const express = require('express');
const multer = require('multer');
const auth = require('../middleware/auth');
const memberCheck = require('../middleware/memberCheck');
const { uploadLimiter } = require('../middleware/rateLimiter');
const roomService = require('../services/roomService');
const messageService = require('../services/messageService');
const mediaService = require('../services/mediaService');
const notificationService = require('../services/notificationService');
const { validate, createDirectRoomSchema, paginationSchema, mediaUploadSchema, sendTextMessageSchema, createGroupRoomSchema, addMemberSchema } = require('../utils/validators');

const router = express.Router();

// Store the Socket.io instance for emitting events
let io = null;

/**
 * Set the Socket.io instance (call this from app.js)
 * @param {Server} socketIO - Socket.io server instance
 */
function setSocketIO(socketIO) {
  io = socketIO;
}

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max (we'll validate per message type)
  },
});

// ============================================================================
// GET /rooms - Get all chat rooms for the authenticated user
// ============================================================================
router.get('/rooms', auth, async (req, res, next) => {
  try {
    const rooms = await roomService.getRoomsForUser(req.userId);
    res.json(rooms);
  } catch (error) {
    console.error('[chat.routes] GET /rooms error:', error.message);
    next(error);
  }
});

// ============================================================================
// GET /rooms/:roomId/messages - Get paginated messages from a room
// ============================================================================
router.get('/rooms/:roomId/messages', auth, memberCheck, async (req, res, next) => {
  try {
    // Validate pagination params
    const validation = validate(paginationSchema, req.query);
    if (validation.error) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: validation.error.message,
          details: validation.error.details,
        },
      });
    }

    const { page, limit } = validation.value;

    const result = await messageService.getMessages(req.params.roomId, page, limit);

    res.json(result);
  } catch (error) {
    console.error('[chat.routes] GET /rooms/:roomId/messages error:', error.message);
    next(error);
  }
});

// ============================================================================
// GET /rooms/:roomId/members - Get all members of a room
// ============================================================================
router.get('/rooms/:roomId/members', auth, memberCheck, async (req, res, next) => {
  try {
    const members = await roomService.getRoomMembers(req.params.roomId);
    res.json(members);
  } catch (error) {
    console.error('[chat.routes] GET /rooms/:roomId/members error:', error.message);
    next(error);
  }
});

// ============================================================================
// POST /rooms/direct - Create or retrieve a direct message room
// ============================================================================
router.post('/rooms/direct', auth, async (req, res, next) => {
  try {
    // Validate request body
    const validation = validate(createDirectRoomSchema, req.body);
    if (validation.error) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: validation.error.message,
          details: validation.error.details,
        },
      });
    }

    const { target_user_id } = validation.value;

    const { room, isNew } = await roomService.createDirectRoom(req.userId, target_user_id);

    const statusCode = isNew ? 201 : 200;
    res.status(statusCode).json(room);
  } catch (error) {
    console.error('[chat.routes] POST /rooms/direct error:', error.message);
    next(error);
  }
});

// ============================================================================
// POST /rooms/:roomId/media - Upload media (image, video, voice) to a room
// ============================================================================
router.post(
  '/rooms/:roomId/media',
  auth,
  memberCheck,
  uploadLimiter,
  upload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          error: {
            code: 'NO_FILE',
            message: 'No file provided',
          },
        });
      }

      // Validate media metadata
      const validation = validate(mediaUploadSchema, req.body);
      if (validation.error) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: validation.error.message,
            details: validation.error.details,
          },
        });
      }

      const { message_type, reply_to_id } = validation.value;

      // Validate file type
      if (!mediaService.validateFileType(req.file.mimetype, message_type)) {
        return res.status(400).json({
          error: {
            code: 'INVALID_FILE_TYPE',
            message: `File type not allowed for ${message_type}`,
          },
        });
      }

      // Upload to S3 and get CloudFront URLs
      const { mediaUrl, mediaThumb, mediaSizeKb } = await mediaService.uploadChatMedia(
        {
          buffer: req.file.buffer,
          mimetype: req.file.mimetype,
          originalname: req.file.originalname,
          size: req.file.size,
        },
        req.params.roomId,
        message_type
      );

      // Save message to database
      const message = await messageService.saveMessage({
        roomId: req.params.roomId,
        senderId: req.userId,
        content: null,
        messageType: message_type,
        mediaUrl,
        mediaThumb,
        mediaSizeKb,
        replyToId: reply_to_id,
      });

      // Push to cache
      await messageService.pushMessageToCache(req.params.roomId, message);

      // Broadcast to all room members via Socket.io
      if (io) {
        io.to(req.params.roomId).emit('new_message', message);
      }

      // Queue FCM notifications for offline members
      const offlineMembers = await notificationService.getOfflineMembers(
        req.params.roomId,
        req.userId
      );

      if (offlineMembers.length > 0) {
        const room = await roomService.getRoomById(req.params.roomId, req.userId);

        await notificationService.sendChatPushNotification({
          roomId: req.params.roomId,
          messageId: message.id,
          senderId: req.userId,
          senderName: message.sender?.full_name || 'User',
          senderPhoto: message.sender?.profile_photo,
          content: '',
          messageType: message_type,
          roomType: room.room_type,
          roomName: room.room_name,
          recipientUserIds: offlineMembers,
        });
      }

      res.status(201).json(message);
    } catch (error) {
      console.error('[chat.routes] POST /rooms/:roomId/media error:', error.message);
      next(error);
    }
  }
);

