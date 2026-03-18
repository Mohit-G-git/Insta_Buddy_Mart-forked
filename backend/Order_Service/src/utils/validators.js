const Joi = require('joi');

// ============================================================================
// Order Validators
// ============================================================================

/**
 * Validate order creation payload (REQ-1, REQ-2)
 * Requester provides store name, items list, estimated cost, and location data
 */
const createOrderSchema = Joi.object({
  storeName: Joi.string().min(1).max(200).required()
    .messages({ 'string.empty': 'Store name is required' }),
  deliveryAddress: Joi.string().min(5).max(500).required()
    .messages({ 'string.min': 'Delivery address must be at least 5 characters' }),

  // Geolocation for distance-based fee calculation
  requesterLat: Joi.number().min(-90).max(90).required()
    .messages({ 'number.base': 'Requester latitude must be a valid number' }),
  requesterLng: Joi.number().min(-180).max(180).required()
    .messages({ 'number.base': 'Requester longitude must be a valid number' }),
  storeLat: Joi.number().min(-90).max(90).required()
    .messages({ 'number.base': 'Store latitude must be a valid number' }),
  storeLng: Joi.number().min(-180).max(180).required()
    .messages({ 'number.base': 'Store longitude must be a valid number' }),

  // Estimated cost of all items
  estimatedCost: Joi.number().positive().precision(2).required()
    .messages({ 'number.positive': 'Estimated cost must be a positive number' }),

  // Optional delivery fee override (must be >= MIN_DELIVERY_FEE)
  deliveryFee: Joi.number().min(30).precision(2).optional()
    .messages({ 'number.min': 'Delivery fee cannot be less than ₹30' }),

  // Shopping list items (REQ-1)
  items: Joi.array().items(
    Joi.object({
      itemName: Joi.string().min(1).max(300).required()
        .messages({ 'string.empty': 'Item name is required' }),
      quantity: Joi.number().integer().min(1).default(1)
        .messages({ 'number.min': 'Quantity must be at least 1' }),
      estimatedPrice: Joi.number().positive().precision(2).optional()
        .messages({ 'number.positive': 'Estimated price must be positive' }),
      imageUrl: Joi.string().uri().optional()
        .messages({ 'string.uri': 'Image URL must be a valid URI' }),
      notes: Joi.string().max(500).optional(),
    })
  ).min(1).required()
    .messages({ 'array.min': 'At least one item is required in the shopping list' }),

  // Optional order notes
  notes: Joi.string().max(1000).optional(),
});

/**
 * Validate order status update payload
 */
const updateOrderStatusSchema = Joi.object({
  status: Joi.string().valid(
    'CREATED', 'ACCEPTED', 'SHOPPING', 'BILL_UPLOADED', 'DELIVERED', 'CANCELLED'
  ).required()
    .messages({ 'any.only': 'Invalid order status' }),
  runnerId: Joi.string().uuid().optional()
    .messages({ 'string.guid': 'Runner ID must be a valid UUID' }),
});

/**
 * Validate UUID path parameter
 */
const orderIdParamSchema = Joi.object({
  id: Joi.string().uuid().required()
    .messages({ 'string.guid': 'Order ID must be a valid UUID' }),
});

// ============================================================================
// Validation Middleware Factory
// ============================================================================

/**
 * Creates a validation middleware for a given Joi schema
 * @param {Joi.ObjectSchema} schema - The Joi schema to validate against
 * @param {string} source - Request property to validate: 'body', 'params', 'query'
 * @returns {Function} Express middleware
 */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[source], {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: error.message,
          details: error.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message,
            type: detail.type,
          })),
        },
      });
    }

    // Replace request data with validated + sanitized values
    req[source] = value;
    next();
  };
}

module.exports = {
  createOrderSchema,
  updateOrderStatusSchema,
  orderIdParamSchema,
  validate,
};
