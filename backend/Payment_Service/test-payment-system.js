#!/usr/bin/env node

/**
 * Basic Payment Service health check test
 * Run: node test-payment-system.js
 */

const http = require('http');

const BASE_URL = 'http://localhost:3002';
let passed = 0;
let failed = 0;

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: { 'Content-Type': 'application/json' },
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

async function runTests() {
  console.log('\n=== Payment Service Health Check Tests ===\n');

  try {
    // Test 1: Health endpoint
    console.log('GET /health');
    const health = await request('GET', '/health');
    assert('Returns 200', health.status === 200);
    assert('Has status: ok', health.body.status === 'ok');
    assert('Has service name', health.body.service === 'payment-service');
    assert('Has timestamp', !!health.body.timestamp);

    // Test 2: Auth required on protected routes
    console.log('\nPOST /api/v1/payments/create-order (no auth)');
    const noAuth = await request('POST', '/api/v1/payments/create-order', {});
    assert('Returns 401 without auth', noAuth.status === 401);
    assert('Returns AUTH_REQUIRED code', noAuth.body.error?.code === 'AUTH_REQUIRED');

  } catch (error) {
    console.error(`\n✗ Connection failed: ${error.message}`);
    console.error('Make sure the payment service is running on port 3002');
    process.exit(1);
  }

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