// ============================================================================
// DELETE /rooms/:roomId/messages/:messageId - Soft delete a message
// ============================================================================
router.delete('/rooms/:roomId/messages/:messageId', auth, memberCheck, async (req, res, next) => {
  try {
    const { messageId, roomId } = req.params;

    const deleted = await messageService.softDeleteMessage(messageId, req.userId);

    // Broadcast deletion to all room members via Socket.io
    if (io) {
      io.to(roomId).emit('message_deleted', {
        messageId,
        roomId,
      });
    }

    res.json({
      message: 'Message deleted successfully',
      ...deleted,
    });
  } catch (error) {
    console.error('[chat.routes] DELETE /rooms/:roomId/messages/:messageId error:', error.message);
    next(error);
  }
});

// ============================================================================
// POST /rooms/:roomId/messages - Send a text message to a room
// ============================================================================
router.post('/rooms/:roomId/messages', auth, memberCheck, async (req, res, next) => {
  try {
    // Validate request body
    const validation = validate(sendTextMessageSchema, req.body);
    if (validation.error) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: validation.error.message,
          details: validation.error.details,
        },
      });
    }

    const { content, reply_to_id } = validation.value;
    const { roomId } = req.params;

    // Save message to database
    const message = await messageService.saveMessage({
      roomId,
      senderId: req.userId,
      content,
      messageType: 'text',
      mediaUrl: null,
      mediaThumb: null,
      mediaSizeKb: null,
      replyToId: reply_to_id,
    });

    // Push to cache
    await messageService.pushMessageToCache(roomId, message);

    // Broadcast to all room members via Socket.io
    if (io) {
      io.to(roomId).emit('new_message', message);
    }

    // Queue FCM notifications for offline members
    const offlineMembers = await notificationService.getOfflineMembers(roomId, req.userId);

    if (offlineMembers.length > 0) {
      const room = await roomService.getRoomById(roomId, req.userId);

      await notificationService.sendChatPushNotification({
        roomId,
        messageId: message.id,
        senderId: req.userId,
        senderName: message.sender?.full_name || 'User',
        senderPhoto: message.sender?.profile_photo,
        content: content.substring(0, 100), // Truncate for notification
        messageType: 'text',
        roomType: room.room_type,
        roomName: room.room_name,
        recipientUserIds: offlineMembers,
      });
    }

    res.status(201).json(message);
  } catch (error) {
    console.error('[chat.routes] POST /rooms/:roomId/messages error:', error.message);
    next(error);
  }
});

// ============================================================================
// POST /rooms/group - Create a new group chat room
// ============================================================================
router.post('/rooms/group', auth, async (req, res, next) => {
  try {
    // Validate request body
    const validation = validate(createGroupRoomSchema, req.body);
    if (validation.error) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: validation.error.message,
          details: validation.error.details,
        },
      });
    }

    const { room_name, member_ids, room_photo } = validation.value;

    // Add creator to member list if not already included
    const allMemberIds = Array.from(new Set([req.userId, ...member_ids]));

    // Create group room
    const room = await roomService.createEventRoom(
      null, // No event_id for generic groups
      'group',
      room_name,
      room_photo || null,
      allMemberIds
    );

    res.status(201).json(room);
  } catch (error) {
    console.error('[chat.routes] POST /rooms/group error:', error.message);
    next(error);
  }
});

// ============================================================================
// POST /rooms/:roomId/members - Add a member to a room
// ============================================================================
router.post('/rooms/:roomId/members', auth, memberCheck, async (req, res, next) => {
  try {
    // Validate request body
    const validation = validate(addMemberSchema, req.body);
    if (validation.error) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: validation.error.message,
          details: validation.error.details,
        },
      });
    }

    const { user_id } = validation.value;
    const { roomId } = req.params;

    // Add member with system message
    const result = await roomService.addMemberToRoom(
      roomId,
      user_id,
      `User was added to the group by ${req.userId}`
    );

    // Broadcast member addition via Socket.io
    if (io) {
      io.to(roomId).emit('member_added', {
        roomId,
        userId: user_id,
        timestamp: new Date(),
      });
    }

    res.status(201).json({
      message: 'Member added successfully',
      ...result,
    });
  } catch (error) {
    console.error('[chat.routes] POST /rooms/:roomId/members error:', error.message);
    next(error);
  }
});

module.exports = router;
module.exports.setSocketIO = setSocketIO;
