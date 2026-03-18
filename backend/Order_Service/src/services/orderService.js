// orderService.js
// Core business logic for order management — CRUD operations and delivery fee calculation
// Implements REQ-1 (shopping list creation) and REQ-2 (delivery fee with ₹30 floor)

const db = require('../config/db');

const MIN_DELIVERY_FEE = parseFloat(process.env.MIN_DELIVERY_FEE) || 30;
const RATE_PER_KM = parseFloat(process.env.RATE_PER_KM) || 10;
const COST_BUFFER_MULTIPLIER = 1.15; // 15% buffer for price variance (REQ-3)

// ============================================================================
// Haversine Distance Calculation
// ============================================================================

/**
 * Calculate the great-circle distance between two lat/lng points using the Haversine formula
 * @param {number} lat1 - Requester latitude
 * @param {number} lng1 - Requester longitude
 * @param {number} lat2 - Store latitude
 * @param {number} lng2 - Store longitude
 * @returns {number} Distance in kilometers
 */
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth's radius in km
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRadians(degrees) {
  return degrees * (Math.PI / 180);
}

// ============================================================================
// Delivery Fee Calculation (REQ-2)
// ============================================================================

/**
 * Calculate delivery fee based on distance with a minimum floor of ₹30
 * @param {number} distanceKm - Distance between requester and store in km
 * @param {number} userOverride - Optional user-specified fee (must be >= MIN_DELIVERY_FEE)
 * @returns {number} Delivery fee in ₹
 */
function calculateDeliveryFee(distanceKm, userOverride = null) {
  const baseFee = distanceKm * RATE_PER_KM;
  const calculatedFee = Math.max(baseFee, MIN_DELIVERY_FEE);

  // If user provides an override, use it only if it's >= the minimum floor
  if (userOverride !== null && userOverride !== undefined) {
    return Math.max(userOverride, MIN_DELIVERY_FEE);
  }

  // Round to 2 decimal places
  return Math.round(calculatedFee * 100) / 100;
}

// ============================================================================
// Create Order (REQ-1, REQ-2, REQ-3)
// ============================================================================

/**
 * Create a new shopping request order with items
 * Calculates delivery fee based on distance and total authorization amount
 * @param {string} requesterId - UUID of the requester (from JWT)
 * @param {Object} data - Order creation payload
 * @returns {Object} - Created order with items and calculated fields
 */
