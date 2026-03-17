require('dotenv').config({
  path: require('path').resolve(__dirname, '../.env')
})

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const db = require('./config/db');
const { generalLimiter } = require('./middleware/rateLimiter');
const { errorHandler } = require('./utils/errors');
const authRouter = require('./routes/auth');
const kycRouter = require('./routes/kyc');

const app = express();
const PORT = process.env.PORT || 3003;

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
app.use(express.json({ limit: '1mb' }));

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
    service: 'iam-service',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Auth API routes (register, login, OTP, refresh, profile)
app.use('/api/v1/auth', authRouter);

// KYC API routes (upload, status, admin verify)
app.use('/api/v1/kyc', kycRouter);

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
      console.log(`\n✓ BuddyUp IAM Service running on port ${PORT}`);
      console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`✓ S3 Bucket: ${process.env.S3_KYC_BUCKET || 'buddyup-kyc-documents'}`);
      console.log(`✓ JWT Expiry: ${process.env.JWT_EXPIRY || '24h'}\n`);
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
