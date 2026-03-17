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
 * Update escrow status to 'refunded' or 'partially_refunded'
 */
async function markRefunded(escrowId, isPartial) {
  const newStatus = isPartial ? 'partially_refunded' : 'refunded';
  const result = await db.query(
    `UPDATE escrow_ledger
     SET status = $2, refunded_at = NOW()
     WHERE id = $1 AND status IN ('authorized', 'captured')
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
 */
async function logTransaction({ escrowId, type, amount, status, razorpayPaymentId, errorMessage }) {
  const result = await db.query(
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
  markRefunded,
  markFailed,
  logTransaction,
  getTransactions,
  getEscrowsByUser,
};
