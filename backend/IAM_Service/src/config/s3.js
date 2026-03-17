// S3 client configuration for KYC document uploads
// Uses AWS SDK v3 with configurable bucket and credentials

const { S3Client } = require('@aws-sdk/client-s3');
const multer = require('multer');
const multerS3 = require('multer-s3');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Initialize S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'ap-south-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = process.env.S3_KYC_BUCKET || 'buddyup-kyc-documents';

// Allowed file types for KYC uploads
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
];

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

/**
 * File filter — only allow images and PDFs for Institute ID uploads
 */
function fileFilter(req, file, cb) {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, WebP, and PDF are allowed.'), false);
  }
}

/**
 * Multer-S3 storage — uploads directly to S3 with structured key naming
 * Key format: kyc/{userId}/{uuid}.{ext}
 */
const kycUploadStorage = multerS3({
  s3: s3Client,
  bucket: BUCKET_NAME,
  contentType: multerS3.AUTO_CONTENT_TYPE,
  metadata: (req, file, cb) => {
    cb(null, {
      fieldName: file.fieldname,
      uploadedBy: req.userId || 'unknown',
      originalName: file.originalname,
    });
  },
  key: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueId = uuidv4();
    const key = `kyc/${req.userId}/${uniqueId}${ext}`;
    cb(null, key);
  },
});

/**
 * Multer upload middleware for KYC documents
 * - Single file upload (field name: 'instituteId')
 * - Max 5 MB file size
 * - Only images and PDFs
 */
const kycUpload = multer({
  storage: kycUploadStorage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
  },
});

module.exports = {
  s3Client,
  BUCKET_NAME,
  kycUpload,
};
