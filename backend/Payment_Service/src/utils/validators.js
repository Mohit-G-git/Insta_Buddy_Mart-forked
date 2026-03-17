const Joi = require('joi');

/**
 * Schema for POST /create-order
 * The Order Service calls this to authorize a payment
 */
const createOrderSchema = Joi.object({
  order_id: Joi.string()
    .uuid({ version: 'uuidv4' })
    .required()
    .messages({
      'string.guid': 'order_id must be a valid UUID',
      'any.required': 'order_id is required',
    }),

  item_cost: Joi.number()
    .positive()
    .precision(2)
    .max(999999.99)
    .required()
    .messages({
      'number.positive': 'item_cost must be a positive number',
      'number.max': 'item_cost cannot exceed 999999.99',
      'any.required': 'item_cost is required',
    }),

  platform_fee: Joi.number()
    .min(0)
    .precision(2)
    .max(99999.99)
    .default(0)
    .messages({
      'number.min': 'platform_fee cannot be negative',
      'number.max': 'platform_fee cannot exceed 99999.99',
    }),

  currency: Joi.string()
    .valid('INR')
    .default('INR')
    .messages({
      'any.only': 'Only INR currency is supported',
    }),

  payee_user_id: Joi.string()
    .uuid({ version: 'uuidv4' })
    .allow(null)
    .optional()
    .messages({
      'string.guid': 'payee_user_id must be a valid UUID',
    }),

  metadata: Joi.object()
    .default({})
    .optional(),
});

/**
 * Schema for POST /verify
 * Client sends Razorpay callback data for server-side verification
 */
const verifyPaymentSchema = Joi.object({
  escrow_id: Joi.string()
    .uuid({ version: 'uuidv4' })
    .required()
    .messages({
      'string.guid': 'escrow_id must be a valid UUID',
      'any.required': 'escrow_id is required',
    }),

  razorpay_order_id: Joi.string()
    .required()
    .messages({
      'any.required': 'razorpay_order_id is required',
    }),

  razorpay_payment_id: Joi.string()
    .required()
    .messages({
      'any.required': 'razorpay_payment_id is required',
    }),

  razorpay_signature: Joi.string()
    .required()
    .messages({
      'any.required': 'razorpay_signature is required',
    }),
});

/**
 * Schema for POST /refund/:escrowId
 */
const refundSchema = Joi.object({
  amount: Joi.number()
    .positive()
    .precision(2)
    .optional()
    .messages({
      'number.positive': 'amount must be a positive number',
    }),

  reason: Joi.string()
    .max(500)
    .optional()
    .messages({
      'string.max': 'reason cannot exceed 500 characters',
    }),
});

/**
 * Validate data against a Joi schema
 */
function validate(schema, data) {
  const { value, error } = schema.validate(data, {
    abortEarly: false,
    stripUnknown: false,
  });

  if (error) {
    const details = error.details.map(detail => ({
      field: detail.path.join('.'),
      message: detail.message,
      type: detail.type,
    }));

    return {
      value,
      error: {
        isJoi: true,
        message: error.message,
        details,
      },
    };
  }

  return { value, error: null };
}

module.exports = {
  createOrderSchema,
  verifyPaymentSchema,
  refundSchema,
  validate,
};
