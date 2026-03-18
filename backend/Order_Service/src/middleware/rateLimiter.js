const rateLimit = require('express-rate-limit');

/**
 * General rate limiter — applies to all routes
 * 200 requests per 15 minutes per IP
 */
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests. Please try again later.',
    },
  },
});

/**
 * Order creation rate limiter — prevents spam
 * 20 order creations per 15 minutes per IP
 */
const orderCreateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many order creation requests. Please try again later.',
    },
  },
});

module.exports = {
  generalLimiter,
  orderCreateLimiter,
};
