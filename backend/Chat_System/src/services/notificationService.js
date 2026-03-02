const presenceService = require('./presenceService');
const { sendPushNotification } = require('../config/firebase');
const redis = require('../config/redis');
const { pool } = require('../config/db');

/**
 * Send FCM push notifications to offline users in a chat room
 * @param {Object} params - Notification parameters
 * @returns {Promise<Object>} { sent: number, failed: number }
 */
async function sendChatPushNotification({
  roomId,
  messageId,
  senderId,
  senderName,
  senderPhoto,
  content,
  messageType,
  roomType,
  roomName,
  recipientUserIds,
}) {
  try {
    if (!recipientUserIds || recipientUserIds.length === 0) {
      return { sent: 0, failed: 0 };
    }

    console.log(
      `[notificationService] Sending push to ${recipientUserIds.length} recipients for message ${messageId}`
    );

    // Send notification to each recipient in parallel
    const sendPromises = recipientUserIds.map(async (userId) => {
      try {
        // Check if user is online
        const isOnline = await presenceService.isUserOnline(userId);
        if (isOnline) {
          console.log(`[notificationService] Skipping online user ${userId}`);
          return { success: false, reason: 'user_online' };
        }

        // Get FCM token from Redis
        let fcmToken = await redis.get(`fcm_token:${userId}`);

        // Fall back to database if not in Redis
        if (!fcmToken) {
          const tokenResult = await pool.query(
            `SELECT fcm_token FROM users WHERE id = $1`,
            [userId]
          );

          if (tokenResult.rows.length > 0) {
            fcmToken = tokenResult.rows[0].fcm_token;
            // Refresh Redis cache
            if (fcmToken) {
              await redis.setWithTTL(`fcm_token:${userId}`, fcmToken, 2592000);
            }
          }
        }

        if (!fcmToken) {
          console.log(`[notificationService] No FCM token for user ${userId}`);
          return { success: false, reason: 'no_token' };
        }

        // Build notification body based on message type
        let notificationBody;
        switch (messageType) {
          case 'image':
            notificationBody = '📷 Sent a photo';
            break;
          case 'video':
            notificationBody = '🎥 Sent a video';
            break;
          case 'voice':
            notificationBody = '🎙️ Sent a voice message';
            break;
          case 'text':
          default:
            // Truncate to 100 chars
            notificationBody = content.length > 100
              ? content.substring(0, 97) + '...'
              : content;
            break;
        }

        // Build notification title
        const notificationTitle = roomType === 'direct'
          ? senderName
          : `${senderName} in ${roomName}`;

        // Build FCM payload
        const notification = {
          title: notificationTitle,
          body: notificationBody,
        };

        const data = {
          type: 'chat_message',
          room_id: roomId,
          message_id: messageId,
          sender_id: senderId,
          click_action: 'OPEN_CHAT_ROOM',
        };

        // Add optional fields
        if (senderPhoto) {
          data.sender_photo = senderPhoto;
        }
        if (roomName) {
          data.room_name = roomName;
        }

        // Send push notification
        const success = await sendPushNotification(fcmToken, notification, data);

        return { success, userId };
      } catch (error) {
        console.error(
          `[notificationService] Error sending push to user ${userId}:`,
          error.message
        );
        return { success: false, reason: 'error', userId };
      }
    });

    // Wait for all sends to complete
    const results = await Promise.allSettled(sendPromises);

    // Count successes and failures
    let sent = 0;
    let failed = 0;

    results.forEach((result) => {
      if (result.status === 'fulfilled' && result.value.success) {
        sent++;
      } else {
        failed++;
      }
    });

    console.log(
      `[notificationService] Push notification results: ${sent} sent, ${failed} failed`
    );

    return { sent, failed };
  } catch (error) {
    console.error('[notificationService] sendChatPushNotification error:', error.message);
    return { sent: 0, failed: recipientUserIds.length };
  }
}

/**
 * Save or update an FCM device token for a user
 * @param {string} userId - User ID
 * @param {string} token - FCM device token
 * @returns {Promise<boolean>} True if successful
 */
async function saveFCMToken(userId, token) {
  try {
    // Save to Redis with 30-day TTL
    await redis.setWithTTL(`fcm_token:${userId}`, token, 2592000);

    // Save to database
    await pool.query(
      `UPDATE users SET fcm_token = $1 WHERE id = $2`,
      [token, userId]
    );

    console.log(`[notificationService] FCM token saved for user ${userId}`);
    return true;
  } catch (error) {
    console.error('[notificationService] saveFCMToken error:', error.message);
    return false;
  }
}

/**
 * Get all offline members of a room
 * @param {string} roomId - Room ID
 * @param {string} excludeUserId - User ID to exclude (usually the sender)
 * @returns {Promise<Array<string>>} Array of offline user IDs
 */
async function getOfflineMembers(roomId, excludeUserId) {
  try {
    // Get all active members of the room
    const result = await pool.query(
      `SELECT user_id FROM chat_room_members 
       WHERE room_id = $1 AND is_active = true AND user_id != $2`,
      [roomId, excludeUserId]
    );

    const memberUserIds = result.rows.map(row => row.user_id);

    if (memberUserIds.length === 0) {
      return [];
    }

    // Check online status for all members
    const onlineStatuses = await presenceService.getManyOnlineStatus(memberUserIds);

    // Filter to only offline members
    const offlineMembers = memberUserIds.filter(userId => !onlineStatuses[userId]);

    return offlineMembers;
  } catch (error) {
    console.error('[notificationService] getOfflineMembers error:', error.message);
    return [];
  }
}

module.exports = {
  sendChatPushNotification,
  saveFCMToken,
  getOfflineMembers,
};
