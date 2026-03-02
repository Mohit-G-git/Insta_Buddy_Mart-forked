// Creates and manages DB connection pool
// Wraps queries with logging + error handling
// Provides connection test utility

const { Pool } = require('pg');
// pg = official PostgreSQL client for Node.js
// Pool = manages multiple DB connections efficiently


const pool = new Pool({
  connectionString: process.env.DATABASE_URL, //database connection URL from .env
  max: 20,                                    //Max 20 simultaneous DB connections. If 100 users send messages at once, Only 20 queries run in parallel, Others wait in queue
  idleTimeoutMillis: 30000,                   //If a DB client is idle for 30 sec → close it.
  connectionTimeoutMillis: 5000,              //If DB doesn't respond in 5 sec → throw error.
});

// Event listener: New connection established
pool.on('connect', () => {
  console.log('✓ New DB client connected');
});

// Event listener: Fatal pool error
pool.on('error', (error) => {
  console.error('✗ Unexpected error in database pool:', error.message);
  process.exit(1);    //Better to crash than run with broken DB connection
});


// Execute a database query with slow query logging
// @param {string} text - SQL query text
// @param {Array} params - Query parameters
// @returns {Promise} Query result from pool.query()

// how is query called??
// first write the text to say what u want to do (storing message below) and then give parameters which will be used instead of $1,$2,$3 in the text. this text is readed by the postgreSQL.
// query( text =   "INSERT INTO messages (chat_id, sender_id, content) VALUES ($1, $2, $3)" , 
//        params = [000001 , 000002 ,"hello"] )

async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);  //Wait until DB finishes, then continue.
    const duration = Date.now() - start;
    
    if (duration > 1000) {    //If query takes more than 1 second, log a warning with the query text and duration.
      console.warn(`⚠ Slow query (${duration}ms):\n${text}`);
    }
    
    return result;
  } 
  catch (error) {
    console.error('Database query error:', error.message);
    throw error;
  }
}


// Test the database connection
// @returns {Promise<boolean>} True if connection is successful
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
  testConnection,
};
// make pool , query and testConnection available to other files that require this module.