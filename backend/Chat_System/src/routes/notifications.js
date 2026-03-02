const express = require('express');
const auth = require('../middleware/auth');
const notificationService = require('../services/notificationService');
const { validate, registerFCMSchema } = require('../utils/validators');

const router = express.Router();

// ============================================================================
// POST /register - Register FCM token for push notifications
// ============================================================================
router.post('/register', auth, async (req, res, next) => {
  try {
    // Validate request body
    const validation = validate(registerFCMSchema, req.body);
    if (validation.error) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: validation.error.message,
          details: validation.error.details,
        },
      });
    }

    const { fcm_token } = validation.value;

    // Save FCM token for user
    await notificationService.saveFCMToken(req.userId, fcm_token);

    res.json({
      message: 'FCM token registered successfully',
      userId: req.userId,
    });
  } catch (error) {
    console.error('[notifications.routes] POST /register error:', error.message);
    next(error);
  }
});

module.exports = router;
