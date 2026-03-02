const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');

/**
 * Socket.io authentication middleware
 * Verifies JWT token on WebSocket connection and validates user exists
 */
module.exports = async (socket, next) => {
  try {
    const authToken = socket.handshake.auth?.token;

    // Check if token exists
    if (!authToken) {
      return next(new Error('INVALID_TOKEN'));
    }

    // Remove "Bearer " prefix if present
    const token = authToken.startsWith('Bearer ')
      ? authToken.slice(7)
      : authToken;

    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (verifyError) {
      return next(new Error('INVALID_TOKEN'));
    }

    if (!decoded.userId) {
      return next(new Error('INVALID_TOKEN'));
    }

    // Verify user exists and is active in the database
    const userResult = await pool.query(
      `SELECT id FROM users WHERE id = $1 AND is_active = true`,
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      return next(new Error('USER_NOT_FOUND'));
    }

    // Set userId on socket for later use
    socket.userId = decoded.userId;

    console.log(`[socketAuth] User ${decoded.userId} authenticated successfully`);

    next();
  } catch (error) {
    console.error('[socketAuth] Unexpected error:', error.message);
    next(new Error('AUTH_ERROR'));
  }
};
