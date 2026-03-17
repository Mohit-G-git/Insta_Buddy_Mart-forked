const express = require('express');
const router = express.Router();

const kycService = require('../services/kycService');
const auth = require('../middleware/auth');
const { kycUpload } = require('../config/s3');
const { validate, kycVerifySchema } = require('../utils/validators');

// ============================================================================
// POST /upload — Upload Institute ID image to S3 (protected)
// ============================================================================
router.post('/upload', auth, (req, res, next) => {
  // Use multer-s3 middleware for single file upload (field: 'instituteId')
  const upload = kycUpload.single('instituteId');

  upload(req, res, async (err) => {
    if (err) {
      // Handle multer/s3 errors
      return next(err);
    }

    if (!req.file) {
      return res.status(400).json({
        error: {
          code: 'FILE_REQUIRED',
          message: 'Please upload an Institute ID image (JPEG, PNG, WebP, or PDF)',
        },
      });
    }

    try {
      const documentUrl = req.file.location; // S3 URL from multer-s3
      const document = await kycService.uploadKycDocument(
        req.userId,
        documentUrl,
        'institute_id'
      );

      res.status(201).json({
        message: 'KYC document uploaded successfully. Pending admin review.',
        document,
      });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({
          error: {
            code: error.code,
            message: error.message,
          },
        });
      }
      next(error);
    }
  });
});

// ============================================================================
// GET /status — Get KYC verification status (protected)
// ============================================================================
router.get('/status', auth, async (req, res, next) => {
  try {
    const status = await kycService.getKycStatus(req.userId);

    res.json(status);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }
    next(error);
  }
});

// ============================================================================
// POST /admin/verify/:userId — Admin approves/rejects KYC (protected, admin-only)
// ============================================================================
router.post('/admin/verify/:userId', auth, validate(kycVerifySchema), async (req, res, next) => {
  try {
    // Check if the requesting user is an admin
    if (req.userRole !== 'admin') {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Only administrators can verify KYC documents',
        },
      });
    }

    const { userId } = req.params;
    const { status, reviewNotes } = req.body;

    const result = await kycService.adminVerifyKyc(
      userId,
      req.userId,    // admin's user ID
      status,
      reviewNotes
    );

    res.json({
      message: `KYC document ${status} successfully`,
      ...result,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }
    next(error);
  }
});

module.exports = router;
