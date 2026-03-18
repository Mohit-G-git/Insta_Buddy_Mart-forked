const express = require('express');
const router = express.Router();

const orderService = require('../services/orderService');
const auth = require('../middleware/auth');
const { orderCreateLimiter } = require('../middleware/rateLimiter');
const {
  validate,
  createOrderSchema,
  updateOrderStatusSchema,
  orderIdParamSchema,
} = require('../utils/validators');

// ============================================================================
// POST / — Create a new shopping request order (REQ-1, REQ-2)
// ============================================================================
router.post(
  '/',
  auth,
  orderCreateLimiter,
  validate(createOrderSchema),
  async (req, res, next) => {
    try {
      const order = await orderService.createOrder(req.userId, req.body);

      res.status(201).json({
        message: 'Order created successfully',
        order,
      });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({
          error: {
            code: error.code,
            message: error.message,
          },
        });
      }
      next(error);
    }
  }
);

// ============================================================================
// GET / — List orders for the authenticated requester (paginated)
// ============================================================================
router.get('/', auth, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const offset = parseInt(req.query.offset, 10) || 0;
    const status = req.query.status || undefined;

    const result = await orderService.getOrdersByRequester(req.userId, {
      limit,
      offset,
      status,
    });

    res.json(result);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }
    next(error);
  }
});

// ============================================================================
// GET /:id — Get a single order by ID
// ============================================================================
router.get(
  '/:id',
  auth,
  validate(orderIdParamSchema, 'params'),
  async (req, res, next) => {
    try {
      const order = await orderService.getOrderById(req.params.id);

      res.json({ order });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({
          error: {
            code: error.code,
            message: error.message,
          },
        });
      }
      next(error);
    }
  }
);

// ============================================================================
// PATCH /:id/status — Update order status
// ============================================================================
router.patch(
  '/:id/status',
  auth,
  validate(orderIdParamSchema, 'params'),
  validate(updateOrderStatusSchema),
  async (req, res, next) => {
    try {
      const { status, runnerId } = req.body;
      const order = await orderService.updateOrderStatus(
        req.params.id,
        status,
        runnerId
      );

      res.json({
        message: 'Order status updated successfully',
        order,
      });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({
          error: {
            code: error.code,
            message: error.message,
          },
        });
      }
      next(error);
    }
  }
);

module.exports = router;
