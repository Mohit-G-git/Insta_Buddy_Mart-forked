const Redis = require('ioredis');  //ioredis is a Node.js library to talk to Redis.

// ioredis expects URL as first argument, not in options object
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  keyPrefix: process.env.REDIS_KEY_PREFIX || 'buddyup:',
  retryStrategy: (times) => Math.min(times * 50, 2000),
  enableReadyCheck: true,
  enableOfflineQueue: true,
});

// Event listeners
redis.on('connect', () => {
  console.log('[Redis] Connected to Redis server');
});

redis.on('ready', () => {
  console.log('[Redis] Redis client ready for commands');
});

redis.on('error', (error) => {
  console.error('[Redis] Error:', error.message);
  // Do NOT exit process - Redis errors should be non-fatal
});

redis.on('close', () => {
  console.log('[Redis] Redis connection closed');
});

redis.on('reconnecting', (info) => {
  console.log(`[Redis] Reconnecting attempt ${info.attempt} of ${info.total}`);
});

// what it does?? Store key/otp for 60 seconds. After 60 seconds → automatically deleted.
// Set a key with TTL expiration
// @param {string} key - Redis key
// @param {string|number} value - Value to store
// @param {number} ttlSeconds - Time to live in seconds
// @returns {Promise<boolean>} True on success, false on error

async function setWithTTL(key, value, ttlSeconds) {
  try {
    await redis.setex(key, ttlSeconds, value);
    return true;
  } catch (error) {
    console.error('[Redis] setWithTTL error:', error.message);
    return null;
  }
}


// Get a value and parse it as JSON
// Redis stores everything as strings.You must convert to JSON string first.
// @param {string} key - Redis key
// @returns {Promise<any>} Parsed JSON object or null

async function getJSON(key) {
  try {
    const value = await redis.get(key);
    if (!value) return null;
    return JSON.parse(value);
  } catch (error) {
    console.error('[Redis] getJSON error:', error.message);
    return null;
  }
}

// Store a value as JSON with optional TTL
// @param {string} key - Redis key
// @param {any} value - Value to stringify and store
// @param {number} ttlSeconds - Optional TTL in seconds
// @returns {Promise<boolean>} True on success, false on error

async function setJSON(key, value, ttlSeconds) {
  try {
    const jsonValue = JSON.stringify(value);
    if (ttlSeconds) {
      await redis.setex(key, ttlSeconds, jsonValue);
    } else {
      await redis.set(key, jsonValue);
    }
    return true;
  } catch (error) {
    console.error('[Redis] setJSON error:', error.message);
    return null;
  }
}


// Delete a key from Redis
// @param {string} key - Redis key
// @returns {Promise<boolean>} True on success, false on error

async function deleteKey(key) {
  try {
    await redis.del(key);
    return true;
  } catch (error) {
    console.error('[Redis] deleteKey error:', error.message);
    return null;
  }
}

// Push a JSON value to a list and trim to maxLength
// Used for caching recent messages (keeps last N messages)
// @param {string} key - Redis list key
// @param {any} value - Value to push (will be stringified)
// @param {number} maxLength - Maximum list length (0-indexed, so 49 keeps 50 items)
// @returns {Promise<boolean>} True on success, false on error

async function pushToList(key, value, maxLength) {
  try {
    const jsonValue = JSON.stringify(value);
    await redis.lpush(key, jsonValue);
    if (maxLength) {
      await redis.ltrim(key, 0, maxLength);
    }
    return true;
  } catch (error) {
    console.error('[Redis] pushToList error:', error.message);
    return null;
  }
}


// Get a range from a Redis list and parse each item as JSON
// @param {string} key - Redis list key
// @param {number} start - Start index (inclusive)
// @param {number} end - End index (inclusive, -1 for last element)
// @returns {Promise<Array>} Array of parsed JSON objects or empty array on error

async function getList(key, start, end) {
  try {
    const items = await redis.lrange(key, start, end);
    if (!items || items.length === 0) return [];
    return items.map(item => {
      try {
        return JSON.parse(item);
      } catch (parseError) {
        console.error('[Redis] Failed to parse list item:', parseError.message);
        return null;
      }
    }).filter(item => item !== null);
  } catch (error) {
    console.error('[Redis] getList error:', error.message);
    return [];
  }
}

module.exports = redis;
module.exports.setWithTTL = setWithTTL;
module.exports.getJSON = getJSON;  // get a value from a key and parse it as JSON
module.exports.setJSON = setJSON;  // set a value to a key after converting in json (used for storing one object in Redis, ex: user presence status)
module.exports.deleteKey = deleteKey; // delete a key from Redis
module.exports.pushToList = pushToList; // push a JSON value to a list and trim to maxLength (used for caching recent messages)
module.exports.getList = getList; // get a range from a Redis list and parse each item as JSON (used for retrieving cached recent messages)
