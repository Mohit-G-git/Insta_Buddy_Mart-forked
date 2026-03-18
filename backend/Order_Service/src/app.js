require('dotenv').config({
  path: require('path').resolve(__dirname, '../.env')
})

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const db = require('./config/db');
const { generalLimiter } = require('./middleware/rateLimiter');
const { errorHandler } = require('./utils/errors');
const ordersRouter = require('./routes/orders');

const app = express();
const PORT = process.env.PORT || 3004;

// ============================================================================
// Middleware Stack
// ============================================================================

// Security
app.use(helmet());

// CORS
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  })
);

// Body parsing
app.use(express.json({ limit: '2mb' }));

// Rate limiting (applied to all routes)
app.use(generalLimiter);

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(
      `[${req.method}] ${req.path} → ${res.statusCode} (${duration}ms)`
    );
  });

  next();
});

// ============================================================================
// Routes
// ============================================================================

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'order-service',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Order API routes (create, list, get, update status)
app.use('/api/v1/orders', ordersRouter);

// ============================================================================
// Error Handler (MUST be last)
// ============================================================================

app.use(errorHandler);

// ============================================================================
// Server Startup
// ============================================================================

async function startServer() {
  try {
    // Test database connection
    await db.testConnection();

    // Start HTTP server
    app.listen(PORT, () => {
      console.log(`\n✓ BuddyUp Order Service running on port ${PORT}`);
      console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`✓ Min Delivery Fee: ₹${process.env.MIN_DELIVERY_FEE || 30}`);
      console.log(`✓ Rate per KM: ₹${process.env.RATE_PER_KM || 10}\n`);
    });
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\nSIGTERM received. Shutting down gracefully...');
  process.exit(0);
});

// Start the server
if (require.main === module) {
  startServer();
}

module.exports = { app };
