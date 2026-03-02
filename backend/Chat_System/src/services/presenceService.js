const redis = require('../config/redis');
const { pool } = require('../config/db');

/**
 * Set a user as online
 * @param {string} userId - User ID
 * @returns {Promise<boolean>} True if successful
 */
async function setUserOnline(userId) {
  try {
    const timestamp = Date.now().toString();
    return await redis.setWithTTL(`online:${userId}`, timestamp, 300);
  } catch (error) {
    console.error('[presenceService] setUserOnline error:', error.message);
    return false;
  }
}

/**
 * Set a user as offline
 * @param {string} userId - User ID
 * @returns {Promise<boolean>} True if successful
 */
async function setUserOffline(userId) {
  try {
    await redis.deleteKey(`online:${userId}`);
    await updateLastActive(userId);
    return true;
  } catch (error) {
    console.error('[presenceService] setUserOffline error:', error.message);
    return false;
  }
}

/**
 * Check if a user is currently online
 * @param {string} userId - User ID
 * @returns {Promise<boolean>} True if online and key exists
 */
async function isUserOnline(userId) {
  try {
    const exists = await redis.exists(`online:${userId}`);
    return exists === 1;
  } catch (error) {
    console.error('[presenceService] isUserOnline error:', error.message);
    return false;
  }
}

/**
 * Refresh the online status TTL for a user
 * Called on every socket event to keep the user marked as online
 * @param {string} userId - User ID
 * @returns {Promise<boolean>} True if successful
 */
async function refreshOnlineStatus(userId) {
  try {
    const result = await redis.expire(`online:${userId}`, 300);
    return result > 0; // Returns 1 if TTL was set, 0 if key doesn't exist
  } catch (error) {
    console.error('[presenceService] refreshOnlineStatus error:', error.message);
    return false;
  }
}

/**
 * Check online status for multiple users at once
 * @param {Array<string>} userIds - Array of user IDs
 * @returns {Promise<Object>} Map of userId -> boolean
 */
async function getManyOnlineStatus(userIds) {
  try {
    if (!userIds || userIds.length === 0) {
      return {};
    }

    const keys = userIds.map(id => `online:${id}`);
    const results = await redis.mget(...keys);

    const onlineMap = {};
    userIds.forEach((userId, index) => {
      onlineMap[userId] = results[index] !== null;
    });

    return onlineMap;
  } catch (error) {
    console.error('[presenceService] getManyOnlineStatus error:', error.message);
    // Return all users as offline on error
    const offlineMap = {};
    userIds.forEach(userId => {
      offlineMap[userId] = false;
    });
    return offlineMap;
  }
}

/**
 * Update the last_active_at timestamp for a user in the database
 * @param {string} userId - User ID
 * @returns {Promise<boolean>} True if successful
 */
async function updateLastActive(userId) {
  try {
    await pool.query(
      `UPDATE users SET last_active_at = NOW() WHERE id = $1`,
      [userId]
    );
    return true;
  } catch (error) {
    console.error('[presenceService] updateLastActive error:', error.message);
    return false;
  }
}

/**
 * Mark that a user is typing in a room
 * @param {string} roomId - Room ID
 * @param {string} userId - User ID
 * @returns {Promise<boolean>} True if successful
 */
async function setTyping(roomId, userId) {
  try {
    const key = `typing:${roomId}`;
    
    // Add user to the set
    await redis.sadd(key, userId);
    
    // Set TTL to 8 seconds (auto-clear if client crashes)
    await redis.expire(key, 8);
    
    return true;
  } catch (error) {
    console.error('[presenceService] setTyping error:', error.message);
    return false;
  }
}

/**
 * Mark that a user stopped typing in a room
 * @param {string} roomId - Room ID
 * @param {string} userId - User ID
 * @returns {Promise<boolean>} True if successful
 */
async function clearTyping(roomId, userId) {
  try {
    const key = `typing:${roomId}`;
    await redis.srem(key, userId);
    return true;
  } catch (error) {
    console.error('[presenceService] clearTyping error:', error.message);
    return false;
  }
}

/**
 * Get all users currently typing in a room
 * @param {string} roomId - Room ID
 * @returns {Promise<Array<string>>} Array of user IDs
 */
async function getTypingUsers(roomId) {
  try {
    const key = `typing:${roomId}`;
    const members = await redis.smembers(key);
    return members || [];
  } catch (error) {
    console.error('[presenceService] getTypingUsers error:', error.message);
    return [];
  }
}

module.exports = {
  setUserOnline,
  setUserOffline,
  isUserOnline,
  refreshOnlineStatus,
  getManyOnlineStatus,
  updateLastActive,
  setTyping,
  clearTyping,
  getTypingUsers,
};
