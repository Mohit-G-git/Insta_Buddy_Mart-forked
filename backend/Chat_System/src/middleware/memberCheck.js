const { pool } = require('../config/db');

module.exports = async (req, res, next) => {
  try {
    const { roomId } = req.params;
    const userId = req.userId;

    // Verify user is an active member of this room
    const result = await pool.query(
      `SELECT id FROM chat_room_members 
       WHERE room_id = $1 AND user_id = $2 AND is_active = true`,
      [roomId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({
        error: {
          code: 'NOT_MEMBER',
          message: 'You are not a member of this room',
        },
      });
    }

    // User is a valid member, proceed
    next();
  } catch (error) {
    console.error('[Member Check Middleware] Database error:', error.message);
    return res.status(403).json({
      error: {
        code: 'NOT_MEMBER',
        message: 'You are not a member of this room',
      },
    });
  }
};
