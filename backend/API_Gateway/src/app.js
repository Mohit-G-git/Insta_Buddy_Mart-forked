require('dotenv').config({
  path: require('path').resolve(__dirname, '../.env')
})

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { createProxyMiddleware } = require('http-proxy-middleware');

const services = require('./config/services');
const { generalLimiter, authLimiter } = require('./middleware/rateLimiter');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================================
// Middleware Stack
// ============================================================================

// Security
app.use(helmet());

// CORS
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:8080',
  })
);

// Rate limiting (applied to all routes)
app.use(generalLimiter);

// Stricter rate limiting on auth routes
app.use('/api/v1/auth', authLimiter);

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
// Health Check
// ============================================================================

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'api-gateway',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    upstreams: Object.entries(services).map(([key, svc]) => ({
      name: svc.name,
      url: svc.url,
      prefixes: svc.prefixes,
    })),
  });
});

// ============================================================================
// Proxy Routes — forward requests to upstream microservices
// ============================================================================

// For each registered service, create proxy middleware for its prefixes
Object.entries(services).forEach(([key, service]) => {
  service.prefixes.forEach((prefix) => {
    console.log(`  ↳ ${prefix}/** → ${service.url} (${service.name})`);

    app.use(
      prefix,
      createProxyMiddleware({
        target: service.url,
        changeOrigin: true,
        // Timeout for upstream connections
        proxyTimeout: 30000,
        timeout: 30000,
        // Error handler — return 502 if upstream is down
        on: {
          error: (err, req, res) => {
            console.error(
              `[Gateway] Proxy error for ${service.name}: ${err.message}`
            );
            if (!res.headersSent) {
              res.status(502).json({
                error: {
                  code: 'SERVICE_UNAVAILABLE',
                  message: `${service.name} is temporarily unavailable`,
                },
              });
            }
          },
          proxyReq: (proxyReq, req) => {
            // Forward the client IP to upstream services
            proxyReq.setHeader('X-Forwarded-For', req.ip);
            proxyReq.setHeader('X-Request-ID', `gw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
          },
        },
      })
    );
  });
});

// ============================================================================
// 404 — no matching route/service
// ============================================================================

app.use((req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `No service registered for path: ${req.path}`,
    },
  });
});

// ============================================================================
// Server Startup
// ============================================================================

async function startServer() {
  try {
    app.listen(PORT, () => {
      console.log(`\n✓ BuddyUp API Gateway running on port ${PORT}`);
      console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`✓ Registered services:`);
      Object.entries(services).forEach(([key, svc]) => {
        console.log(`  → ${svc.name}: ${svc.url}`);
      });
      console.log('');
    });
  } catch (error) {
    console.error('Failed to start API Gateway:', error.message);
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

// Start the gateway
if (require.main === module) {
  startServer();
}

module.exports = { app };