async function createOrder(requesterId, data) {
  const {
    storeName,
    deliveryAddress,
    requesterLat,
    requesterLng,
    storeLat,
    storeLng,
    estimatedCost,
    deliveryFee: userDeliveryFee,
    items,
    notes,
  } = data;

  // Calculate distance using Haversine formula
  const distanceKm = calculateDistance(requesterLat, requesterLng, storeLat, storeLng);
  const roundedDistance = Math.round(distanceKm * 100) / 100;

  // Calculate delivery fee with ₹30 minimum floor (REQ-2)
  const deliveryFee = calculateDeliveryFee(distanceKm, userDeliveryFee);

  // Calculate total authorization amount (REQ-3)
  // Formula: (Estimated Item Cost * 1.15) + Delivery Fee
  const totalAuthAmount = Math.round(
    (estimatedCost * COST_BUFFER_MULTIPLIER + deliveryFee) * 100
  ) / 100;

  // Use a transaction to insert order + items atomically
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    // Insert order
    const orderResult = await client.query(
      `INSERT INTO orders (
        requester_id, store_name, delivery_address,
        requester_lat, requester_lng, store_lat, store_lng,
        estimated_cost, delivery_fee, total_auth_amount, distance_km,
        notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [
        requesterId, storeName, deliveryAddress,
        requesterLat, requesterLng, storeLat, storeLng,
        estimatedCost, deliveryFee, totalAuthAmount, roundedDistance,
        notes || null,
      ]
    );

    const order = orderResult.rows[0];

    // Insert order items
    const insertedItems = [];
    for (const item of items) {
      const itemResult = await client.query(
        `INSERT INTO order_items (order_id, item_name, quantity, estimated_price, image_url, notes)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          order.id,
          item.itemName,
          item.quantity || 1,
          item.estimatedPrice || null,
          item.imageUrl || null,
          item.notes || null,
        ]
      );
      insertedItems.push(itemResult.rows[0]);
    }

    await client.query('COMMIT');

    // Log RequestCreated event (stub for message broker integration in Sprint 2)
    console.log(
      `[InstaBuddy_Order] RequestCreated event — OrderID: ${order.id}, ` +
      `RequesterID: ${requesterId}, Store: ${storeName}, ` +
      `Distance: ${roundedDistance}km, Fee: ₹${deliveryFee}, ` +
      `TotalAuth: ₹${totalAuthAmount}`
    );

    return {
      ...order,
      items: insertedItems,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// ============================================================================
// Get Order by ID
// ============================================================================

/**
 * Fetch a single order with its items
 * @param {string} orderId - UUID of the order
 * @returns {Object} - Order with items array
 */
async function getOrderById(orderId) {
  // Fetch order
  const orderResult = await db.query(
    'SELECT * FROM orders WHERE id = $1',
    [orderId]
  );

  if (orderResult.rows.length === 0) {
    const error = new Error('Order not found');
    error.statusCode = 404;
    error.code = 'NOT_FOUND';
    throw error;
  }

  const order = orderResult.rows[0];

  // Fetch items for this order
  const itemsResult = await db.query(
    'SELECT * FROM order_items WHERE order_id = $1 ORDER BY created_at ASC',
    [orderId]
  );

  return {
    ...order,
    items: itemsResult.rows,
  };
}

// ============================================================================
// List Orders by Requester (with pagination)
// ============================================================================

/**
 * List orders for a specific requester with cursor-based pagination
 * @param {string} requesterId - UUID of the requester
 * @param {Object} options - { limit, offset, status }
 * @returns {Object} - { orders, total, limit, offset }
 */
async function getOrdersByRequester(requesterId, { limit = 20, offset = 0, status } = {}) {
  const params = [requesterId];
  let whereClause = 'WHERE requester_id = $1';

  // Optional status filter
  if (status) {
    params.push(status);
    whereClause += ` AND status = $${params.length}`;
  }

  // Get total count
  const countResult = await db.query(
    `SELECT COUNT(*) FROM orders ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].count, 10);

  // Fetch paginated orders
  params.push(limit, offset);
  const ordersResult = await db.query(
    `SELECT * FROM orders ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return {
    orders: ordersResult.rows,
    total,
    limit,
    offset,
  };
}

// ============================================================================
// Update Order Status
// ============================================================================

/**
 * Update order status with optional runner assignment
 * @param {string} orderId - UUID of the order
 * @param {string} newStatus - New status value
 * @param {string} runnerId - Optional runner UUID (set when status = ACCEPTED)
 * @returns {Object} - Updated order
 */
async function updateOrderStatus(orderId, newStatus, runnerId = null) {
  // Verify order exists
  const existingOrder = await db.query(
    'SELECT id, status FROM orders WHERE id = $1',
    [orderId]
  );

  if (existingOrder.rows.length === 0) {
    const error = new Error('Order not found');
    error.statusCode = 404;
    error.code = 'NOT_FOUND';
    throw error;
  }

  // Build update query
  const updateFields = ['status = $2', 'updated_at = NOW()'];
  const params = [orderId, newStatus];

  if (runnerId) {
    params.push(runnerId);
    updateFields.push(`runner_id = $${params.length}`);
  }

  const result = await db.query(
    `UPDATE orders SET ${updateFields.join(', ')}
     WHERE id = $1
     RETURNING *`,
    params
  );

  console.log(
    `[InstaBuddy_Order] StatusChanged — OrderID: ${orderId}, ` +
    `${existingOrder.rows[0].status} → ${newStatus}`
  );

  return result.rows[0];
}

module.exports = {
  createOrder,
  getOrderById,
  getOrdersByRequester,
  updateOrderStatus,
  // Exported for testing
  calculateDistance,
  calculateDeliveryFee,
};
