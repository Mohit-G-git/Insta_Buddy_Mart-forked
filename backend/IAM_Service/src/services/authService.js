// authService.js
// Handles user registration, login, OTP generation/verification, and JWT token management

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../config/db');

const SALT_ROUNDS = 12;
const OTP_EXPIRY_MINUTES = 5;
const JWT_EXPIRY = process.env.JWT_EXPIRY || '24h';
const REFRESH_TOKEN_EXPIRY = process.env.REFRESH_TOKEN_EXPIRY || '7d';

// ============================================================================
// User Registration
// ============================================================================

/**
 * Register a new user
 * @param {Object} data - { fullName, email, phone, password, role }
 * @returns {Object} - Created user (without password hash)
 */
async function registerUser({ fullName, email, phone, password, role }) {
  // Check if email or phone already exists
  const existingUser = await db.query(
    'SELECT id FROM users_iam WHERE email = $1 OR phone = $2',
    [email, phone]
  );

  if (existingUser.rows.length > 0) {
    const error = new Error('A user with this email or phone already exists');
    error.statusCode = 409;
    error.code = 'CONFLICT';
    throw error;
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  // Insert user
  const result = await db.query(
    `INSERT INTO users_iam (full_name, email, phone, password_hash, role)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, full_name, email, phone, role, kyc_verified, is_active, created_at`,
    [fullName, email, phone, passwordHash, role || 'requester']
  );

  return result.rows[0];
}

// ============================================================================
// Login
// ============================================================================

/**
 * Authenticate user with email and password
 * @param {string} email
 * @param {string} password
 * @returns {Object} - { user, accessToken, refreshToken }
 */
async function loginUser(email, password) {
  // Fetch user by email
  const result = await db.query(
    `SELECT id, full_name, email, phone, password_hash, role, kyc_verified, is_active
     FROM users_iam WHERE email = $1`,
    [email]
  );

  if (result.rows.length === 0) {
    const error = new Error('Invalid email or password');
    error.statusCode = 401;
    error.code = 'INVALID_CREDENTIALS';
    throw error;
  }

  const user = result.rows[0];

  // Check if account is active
  if (!user.is_active) {
    const error = new Error('Account has been deactivated');
    error.statusCode = 403;
    error.code = 'ACCOUNT_DEACTIVATED';
    throw error;
  }

  // Verify password
  const isValidPassword = await bcrypt.compare(password, user.password_hash);
  if (!isValidPassword) {
    const error = new Error('Invalid email or password');
    error.statusCode = 401;
    error.code = 'INVALID_CREDENTIALS';
    throw error;
  }

  // Generate tokens
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  // Remove password_hash from response
  delete user.password_hash;

  return { user, accessToken, refreshToken };
}

// ============================================================================
// OTP Management
// ============================================================================

/**
 * Generate and store a 6-digit OTP for the given email
 * In production, this would send via Twilio/AWS SNS
 * @param {string} email
 * @returns {Object} - { otpId, expiresAt, message }
 */
async function requestOtp(email) {
  // Find user by email
  const userResult = await db.query(
    'SELECT id, phone FROM users_iam WHERE email = $1',
    [email]
  );

  if (userResult.rows.length === 0) {
    const error = new Error('No account found with this email');
    error.statusCode = 404;
    error.code = 'USER_NOT_FOUND';
    throw error;
  }

  const user = userResult.rows[0];

  // Invalidate any existing unused OTPs for this user
  await db.query(
    'UPDATE otp_codes SET verified = true WHERE user_id = $1 AND verified = false',
    [user.id]
  );

  // Generate 6-digit OTP
  const code = crypto.randomInt(100000, 999999).toString();
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  // Store OTP in database
  const otpResult = await db.query(
    `INSERT INTO otp_codes (user_id, code, expires_at)
     VALUES ($1, $2, $3)
     RETURNING id, expires_at`,
    [user.id, code, expiresAt]
  );

  // In production: send OTP via SMS/email using Twilio/AWS SNS
  // For development, log the OTP to console
  console.log(`[DEV] OTP for ${email}: ${code} (expires at ${expiresAt.toISOString()})`);

  return {
    otpId: otpResult.rows[0].id,
    expiresAt: otpResult.rows[0].expires_at,
    message: 'OTP sent successfully. Valid for 5 minutes.',
    // DEV ONLY — remove in production
    ...(process.env.NODE_ENV === 'development' && { devOtp: code }),
  };
}

/**
 * Verify OTP and return JWT tokens
 * @param {string} email
 * @param {string} code
 * @returns {Object} - { user, accessToken, refreshToken }
 */
async function verifyOtp(email, code) {
  // Find user
  const userResult = await db.query(
    `SELECT id, full_name, email, phone, role, kyc_verified, is_active
     FROM users_iam WHERE email = $1`,
    [email]
  );

  if (userResult.rows.length === 0) {
    const error = new Error('No account found with this email');
    error.statusCode = 404;
    error.code = 'USER_NOT_FOUND';
    throw error;
  }

  const user = userResult.rows[0];

  // Find the most recent valid (unexpired, unverified) OTP for this user
  const otpResult = await db.query(
    `SELECT id, code, expires_at FROM otp_codes
     WHERE user_id = $1 AND verified = false AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [user.id]
  );

  if (otpResult.rows.length === 0) {
    const error = new Error('OTP has expired or is invalid. Please request a new one.');
    error.statusCode = 401;
    error.code = 'OTP_EXPIRED';
    throw error;
  }

  const otpRecord = otpResult.rows[0];

  // Check if OTP matches
  if (otpRecord.code !== code) {
    const error = new Error('Invalid OTP code');
    error.statusCode = 401;
    error.code = 'INVALID_OTP';
    throw error;
  }

  // Mark OTP as verified
  await db.query(
    'UPDATE otp_codes SET verified = true WHERE id = $1',
    [otpRecord.id]
  );

  // Generate tokens
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  return { user, accessToken, refreshToken };
}

// ============================================================================
// Token Management
// ============================================================================

/**
 * Generate JWT access token
 * Payload includes userId, email, role, and kycVerified for downstream services
 */
function generateAccessToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
      kycVerified: user.kyc_verified,
    },
    process.env.JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
}

/**
 * Generate JWT refresh token (longer-lived, used to get a new access token)
 */
function generateRefreshToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      type: 'refresh',
    },
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    { expiresIn: REFRESH_TOKEN_EXPIRY }
  );
}

/**
 * Refresh an access token using a valid refresh token
 * @param {string} refreshToken
 * @returns {Object} - { accessToken, refreshToken }
 */
async function refreshAccessToken(refreshToken) {
  let decoded;
  try {
    decoded = jwt.verify(
      refreshToken,
      process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET
    );
  } catch (err) {
    const error = new Error('Invalid or expired refresh token');
    error.statusCode = 401;
    error.code = 'INVALID_REFRESH_TOKEN';
    throw error;
  }

  if (!decoded || decoded.type !== 'refresh') {
    const error = new Error('Invalid token type');
    error.statusCode = 401;
    error.code = 'INVALID_REFRESH_TOKEN';
    throw error;
  }

  // Fetch latest user data (role/KYC might have changed)
  const result = await db.query(
    `SELECT id, email, role, kyc_verified, is_active
     FROM users_iam WHERE id = $1`,
    [decoded.userId]
  );

  if (result.rows.length === 0 || !result.rows[0].is_active) {
    const error = new Error('User not found or account deactivated');
    error.statusCode = 401;
    error.code = 'INVALID_REFRESH_TOKEN';
    throw error;
  }

  const user = result.rows[0];

  // Issue fresh tokens
  const newAccessToken = generateAccessToken(user);
  const newRefreshToken = generateRefreshToken(user);

  return { accessToken: newAccessToken, refreshToken: newRefreshToken };
}

/**
 * Get user profile by ID
 * @param {string} userId
 * @returns {Object} user profile
 */
async function getUserProfile(userId) {
  const result = await db.query(
    `SELECT id, full_name, email, phone, role, kyc_verified, is_active, created_at, updated_at
     FROM users_iam WHERE id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    const error = new Error('User not found');
    error.statusCode = 404;
    error.code = 'USER_NOT_FOUND';
    throw error;
  }

  return result.rows[0];
}

module.exports = {
  registerUser,
  loginUser,
  requestOtp,
  verifyOtp,
  refreshAccessToken,
  getUserProfile,
};
