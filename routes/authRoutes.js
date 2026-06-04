const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const ActiveSession = require('../models/ActiveSession');
const Student = require('../models/Student');
const GuestMentorId = require('../models/GuestMentorId');

const normalize = (str) => str.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * POST /api/verify-student
 * Verify student credentials (LMS ID or Guest/Mentor ID) and create session
 */
router.post('/verify-student', async (req, res) => {
  try {
    const { lmsId, name, deviceToken, forceLogin } = req.body;

    if (!lmsId || !name || !deviceToken) {
      return res.status(400).json({
        success: false,
        message: 'ID, Student Name, and Device Token are required'
      });
    }

    const sanitizedLmsId = lmsId.trim();
    const sanitizedName = name.trim();

    const isGuestMentorId = sanitizedLmsId.startsWith('GUEST_') || sanitizedLmsId.startsWith('MENTOR_') || sanitizedLmsId.startsWith('MOCK_INTERVIEW_');
    
    let isValid = false;
    let userInfo = null;
    let userType = 'student';

    if (isGuestMentorId) {
      userInfo = await GuestMentorId.findOne({ id: sanitizedLmsId, status: 'Active' }).lean();
      if (userInfo && normalize(userInfo.assignedName) === normalize(sanitizedName)) {
        isValid = true;
      }
      if (sanitizedLmsId.startsWith('GUEST_')) {
        userType = 'guest';
      } else if (sanitizedLmsId.startsWith('MENTOR_')) {
        userType = 'mentor';
      } else if (sanitizedLmsId.startsWith('MOCK_INTERVIEW_')) {
        userType = 'mock-interview';
      }
    } else {
      userInfo = await Student.findOne({ lmsId: sanitizedLmsId }).lean();
      if (userInfo && normalize(userInfo.name) === normalize(sanitizedName)) {
        isValid = true;
      }
    }

    if (!isValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid ID or Name'
      });
    }

    let existingSession = await ActiveSession.findOne({
      lmsId: sanitizedLmsId,
      status: 'active'
    });

    if (existingSession) {
      if (existingSession.deviceToken !== deviceToken && !forceLogin) {
        return res.status(409).json({
          success: false,
          message: 'Already Logged In On Another Device',
          alreadyLoggedIn: true
        });
      }
      
      existingSession.status = 'ended';
      await existingSession.save();
    }

    const sessionToken = `TOKEN_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    
    const newActiveSession = new ActiveSession({
      sessionToken,
      lmsId: sanitizedLmsId,
      name: sanitizedName,
      deviceToken,
      status: 'active'
    });
    
    await newActiveSession.save();

    return res.status(200).json({
      success: true,
      message: 'User verified successfully',
      sessionToken: sessionToken,
      studentName: sanitizedName,
      lmsId: sanitizedLmsId,
      userType: userType,
      course: isGuestMentorId && userInfo ? userInfo.course : undefined,
      zoom: null
    });

  } catch (error) {
    console.error('Error in verify-student:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Server error occurred',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * POST /api/force-logout
 */
router.post('/force-logout', async (req, res) => {
  try {
    const { lmsId, name, deviceToken } = req.body;

    if (!lmsId || !name || !deviceToken) {
      return res.status(400).json({
        success: false,
        message: 'LMS ID, Student Name, and Device Token are required'
      });
    }

    const sanitizedLmsId = lmsId.trim();
    const sanitizedName = name.trim();

    const isGuestMentorId = sanitizedLmsId.startsWith('GUEST_') || sanitizedLmsId.startsWith('MENTOR_') || sanitizedLmsId.startsWith('MOCK_INTERVIEW_');
    let isValid = false;

    if (isGuestMentorId) {
      const userInfo = await GuestMentorId.findOne({ id: sanitizedLmsId, status: 'Active' }).lean();
      if (userInfo && normalize(userInfo.assignedName) === normalize(sanitizedName)) {
        isValid = true;
      }
    } else {
      const userInfo = await Student.findOne({ lmsId: sanitizedLmsId }).lean();
      if (userInfo && normalize(userInfo.name) === normalize(sanitizedName)) {
        isValid = true;
      }
    }

    if (!isValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid LMS ID or Student Name'
      });
    }

    await ActiveSession.updateOne(
      { lmsId: sanitizedLmsId, status: 'active' },
      { $set: { status: 'ended' } }
    );

    return res.status(200).json({
      success: true,
      message: 'Active session cleared'
    });
  } catch (error) {
    console.error('Error in force-logout:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Server error occurred',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * POST /api/logout
 */
router.post('/logout', async (req, res) => {
  try {
    const { lmsId } = req.body;

    if (!lmsId) {
      return res.status(400).json({
        success: false,
        message: 'LMS ID is required'
      });
    }

    const result = await ActiveSession.updateOne(
      { lmsId: lmsId.trim(), status: 'active' },
      { $set: { status: 'ended' } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'No active session found'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    console.error('Error in logout:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Server error occurred',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * GET /api/session/:lmsId
 */
router.get('/session/:lmsId', async (req, res) => {
  try {
    const { lmsId } = req.params;
    const { deviceToken } = req.query;

    if (!lmsId) return res.status(400).json({ success: false, message: 'LMS ID is required' });
    if (!deviceToken) return res.status(400).json({ success: false, message: 'Device token is required' });

    const sessionData = await ActiveSession.findOne({
      lmsId: lmsId.trim(),
      status: 'active'
    }).lean();

    if (!sessionData) {
      return res.status(404).json({
        success: false,
        message: 'No active session found'
      });
    }

    if (sessionData.deviceToken && sessionData.deviceToken !== deviceToken) {
      return res.status(403).json({
        success: false,
        message: 'Session belongs to a different device'
      });
    }

    return res.status(200).json({
      success: true,
      session: sessionData
    });

  } catch (error) {
    console.error('Error retrieving session:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Server error occurred'
    });
  }
});

module.exports = router;
