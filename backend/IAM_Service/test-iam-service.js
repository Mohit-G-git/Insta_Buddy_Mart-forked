#!/usr/bin/env node

/**
 * IAM Service health check and auth flow test
 * Run: node test-iam-service.js
 *
 * Tests:
 *   1. Health endpoint
 *   2. User registration
 *   3. Login with credentials
 *   4. OTP request
 *   5. Auth-protected route (/me) without token
 *   6. Auth-protected route (/me) with token
 *   7. KYC status check
 */

const http = require('http');

const BASE_URL = 'http://localhost:3003';
let passed = 0;
let failed = 0;
let authToken = null;

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
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

async function runTests() {
  console.log('\n=== IAM Service Tests ===\n');

  const testEmail = `test_${Date.now()}@example.com`;
  const testPhone = `9${Math.floor(100000000 + Math.random() * 900000000)}`;

  try {
    // ─────────────────────────────────────────────────
    // Test 1: Health endpoint
    // ─────────────────────────────────────────────────
    console.log('1. GET /health');
    const health = await request('GET', '/health');
    assert('Returns 200', health.status === 200);
    assert('Has status: ok', health.body.status === 'ok');
    assert('Has service name', health.body.service === 'iam-service');
    assert('Has timestamp', !!health.body.timestamp);

    // ─────────────────────────────────────────────────
    // Test 2: User registration
    // ─────────────────────────────────────────────────
    console.log('\n2. POST /api/v1/auth/register');
    const register = await request('POST', '/api/v1/auth/register', {
      fullName: 'Test User',
      email: testEmail,
      phone: testPhone,
      password: 'TestPassword123',
      role: 'runner',
    });
    assert('Returns 201', register.status === 201);
    assert('Returns user object', !!register.body.user);
    assert('User has id', !!register.body.user?.id);
    assert('User role is runner', register.body.user?.role === 'runner');
    assert('KYC not verified by default', register.body.user?.kyc_verified === false);

    // ─────────────────────────────────────────────────
    // Test 3: Duplicate registration fails
    // ─────────────────────────────────────────────────
    console.log('\n3. POST /api/v1/auth/register (duplicate)');
    const duplicate = await request('POST', '/api/v1/auth/register', {
      fullName: 'Test User',
      email: testEmail,
      phone: testPhone,
      password: 'TestPassword123',
      role: 'runner',
    });
    assert('Returns 409 for duplicate', duplicate.status === 409);
    assert('Returns CONFLICT code', duplicate.body.error?.code === 'CONFLICT');

    // ─────────────────────────────────────────────────
    // Test 4: Login with credentials
    // ─────────────────────────────────────────────────
    console.log('\n4. POST /api/v1/auth/login');
    const login = await request('POST', '/api/v1/auth/login', {
      email: testEmail,
      password: 'TestPassword123',
    });
    assert('Returns 200', login.status === 200);
    assert('Returns accessToken', !!login.body.accessToken);
    assert('Returns refreshToken', !!login.body.refreshToken);
    assert('Returns user object', !!login.body.user);

    authToken = login.body.accessToken;

    // ─────────────────────────────────────────────────
    // Test 5: Login with wrong password
    // ─────────────────────────────────────────────────
    console.log('\n5. POST /api/v1/auth/login (wrong password)');
    const wrongLogin = await request('POST', '/api/v1/auth/login', {
      email: testEmail,
      password: 'WrongPassword',
    });
    assert('Returns 401 for wrong password', wrongLogin.status === 401);
    assert('Returns INVALID_CREDENTIALS', wrongLogin.body.error?.code === 'INVALID_CREDENTIALS');

    // ─────────────────────────────────────────────────
    // Test 6: OTP request
    // ─────────────────────────────────────────────────
    console.log('\n6. POST /api/v1/auth/otp/request');
    const otpReq = await request('POST', '/api/v1/auth/otp/request', {
      email: testEmail,
    });
    assert('Returns 200', otpReq.status === 200);
    assert('Has expiresAt', !!otpReq.body.expiresAt);
    assert('Has devOtp in development', !!otpReq.body.devOtp);

    // ─────────────────────────────────────────────────
    // Test 7: OTP verify
    // ─────────────────────────────────────────────────
    if (otpReq.body.devOtp) {
      console.log('\n7. POST /api/v1/auth/otp/verify');
      const otpVerify = await request('POST', '/api/v1/auth/otp/verify', {
        email: testEmail,
        code: otpReq.body.devOtp,
      });
      assert('Returns 200', otpVerify.status === 200);
      assert('Returns accessToken', !!otpVerify.body.accessToken);
      assert('Returns user object', !!otpVerify.body.user);
    }

    // ─────────────────────────────────────────────────
    // Test 8: Protected route without token
    // ─────────────────────────────────────────────────
    console.log('\n8. GET /api/v1/auth/me (no auth)');
    const noAuth = await request('GET', '/api/v1/auth/me');
    assert('Returns 401 without token', noAuth.status === 401);
    assert('Returns AUTH_REQUIRED', noAuth.body.error?.code === 'AUTH_REQUIRED');

    // ─────────────────────────────────────────────────
    // Test 9: Protected route with token
    // ─────────────────────────────────────────────────
    if (authToken) {
      console.log('\n9. GET /api/v1/auth/me (with auth)');
      const me = await request('GET', '/api/v1/auth/me', null, {
        Authorization: `Bearer ${authToken}`,
      });
      assert('Returns 200 with token', me.status === 200);
      assert('Returns user object', !!me.body.user);
      assert('User email matches', me.body.user?.email === testEmail);
    }

    // ─────────────────────────────────────────────────
    // Test 10: KYC status (no document uploaded)
    // ─────────────────────────────────────────────────
    if (authToken) {
      console.log('\n10. GET /api/v1/kyc/status (no document)');
      const kycStatus = await request('GET', '/api/v1/kyc/status', null, {
        Authorization: `Bearer ${authToken}`,
      });
      assert('Returns 200', kycStatus.status === 200);
      assert('kycVerified is false', kycStatus.body.kycVerified === false);
      assert('document is null', kycStatus.body.document === null);
    }

    // ─────────────────────────────────────────────────
    // Test 11: Refresh token
    // ─────────────────────────────────────────────────
    if (login.body.refreshToken) {
      console.log('\n11. POST /api/v1/auth/refresh-token');
      const refresh = await request('POST', '/api/v1/auth/refresh-token', {
        refreshToken: login.body.refreshToken,
      });
      assert('Returns 200', refresh.status === 200);
      assert('Returns new accessToken', !!refresh.body.accessToken);
      assert('Returns new refreshToken', !!refresh.body.refreshToken);
    }

    // ─────────────────────────────────────────────────
    // Test 12: Validation error
    // ─────────────────────────────────────────────────
    console.log('\n12. POST /api/v1/auth/register (validation error)');
    const invalid = await request('POST', '/api/v1/auth/register', {
      email: 'not-an-email',
    });
    assert('Returns 400 for invalid data', invalid.status === 400);
    assert('Returns VALIDATION_ERROR', invalid.body.error?.code === 'VALIDATION_ERROR');

  } catch (error) {
    console.error(`\n✗ Connection failed: ${error.message}`);
    console.error('Make sure the IAM service is running on port 3003');
    process.exit(1);
  }

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
