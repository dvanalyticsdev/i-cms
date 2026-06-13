const crypto = require('crypto');
const jwt = require('jsonwebtoken');

/**
 * JWT Utilities for Admin Authentication
 */

/**
 * Generate JWT token for admin
 * @param {Object} payload - Token payload (username, etc.)
 * @param {number} expiresIn - Token expiration time in seconds (default: 24 hours)
 * @returns {string} - JWT token
 */
const generateToken = (payload, expiresIn = 86400) => {
  const jwtSecret = process.env.JWT_SECRET;
  
  if (!jwtSecret) {
    throw new Error('JWT_SECRET not configured');
  }

  return jwt.sign(payload, jwtSecret, {
    expiresIn,
    algorithm: 'HS256'
  });
};

/**
 * Build a stable fingerprint for the current admin credentials.
 * Any password or username change should invalidate existing JWTs.
 * @returns {string}
 */
const getAdminCredentialVersion = () => {
  const adminUsername = process.env.ADMIN_USERNAME;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminUsername || !adminPassword) {
    throw new Error('Admin credentials not configured in environment');
  }

  return crypto
    .createHash('sha256')
    .update(`${adminUsername}:${adminPassword}`)
    .digest('hex');
};

/**
 * Verify JWT token
 * @param {string} token - JWT token to verify
 * @returns {Object} - Decoded token payload
 * @throws {Error} - If token is invalid or expired
 */
const verifyToken = (token) => {
  const jwtSecret = process.env.JWT_SECRET;
  
  if (!jwtSecret) {
    throw new Error('JWT_SECRET not configured');
  }

  return jwt.verify(token, jwtSecret);
};

/**
 * Verify admin credentials
 * @param {string} username - Admin username
 * @param {string} password - Admin password
 * @returns {boolean} - True if credentials match environment variables
 */
const verifyAdminCredentials = (username, password) => {
  const adminUsername = process.env.ADMIN_USERNAME;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminUsername || !adminPassword) {
    throw new Error('Admin credentials not configured in environment');
  }

  return username === adminUsername && password === adminPassword;
};

module.exports = {
  generateToken,
  verifyToken,
  verifyAdminCredentials,
  getAdminCredentialVersion
};
