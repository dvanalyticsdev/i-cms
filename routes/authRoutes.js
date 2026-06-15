const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const ActiveSession = require('../models/ActiveSession');
const Student = require('../models/Student');
const GuestMentorId = require('../models/GuestMentorId');
const AttendanceRecord = require('../models/AttendanceRecord');
const { sanitizeLmsId } = require('../utils/studentValidation');
const { finalizeAttendanceForActiveSession } = require('../utils/attendanceTracker');
const { findStudentInWorkbook } = require('../utils/workbookSync');

function normalize(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function resolvePaymentStatus(studentRecord, lmsId) {
  const mongoStatus = String(studentRecord?.paymentStatus || '').trim().toUpperCase();
  if (mongoStatus) {
    return mongoStatus;
  }

  const workbookStudent = findStudentInWorkbook(lmsId);
  return String(workbookStudent?.paymentStatus || '').trim().toUpperCase();
}

/**
 * POST /api/verify-student
 * Verify student credentials (LMS ID or Guest/Mentor ID) and create session
 */
router.post('/verify-student', async (req, res) => {
  try {
    const { lmsId, name, deviceToken, forceLogin } = req.body;

    if (!lmsId || !deviceToken) {
      return res.status(400).json({
        success: false,
        message: 'LMS ID and Device Token are required'
      });
    }

    const sanitizedLmsId = sanitizeLmsId(lmsId);

    const isGuestMentorId = sanitizedLmsId.startsWith('GUEST_') || sanitizedLmsId.startsWith('MENTOR_') || sanitizedLmsId.startsWith('MOCK_INTERVIEW_');
    
    let isValid = false;
    let userInfo = null;
    let userType = 'student';

    if (isGuestMentorId) {
      if (!name) {
        return res.status(400).json({
          success: false,
          message: 'Student Name is required for guest and mentor IDs'
        });
      }

      const sanitizedName = name.trim();
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
      if (userInfo) {
        isValid = true;
      }
    }

    if (!isValid) {
      return res.status(401).json({
        success: false,
        message: 'We were unable to verify your details. Please contact the Program Department for assistance at 9611276828 or 8904250708.'
      });
    }

    if (!isGuestMentorId && resolvePaymentStatus(userInfo, sanitizedLmsId) === 'DEFAULT') {
      return res.status(403).json({
        success: false,
        feePending: true,
        message: 'Our records show that there is an outstanding fee balance on your account. Please contact the Finance Department at 8431424165, or use Report an Issue for support.'
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
      
      const endedAt = existingSession.lastSeenAt || existingSession.joinedAt || new Date();
      await finalizeAttendanceForActiveSession(existingSession, endedAt);
      existingSession.status = 'ended';
      existingSession.endedAt = endedAt;
      await existingSession.save();
    }

    const sessionToken = `TOKEN_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    
    const newActiveSession = new ActiveSession({
      sessionToken,
      lmsId: sanitizedLmsId,
      name: name ? name.trim() : (userInfo?.name || sanitizedLmsId),
      phoneNumber: userInfo?.mobile || null,
      deviceToken,
      status: 'active'
    });
    
    await newActiveSession.save();

    return res.status(200).json({
      success: true,
      message: 'User verified successfully',
      sessionToken: sessionToken,
      studentName: name?.trim() || userInfo?.name || sanitizedLmsId,
      lmsId: sanitizedLmsId,
      userType: userType,
      mobile: userInfo?.mobile || undefined,
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

    if (!lmsId || !deviceToken) {
      return res.status(400).json({
        success: false,
        message: 'LMS ID and Device Token are required'
      });
    }

    const sanitizedLmsId = sanitizeLmsId(lmsId);

    const isGuestMentorId = sanitizedLmsId.startsWith('GUEST_') || sanitizedLmsId.startsWith('MENTOR_') || sanitizedLmsId.startsWith('MOCK_INTERVIEW_');
    let isValid = false;

    if (isGuestMentorId) {
      if (!name) {
        return res.status(400).json({
          success: false,
          message: 'Student Name is required for guest and mentor IDs'
        });
      }

      const sanitizedName = name.trim();
      const userInfo = await GuestMentorId.findOne({ id: sanitizedLmsId, status: 'Active' }).lean();
      if (userInfo && normalize(userInfo.assignedName) === normalize(sanitizedName)) {
        isValid = true;
      }
    } else {
      const userInfo = await Student.findOne({ lmsId: sanitizedLmsId }).lean();
      if (userInfo) {
        isValid = true;
      }
    }

    if (!isValid) {
      return res.status(401).json({
        success: false,
        message: 'We were unable to verify your details. Please contact the Program Department for assistance at 9611276828 or 8904250708.'
      });
    }

    const activeSession = await ActiveSession.findOne({ lmsId: sanitizedLmsId, status: 'active' });
    if (activeSession) {
      const endedAt = activeSession.lastSeenAt || activeSession.joinedAt || new Date();
      await finalizeAttendanceForActiveSession(activeSession, endedAt);
      activeSession.status = 'ended';
      activeSession.endedAt = endedAt;
      await activeSession.save();
    }

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

    const activeSession = await ActiveSession.findOne({ lmsId: lmsId.trim(), status: 'active' });

    if (!activeSession) {
      return res.status(404).json({
        success: false,
        message: 'No active session found'
      });
    }

    const endedAt = activeSession.lastSeenAt || activeSession.joinedAt || new Date();
    await finalizeAttendanceForActiveSession(activeSession, endedAt);
    activeSession.status = 'ended';
    activeSession.endedAt = endedAt;
    await activeSession.save();

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

    const now = new Date();
    const sessionData = await ActiveSession.findOneAndUpdate(
      { lmsId: lmsId.trim(), status: 'active' },
      { $set: { lastSeenAt: now } },
      { new: true }
    ).lean();

    if (!sessionData) {
      return res.status(404).json({
        success: false,
        message: 'No active session found'
      });
    }

    const studentRecord = await Student.findOne({ lmsId: lmsId.trim() }).lean();
    if (studentRecord && resolvePaymentStatus(studentRecord, lmsId.trim()) === 'DEFAULT') {
      if (sessionData.classSessionId) {
        try {
          await finalizeAttendanceForActiveSession(sessionData, now);
        } catch (err) {
          console.warn('Failed to finalize attendance during fee-pending enforcement:', err.message);
        }
      }

      await ActiveSession.updateOne(
        { _id: sessionData._id },
        { $set: { status: 'ended', endedAt: now, lastSeenAt: now } }
      );

      return res.status(403).json({
        success: false,
        feePending: true,
        message: 'Our records show that there is an outstanding fee balance on your account. Please contact the Finance Department at 8431424165, or use Report an Issue for support.'
      });
    }

    if (sessionData.deviceToken && sessionData.deviceToken !== deviceToken) {
      return res.status(403).json({
        success: false,
        message: 'Session belongs to a different device'
      });
    }

    if (sessionData.classSessionId) {
      try {
        await AttendanceRecord.updateOne(
          {
            lmsId: sessionData.lmsId,
            sessionId: sessionData.classSessionId,
            currentJoinStartedAt: { $ne: null }
          },
          { $set: { lastSeenAt: now } }
        );
      } catch (err) {
        console.warn('Failed to update AttendanceRecord lastSeenAt on heartbeat:', err.message);
      }
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
