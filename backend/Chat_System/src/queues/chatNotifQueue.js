const Queue = require('bull');
const notificationService = require('../services/notificationService');

// Create Bull queue using Redis
// Job-level options will control retention (in addNotificationJob function)
const chatNotifQueue = new Queue('chat-notifications', process.env.REDIS_URL);

// Configure concurrency
const concurrency = parseInt(process.env.BULL_CONCURRENCY) || 5;

/**
 * Process notification jobs
 */
chatNotifQueue.process(concurrency, async (job) => {
  const {
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
  } = job.data;

  try {
    console.log(`[chatNotifQueue] Processing job ${job.id} for message ${messageId}`);

    const result = await notificationService.sendChatPushNotification({
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
    });

    console.log(
      `[chatNotifQueue] Job ${job.id} completed: ${result.sent} sent, ${result.failed} failed`
    );

    // Return result metadata
    return {
      success: true,
      messageId,
      recipientCount: recipientUserIds.length,
      sent: result.sent,
      failed: result.failed,
    };
  } catch (error) {
    console.error(
      `[chatNotifQueue] Job ${job.id} processing error (attempt ${job.attemptsMade + 1}):`,
      error.message
    );
    throw error;
  }
});

/**
 * Event listener: Job completed successfully
 */
chatNotifQueue.on('completed', (job, result) => {
  console.log(
    `[chatNotifQueue] ✓ Job ${job.id} completed: ${result.recipientCount} recipients, ${result.sent} sent`
  );
});

/**
 * Event listener: Job failed after all retries
 */
chatNotifQueue.on('failed', (job, error) => {
  console.error(
    `[chatNotifQueue] ✗ Job ${job.id} failed (attempt ${job.attemptsMade}/${job.opts.attempts}): ${error.message}`
  );
});

/**
 * Event listener: Job stalled (being processed but not progressing)
 */
chatNotifQueue.on('stalled', (job) => {
  console.warn(`[chatNotifQueue] ⚠ Job ${job.id} stalled and will be retried`);
});

/**
 * Add a new notification job to the queue
 * @param {Object} payload - Notification job payload matching Section 8 of README
 * @returns {Promise<Job>} Bull Job object
 */
async function addNotificationJob(payload) {
  try {
    const job = await chatNotifQueue.add(payload, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: 100,
      removeOnFail: 500,
    });

    console.log(`[chatNotifQueue] Added notification job ${job.id} for message ${payload.messageId}`);
    return job;
  } catch (error) {
    console.error('[chatNotifQueue] Error adding job:', error.message);
    throw error;
  }
}

module.exports = {
  chatNotifQueue,
  addNotificationJob,
};
