const jwt = require('jsonwebtoken');
const { getAdminCredentialVersion } = require('../utils/jwtUtils');

/**
 * JWT Authentication Middleware
 * Validates JWT tokens in Authorization header
 * Used for admin routes
 */
const authMiddleware = (req, res, next) => {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers['authorization'];
    
    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: 'Authorization token required'
      });
    }

    // Bearer token format: "Bearer <token>"
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : authHeader;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token format'
      });
    }

    // Verify token
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      console.error('JWT_SECRET not configured');
      return res.status(500).json({
        success: false,
        message: 'Server configuration error'
      });
    }

    const decoded = jwt.verify(token, jwtSecret);

    if (decoded?.role === 'admin') {
      const currentCredentialVersion = getAdminCredentialVersion();
      if (!decoded.credentialVersion || decoded.credentialVersion !== currentCredentialVersion) {
        return res.status(401).json({
          success: false,
          message: 'Session expired. Please log in again.'
        });
      }
    }

    req.admin = decoded; // Attach admin info to request
    next();

  } catch (error) {
    console.error('JWT verification error:', error.message);
    
    if (error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({
        success: false,
        message: 'Token expired'
      });
    }

    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Authentication error'
    });
  }
};

module.exports = authMiddleware;
