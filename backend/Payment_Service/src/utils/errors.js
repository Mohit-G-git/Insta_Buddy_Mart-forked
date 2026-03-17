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

class AuthError extends AppError {
  constructor(message, code = 'AUTH_REQUIRED') {
    super(message, 401, code);
  }
}

class ForbiddenError extends AppError {
  constructor(message, code = 'FORBIDDEN') {
    super(message, 403, code);
  }
}

class NotFoundError extends AppError {
  constructor(message, code = 'NOT_FOUND') {
    super(message, 404, code);
  }
}

class ValidationError extends AppError {
  constructor(message, details) {
    super(message, 400, 'VALIDATION_ERROR');
    this.details = details;
  }
}

class RateLimitError extends AppError {
  constructor(message) {
    super(message, 429, 'RATE_LIMITED');
  }
}

class PaymentError extends AppError {
  constructor(message, code = 'PAYMENT_ERROR') {
    super(message, 402, code);
  }
}

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

    if (process.env.NODE_ENV === 'development') {
      return res.status(statusCode).json({
        error: {
          code,
          message: err.message,
          stack: err.stack,
        },
      });
    }

    message = 'An internal server error occurred';
  }

  const logLevel = statusCode >= 500 ? 'error' : 'warn';
  console[logLevel](
    `[${code}] [${statusCode}] ${req.method} ${req.path} - ${message}`
  );

  const errorResponse = {
    error: {
      code,
      message,
    },
  };

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
  PaymentError,
  ConflictError,
  errorHandler,
};
