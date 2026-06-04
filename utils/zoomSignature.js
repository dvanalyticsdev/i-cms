const KJUR = require('jsrsasign');

/**
 * Generate Zoom Meeting SDK JWT Token (v6.0.0+)
 * Following official Zoom documentation for JWT generation
 * https://developers.zoom.us/docs/meeting-sdk/auth/
 * 
 * UPDATED: Now supports dynamic meeting numbers from MongoDB
 * 
 * @param {string} meetingNumber - The Zoom meeting number (required)
 * @param {string} role - User role (0 = participant, 1 = host)
 * @returns {Object} - Object containing JWT token and other required data
 * @throws {Error} - If meeting number is missing or SDK credentials not configured
 */
const generateZoomSignature = (meetingNumber, role = 0) => {
  try {
    // Meeting number is now REQUIRED (no default from environment)
    if (!meetingNumber) {
      throw new Error('Meeting number is required');
    }

    const sdkKey = process.env.ZOOM_SDK_KEY;
    const sdkSecret = process.env.ZOOM_SDK_SECRET;

    if (!sdkKey || !sdkSecret) {
      throw new Error('ZOOM_SDK_KEY or ZOOM_SDK_SECRET not configured in .env');
    }

    // Token timestamps (in seconds, Unix epoch)
    const iat = Math.floor(Date.now() / 1000) - 30; // Issue time (subtract 30 seconds for clock skew)
    const exp = iat + (2 * 60 * 60); // Expiration: 2 hours from issue time (max recommended = 48 hours)
    const sanitizedMeetingNumber = meetingNumber.toString().replace(/\s/g, '');

    // JWT Payload - MUST include all required fields per Zoom spec
    const payload = {
      appKey: sdkKey,                // Required: Client ID (SDK Key)
      sdkKey: sdkKey,                // Included for compatibility with some SDK checks
      mn: sanitizedMeetingNumber,    // Required for web: Meeting number
      role: parseInt(role, 10),      // Required for web: 0 = participant, 1 = host
      iat: iat,                      // Required: Issue timestamp
      exp: exp,                      // Required: Expiration timestamp
      tokenExp: exp                  // Required: SDK token expiration (same as exp)
    };

    const token = KJUR.jws.JWS.sign('HS256', JSON.stringify({ alg: 'HS256', typ: 'JWT' }), JSON.stringify(payload), sdkSecret);



    return {
      signature: token,  // JWT token
      sdkKey,
      meetingNumber: sanitizedMeetingNumber,
      role
    };
  } catch (error) {
    console.error('Error generating Zoom JWT:', error.message);
    throw new Error('Failed to generate Zoom JWT token: ' + error.message);
  }
};

/**
 * Validate Zoom SDK credentials
 * @returns {boolean} - True if Zoom SDK credentials are properly configured
 */
const isZoomConfigured = () => {
  return !!(
    process.env.ZOOM_SDK_KEY &&
    process.env.ZOOM_SDK_SECRET
  );
};

/**
 * Get Zoom SDK configuration
 * @returns {Object} - Zoom SDK configuration object (NOT meeting-specific)
 */
const getZoomSDKConfig = () => {
  return {
    sdkKey: process.env.ZOOM_SDK_KEY,
    sdkSecret: process.env.ZOOM_SDK_SECRET
  };
};

module.exports = {
  generateZoomSignature,
  isZoomConfigured,
  getZoomSDKConfig
};
