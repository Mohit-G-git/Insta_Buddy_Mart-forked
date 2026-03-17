// kycService.js
// Handles KYC document upload to S3, status management, and admin verification

const db = require('../config/db');

// ============================================================================
// KYC Document Upload
// ============================================================================

/**
 * Record a KYC document upload in the database
 * The actual S3 upload is handled by multer-s3 middleware before this is called
 *
 * @param {string} userId - ID of the user uploading the document
 * @param {string} documentUrl - S3 URL of the uploaded file
 * @param {string} documentType - Type of document (default: 'institute_id')
 * @returns {Object} - Created KYC document record
 */
async function uploadKycDocument(userId, documentUrl, documentType = 'institute_id') {
  // Check if user already has a KYC document
  const existing = await db.query(
    'SELECT id, status FROM kyc_documents WHERE user_id = $1',
    [userId]
  );

  if (existing.rows.length > 0) {
    const doc = existing.rows[0];

    // If previously rejected, allow re-upload
    if (doc.status === 'rejected') {
      const result = await db.query(
        `UPDATE kyc_documents
         SET document_url = $1, document_type = $2, status = 'pending',
             reviewed_by = NULL, review_notes = NULL, reviewed_at = NULL,
             uploaded_at = NOW()
         WHERE user_id = $3
         RETURNING id, user_id, document_url, document_type, status, uploaded_at`,
        [documentUrl, documentType, userId]
      );
      return result.rows[0];
    }

    // If pending or approved, don't allow re-upload
    const error = new Error(
      doc.status === 'approved'
        ? 'KYC document has already been approved'
        : 'KYC document is already pending review'
    );
    error.statusCode = 409;
    error.code = 'KYC_ALREADY_EXISTS';
    throw error;
  }

  // Insert new KYC document record
  const result = await db.query(
    `INSERT INTO kyc_documents (user_id, document_url, document_type)
     VALUES ($1, $2, $3)
     RETURNING id, user_id, document_url, document_type, status, uploaded_at`,
    [userId, documentUrl, documentType]
  );

  return result.rows[0];
}

// ============================================================================
// KYC Status
// ============================================================================

/**
 * Get KYC verification status for a user
 * @param {string} userId
 * @returns {Object} - KYC status info
 */
async function getKycStatus(userId) {
  const result = await db.query(
    `SELECT kd.id, kd.document_url, kd.document_type, kd.status,
            kd.review_notes, kd.uploaded_at, kd.reviewed_at,
            ui.kyc_verified
     FROM users_iam ui
     LEFT JOIN kyc_documents kd ON kd.user_id = ui.id
     WHERE ui.id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    const error = new Error('User not found');
    error.statusCode = 404;
    error.code = 'USER_NOT_FOUND';
    throw error;
  }

  const row = result.rows[0];

  // No document uploaded yet
  if (!row.id) {
    return {
      kycVerified: row.kyc_verified,
      document: null,
      message: 'No KYC document uploaded. Please upload your Institute ID.',
    };
  }

  return {
    kycVerified: row.kyc_verified,
    document: {
      id: row.id,
      documentUrl: row.document_url,
      documentType: row.document_type,
      status: row.status,
      reviewNotes: row.review_notes,
      uploadedAt: row.uploaded_at,
      reviewedAt: row.reviewed_at,
    },
  };
}

// ============================================================================
// Admin KYC Verification
// ============================================================================

/**
 * Admin approves or rejects a user's KYC document
 * When approved, sets kyc_verified = true on the users_iam record
 *
 * @param {string} targetUserId - The user whose KYC is being reviewed
 * @param {string} adminUserId - The admin performing the review
 * @param {string} status - 'approved' or 'rejected'
 * @param {string} reviewNotes - Optional notes from the admin
 * @returns {Object} - Updated KYC document + user verification status
 */
async function adminVerifyKyc(targetUserId, adminUserId, status, reviewNotes) {
  // Check if document exists
  const docResult = await db.query(
    'SELECT id, status FROM kyc_documents WHERE user_id = $1',
    [targetUserId]
  );

  if (docResult.rows.length === 0) {
    const error = new Error('No KYC document found for this user');
    error.statusCode = 404;
    error.code = 'KYC_NOT_FOUND';
    throw error;
  }

  const doc = docResult.rows[0];

  if (doc.status === 'approved') {
    const error = new Error('KYC document has already been approved');
    error.statusCode = 409;
    error.code = 'KYC_ALREADY_VERIFIED';
    throw error;
  }

  // Update KYC document status
  const updatedDoc = await db.query(
    `UPDATE kyc_documents
     SET status = $1, reviewed_by = $2, review_notes = $3, reviewed_at = NOW()
     WHERE user_id = $4
     RETURNING id, user_id, document_url, document_type, status, review_notes, reviewed_at`,
    [status, adminUserId, reviewNotes || null, targetUserId]
  );

  // If approved, update user's kyc_verified flag
  if (status === 'approved') {
    await db.query(
      `UPDATE users_iam SET kyc_verified = true, updated_at = NOW() WHERE id = $1`,
      [targetUserId]
    );
  }

  // If rejected, ensure kyc_verified stays false
  if (status === 'rejected') {
    await db.query(
      `UPDATE users_iam SET kyc_verified = false, updated_at = NOW() WHERE id = $1`,
      [targetUserId]
    );
  }

  return {
    document: updatedDoc.rows[0],
    kycVerified: status === 'approved',
  };
}

module.exports = {
  uploadKycDocument,
  getKycStatus,
  adminVerifyKyc,
};
