#!/usr/bin/env node

/**
 * API Gateway health check test
 * Run: node test-api-gateway.js
 */

const http = require('http');

const BASE_URL = 'http://localhost:3000';
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
  console.log('\n=== API Gateway Health Check Tests ===\n');

  try {
    // Test 1: Health endpoint
    console.log('GET /health');
    const health = await request('GET', '/health');
    assert('Returns 200', health.status === 200);
    assert('Has status: ok', health.body.status === 'ok');
    assert('Has service name', health.body.service === 'api-gateway');
    assert('Has timestamp', !!health.body.timestamp);
    assert('Lists upstream services', Array.isArray(health.body.upstreams));

    // Test 2: Unknown route returns 404
    console.log('\nGET /api/v1/unknown');
    const notFound = await request('GET', '/api/v1/unknown');
    assert('Returns 404 for unknown route', notFound.status === 404);
    assert('Returns NOT_FOUND code', notFound.body.error?.code === 'NOT_FOUND');

    // Test 3: Auth route proxying (will return 502 if IAM is down, which is expected)
    console.log('\nPOST /api/v1/auth/login (proxy test)');
    const authProxy = await request('POST', '/api/v1/auth/login', {});
    // If IAM is running → forwards response; if not → 502
    assert(
      'Auth route is proxied (200/400/401/502)',
      [200, 400, 401, 502].includes(authProxy.status)
    );

  } catch (error) {
    console.error(`\n✗ Connection failed: ${error.message}`);
    console.error('Make sure the API Gateway is running on port 3000');
    process.exit(1);
  }

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
