const socketAuthMiddleware = require('./socketAuth');
const presenceService = require('../services/presenceService');
const messageService = require('../services/messageService');
const { checkMessageRateLimit } = require('../middleware/rateLimiter');
const { validate, sendMessageSchema } = require('../utils/validators');
const { addNotificationJob } = require('../queues/chatNotifQueue');
const { getOfflineMembers } = require('../services/notificationService');
const { pool } = require('../config/db');
const roomService = require('../services/roomService');

/**
 * Initialize Socket.io event handlers
 * @param {Server} io - Socket.io server instance
 */
function initSocketHandlers(io) {
  // Apply authentication middleware to all connections
  io.use(socketAuthMiddleware);

  // Handle connection
  io.on('connection', async (socket) => {
    const userId = socket.userId;
    const userIdMasked = userId.substring(0, 8);

    try {
      // Mark user as online
      await presenceService.setUserOnline(userId);

      console.log(`[socketHandler] User ${userIdMasked}... connected`);

      // Join all active chat rooms for this user
      const roomsResult = await pool.query(
        `SELECT room_id FROM chat_room_members 
         WHERE user_id = $1 AND is_active = true`,
        [userId]
      );

      roomsResult.rows.forEach(row => {
        socket.join(row.room_id);
      });

      if (roomsResult.rows.length > 0) {
        console.log(
          `[socketHandler] User ${userIdMasked}... joined ${roomsResult.rows.length} room(s)`
        );
      }

      // Broadcast user online to all rooms
      socket.rooms.forEach(roomId => {
        if (roomId !== socket.id) { // Skip the socket's own ID
          io.to(roomId).emit('user_online', { userId });
        }
      });

      // =====================================================================
      // Event: join_room
      // =====================================================================
      socket.on('join_room', async (payload) => {
        try {
          const { roomId } = payload;

          if (!roomId) {
            return socket.emit('error', {
              code: 'INVALID_PAYLOAD',
              message: 'roomId is required',
            });
          }

          // Verify user is a member of this room
          const memberCheck = await pool.query(
            `SELECT id FROM chat_room_members 
             WHERE room_id = $1 AND user_id = $2 AND is_active = true`,
            [roomId, userId]
          );

          if (memberCheck.rows.length === 0) {
            return socket.emit('error', {
              code: 'NOT_MEMBER',
              message: 'You are not a member of this room',
            });
          }

          // Join the room
          socket.join(roomId);

          // Refresh online status
          await presenceService.refreshOnlineStatus(userId);

          console.log(`[socketHandler] User ${userIdMasked}... joined room ${roomId.substring(0, 8)}...`);
        } catch (error) {
          console.error('[socketHandler] join_room error:', error.message);
          socket.emit('error', {
            code: 'ROOM_JOIN_ERROR',
            message: 'Failed to join room',
          });
        }
      });

      // =====================================================================
      // Event: send_message
      // =====================================================================
      socket.on('send_message', async (payload) => {
        try {
          // Rate limit check
          const isAllowed = await checkMessageRateLimit(userId);
          if (!isAllowed) {
            return socket.emit('error', {
              code: 'RATE_LIMITED',
              message: 'Too many messages. Maximum 60 per minute.',
            });
          }

          // Validate payload
          const validation = validate(sendMessageSchema, payload);
          if (validation.error) {
            return socket.emit('error', {
              code: 'VALIDATION_ERROR',
              message: validation.error.message,
              details: validation.error.details,
            });
          }

          const { roomId, content, type, mediaUrl, replyToId } = validation.value;

          // Verify user is a member of this room
          const memberCheck = await pool.query(
            `SELECT id FROM chat_room_members 
             WHERE room_id = $1 AND user_id = $2 AND is_active = true`,
            [roomId, userId]
          );

          if (memberCheck.rows.length === 0) {
            return socket.emit('error', {
              code: 'NOT_MEMBER',
              message: 'You are not a member of this room',
            });
          }

          // Check if user is blocked in direct rooms
          const roomResult = await pool.query(
            `SELECT room_type FROM chat_rooms WHERE id = $1`,
            [roomId]
          );

          if (roomResult.rows.length > 0 && roomResult.rows[0].room_type === 'direct') {
            // Get the other member
            const otherMemberResult = await pool.query(
              `SELECT user_id FROM chat_room_members WHERE room_id = $1 AND user_id != $2`,
              [roomId, userId]
            );

            if (otherMemberResult.rows.length > 0) {
              const otherUserId = otherMemberResult.rows[0].user_id;

              // Check if blocked
              const blockedCheck = await pool.query(
                `SELECT id FROM connections 
                 WHERE ((requester_id = $1 AND receiver_id = $2) 
                        OR (requester_id = $2 AND receiver_id = $1))
                 AND status = 'blocked'`,
                [userId, otherUserId]
              );

              if (blockedCheck.rows.length > 0) {
                return socket.emit('error', {
                  code: 'BLOCKED',
                  message: 'You cannot message this user',
                });
              }
            }
          }

          // Save message
          const message = await messageService.saveMessage({
            roomId,
            senderId: userId,
            content,
            messageType: type,
            mediaUrl,
            mediaThumb: null,
            mediaSizeKb: null,
            replyToId,
          });

          // Push to cache
          await messageService.pushMessageToCache(roomId, message);

          // Refresh online status
          await presenceService.refreshOnlineStatus(userId);

          // Broadcast to all room members
          io.to(roomId).emit('new_message', message);

          // Get offline members and queue FCM notifications
          const offlineMembers = await getOfflineMembers(roomId, userId);

          if (offlineMembers.length > 0) {
            const roomInfo = await roomService.getRoomById(roomId, userId);
            
            await addNotificationJob({
              roomId,
              messageId: message.id,
              senderId: userId,
              senderName: message.sender?.full_name || 'User',
              senderPhoto: message.sender?.profile_photo,
              content: content || '',
              messageType: type,
              roomType: roomInfo.room_type,
              roomName: roomInfo.room_name,
              recipientUserIds: offlineMembers,
            });
          }

          console.log(`[socketHandler] Message sent in room ${roomId.substring(0, 8)}...`);
        } catch (error) {
          console.error('[socketHandler] send_message error:', error.message);
          socket.emit('error', {
            code: 'MESSAGE_SEND_ERROR',
            message: 'Failed to send message',
          });
        }
      });

      // =====================================================================
      // Event: typing_start
      // =====================================================================
      socket.on('typing_start', async (payload) => {
        try {
          const { roomId } = payload;

          if (!roomId) {
            return socket.emit('error', {
              code: 'INVALID_PAYLOAD',
              message: 'roomId is required',
            });
          }

          // Verify membership
          const memberCheck = await pool.query(
            `SELECT id FROM chat_room_members 
             WHERE room_id = $1 AND user_id = $2 AND is_active = true`,
            [roomId, userId]
          );

          if (memberCheck.rows.length === 0) {
            return socket.emit('error', {
              code: 'NOT_MEMBER',
              message: 'You are not a member of this room',
            });
          }

          // Set typing indicator
          await presenceService.setTyping(roomId, userId);

          // Broadcast to others in the room (not sender)
          socket.to(roomId).emit('user_typing', { userId, roomId });

          console.log(`[socketHandler] User ${userIdMasked}... typing in room ${roomId.substring(0, 8)}...`);
        } catch (error) {
          console.error('[socketHandler] typing_start error:', error.message);
          socket.emit('error', {
            code: 'TYPING_ERROR',
            message: 'Failed to set typing indicator',
          });
        }
      });

      // =====================================================================
      // Event: typing_stop
      // =====================================================================
      socket.on('typing_stop', async (payload) => {
        try {
          const { roomId } = payload;

          if (!roomId) {
            return socket.emit('error', {
              code: 'INVALID_PAYLOAD',
              message: 'roomId is required',
            });
          }

          // Clear typing indicator
          await presenceService.clearTyping(roomId, userId);

          // Broadcast to others in the room
          socket.to(roomId).emit('user_stopped_typing', { userId, roomId });

          console.log(`[socketHandler] User ${userIdMasked}... stopped typing in room ${roomId.substring(0, 8)}...`);
        } catch (error) {
          console.error('[socketHandler] typing_stop error:', error.message);
          socket.emit('error', {
            code: 'TYPING_ERROR',
            message: 'Failed to clear typing indicator',
          });
        }
      });

      // =====================================================================
      // Event: mark_read
      // =====================================================================
      socket.on('mark_read', async (payload) => {
        try {
          const { roomId } = payload;

          if (!roomId) {
            return socket.emit('error', {
              code: 'INVALID_PAYLOAD',
              message: 'roomId is required',
            });
          }

          // Verify membership
          const memberCheck = await pool.query(
            `SELECT id FROM chat_room_members 
             WHERE room_id = $1 AND user_id = $2 AND is_active = true`,
            [roomId, userId]
          );

          if (memberCheck.rows.length === 0) {
            return socket.emit('error', {
              code: 'NOT_MEMBER',
              message: 'You are not a member of this room',
            });
          }

          // Mark messages as read
          const count = await messageService.markRoomAsRead(roomId, userId);

          // Broadcast read receipt to others in the room
          socket.to(roomId).emit('message_read', {
            userId,
            roomId,
            readAt: new Date(),
          });

          console.log(`[socketHandler] User ${userIdMasked}... marked ${count} message(s) as read`);
        } catch (error) {
          console.error('[socketHandler] mark_read error:', error.message);
          socket.emit('error', {
            code: 'READ_RECEIPT_ERROR',
            message: 'Failed to mark messages as read',
          });
        }
      });

      // =====================================================================
      // Event: disconnect
      // =====================================================================
      socket.on('disconnect', async () => {
        try {
          // Mark user as offline
          await presenceService.setUserOffline(userId);

          // Get all rooms this socket was in
          const roomIds = Array.from(socket.rooms).filter(roomId => roomId !== socket.id);

          // Broadcast offline status to all rooms
          roomIds.forEach(roomId => {
            io.to(roomId).emit('user_offline', { userId });
          });

          console.log(`[socketHandler] User ${userIdMasked}... disconnected`);
        } catch (error) {
          console.error('[socketHandler] disconnect error:', error.message);
        }
      });

      // Refresh online status on any other event
      socket.onAny(async () => {
        await presenceService.refreshOnlineStatus(userId);
      });
    } catch (error) {
      console.error('[socketHandler] Connection error:', error.message);
      socket.emit('error', {
        code: 'CONNECTION_ERROR',
        message: 'Connection failed',
      });
      socket.disconnect();
    }
  });
}

module.exports = {
  initSocketHandlers,
};
