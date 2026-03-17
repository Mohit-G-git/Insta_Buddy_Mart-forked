// Payment orchestration service
// Ties together Razorpay and Escrow into business-level workflows

const razorpayService = require('./razorpayService');
const escrowService = require('./escrowService');
const autoReleaseJobService = require('./autoReleaseJobService');
const processedEventService = require('./processedEventService');
const db = require('../config/db');
const { PaymentError, NotFoundError, ConflictError } = require('../utils/errors');

// Buffer multiplier: 15% on top of item cost
const BUFFER_MULTIPLIER = 0.15;

// Auto-release delay: exactly 24 hours
const AUTO_RELEASE_DELAY_MS = 24 * 60 * 60 * 1000;

/**
 * Calculate the Total Authorization Amount
 * Formula: (item_cost * 1.15) + platform_fee
 *
 * @param {number} itemCost - Base cost of the item(s)
 * @param {number} platformFee - Platform/service fee
 * @returns {{ bufferAmount: number, totalAuthorized: number }}
 */
function calculateTotal(itemCost, platformFee = 0) {
  const bufferAmount = parseFloat((itemCost * BUFFER_MULTIPLIER).toFixed(2));
  const totalAuthorized = parseFloat((itemCost + bufferAmount + platformFee).toFixed(2));

  return { bufferAmount, totalAuthorized };
}

/**
 * STEP 1: Create Order
 *
 * Called by the Order Service when a user places an order.
 * 1. Calculate total authorization amount
 * 2. Create Razorpay order (authorize-only, no auto-capture)
 * 3. Create escrow ledger record
 * 4. Log the transaction
 * 5. Return escrow + Razorpay details for the client to open checkout
 */
async function createPaymentOrder({ orderId, payerUserId, payeeUserId, itemCost, platformFee, currency, metadata }) {
  // Check for duplicate order
  const existing = await escrowService.getEscrowByOrderId(orderId);
  if (existing && existing.status !== 'failed') {
    throw new ConflictError('A payment already exists for this order');
  }

  // Calculate amounts
  const { bufferAmount, totalAuthorized } = calculateTotal(itemCost, platformFee);

  // Convert to paise for Razorpay (INR * 100)
  const amountInPaise = Math.round(totalAuthorized * 100);

  // Create Razorpay order
  let razorpayOrder;
  try {
    razorpayOrder = await razorpayService.createOrder(
      amountInPaise,
      currency || 'INR',
      orderId,                        // receipt = our order_id
      { order_id: orderId, payer_user_id: payerUserId }
    );
  } catch (error) {
    throw new PaymentError(`Failed to create payment order: ${error.message}`);
  }

  // Create escrow record
  const escrow = await escrowService.createEscrow({
    orderId,
    payerUserId,
    payeeUserId: payeeUserId || null,
    itemCost,
    bufferAmount,
    platformFee: platformFee || 0,
    totalAuthorized,
    currency: currency || 'INR',
    razorpayOrderId: razorpayOrder.id,
    metadata,
  });

  // Log the transaction
  await escrowService.logTransaction({
    escrowId: escrow.id,
    type: 'authorization',
    amount: totalAuthorized,
    status: 'success',
    razorpayPaymentId: null,
  });

  return {
    escrow_id: escrow.id,
    order_id: orderId,
    razorpay_order_id: razorpayOrder.id,
    razorpay_key_id: process.env.RAZORPAY_KEY_ID,
    amount: totalAuthorized,
    amount_in_paise: amountInPaise,
    currency: escrow.currency,
    breakdown: {
      item_cost: itemCost,
      buffer_15_percent: bufferAmount,
      platform_fee: platformFee || 0,
      total: totalAuthorized,
    },
    status: escrow.status,
  };
}

/**
 * STEP 2: Verify Payment
 *
 * Called after the client completes Razorpay checkout.
 * 1. Find escrow record
 * 2. Verify Razorpay signature (ensures callback is authentic)
 * 3. Update escrow to 'authorized'
 * 4. Log the transaction
 */
