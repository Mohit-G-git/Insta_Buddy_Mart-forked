const rateLimit = require('express-rate-limit');

/**
 * General API rate limiter (in-memory, no Redis dependency for payment service)
 */
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,       // 1 minute
  max: 60,                   // 60 requests per minute per user/IP
  keyGenerator: (req) => req.userId || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Payment creation rate limiter — stricter to prevent abuse
 */
const paymentLimiter = rateLimit({
  windowMs: 60 * 1000,       // 1 minute
  max: 10,                   // 10 payment creations per minute
  keyGenerator: (req) => req.userId || req.ip,
  handler: (req, res) => {
    res.status(429).json({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many payment requests. Try again shortly.',
      },
    });
  },
});

module.exports = {
  generalLimiter,
  paymentLimiter,
};
