// POST /api/v1/users/fcm-token
router.post('/fcm-token', authenticate, async (req, res) => {
  const { fcmToken } = req.body;
  
  if (!fcmToken) {
    return res.status(400).json({ error: 'FCM token required' });
  }
  
  try {
    // Store in database
    await pool.query(
      'UPDATE users SET fcm_token = $1 WHERE id = $2',
      [fcmToken, req.userId]
    );
    
    // Also cache in Redis for quick access
    await redis.setWithTTL(`fcm_token:${req.userId}`, fcmToken, 2592000);
    
    res.json({ success: true, message: 'FCM token saved' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});