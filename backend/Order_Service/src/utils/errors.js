/**
 * Base application error class
 */
class AppError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = undefined;

    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Authentication error (401)
 */
class AuthError extends AppError {
  constructor(message, code = 'AUTH_REQUIRED') {
    super(message, 401, code);
  }
}

/**
 * Forbidden error (403)
 */
class ForbiddenError extends AppError {
  constructor(message, code = 'FORBIDDEN') {
    super(message, 403, code);
  }
}

/**
 * Not found error (404)
 */
class NotFoundError extends AppError {
  constructor(message, code = 'NOT_FOUND') {
    super(message, 404, code);
  }
}

/**
 * Validation error (400)
 */
class ValidationError extends AppError {
  constructor(message, details) {
    super(message, 400, 'VALIDATION_ERROR');
    this.details = details;
  }
}

/**
 * Rate limit error (429)
 */
class RateLimitError extends AppError {
  constructor(message) {
    super(message, 429, 'RATE_LIMITED');
  }
}

/**
 * Conflict error (409)
 */
class ConflictError extends AppError {
  constructor(message, code = 'CONFLICT') {
    super(message, 409, code);
  }
}

/**
 * Express error handler middleware
 * Must be the LAST middleware in the app
 */
const errorHandler = (err, req, res, next) => {
  // Default to 500 server error
  let statusCode = 500;
  let code = 'SERVER_ERROR';
  let message = 'An unexpected error occurred';
  let details = undefined;

  // Handle AppError instances
  if (err instanceof AppError) {
    statusCode = err.statusCode;
    code = err.code;
    message = err.message;
    details = err.details;
  }
  // Handle Joi validation errors
  else if (err.isJoi) {
    statusCode = 400;
    code = 'VALIDATION_ERROR';
    message = err.message;
    details = err.details?.map(detail => ({
      field: detail.path.join('.'),
      message: detail.message,
      type: detail.type,
    }));
  }
  // Handle unknown errors
  else {
    console.error('[Error Handler] Unexpected error:', err);

    // In development, return full error details
    if (process.env.NODE_ENV === 'development') {
      return res.status(statusCode).json({
        error: {
          code,
          message: err.message,
          stack: err.stack,
        },
      });
    }

    // In production, return generic message
    message = 'An internal server error occurred';
  }

  // Log the error
  const logLevel = statusCode >= 500 ? 'error' : 'warn';
  console[logLevel](
    `[${code}] [${statusCode}] ${req.method} ${req.path} - ${message}`
  );

  // Send error response
  const errorResponse = {
    error: {
      code,
      message,
    },
  };

  // Include details if present
  if (details) {
    errorResponse.error.details = details;
  }

  res.status(statusCode).json(errorResponse);
};

module.exports = {
  AppError,
  AuthError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  RateLimitError,
  ConflictError,
  errorHandler,
};
