const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    // Check if Authorization header exists
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: {
          code: 'AUTH_REQUIRED',
          message: 'Authentication required',
        },
      });
    }

    // Extract token from header
    const token = authHeader.slice(7); // Remove "Bearer " prefix

    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (verifyError) {
      return res.status(401).json({
        error: {
          code: 'INVALID_TOKEN',
          message: 'Token is invalid or expired',
        },
      });
    }

    // Guard against missing userId in token payload
    if (!decoded || !decoded.userId) {
      return res.status(401).json({
        error: {
          code: 'INVALID_TOKEN',
          message: 'Token is invalid or expired',
        },
      });
    }

    // Set user data on request object
    req.userId = decoded.userId;
    req.userRole = decoded.role;
    req.kycVerified = decoded.kycVerified;

    // Continue to next middleware/route
    next();
  } catch (error) {
    console.error('[Auth Middleware] Unexpected error:', error.message);
    return res.status(401).json({
      error: {
        code: 'AUTH_REQUIRED',
        message: 'Authentication required',
      },
    });
  }
};
