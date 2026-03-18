#!/usr/bin/env node

/**
 * Order Service integration test
 * Run: node test-order-service.js
 *
 * Prerequisites:
 *   - Order Service running on port 3004
 *   - IAM Service running on port 3003 (for JWT token generation)
 *
 * Tests:
 *   1. Health endpoint
 *   2. Create order without auth → 401
 *   3. Create order with validation error → 400
 *   4. Create order with valid data → 201
 *   5. Delivery fee ≥ ₹30 floor
 *   6. Total auth amount formula verification
 *   7. Get order by ID → 200
 *   8. List requester's orders → 200
 *   9. Update order status → 200
 */

const http = require('http');

const ORDER_BASE = 'http://localhost:3004';
const IAM_BASE = 'http://localhost:3003';
let passed = 0;
let failed = 0;
let authToken = null;
let createdOrderId = null;

function request(baseUrl, method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

function assert(testName, condition) {
  if (condition) {
    console.log(`  ✓ ${testName}`);
    passed++;
  } else {
    console.log(`  ✗ ${testName}`);
    failed++;
  }
}

// Sample order data — store ~3km away from requester (Bangalore coordinates)
const sampleOrder = {
  storeName: 'Reliance Fresh - Koramangala',
  deliveryAddress: '123, 4th Block, Koramangala, Bangalore 560034',
  requesterLat: 12.9352,
  requesterLng: 77.6245,
  storeLat: 12.9279,
  storeLng: 77.6271,
  estimatedCost: 500,
  items: [
    { itemName: 'Milk 1L (Nandini)', quantity: 2, estimatedPrice: 56 },
    { itemName: 'Bread - Whole Wheat', quantity: 1, estimatedPrice: 45 },
    { itemName: 'Eggs (12 pack)', quantity: 1, estimatedPrice: 84 },
    { itemName: 'Bananas', quantity: 6, estimatedPrice: 30 },
  ],
  notes: 'Please check expiry dates on the milk',
};

async function getAuthToken() {
  const testEmail = `ordertest_${Date.now()}@example.com`;
  const testPhone = `9${Math.floor(100000000 + Math.random() * 900000000)}`;

  // Register a test user on IAM Service
  try {
    await request(IAM_BASE, 'POST', '/api/v1/auth/register', {
      fullName: 'Order Test User',
      email: testEmail,
      phone: testPhone,
      password: 'TestPassword123',
      role: 'requester',
    });

    // Login to get JWT
    const login = await request(IAM_BASE, 'POST', '/api/v1/auth/login', {
      email: testEmail,
      password: 'TestPassword123',
    });

    if (login.body.accessToken) {
      return login.body.accessToken;
    }
  } catch (error) {
    console.warn('  ⚠ Could not get auth token from IAM Service. Using mock token.');
  }

  // Fallback: create a mock JWT if IAM Service is not running
  // This will only work if JWT_SECRET matches
  return null;
}

async function runTests() {
  console.log('\n=== Order Service Tests ===\n');

  try {
    // ─────────────────────────────────────────────────
    // Test 1: Health endpoint
    // ─────────────────────────────────────────────────
    console.log('1. GET /health');
    const health = await request(ORDER_BASE, 'GET', '/health');
    assert('Returns 200', health.status === 200);
    assert('Has status: ok', health.body.status === 'ok');
    assert('Has service name', health.body.service === 'order-service');
    assert('Has timestamp', !!health.body.timestamp);

    // ─────────────────────────────────────────────────
    // Get auth token from IAM Service
    // ─────────────────────────────────────────────────
    console.log('\n-- Obtaining auth token from IAM Service...');
    authToken = await getAuthToken();
    if (!authToken) {
      console.log('  ⚠ IAM Service not available. Skipping auth-dependent tests.');
      console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
      process.exit(failed > 0 ? 1 : 0);
    }
    console.log('  ✓ Auth token obtained');

    // ─────────────────────────────────────────────────
    // Test 2: Create order without auth → 401
    // ─────────────────────────────────────────────────
    console.log('\n2. POST /api/v1/orders (no auth)');
    const noAuth = await request(ORDER_BASE, 'POST', '/api/v1/orders', sampleOrder);
    assert('Returns 401 without token', noAuth.status === 401);
    assert('Returns AUTH_REQUIRED', noAuth.body.error?.code === 'AUTH_REQUIRED');

    // ─────────────────────────────────────────────────
    // Test 3: Create order with validation error → 400
    // ─────────────────────────────────────────────────
    console.log('\n3. POST /api/v1/orders (missing fields)');
    const invalid = await request(ORDER_BASE, 'POST', '/api/v1/orders', { storeName: 'Test' }, {
      Authorization: `Bearer ${authToken}`,
    });
    assert('Returns 400 for missing fields', invalid.status === 400);
    assert('Returns VALIDATION_ERROR', invalid.body.error?.code === 'VALIDATION_ERROR');

    // ─────────────────────────────────────────────────
    // Test 4: Create order with valid data → 201
    // ─────────────────────────────────────────────────
    console.log('\n4. POST /api/v1/orders (valid)');
    const create = await request(ORDER_BASE, 'POST', '/api/v1/orders', sampleOrder, {
      Authorization: `Bearer ${authToken}`,
    });
    assert('Returns 201', create.status === 201);
    assert('Returns order object', !!create.body.order);
    assert('Order has id', !!create.body.order?.id);
    assert('Status is CREATED', create.body.order?.status === 'CREATED');
    assert('Has items array', Array.isArray(create.body.order?.items));
    assert('Items count matches', create.body.order?.items?.length === 4);

    createdOrderId = create.body.order?.id;

    // ─────────────────────────────────────────────────
    // Test 5: Delivery fee ≥ ₹30 floor (REQ-2)
    // ─────────────────────────────────────────────────
    console.log('\n5. Delivery fee validation (REQ-2)');
    const deliveryFee = parseFloat(create.body.order?.delivery_fee);
    assert('Delivery fee is a number', !isNaN(deliveryFee));
    assert('Delivery fee ≥ ₹30 (minimum floor)', deliveryFee >= 30);
    assert('Distance is calculated', parseFloat(create.body.order?.distance_km) > 0);
    console.log(`     Distance: ${create.body.order?.distance_km} km, Fee: ₹${deliveryFee}`);

    // ─────────────────────────────────────────────────
    // Test 6: Total auth amount formula (REQ-3)
    // ─────────────────────────────────────────────────
    console.log('\n6. Total auth amount formula (REQ-3)');
    const estimatedCost = parseFloat(create.body.order?.estimated_cost);
    const totalAuth = parseFloat(create.body.order?.total_auth_amount);
    const expectedAuth = Math.round((estimatedCost * 1.15 + deliveryFee) * 100) / 100;
    assert('Total auth amount matches formula', Math.abs(totalAuth - expectedAuth) < 0.01);
    console.log(`     Expected: ₹${expectedAuth}, Got: ₹${totalAuth}`);

    // ─────────────────────────────────────────────────
    // Test 7: Get order by ID → 200
    // ─────────────────────────────────────────────────
    if (createdOrderId) {
      console.log('\n7. GET /api/v1/orders/:id');
      const getOrder = await request(ORDER_BASE, 'GET', `/api/v1/orders/${createdOrderId}`, null, {
        Authorization: `Bearer ${authToken}`,
      });
      assert('Returns 200', getOrder.status === 200);
      assert('Returns order object', !!getOrder.body.order);
      assert('Order ID matches', getOrder.body.order?.id === createdOrderId);
      assert('Has items array', Array.isArray(getOrder.body.order?.items));
      assert('Store name matches', getOrder.body.order?.store_name === sampleOrder.storeName);
    }

    // ─────────────────────────────────────────────────
    // Test 8: List requester's orders → 200
    // ─────────────────────────────────────────────────
    console.log('\n8. GET /api/v1/orders (list)');
    const listOrders = await request(ORDER_BASE, 'GET', '/api/v1/orders?limit=10&offset=0', null, {
      Authorization: `Bearer ${authToken}`,
    });
    assert('Returns 200', listOrders.status === 200);
    assert('Has orders array', Array.isArray(listOrders.body.orders));
    assert('Has total count', typeof listOrders.body.total === 'number');
    assert('Total >= 1', listOrders.body.total >= 1);

    // ─────────────────────────────────────────────────
    // Test 9: Update order status → 200
    // ─────────────────────────────────────────────────
    if (createdOrderId) {
      console.log('\n9. PATCH /api/v1/orders/:id/status');
      const updateStatus = await request(
        ORDER_BASE,
        'PATCH',
        `/api/v1/orders/${createdOrderId}/status`,
        { status: 'ACCEPTED' },
        { Authorization: `Bearer ${authToken}` }
      );
      assert('Returns 200', updateStatus.status === 200);
      assert('Status updated to ACCEPTED', updateStatus.body.order?.status === 'ACCEPTED');
    }

    // ─────────────────────────────────────────────────
    // Test 10: Create order with delivery fee below floor → 400
    // ─────────────────────────────────────────────────
    console.log('\n10. POST /api/v1/orders (delivery fee below ₹30 floor)');
    const lowFee = await request(ORDER_BASE, 'POST', '/api/v1/orders', {
      ...sampleOrder,
      deliveryFee: 10, // Below ₹30 minimum
    }, {
      Authorization: `Bearer ${authToken}`,
    });
    assert('Returns 400 for fee below floor', lowFee.status === 400);
    assert('Returns VALIDATION_ERROR', lowFee.body.error?.code === 'VALIDATION_ERROR');

  } catch (error) {
    console.error(`\n✗ Connection failed: ${error.message}`);
    console.error('Make sure the Order Service is running on port 3004');
    process.exit(1);
  }

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
