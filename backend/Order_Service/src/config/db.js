// Creates and manages DB connection pool
// Wraps queries with logging + error handling
// Provides connection test utility

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,                                    // Order service — higher pool for concurrent order creation
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('connect', () => {
  console.log('✓ New DB client connected');
});

pool.on('error', (error) => {
  console.error('✗ Unexpected error in database pool:', error.message);
  process.exit(1);
});

/**
 * Execute a parameterized SQL query with logging for slow queries
 * @param {string} text - SQL query string
 * @param {Array} params - Query parameters
 * @returns {Object} - pg query result
 */
async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;

    if (duration > 1000) {
      console.warn(`⚠ Slow query (${duration}ms):\n${text}`);
    }

    return result;
  }
  catch (error) {
    console.error('Database query error:', error.message);
    throw error;
  }
}

/**
 * Get a client from the pool for transaction support
 * @returns {Object} - pg client
 */
async function getClient() {
  const client = await pool.connect();
  return client;
}

async function testConnection() {
  try {
    const result = await pool.query('SELECT NOW()');
    console.log('✓ Database connection test successful:', result.rows[0].now);
    return true;
  } catch (error) {
    console.error('✗ Database connection test failed:', error.message);
    throw error;
  }
}

module.exports = {
  pool,
  query,
  getClient,
  testConnection,
};
