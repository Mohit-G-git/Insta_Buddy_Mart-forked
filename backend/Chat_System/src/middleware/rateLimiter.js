const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const redis = require('../config/redis');

/**
 * Wrapper for ioredis to match rate-limit-redis API
 */
function sendCommand(command, ...args) {
  return redis.call(command, ...args);
}

/**
 * General API rate limiter
 */
const generalLimiter = rateLimit({
  store: new RedisStore({
    sendCommand: (command, ...args) => sendCommand(command, ...args),
    prefix: 'ratelimit:general:',
  }),
  windowMs: 60 * 1000,
  max: 100,
  keyGenerator: (req) => req.userId || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Upload rate limiter
 */
const uploadLimiter = rateLimit({
  store: new RedisStore({
    sendCommand: (command, ...args) => sendCommand(command, ...args),
    prefix: 'ratelimit:upload:',
  }),
  windowMs: 60 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => req.userId || req.ip,
  handler: (req, res) => {
    res.status(429).json({
      error: {
        code: 'RATE_LIMITED',
        message: 'Upload limit reached. Try again in an hour.',
      },
    });
  },
});

/**
 * WebSocket message rate limiter
 */
async function checkMessageRateLimit(userId) {
  try {
    const key = `ratelimit:msg:${userId}`;
    const count = await redis.incr(key);

    if (count === 1) {
      await redis.expire(key, 60);
    }

    return count <= 60;
  } catch (error) {
    console.error('[Rate Limiter] Message rate check error:', error.message);
    return true;
  }
}

module.exports = {
  generalLimiter,
  uploadLimiter,
  checkMessageRateLimit,
};