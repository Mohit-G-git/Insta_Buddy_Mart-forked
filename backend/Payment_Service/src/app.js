require('dotenv').config({
  path: require('path').resolve(__dirname, '../.env')
})

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const db = require('./config/db');
const { generalLimiter } = require('./middleware/rateLimiter');
const { errorHandler } = require('./utils/errors');
const paymentRouter = require('./routes/payment');

const app = express();
const PORT = process.env.PORT || 3002;

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
// NOTE: /webhook/razorpay uses express.raw() internally for signature verification
app.use((req, res, next) => {
  if (req.path === '/api/v1/payments/webhook/razorpay') {
    return next();    // Skip JSON parsing — webhook handler uses raw body
  }
  express.json({ limit: '1mb' })(req, res, next);
});

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
    service: 'payment-service',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Payment API routes
app.use('/api/v1/payments', paymentRouter);

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
      console.log(`\n✓ BuddyUp Payment Service running on port ${PORT}`);
      console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`✓ Razorpay Key: ${process.env.RAZORPAY_KEY_ID ? 'configured' : '⚠ NOT SET'}\n`);
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
