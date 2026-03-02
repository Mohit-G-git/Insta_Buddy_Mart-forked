const { pool } = require('../config/db');
const redis = require('../config/redis');
const { NotFoundError, ForbiddenError } = require('../utils/errors');
const { v4: uuidv4 } = require('uuid');

/**
 * Get all chat rooms for a user with last message, unread count, and member details
 * @param {string} userId - User ID
 * @returns {Promise<Array>} Array of room objects with last_message and other_member details
 */
async function getRoomsForUser(userId) {
  try {
    const result = await pool.query(
      `SELECT 
        cr.*,
        (
          SELECT row_to_json(m) FROM (
            SELECT content, message_type, sender_id, sent_at
            FROM messages 
            WHERE room_id = cr.id AND is_deleted = false
            ORDER BY sent_at DESC LIMIT 1
          ) m
        ) AS last_message,
        (
          SELECT COUNT(*) FROM messages
          WHERE room_id = cr.id
          AND sent_at > COALESCE(crm.last_read_at, '1970-01-01')
          AND sender_id != $1
          AND is_deleted = false
        ) AS unread_count
      FROM chat_rooms cr
      JOIN chat_room_members crm ON crm.room_id = cr.id AND crm.user_id = $1 AND crm.is_active = true
      ORDER BY cr.last_message_at DESC`,
      [userId]
    );

    // Enrich each room with member details and online status
    const rooms = await Promise.all(
      result.rows.map(async (room) => {
        if (room.room_type === 'direct') {
          // Get the other member for direct rooms
          const otherMemberResult = await pool.query(
            `SELECT u.id, u.full_name, u.username, u.profile_photo
             FROM users u
             JOIN chat_room_members crm ON crm.user_id = u.id
             WHERE crm.room_id = $1 AND u.id != $2`,
            [room.id, userId]
          );

          if (otherMemberResult.rows.length > 0) {
            const otherMember = otherMemberResult.rows[0];
            const isOnline = await redis.exists(`online:${otherMember.id}`);
            room.other_member = {
              ...otherMember,
              is_online: isOnline === 1,
            };
          }
        }

        return room;
      })
    );

    return rooms;
  } catch (error) {
    console.error('[roomService] getRoomsForUser error:', error.message);
    throw error;
  }
}

/**
 * Get a single room by ID if user is a member
 * @param {string} roomId - Room ID
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Room object
 */
async function getRoomById(roomId, userId) {
  try {
    // Verify user is a member
    const memberCheck = await pool.query(
      `SELECT id FROM chat_room_members 
       WHERE room_id = $1 AND user_id = $2 AND is_active = true`,
      [roomId, userId]
    );

    if (memberCheck.rows.length === 0) {
      throw new ForbiddenError(
        'You are not a member of this room',
        'NOT_MEMBER'
      );
    }

    // Get room details
    const roomResult = await pool.query(
      `SELECT * FROM chat_rooms WHERE id = $1`,
      [roomId]
    );

    if (roomResult.rows.length === 0) {
      throw new NotFoundError('Room not found', 'ROOM_NOT_FOUND');
    }

    return roomResult.rows[0];
  } catch (error) {
    console.error('[roomService] getRoomById error:', error.message);
    throw error;
  }
}

/**
 * Create or retrieve a direct message room between two connected users
 * @param {string} myUserId - Current user ID
 * @param {string} targetUserId - Target user ID
 * @returns {Promise<Object>} { room, isNew }
 */
