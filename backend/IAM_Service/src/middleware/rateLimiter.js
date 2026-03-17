const rateLimit = require('express-rate-limit');

/**
 * General API rate limiter (in-memory, no Redis dependency for IAM service)
 */
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,       // 1 minute
  max: 60,                   // 60 requests per minute per user/IP
  keyGenerator: (req) => req.userId || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * OTP request rate limiter — stricter to prevent abuse
 * 5 OTP requests per 10 minutes per IP
 */
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,  // 10 minutes
  max: 5,                    // 5 OTP requests per 10 minutes
  keyGenerator: (req) => req.ip,
  handler: (req, res) => {
    res.status(429).json({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many OTP requests. Try again in 10 minutes.',
      },
    });
  },
});

/**
 * Login rate limiter — prevent brute-force attacks
 * 10 login attempts per 15 minutes per IP
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 10,                   // 10 login attempts per 15 minutes
  keyGenerator: (req) => req.ip,
  handler: (req, res) => {
    res.status(429).json({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many login attempts. Try again in 15 minutes.',
      },
    });
  },
});

module.exports = {
  generalLimiter,
  otpLimiter,
  loginLimiter,
};
