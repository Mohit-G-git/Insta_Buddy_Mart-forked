// Razorpay integration service
// Handles order creation, payment verification, capture, and refund

const Razorpay = require('razorpay');
const crypto = require('crypto');

let razorpayInstance = null;

/**
 * Initialize Razorpay instance (lazy — created on first use)
 */
function getInstance() {
  if (!razorpayInstance) {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      throw new Error(
        'RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set in environment variables'
      );
    }

    razorpayInstance = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });
  }

  return razorpayInstance;
}

/**
 * Create a Razorpay order
 * payment_capture: 0 means "authorize only" — money is held but not captured
 * This gives us escrow-like behavior: capture only after delivery is confirmed
 *
 * @param {number} amountInPaise - Total amount in paise (INR * 100)
 * @param {string} currency - Currency code (default INR)
 * @param {string} receiptId - Unique receipt ID (our escrow ID)
 * @param {object} notes - Additional metadata
 * @returns {object} Razorpay order object
 */
async function createOrder(amountInPaise, currency, receiptId, notes = {}) {
  const rzp = getInstance();

  const options = {
    amount: amountInPaise,
    currency: currency || 'INR',
    receipt: receiptId,
    payment_capture: 0,       // Manual capture for escrow flow
    notes,
  };

  try {
    const order = await rzp.orders.create(options);
    console.log(`[Razorpay] Order created: ${order.id} for ₹${amountInPaise / 100}`);
    return order;
  } catch (error) {
    console.error('[Razorpay] Order creation failed:', error.message);
    throw error;
  }
}

/**
 * Verify Razorpay payment signature
 * Razorpay signs the callback with HMAC-SHA256 using your key_secret
 *
 * @param {string} razorpayOrderId
 * @param {string} razorpayPaymentId
 * @param {string} razorpaySignature
 * @returns {boolean}
 */
function verifySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature) {
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  const body = razorpayOrderId + '|' + razorpayPaymentId;
  const expectedSignature = crypto
    .createHmac('sha256', keySecret)
    .update(body)
    .digest('hex');

  return expectedSignature === razorpaySignature;
}

/**
 * Capture an authorized payment
 * This actually moves money from the customer's account
 *
 * @param {string} paymentId - Razorpay payment ID
 * @param {number} amountInPaise - Amount to capture in paise
 * @param {string} currency - Currency code
 * @returns {object} Capture response from Razorpay
 */
async function capturePayment(paymentId, amountInPaise, currency = 'INR') {
  const rzp = getInstance();

  try {
    const capture = await rzp.payments.capture(paymentId, amountInPaise, currency);
    console.log(`[Razorpay] Payment captured: ${paymentId} for ₹${amountInPaise / 100}`);
    return capture;
  } catch (error) {
    console.error('[Razorpay] Capture failed:', error.message);
    throw error;
  }
}

/**
 * Refund a captured payment (full or partial)
 *
 * @param {string} paymentId - Razorpay payment ID
 * @param {number} amountInPaise - Amount to refund in paise (omit for full refund)
 * @param {object} notes - Refund notes
 * @returns {object} Refund response from Razorpay
 */
async function refundPayment(paymentId, amountInPaise, notes = {}) {
  const rzp = getInstance();

  const options = { notes };
  if (amountInPaise) {
    options.amount = amountInPaise;
  }

  try {
    const refund = await rzp.payments.refund(paymentId, options);
    console.log(`[Razorpay] Refund issued: ${refund.id} for ₹${(amountInPaise || 0) / 100}`);
    return refund;
  } catch (error) {
    console.error('[Razorpay] Refund failed:', error.message);
    throw error;
  }
}

/**
 * Fetch payment details from Razorpay
 *
 * @param {string} paymentId - Razorpay payment ID
 * @returns {object} Payment details
 */
async function fetchPayment(paymentId) {
  const rzp = getInstance();

  try {
    return await rzp.payments.fetch(paymentId);
  } catch (error) {
    console.error('[Razorpay] Fetch payment failed:', error.message);
    throw error;
  }
}

module.exports = {
  createOrder,
  verifySignature,
  capturePayment,
  refundPayment,
  fetchPayment,
};