async function createDirectRoom(myUserId, targetUserId) {
  try {
    // Check if users are connected
    const connectionResult = await pool.query(
      `SELECT id FROM connections 
       WHERE ((requester_id = $1 AND receiver_id = $2) 
              OR (requester_id = $2 AND receiver_id = $1))
       AND status = 'accepted'`,
      [myUserId, targetUserId]
    );

    if (connectionResult.rows.length === 0) {
      throw new ForbiddenError(
        'Users must be connected to create a direct message room',
        'NOT_CONNECTED'
      );
    }

    // Check for existing direct room (idempotent)
    const existingRoom = await pool.query(
      `SELECT cr.id FROM chat_rooms cr
       JOIN chat_room_members m1 ON m1.room_id = cr.id AND m1.user_id = $1
       JOIN chat_room_members m2 ON m2.room_id = cr.id AND m2.user_id = $2
       WHERE cr.room_type = 'direct'
       LIMIT 1`,
      [myUserId, targetUserId]
    );

    if (existingRoom.rows.length > 0) {
      const room = await getRoomById(existingRoom.rows[0].id, myUserId);
      return { room, isNew: false };
    }

    // Create new room in a transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const roomId = uuidv4();

      // Create room
      await client.query(
        `INSERT INTO chat_rooms (id, room_type, created_at, last_message_at)
         VALUES ($1, $2, NOW(), NOW())`,
        [roomId, 'direct']
      );

      // Add both users as members
      await client.query(
        `INSERT INTO chat_room_members (room_id, user_id, joined_at)
         VALUES ($1, $2, NOW()), ($1, $3, NOW())`,
        [roomId, myUserId, targetUserId]
      );

      await client.query('COMMIT');

      const newRoom = await getRoomById(roomId, myUserId);
      return { room: newRoom, isNew: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[roomService] createDirectRoom error:', error.message);
    throw error;
  }
}

/**
 * Create a group chat room for an event
 * @param {string} eventId - Event ID
 * @param {string} roomType - Room type ('group')
 * @param {string} roomName - Room name (event title)
 * @param {string} roomPhoto - Room photo URL (event cover photo)
 * @param {Array<string>} memberUserIds - Array of user IDs to add as members
 * @returns {Promise<Object>} Created room object
 */
async function createEventRoom(eventId, roomType, roomName, roomPhoto, memberUserIds) {
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const roomId = uuidv4();

      // Create room
      await client.query(
        `INSERT INTO chat_rooms (id, event_id, room_type, room_name, room_photo, created_at, last_message_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
        [roomId, eventId, roomType, roomName, roomPhoto]
      );

      // Add all members in a single INSERT
      const memberValues = memberUserIds.map((userId, i) => `($1, $${i + 2}, NOW())`).join(',');
      const queryParams = [roomId, ...memberUserIds];

      await client.query(
        `INSERT INTO chat_room_members (room_id, user_id, joined_at)
         VALUES ${memberValues}`,
        queryParams
      );

      // Insert system message
      const systemMessageId = uuidv4();
      await client.query(
        `INSERT INTO messages (id, room_id, sender_id, content, message_type, is_deleted, sent_at, read_by)
         VALUES ($1, $2, NULL, $3, 'system', false, NOW(), '{}')`,
        [systemMessageId, roomId, `Chat created for ${roomName} 🎉`]
      );

      await client.query('COMMIT');

      const newRoom = await getRoomById(roomId, memberUserIds[0]);
      return newRoom;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[roomService] createEventRoom error:', error.message);
    throw error;
  }
}

/**
 * Add a member to a room and insert a system message
 * @param {string} roomId - Room ID
 * @param {string} userId - User ID to add
 * @param {string} systemMessageText - System message text
 * @returns {Promise<Object>} Inserted message object
 */
async function addMemberToRoom(roomId, userId, systemMessageText) {
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Add member (handle if already exists)
      await client.query(
        `INSERT INTO chat_room_members (room_id, user_id, joined_at, is_active)
         VALUES ($1, $2, NOW(), true)
         ON CONFLICT (room_id, user_id) DO UPDATE SET is_active = true`,
        [roomId, userId]
      );

      // Insert system message
      const messageId = uuidv4();
      await client.query(
        `INSERT INTO messages (id, room_id, sender_id, content, message_type, is_deleted, sent_at, read_by)
         VALUES ($1, $2, NULL, $3, 'system', false, NOW(), '{}')`,
        [messageId, roomId, systemMessageText]
      );

      // Update room's last_message_at
      await client.query(
        `UPDATE chat_rooms SET last_message_at = NOW() WHERE id = $1`,
        [roomId]
      );

      await client.query('COMMIT');

      // Return the system message
      const messageResult = await client.query(
        `SELECT * FROM messages WHERE id = $1`,
        [messageId]
      );

      return messageResult.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[roomService] addMemberToRoom error:', error.message);
    throw error;
  }
}

/**
 * Get all active members of a room with profile and online status
 * @param {string} roomId - Room ID
 * @returns {Promise<Array>} Array of member objects with online status
 */
async function getRoomMembers(roomId) {
  try {
    const result = await pool.query(
      `SELECT 
        crm.room_id,
        crm.user_id,
        crm.joined_at,
        crm.last_read_at,
        u.full_name,
        u.username,
        u.profile_photo
       FROM chat_room_members crm
       JOIN users u ON u.id = crm.user_id
       WHERE crm.room_id = $1 AND crm.is_active = true
       ORDER BY crm.joined_at ASC`,
      [roomId]
    );

    // Add is_online status from Redis
    const membersWithStatus = await Promise.all(
      result.rows.map(async (member) => {
        const isOnline = await redis.exists(`online:${member.user_id}`);
        return {
          ...member,
          is_online: isOnline === 1,
        };
      })
    );

    return membersWithStatus;
  } catch (error) {
    console.error('[roomService] getRoomMembers error:', error.message);
    throw error;
  }
}

module.exports = {
  getRoomsForUser,
  getRoomById,
  createDirectRoom,
  createEventRoom,
  addMemberToRoom,
  getRoomMembers,
};