async function verifyPayment({ escrowId, razorpayOrderId, razorpayPaymentId, razorpaySignature }) {
  const escrow = await escrowService.getEscrowById(escrowId);
  if (!escrow) {
    throw new NotFoundError('Escrow record not found');
  }

  if (escrow.status !== 'created') {
    throw new ConflictError(`Payment cannot be verified in status: ${escrow.status}`);
  }

  if (escrow.razorpay_order_id !== razorpayOrderId) {
    throw new PaymentError('Razorpay order ID mismatch');
  }

  // Verify signature
  const isValid = razorpayService.verifySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
  if (!isValid) {
    await escrowService.markFailed(escrowId);
    await escrowService.logTransaction({
      escrowId,
      type: 'failure',
      amount: parseFloat(escrow.total_authorized),
      status: 'failed',
      razorpayPaymentId,
      errorMessage: 'Signature verification failed',
    });

    throw new PaymentError('Payment signature verification failed', 'SIGNATURE_INVALID');
  }

  // Mark as authorized
  const updated = await escrowService.markAuthorized(escrowId, razorpayPaymentId, razorpaySignature);
  if (!updated) {
    throw new ConflictError('Failed to update escrow status — possible race condition');
  }

  // Log success
  await escrowService.logTransaction({
    escrowId,
    type: 'authorization',
    amount: parseFloat(escrow.total_authorized),
    status: 'success',
    razorpayPaymentId,
  });

  return {
    escrow_id: escrowId,
    order_id: escrow.order_id,
    status: 'authorized',
    amount: parseFloat(escrow.total_authorized),
    authorized_at: updated.authorized_at,
  };
}

/**
 * STEP 3: Capture Payment
 *
 * Called when the helper picks up the items (or delivery is in progress).
 * Actually moves money from the customer's account → Razorpay.
 */
async function capturePayment(escrowId) {
  const escrow = await escrowService.getEscrowById(escrowId);
  if (!escrow) {
    throw new NotFoundError('Escrow record not found');
  }

  if (escrow.status !== 'authorized') {
    throw new ConflictError(`Payment cannot be captured in status: ${escrow.status}`);
  }

  const amountInPaise = Math.round(parseFloat(escrow.total_authorized) * 100);

  try {
    await razorpayService.capturePayment(
      escrow.razorpay_payment_id,
      amountInPaise,
      escrow.currency
    );
  } catch (error) {
    await escrowService.logTransaction({
      escrowId,
      type: 'capture',
      amount: parseFloat(escrow.total_authorized),
      status: 'failed',
      razorpayPaymentId: escrow.razorpay_payment_id,
      errorMessage: error.message,
    });
    throw new PaymentError(`Capture failed: ${error.message}`);
  }

  const updated = await escrowService.markCaptured(escrowId);

  await escrowService.logTransaction({
    escrowId,
    type: 'capture',
    amount: parseFloat(escrow.total_authorized),
    status: 'success',
    razorpayPaymentId: escrow.razorpay_payment_id,
  });

  return {
    escrow_id: escrowId,
    order_id: escrow.order_id,
    status: 'captured',
    amount: parseFloat(escrow.total_authorized),
    captured_at: updated.captured_at,
  };
}

/**
 * STEP 4: Release Escrow (Manual Path)
 *
 * Called when buyer confirms delivery (manual release).
 * REQ-9: Now only allows release from 'captured' state.
 * Locked escrows MUST go through the auto-release worker or admin override.
 */
async function releaseEscrow(escrowId) {
  const escrow = await escrowService.getEscrowById(escrowId);
  if (!escrow) {
    throw new NotFoundError('Escrow record not found');
  }

  // REQ-9: Reject locked escrows from manual release path
  if (escrow.status === 'locked') {
    throw new ConflictError(
      'Escrow is locked pending auto-release. Cannot manually release locked funds.'
    );
  }

  if (escrow.status !== 'captured') {
    throw new ConflictError(`Escrow cannot be released in status: ${escrow.status}`);
  }

  const updated = await escrowService.markReleased(escrowId);

  await escrowService.logTransaction({
    escrowId,
    type: 'release',
    amount: parseFloat(escrow.total_authorized),
    status: 'success',
    razorpayPaymentId: escrow.razorpay_payment_id,
  });

  return {
    escrow_id: escrowId,
    order_id: escrow.order_id,
    status: 'released',
    amount: parseFloat(escrow.total_authorized),
    released_at: updated.released_at,
  };
}

/**
 * STEP 5: Refund Payment
 *
 * Called when an order is cancelled or a dispute is resolved.
 * Supports full and partial refunds.
 * REQ-9: Now also allows refund from 'locked' and 'dispute_raised' states.
 */
