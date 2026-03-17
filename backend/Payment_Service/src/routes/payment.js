const express = require('express');
const crypto = require('crypto');
const auth = require('../middleware/auth');
const { paymentLimiter } = require('../middleware/rateLimiter');
const { validate, createOrderSchema, verifyPaymentSchema, refundSchema } = require('../utils/validators');
const paymentService = require('../services/paymentService');
const escrowService = require('../services/escrowService');
const { ValidationError } = require('../utils/errors');

const router = express.Router();

// ============================================================================
// POST /create-order
// Called by the Order Service to authorize a payment
// Body: { order_id, item_cost, platform_fee, currency?, payee_user_id?, metadata? }
// Returns: { escrow_id, razorpay_order_id, amount, breakdown, ... }
// ============================================================================
router.post('/create-order', auth, paymentLimiter, async (req, res, next) => {
  try {
    const { value, error } = validate(createOrderSchema, req.body);
    if (error) {
      throw new ValidationError(error.message, error.details);
    }

    const result = await paymentService.createPaymentOrder({
      orderId: value.order_id,
      payerUserId: req.userId,
      payeeUserId: value.payee_user_id,
      itemCost: value.item_cost,
      platformFee: value.platform_fee,
      currency: value.currency,
      metadata: value.metadata,
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// POST /verify
// Client sends Razorpay callback data after completing checkout
// Body: { escrow_id, razorpay_order_id, razorpay_payment_id, razorpay_signature }
// Returns: { escrow_id, status: 'authorized', ... }
// ============================================================================
router.post('/verify', auth, async (req, res, next) => {
  try {
    const { value, error } = validate(verifyPaymentSchema, req.body);
    if (error) {
      throw new ValidationError(error.message, error.details);
    }

    const result = await paymentService.verifyPayment({
      escrowId: value.escrow_id,
      razorpayOrderId: value.razorpay_order_id,
      razorpayPaymentId: value.razorpay_payment_id,
      razorpaySignature: value.razorpay_signature,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// POST /capture/:escrowId
// Capture an authorized payment (money actually moves)
// Called when helper picks up items
// ============================================================================
router.post('/capture/:escrowId', auth, async (req, res, next) => {
  try {
    const result = await paymentService.capturePayment(req.params.escrowId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// POST /release/:escrowId
// Release captured funds to the helper
// Called when buyer confirms delivery
// ============================================================================
router.post('/release/:escrowId', auth, async (req, res, next) => {
  try {
    const result = await paymentService.releaseEscrow(req.params.escrowId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// POST /refund/:escrowId
// Full or partial refund
// Body: { amount? (omit for full), reason? }
// ============================================================================
router.post('/refund/:escrowId', auth, async (req, res, next) => {
  try {
    const { value, error } = validate(refundSchema, req.body);
    if (error) {
      throw new ValidationError(error.message, error.details);
    }

    const result = await paymentService.refundPayment(
      req.params.escrowId,
      value.amount,
      value.reason
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// GET /escrow/:escrowId
// Get full escrow details with transaction history
// ============================================================================
router.get('/escrow/:escrowId', auth, async (req, res, next) => {
  try {
    const result = await paymentService.getEscrowDetails(req.params.escrowId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// GET /order/:orderId
// Get payment status by order ID (used by Order Service)
// ============================================================================
router.get('/order/:orderId', auth, async (req, res, next) => {
  try {
    const escrow = await escrowService.getEscrowByOrderId(req.params.orderId);
    if (!escrow) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'No payment found for this order',
        },
      });
    }
    res.json(escrow);
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// GET /my-payments
// Get all payments for the authenticated user
// Query: ?page=1&limit=20
// ============================================================================
router.get('/my-payments', auth, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);

    const escrows = await escrowService.getEscrowsByUser(req.userId, page, limit);
    res.json({ page, limit, data: escrows });
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// POST /webhook/razorpay
// Razorpay webhook handler (NO auth middleware — signature-verified instead)
// Razorpay sends events like payment.authorized, payment.captured, payment.failed
// ============================================================================
router.post('/webhook/razorpay', express.raw({ type: 'application/json' }), async (req, res, next) => {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.warn('[Webhook] RAZORPAY_WEBHOOK_SECRET not set — skipping webhook');
      return res.status(200).json({ status: 'ignored' });
    }

    // Verify webhook signature
    const receivedSignature = req.headers['x-razorpay-signature'];
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(body)
      .digest('hex');

    if (receivedSignature !== expectedSignature) {
      console.warn('[Webhook] Invalid signature');
      return res.status(400).json({ error: { code: 'INVALID_SIGNATURE', message: 'Webhook signature mismatch' } });
    }

    const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const eventType = event.event;
    const payload = event.payload?.payment?.entity;

    console.log(`[Webhook] Received event: ${eventType}`);

    if (!payload) {
      return res.status(200).json({ status: 'ok' });
    }

    // Handle payment.failed — mark escrow as failed
    if (eventType === 'payment.failed') {
      const escrow = await escrowService.getEscrowByRazorpayOrderId(payload.order_id);
      if (escrow && escrow.status === 'created') {
        await escrowService.markFailed(escrow.id);
        await escrowService.logTransaction({
          escrowId: escrow.id,
          type: 'failure',
          amount: parseFloat(escrow.total_authorized),
          status: 'failed',
          razorpayPaymentId: payload.id,
          errorMessage: payload.error_description || 'Payment failed',
        });
        console.log(`[Webhook] Escrow ${escrow.id} marked as failed`);
      }
    }

    // Acknowledge receipt
    res.status(200).json({ status: 'ok' });
  } catch (err) {
    // Always return 200 to Razorpay so it doesn't retry indefinitely
    console.error('[Webhook] Error processing webhook:', err.message);
    res.status(200).json({ status: 'error_logged' });
  }
});

module.exports = router;
