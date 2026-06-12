const express = require('express');
const router = express.Router();
const ClassSession = require('../models/ClassSession');
const ActiveSession = require('../models/ActiveSession');
const Student = require('../models/Student');
const GuestMentorId = require('../models/GuestMentorId');
const ClassAccessRule = require('../models/ClassAccessRule');
const { generateZoomSignature } = require('../utils/zoomSignature');
const { finalizeAttendanceForActiveSession, recordSessionJoin } = require('../utils/attendanceTracker');
const { mapRulesByKey, isClassAccessible } = require('../utils/classAccess');

/**
 * GET /api/class-sessions
 */
router.get('/class-sessions', async (req, res) => {
  try {
    let studentCourse = null;
    let studentBatch = null;
    let studentRecord = null;
    let accessRuleMap = null;
    const { lmsId } = req.query;
    
    if (lmsId) {
      let student = await Student.findOne({ lmsId }).lean();
      
      if (!student && (lmsId.startsWith('GUEST_') || lmsId.startsWith('MENTOR_') || lmsId.startsWith('MOCK_INTERVIEW_'))) {
        const user = await GuestMentorId.findOne({ id: lmsId }).lean();
        
        if (user && user.status === 'Active' && user.course) {
          studentCourse = user.course;
        } else if (user && user.status !== 'Active') {
          return res.status(403).json({
            success: false,
            message: 'This ID has been revoked. Please contact support.',
            idRevoked: true
          });
        }
      } else if (student && student.course) {
        studentRecord = student;
        studentCourse = student.course;
        studentBatch = student.batch || null;
        const rules = await ClassAccessRule.find({}).lean();
        accessRuleMap = mapRulesByKey(rules);
      }
    }

    let query = {};
    
    if (studentCourse) {
      const allSessions = await ClassSession.find()
        .select('sessionId title meetingNumber status description createdAt updatedAt courses passcode batch mentorName className')
        .sort({ updatedAt: -1 })
        .lean();
      
      const filteredSessions = allSessions.filter(session => {
        if (studentBatch && session.batch && session.batch !== studentBatch) {
          return false;
        }
        if (studentRecord && session.className) {
          return isClassAccessible({
            student: studentRecord,
            className: session.className,
            ruleMap: accessRuleMap
          });
        }
        if (!session.courses || session.courses.length === 0) {
          return true;
        }
        const studentCourses = Array.isArray(studentCourse) ? studentCourse : [studentCourse];
        return studentCourses.some(course => session.courses.includes(course));
      });

      return res.status(200).json({
        success: true,
        message: 'Class sessions retrieved successfully',
        sessions: filteredSessions,
        total: filteredSessions.length,
        studentCourse: studentCourse,
        studentBatch: studentBatch
      });
    } else {
      const sessions = await ClassSession.find()
        .select('sessionId title meetingNumber status description createdAt updatedAt courses passcode batch mentorName className')
        .sort({ updatedAt: -1 })
        .lean();

      return res.status(200).json({
        success: true,
        message: 'Class sessions retrieved successfully',
        sessions,
        total: sessions.length
      });
    }

  } catch (error) {
    console.error('Error retrieving class sessions:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

/**
 * POST /api/join-session
 */
router.post('/join-session', async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID is required'
      });
    }

    const session = await ClassSession.findOne({ sessionId }).lean();

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

    if (session.status === 'off') {
      return res.status(403).json({
        success: false,
        message: 'Session is currently inactive',
        sessionInactive: true
      });
    }

    let zoomSignature = null;
    try {
      zoomSignature = generateZoomSignature(session.meetingNumber, 0);
      zoomSignature.passcode = session.passcode;
    } catch (zoomError) {
      console.error('Zoom signature generation error:', zoomError.message);
      return res.status(500).json({
        success: false,
        message: 'Failed to generate Zoom credentials'
      });
    }

    const { lmsId } = req.body || {};

    try {
      if (lmsId) {
        const student = await Student.findOne({ lmsId }).lean();
        if (student && session.batch && student.batch && session.batch !== student.batch) {
          return res.status(403).json({
            success: false,
            message: 'This session is assigned to a different batch'
          });
        }
        if (student && session.className) {
          const rules = await ClassAccessRule.find({}).lean();
          const ruleMap = mapRulesByKey(rules);
          const isAllowed = isClassAccessible({
            student,
            className: session.className,
            ruleMap
          });

          if (!isAllowed) {
            return res.status(403).json({
              success: false,
              message: `Your current access settings do not allow entry to ${session.className}. Please contact your support team if you believe this is incorrect.`
            });
          }
        }
        const existingActiveSession = await ActiveSession.findOne({ lmsId, status: 'active' });

        if (existingActiveSession) {
          const endedAt = existingActiveSession.lastSeenAt || existingActiveSession.joinedAt || new Date();
          await finalizeAttendanceForActiveSession(existingActiveSession, endedAt);
        }

        await ActiveSession.updateOne(
          { lmsId: lmsId, status: 'active' },
          { $set: { classSessionId: session.sessionId, meetingNumber: session.meetingNumber, joinedAt: new Date(), endedAt: null } }
        );

        if (student) {
          const joinedAt = new Date();
          const attendanceDate = joinedAt.toLocaleDateString('en-CA');
          await recordSessionJoin({
            lmsId,
            studentName: student.name || lmsId,
            mobile: student.mobile || '',
            course: student.course || '',
            batch: student.batch || '',
            sessionId: session.sessionId,
            sessionName: session.title,
            mentorName: session.mentorName || '',
            className: session.className || '',
            attendanceDate,
            source: 'session-join',
            joinedAt
          });
        }

      }
    } catch (err) {
      console.warn('Error while recording class join:', err.message);
    }

    return res.status(200).json({
      success: true,
      message: 'Zoom credentials generated successfully',
      session: {
        sessionId: session.sessionId,
        title: session.title,
        meetingNumber: session.meetingNumber,
        status: session.status,
        mentorName: session.mentorName || '',
        className: session.className || ''
      },
      zoom: zoomSignature
    });

  } catch (error) {
    console.error('Error in join-session:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;
