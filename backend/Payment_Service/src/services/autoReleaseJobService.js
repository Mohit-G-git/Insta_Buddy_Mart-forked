// Auto-release job data access layer
// All PostgreSQL operations for the auto_release_jobs table

const db = require('../config/db');

/**
 * Create a new auto-release job
 *
 * @param {object} params
 * @param {string} params.escrowId - UUID of the escrow
 * @param {string} params.orderId - UUID of the order
 * @param {string} params.dueAt - ISO timestamp for scheduled release
 * @param {string} params.scheduledFromEventAt - ISO timestamp of the originating event
 * @param {object} [client] - Optional DB client for transactional use
 * @returns {object} The created job row
 */
async function createJob({ escrowId, orderId, dueAt, scheduledFromEventAt }, client) {
  const queryFn = client || db;
  const result = await queryFn.query(
    `INSERT INTO auto_release_jobs
      (escrow_id, order_id, status, due_at, scheduled_from_event_at)
     VALUES ($1, $2, 'scheduled', $3, $4)
     ON CONFLICT (escrow_id) WHERE status IN ('scheduled', 'processing')
     DO NOTHING
     RETURNING *`,
    [escrowId, orderId, dueAt, scheduledFromEventAt]
  );
  return result.rows[0] || null;
}

/**
 * Find all due scheduled jobs ready for processing
 * Uses FOR UPDATE SKIP LOCKED to avoid worker contention
 *
 * @param {number} limit - Max number of jobs to fetch
 * @param {object} client - DB client (must be inside a transaction)
 * @returns {Array} Array of job rows
 */
async function findDueJobs(limit = 10, client) {
  const queryFn = client || db;
  const result = await queryFn.query(
    `SELECT * FROM auto_release_jobs
     WHERE status = 'scheduled' AND due_at <= NOW()
     ORDER BY due_at ASC
     LIMIT $1
     FOR UPDATE SKIP LOCKED`,
    [limit]
  );
  return result.rows;
}

/**
 * Update job status with optional metadata fields
 *
 * @param {string} jobId - UUID of the job
 * @param {object} updates - Fields to update
 * @param {string} updates.status - New status
 * @param {string} [updates.cancelledReason] - Reason for cancellation/skip
 * @param {string} [updates.lastError] - Error message on failure
 * @param {object} [client] - Optional DB client for transactional use
 * @returns {object|null} Updated job row
 */
async function updateJobStatus(jobId, { status, cancelledReason, lastError }, client) {
  const queryFn = client || db;
  const completedAt = ['completed', 'cancelled', 'skipped', 'failed'].includes(status)
    ? 'NOW()'
    : 'completed_at';

  const result = await queryFn.query(
    `UPDATE auto_release_jobs
     SET status = $2,
         cancelled_reason = COALESCE($3, cancelled_reason),
         last_error = COALESCE($4, last_error),
         attempts = attempts + 1,
         updated_at = NOW(),
         completed_at = ${completedAt}
     WHERE id = $1
     RETURNING *`,
    [jobId, status, cancelledReason || null, lastError || null]
  );
  return result.rows[0] || null;
}

/**
 * Cancel all open (scheduled/processing) auto-release jobs for an escrow
 *
 * @param {string} escrowId - UUID of the escrow
 * @param {string} reason - Cancellation reason
 * @param {object} [client] - Optional DB client for transactional use
 * @returns {Array} Array of cancelled job rows
 */
async function cancelJobsByEscrowId(escrowId, reason, client) {
  const queryFn = client || db;
  const result = await queryFn.query(
    `UPDATE auto_release_jobs
     SET status = 'cancelled',
         cancelled_reason = $2,
         updated_at = NOW(),
         completed_at = NOW()
     WHERE escrow_id = $1 AND status IN ('scheduled', 'processing')
     RETURNING *`,
    [escrowId, reason]
  );
  return result.rows;
}

/**
 * Get an open job for a given escrow (scheduled or processing)
 *
 * @param {string} escrowId - UUID of the escrow
 * @param {object} [client] - Optional DB client for transactional use
 * @returns {object|null} Job row or null
 */
async function getOpenJobByEscrowId(escrowId, client) {
  const queryFn = client || db;
  const result = await queryFn.query(
    `SELECT * FROM auto_release_jobs
     WHERE escrow_id = $1 AND status IN ('scheduled', 'processing')
     LIMIT 1`,
    [escrowId]
  );
  return result.rows[0] || null;
}

module.exports = {
  createJob,
  findDueJobs,
  updateJobStatus,
  cancelJobsByEscrowId,
  getOpenJobByEscrowId,
};
