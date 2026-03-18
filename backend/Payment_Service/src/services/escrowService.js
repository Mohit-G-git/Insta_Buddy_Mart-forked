// Escrow data access layer
// All PostgreSQL operations for the escrow_ledger and payment_transactions tables

const db = require('../config/db');

/**
 * Create a new escrow record
 * Called when an order is placed and payment needs to be authorized
 *
 * @returns {object} The created escrow row
 */
async function createEscrow({
  orderId,
  payerUserId,
  payeeUserId,
  itemCost,
  bufferAmount,
  platformFee,
  totalAuthorized,
  currency,
  razorpayOrderId,
  metadata,
}) {
  const result = await db.query(
    `INSERT INTO escrow_ledger
      (order_id, payer_user_id, payee_user_id, item_cost, buffer_amount,
       platform_fee, total_authorized, currency, razorpay_order_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      orderId,
      payerUserId,
      payeeUserId,
      itemCost,
      bufferAmount,
      platformFee,
      totalAuthorized,
      currency || 'INR',
      razorpayOrderId,
      JSON.stringify(metadata || {}),
    ]
  );

  return result.rows[0];
}

/**
 * Get escrow by ID
 */
async function getEscrowById(escrowId) {
  const result = await db.query(
    'SELECT * FROM escrow_ledger WHERE id = $1',
    [escrowId]
  );
  return result.rows[0] || null;
}

/**
 * Get escrow by order ID
 */
async function getEscrowByOrderId(orderId) {
  const result = await db.query(
    'SELECT * FROM escrow_ledger WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1',
    [orderId]
  );
  return result.rows[0] || null;
}

/**
 * Get escrow by Razorpay order ID
 */
async function getEscrowByRazorpayOrderId(razorpayOrderId) {
  const result = await db.query(
    'SELECT * FROM escrow_ledger WHERE razorpay_order_id = $1',
    [razorpayOrderId]
  );
  return result.rows[0] || null;
}

/**
 * Update escrow status to 'authorized' after payment verification
 */
async function markAuthorized(escrowId, razorpayPaymentId, razorpaySignature) {
  const result = await db.query(
    `UPDATE escrow_ledger
     SET status = 'authorized',
         razorpay_payment_id = $2,
         razorpay_signature = $3,
         authorized_at = NOW()
     WHERE id = $1 AND status = 'created'
     RETURNING *`,
    [escrowId, razorpayPaymentId, razorpaySignature]
  );
  return result.rows[0] || null;
}

/**
 * Update escrow status to 'captured' after payment capture
 */
async function markCaptured(escrowId) {
  const result = await db.query(
    `UPDATE escrow_ledger
     SET status = 'captured', captured_at = NOW()
     WHERE id = $1 AND status = 'authorized'
     RETURNING *`,
    [escrowId]
  );
  return result.rows[0] || null;
}

/**
 * Update escrow status to 'released' after delivery confirmation
 * NOTE: Manual release only allowed from 'captured' state (guard tightening per REQ-9)
 */
async function markReleased(escrowId) {
  const result = await db.query(
    `UPDATE escrow_ledger
     SET status = 'released', released_at = NOW()
     WHERE id = $1 AND status = 'captured'
     RETURNING *`,
    [escrowId]
  );
  return result.rows[0] || null;
}

/**
 * REQ-9: Update escrow status to 'locked' after OrderDelivered
 * Allowed transition: captured -> locked
 *
 * @param {string} escrowId
 * @param {string} deliveredAt - ISO timestamp of the delivery event
 * @param {object} [client] - Optional DB client for transactional use
 * @returns {object|null} Updated escrow row or null if transition not allowed
 */
async function markLocked(escrowId, deliveredAt, client) {
  const queryFn = client || db;
  const result = await queryFn.query(
    `UPDATE escrow_ledger
     SET status = 'locked',
         locked_at = NOW(),
         order_delivered_at = $2
     WHERE id = $1 AND status = 'captured'
     RETURNING *`,
    [escrowId, deliveredAt]
  );
  return result.rows[0] || null;
}

/**
 * REQ-9: Set auto-release due time and job reference on escrow
 *
 * @param {string} escrowId
 * @param {string} dueAt - ISO timestamp for scheduled release
 * @param {string} jobId - UUID of the auto_release_jobs row
 * @param {object} [client] - Optional DB client for transactional use
 * @returns {object|null}
 */
async function setAutoReleaseDue(escrowId, dueAt, jobId, client) {
  const queryFn = client || db;
  const result = await queryFn.query(
    `UPDATE escrow_ledger
     SET auto_release_due_at = $2,
         auto_release_job_id = $3
     WHERE id = $1
     RETURNING *`,
    [escrowId, dueAt, jobId]
  );
  return result.rows[0] || null;
}

/**
 * REQ-9: Mark escrow as dispute_raised
 * Allowed transitions: locked -> dispute_raised, captured -> dispute_raised
 *
 * @param {string} escrowId
 * @param {object} [client] - Optional DB client for transactional use
 * @returns {object|null}
 */
async function markDisputeRaised(escrowId, client) {
  const queryFn = client || db;
  const result = await queryFn.query(
    `UPDATE escrow_ledger
     SET status = 'dispute_raised'
     WHERE id = $1 AND status IN ('locked', 'captured')
     RETURNING *`,
    [escrowId]
  );
  return result.rows[0] || null;
}

/**
 * REQ-9: Get escrow with row lock for worker safety
 * MUST be called within a transaction
 *
 * @param {string} escrowId
 * @param {object} client - DB client (must be inside a transaction)
 * @returns {object|null}
 */
async function getEscrowForUpdate(escrowId, client) {
  const queryFn = client || db;
  const result = await queryFn.query(
    'SELECT * FROM escrow_ledger WHERE id = $1 FOR UPDATE',
    [escrowId]
  );
  return result.rows[0] || null;
}

/**
 * REQ-9: Release escrow from locked state (worker/system path only)
 * Only releases if status is 'locked' — rejects all other states
 *
 * @param {string} escrowId
 * @param {object} [client] - Optional DB client for transactional use
 * @returns {object|null}
 */
async function markReleasedBySystem(escrowId, client) {
  const queryFn = client || db;
  const result = await queryFn.query(
    `UPDATE escrow_ledger
     SET status = 'released', released_at = NOW()
     WHERE id = $1 AND status = 'locked'
     RETURNING *`,
    [escrowId]
  );
  return result.rows[0] || null;
}

/**
 * Update escrow status to 'refunded' or 'partially_refunded'
 * REQ-9: Now also allows refund from 'locked' and 'dispute_raised' states
 */
async function markRefunded(escrowId, isPartial) {
  const newStatus = isPartial ? 'partially_refunded' : 'refunded';
  const result = await db.query(
    `UPDATE escrow_ledger
     SET status = $2, refunded_at = NOW()
     WHERE id = $1 AND status IN ('authorized', 'captured', 'locked', 'dispute_raised')
     RETURNING *`,
    [escrowId, newStatus]
  );
  return result.rows[0] || null;
}

/**
 * Update escrow status to 'failed'
 */
async function markFailed(escrowId) {
  const result = await db.query(
    `UPDATE escrow_ledger
     SET status = 'failed', failed_at = NOW()
     WHERE id = $1 AND status = 'created'
     RETURNING *`,
    [escrowId]
  );
  return result.rows[0] || null;
}

/**
 * Log a payment transaction (audit trail)
 * @param {object} [client] - Optional DB client for transactional use
 */
async function logTransaction({ escrowId, type, amount, status, razorpayPaymentId, errorMessage }, client) {
  const queryFn = client || db;
  const result = await queryFn.query(
    `INSERT INTO payment_transactions
      (escrow_id, type, amount, status, razorpay_payment_id, error_message)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [escrowId, type, amount, status, razorpayPaymentId || null, errorMessage || null]
  );
  return result.rows[0];
}

/**
 * Get all transactions for an escrow record
 */
async function getTransactions(escrowId) {
  const result = await db.query(
    `SELECT * FROM payment_transactions
     WHERE escrow_id = $1
     ORDER BY created_at ASC`,
    [escrowId]
  );
  return result.rows;
}

/**
 * Get all escrow records for a user (as payer)
 */
async function getEscrowsByUser(userId, page = 1, limit = 20) {
  const offset = (page - 1) * limit;
  const result = await db.query(
    `SELECT * FROM escrow_ledger
     WHERE payer_user_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  return result.rows;
}

module.exports = {
  createEscrow,
  getEscrowById,
  getEscrowByOrderId,
  getEscrowByRazorpayOrderId,
  markAuthorized,
  markCaptured,
  markReleased,
  markLocked,
  setAutoReleaseDue,
  markDisputeRaised,
  getEscrowForUpdate,
  markReleasedBySystem,
  markRefunded,
  markFailed,
  logTransaction,
  getTransactions,
  getEscrowsByUser,
};
