// Processed events data access layer
// Idempotency table to prevent duplicate event processing

const db = require('../config/db');

/**
 * Check if an event has already been processed
 *
 * @param {string} eventId - UUID of the event
 * @param {object} [client] - Optional DB client for transactional use
 * @returns {boolean} True if the event has already been processed
 */
async function isEventProcessed(eventId, client) {
  const queryFn = client || db;
  const result = await queryFn.query(
    'SELECT 1 FROM processed_events WHERE event_id = $1',
    [eventId]
  );
  return result.rows.length > 0;
}

/**
 * Record an event as processed
 * Uses ON CONFLICT to handle race conditions gracefully
 *
 * @param {object} params
 * @param {string} params.eventId - UUID of the event
 * @param {string} params.eventType - Type of event (e.g. 'OrderDelivered')
 * @param {string} params.orderId - UUID of the order
 * @param {object} [client] - Optional DB client for transactional use
 * @returns {boolean} True if the event was newly inserted, false if duplicate
 */
async function markEventProcessed({ eventId, eventType, orderId }, client) {
  const queryFn = client || db;
  const result = await queryFn.query(
    `INSERT INTO processed_events (event_id, event_type, order_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (event_id) DO NOTHING
     RETURNING *`,
    [eventId, eventType, orderId]
  );
  return result.rows.length > 0;  // true = newly inserted, false = duplicate
}

module.exports = {
  isEventProcessed,
  markEventProcessed,
};
