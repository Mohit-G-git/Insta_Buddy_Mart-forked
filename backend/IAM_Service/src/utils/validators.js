const Joi = require('joi');

// ============================================================================
// Auth Validators
// ============================================================================

/**
 * Validate user registration payload
 */
const registerSchema = Joi.object({
  fullName: Joi.string().min(2).max(100).required()
    .messages({ 'string.min': 'Full name must be at least 2 characters' }),
  email: Joi.string().email().max(150).required()
    .messages({ 'string.email': 'Please provide a valid email address' }),
  phone: Joi.string().pattern(/^[6-9]\d{9}$/).required()
    .messages({ 'string.pattern.base': 'Please provide a valid 10-digit Indian phone number' }),
  password: Joi.string().min(8).max(128).required()
    .messages({ 'string.min': 'Password must be at least 8 characters' }),
  role: Joi.string().valid('requester', 'runner').default('requester')
    .messages({ 'any.only': 'Role must be either "requester" or "runner"' }),
});

/**
 * Validate login payload
 */
const loginSchema = Joi.object({
  email: Joi.string().email().required()
    .messages({ 'string.email': 'Please provide a valid email address' }),
  password: Joi.string().required()
    .messages({ 'any.required': 'Password is required' }),
});

/**
 * Validate OTP request payload
 */
const otpRequestSchema = Joi.object({
  email: Joi.string().email().required()
    .messages({ 'string.email': 'Please provide a valid email address' }),
});

/**
 * Validate OTP verification payload
 */
const otpVerifySchema = Joi.object({
  email: Joi.string().email().required()
    .messages({ 'string.email': 'Please provide a valid email address' }),
  code: Joi.string().length(6).pattern(/^\d{6}$/).required()
    .messages({
      'string.length': 'OTP must be exactly 6 digits',
      'string.pattern.base': 'OTP must contain only digits',
    }),
});

/**
 * Validate refresh token payload
 */
const refreshTokenSchema = Joi.object({
  refreshToken: Joi.string().required()
    .messages({ 'any.required': 'Refresh token is required' }),
});

// ============================================================================
// KYC Validators
// ============================================================================

/**
 * Validate KYC admin verification payload
 */
const kycVerifySchema = Joi.object({
  status: Joi.string().valid('approved', 'rejected').required()
    .messages({ 'any.only': 'Status must be either "approved" or "rejected"' }),
  reviewNotes: Joi.string().max(500).optional(),
});

// ============================================================================
// Validation Middleware Factory
// ============================================================================

/**
 * Creates a validation middleware for a given Joi schema
 * @param {Joi.ObjectSchema} schema - The Joi schema to validate against
 * @returns {Function} Express middleware
 */
function validate(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: error.message,
          details: error.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message,
            type: detail.type,
          })),
        },
      });
    }

    // Replace req.body with validated + sanitized values
    req.body = value;
    next();
  };
}

module.exports = {
  registerSchema,
  loginSchema,
  otpRequestSchema,
  otpVerifySchema,
  refreshTokenSchema,
  kycVerifySchema,
  validate,
};
