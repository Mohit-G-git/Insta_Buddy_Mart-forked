/**
 * Middleware: requireKyc
 * Ensures that runner-role users have completed KYC verification.
 * Must be applied AFTER the auth middleware (which sets req.userId, req.userRole, req.kycVerified).
 */
module.exports = (req, res, next) => {
  // Only enforce KYC for runners
  if (req.userRole === 'runner' && !req.kycVerified) {
    return res.status(403).json({
      error: {
        code: 'KYC_REQUIRED',
        message: 'KYC verification is required for runner accounts. Please upload your Institute ID.',
      },
    });
  }

  next();
};
