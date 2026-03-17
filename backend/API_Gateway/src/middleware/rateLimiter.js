const rateLimit = require('express-rate-limit');

/**
 * General API rate limiter (in-memory, no Redis dependency for gateway)
 * 100 requests per minute per user/IP
 */
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,       // 1 minute
  max: 100,                  // 100 requests per minute per user/IP
  keyGenerator: (req) => req.ip,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Auth-specific rate limiter — stricter to prevent brute-force
 * 20 requests per minute per IP
 */
const authLimiter = rateLimit({
  windowMs: 60 * 1000,       // 1 minute
  max: 20,                   // 20 auth requests per minute
  keyGenerator: (req) => req.ip,
  handler: (req, res) => {
    res.status(429).json({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many authentication requests. Try again shortly.',
      },
    });
  },
});

module.exports = {
  generalLimiter,
  authLimiter,
};
