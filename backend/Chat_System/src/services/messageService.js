const { pool } = require('../config/db');
const redis = require('../config/redis');
const { ForbiddenError, NotFoundError } = require('../utils/errors');
const { v4: uuidv4 } = require('uuid');

/**
 * Save a message to the database
 * @param {Object} params - Message parameters
 * @returns {Promise<Object>} Full message object with sender info
 */
async function saveMessage({
  roomId,
  senderId,
  content,
  messageType,
  mediaUrl,
  mediaThumb,
  mediaSizeKb,
  replyToId,
}) {
  try {
    const messageId = uuidv4();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Insert message
      await client.query(
        `INSERT INTO messages (
          id, room_id, sender_id, content, message_type,
          media_url, media_thumb, media_size_kb, reply_to_id, sent_at, read_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), '{}')`,
        [messageId, roomId, senderId, content, messageType, mediaUrl, mediaThumb, mediaSizeKb, replyToId]
      );

      // Update room's last_message_at
      await client.query(
        `UPDATE chat_rooms SET last_message_at = NOW() WHERE id = $1`,
        [roomId]
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    // Fetch the saved message with sender info
    const messageResult = await pool.query(
      `SELECT 
        m.*,
        row_to_json(u) AS sender
       FROM messages m
       LEFT JOIN users u ON u.id = m.sender_id
       WHERE m.id = $1`,
      [messageId]
    );

    if (messageResult.rows.length === 0) {
      throw new NotFoundError('Message not found after insert', 'MESSAGE_NOT_FOUND');
    }

    const message = messageResult.rows[0];

    // If replyToId, fetch the reply_to message
    if (replyToId) {
      const replyResult = await pool.query(
        `SELECT id, content, message_type, sender_id FROM messages WHERE id = $1`,
        [replyToId]
      );

      if (replyResult.rows.length > 0) {
        message.reply_to = replyResult.rows[0];
      }
    } else {
      message.reply_to = null;
    }

    // Format sender details
    if (message.sender) {
      message.sender = {
        id: message.sender.id,
        full_name: message.sender.full_name,
        username: message.sender.username,
        profile_photo: message.sender.profile_photo,
      };
    }

    return message;
  } catch (error) {
    console.error('[messageService] saveMessage error:', error.message);
    throw error;
  }
}

/**
 * Get paginated messages from a room
 * @param {string} roomId - Room ID
 * @param {number} page - Page number (1-indexed)
 * @param {number} limit - Messages per page
 * @returns {Promise<Object>} { messages, pagination }
 */
async function getMessages(roomId, page, limit) {
  try {
    const offset = (page - 1) * limit;

    // Try Redis cache for page 1
    if (page === 1) {
      const cachedMessages = await redis.getList(`chat:${roomId}:recent`, 0, -1);
      
      if (cachedMessages && cachedMessages.length > 0) {
        // Reverse to get chronological order (oldest first)
        const messages = cachedMessages.reverse();
        return {
          messages,
          pagination: {
            page,
            limit,
            has_more: false,
          },
        };
      }
    }

    // Fall back to database
    const totalResult = await pool.query(
      `SELECT COUNT(*) as count FROM messages WHERE room_id = $1 AND is_deleted = false`,
      [roomId]
    );

    const total = parseInt(totalResult.rows[0].count);
    const hasMore = offset + limit < total;

    const result = await pool.query(
      `SELECT 
        m.*,
        row_to_json(u) AS sender
       FROM messages m
       LEFT JOIN users u ON u.id = m.sender_id
       WHERE m.room_id = $1 AND m.is_deleted = false
       ORDER BY m.sent_at DESC
       LIMIT $2 OFFSET $3`,
      [roomId, limit, offset]
    );

    // Format messages
    const messages = result.rows.map(row => ({
      id: row.id,
      room_id: row.room_id,
      sender_id: row.sender_id,
      sender: row.sender ? {
        id: row.sender.id,
        full_name: row.sender.full_name,
        username: row.sender.username,
        profile_photo: row.sender.profile_photo,
      } : null,
      content: row.content,
      message_type: row.message_type,
      media_url: row.media_url,
      media_thumb: row.media_thumb,
      reply_to_id: row.reply_to_id,
      reply_to: null, // Could be populated if needed
      is_deleted: row.is_deleted,
      sent_at: row.sent_at,
      read_by: row.read_by,
    }));

    // Reverse to get chronological order (oldest first)
    messages.reverse();

    return {
      messages,
      pagination: {
        page,
        limit,
        has_more: hasMore,
      },
    };
  } catch (error) {
    console.error('[messageService] getMessages error:', error.message);
    throw error;
  }
}

/**
 * Soft delete a message (only mark as deleted, keep row for threading)
 * @param {string} messageId - Message ID to delete
 * @param {string} userId - User ID (must be the sender)
 * @returns {Promise<Object>} { messageId, roomId }
 */
async function softDeleteMessage(messageId, userId) {
  try {
    // Verify message exists and user is the sender
    const messageResult = await pool.query(
      `SELECT id, room_id, sender_id FROM messages WHERE id = $1`,
      [messageId]
    );

    if (messageResult.rows.length === 0) {
      throw new NotFoundError('Message not found', 'MESSAGE_NOT_FOUND');
    }

    const message = messageResult.rows[0];

    if (message.sender_id !== userId) {
      throw new ForbiddenError(
        'You can only delete your own messages',
        'NOT_OWNER'
      );
    }

    // Soft delete the message
    await pool.query(
      `UPDATE messages 
       SET is_deleted = true, deleted_at = NOW(), content = NULL, 
           media_url = NULL, media_thumb = NULL
       WHERE id = $1`,
      [messageId]
    );

    // Invalidate Redis cache for this room
    await redis.deleteKey(`chat:${message.room_id}:recent`);

    return {
      messageId,
      roomId: message.room_id,
    };
  } catch (error) {
    console.error('[messageService] softDeleteMessage error:', error.message);
    throw error;
  }
}

/**
 * Mark all messages in a room as read by a user
 * @param {string} roomId - Room ID
 * @param {string} userId - User ID
 * @returns {Promise<number>} Count of messages updated
 */
async function markRoomAsRead(roomId, userId) {
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Update last_read_at for the member
      await client.query(
        `UPDATE chat_room_members 
         SET last_read_at = NOW()
         WHERE room_id = $1 AND user_id = $2`,
        [roomId, userId]
      );

      // Add userId to read_by array for unread messages
      const updateResult = await client.query(
        `UPDATE messages 
         SET read_by = array_append(read_by, $1::uuid)
         WHERE room_id = $2 
         AND NOT ($1::uuid = ANY(read_by))
         AND sender_id != $1`,
        [userId, roomId]
      );

      await client.query('COMMIT');

      return updateResult.rowCount;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[messageService] markRoomAsRead error:', error.message);
    throw error;
  }
}

/**
 * Push a message to the Redis recent messages cache
 * @param {string} roomId - Room ID
 * @param {Object} messageObject - Full message object to cache
 * @returns {Promise<boolean>} True on success, false on error
 */
async function pushMessageToCache(roomId, messageObject) {
  try {
    const key = `chat:${roomId}:recent`;
    return await redis.pushToList(key, messageObject, 49); // Keep 50 messages (0-49)
  } catch (error) {
    console.error('[messageService] pushMessageToCache error:', error.message);
    return false;
  }
}

module.exports = {
  saveMessage,
  getMessages,
  softDeleteMessage,
  markRoomAsRead,
  pushMessageToCache,
};