async function refundPayment(escrowId, amount, reason) {
  const escrow = await escrowService.getEscrowById(escrowId);
  if (!escrow) {
    throw new NotFoundError('Escrow record not found');
  }

  if (!['authorized', 'captured', 'locked', 'dispute_raised'].includes(escrow.status)) {
    throw new ConflictError(`Payment cannot be refunded in status: ${escrow.status}`);
  }

  const totalAuthorized = parseFloat(escrow.total_authorized);
  const refundAmount = amount || totalAuthorized;
  const isPartial = refundAmount < totalAuthorized;
  const amountInPaise = Math.round(refundAmount * 100);

  try {
    await razorpayService.refundPayment(
      escrow.razorpay_payment_id,
      isPartial ? amountInPaise : undefined,      // undefined = full refund
      { reason: reason || 'Requested by user', escrow_id: escrowId }
    );
  } catch (error) {
    await escrowService.logTransaction({
      escrowId,
      type: 'refund',
      amount: refundAmount,
      status: 'failed',
      razorpayPaymentId: escrow.razorpay_payment_id,
      errorMessage: error.message,
    });
    throw new PaymentError(`Refund failed: ${error.message}`);
  }

  // If there are open auto-release jobs, cancel them on refund
  await autoReleaseJobService.cancelJobsByEscrowId(escrowId, 'refund_initiated');

  const updated = await escrowService.markRefunded(escrowId, isPartial);

  await escrowService.logTransaction({
    escrowId,
    type: 'refund',
    amount: refundAmount,
    status: 'success',
    razorpayPaymentId: escrow.razorpay_payment_id,
  });

  return {
    escrow_id: escrowId,
    order_id: escrow.order_id,
    status: updated.status,
    refunded_amount: refundAmount,
    is_partial: isPartial,
    refunded_at: updated.refunded_at,
  };
}

/**
 * Get escrow details with transaction history
 */
async function getEscrowDetails(escrowId) {
  const escrow = await escrowService.getEscrowById(escrowId);
  if (!escrow) {
    throw new NotFoundError('Escrow record not found');
  }

  const transactions = await escrowService.getTransactions(escrowId);

  return {
    ...escrow,
    breakdown: {
      item_cost: parseFloat(escrow.item_cost),
      buffer_15_percent: parseFloat(escrow.buffer_amount),
      platform_fee: parseFloat(escrow.platform_fee),
      total: parseFloat(escrow.total_authorized),
    },
    transactions,
  };
}

// ============================================================================
// REQ-9: Event Orchestrators
// ============================================================================

/**
 * Handle OrderDelivered event
 *
 * 1. Validate idempotency (processed_events)
 * 2. Validate escrow exists and is in captured (or already locked = idempotent)
 * 3. Transition captured -> locked
 * 4. Compute dueAt = occurredAt + 24 hours
 * 5. Create auto-release job
 * 6. Log audit transactions (lock + auto_release_scheduled)
 *
 * @param {object} params
 * @param {string} params.orderId - UUID of the order
 * @param {string} params.escrowId - UUID of the escrow (optional, will lookup by orderId)
 * @param {string} params.occurredAt - ISO timestamp of when delivery occurred
 * @param {string} params.eventId - UUID for idempotency
 * @returns {object} Result with processing details
 */
async function onOrderDelivered({ orderId, escrowId, occurredAt, eventId }) {
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Idempotency check
    const isNew = await processedEventService.markEventProcessed(
      { eventId, eventType: 'OrderDelivered', orderId },
      client
    );
    if (!isNew) {
      await client.query('COMMIT');
      return { processed: false, reason: 'duplicate' };
    }

    // 2. Find escrow
    let escrow;
    if (escrowId) {
      escrow = await escrowService.getEscrowForUpdate(escrowId, client);
    } else {
      // Lookup by order_id, then lock
      escrow = await escrowService.getEscrowByOrderId(orderId);
      if (escrow) {
        escrow = await escrowService.getEscrowForUpdate(escrow.id, client);
      }
    }

    if (!escrow) {
      await client.query('ROLLBACK');
      return { processed: false, reason: 'not_found' };
    }

    // Idempotent: if already locked, return success without re-processing
    if (escrow.status === 'locked') {
      await client.query('COMMIT');
      return { processed: true, reason: 'already_locked', escrow_id: escrow.id };
    }

    // Only allow transition from captured
    if (escrow.status !== 'captured') {
      await client.query('ROLLBACK');
      return { processed: false, reason: 'invalid_state', current_status: escrow.status };
    }

    // 3. Transition to locked
    const lockedEscrow = await escrowService.markLocked(escrow.id, occurredAt, client);
    if (!lockedEscrow) {
      await client.query('ROLLBACK');
      return { processed: false, reason: 'transition_failed' };
    }

    // 4. Compute due time: exactly +24 hours from occurredAt
    const dueAt = new Date(new Date(occurredAt).getTime() + AUTO_RELEASE_DELAY_MS).toISOString();

    // 5. Create auto-release job
    const job = await autoReleaseJobService.createJob(
      { escrowId: escrow.id, orderId, dueAt, scheduledFromEventAt: occurredAt },
      client
    );

    // Update escrow with job reference
    if (job) {
      await escrowService.setAutoReleaseDue(escrow.id, dueAt, job.id, client);
    }

    // 6. Log audit transactions
    const amount = parseFloat(escrow.total_authorized);

    await escrowService.logTransaction({
      escrowId: escrow.id,
      type: 'lock',
      amount,
      status: 'success',
    }, client);

    await escrowService.logTransaction({
      escrowId: escrow.id,
      type: 'auto_release_scheduled',
      amount,
      status: 'success',
    }, client);

    await client.query('COMMIT');

    console.log(
      `[REQ-9] OrderDelivered processed: escrow=${escrow.id}, ` +
      `job=${job?.id}, due_at=${dueAt}`
    );

    return {
      processed: true,
      escrow_id: escrow.id,
      job_id: job?.id,
      due_at: dueAt,
      status: 'locked',
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[REQ-9] onOrderDelivered error:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Handle DisputeRaised event
 *
 * 1. Validate idempotency (processed_events)
 * 2. Validate escrow exists and is in locked/captured state
 * 3. Transition to dispute_raised
 * 4. Cancel any pending auto-release jobs
 * 5. Log audit transactions (dispute + auto_release_cancelled)
 *
 * @param {object} params
 * @param {string} params.orderId - UUID of the order
 * @param {string} params.escrowId - UUID of the escrow (optional)
 * @param {string} params.occurredAt - ISO timestamp
 * @param {string} params.eventId - UUID for idempotency
 * @returns {object} Result with processing details
 */
async function onDisputeRaised({ orderId, escrowId, occurredAt, eventId }) {
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Idempotency check
    const isNew = await processedEventService.markEventProcessed(
      { eventId, eventType: 'DisputeRaised', orderId },
      client
    );
    if (!isNew) {
      await client.query('COMMIT');
      return { processed: false, reason: 'duplicate' };
    }

    // 2. Find escrow
    let escrow;
    if (escrowId) {
      escrow = await escrowService.getEscrowForUpdate(escrowId, client);
    } else {
      escrow = await escrowService.getEscrowByOrderId(orderId);
      if (escrow) {
        escrow = await escrowService.getEscrowForUpdate(escrow.id, client);
      }
    }

    if (!escrow) {
      await client.query('ROLLBACK');
      return { processed: false, reason: 'not_found' };
    }

    // Idempotent: if already dispute_raised, return success
    if (escrow.status === 'dispute_raised') {
      await client.query('COMMIT');
      return { processed: true, reason: 'already_dispute_raised', escrow_id: escrow.id };
    }

    // Only allow transition from locked or captured
    if (!['locked', 'captured'].includes(escrow.status)) {
      await client.query('ROLLBACK');
      return { processed: false, reason: 'invalid_state', current_status: escrow.status };
    }

    // 3. Transition to dispute_raised
    const updated = await escrowService.markDisputeRaised(escrow.id, client);
    if (!updated) {
      await client.query('ROLLBACK');
      return { processed: false, reason: 'transition_failed' };
    }

    // 4. Cancel pending auto-release jobs
    const cancelledJobs = await autoReleaseJobService.cancelJobsByEscrowId(
      escrow.id, 'dispute_raised', client
    );

    // 5. Log audit transactions
    const amount = parseFloat(escrow.total_authorized);

    await escrowService.logTransaction({
      escrowId: escrow.id,
      type: 'dispute',
      amount,
      status: 'success',
    }, client);

    if (cancelledJobs.length > 0) {
      await escrowService.logTransaction({
        escrowId: escrow.id,
        type: 'auto_release_cancelled',
        amount,
        status: 'success',
      }, client);
    }

    await client.query('COMMIT');

    console.log(
      `[REQ-9] DisputeRaised processed: escrow=${escrow.id}, ` +
      `cancelled_jobs=${cancelledJobs.length}`
    );

    return {
      processed: true,
      escrow_id: escrow.id,
      cancelled_jobs: cancelledJobs.length,
      status: 'dispute_raised',
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[REQ-9] onDisputeRaised error:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  calculateTotal,
  createPaymentOrder,
  verifyPayment,
  capturePayment,
  releaseEscrow,
  refundPayment,
  getEscrowDetails,
  onOrderDelivered,
  onDisputeRaised,
};

