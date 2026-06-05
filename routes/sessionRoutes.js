const express = require('express');
const router = express.Router();
const ClassSession = require('../models/ClassSession');
const ActiveSession = require('../models/ActiveSession');
const Student = require('../models/Student');
const GuestMentorId = require('../models/GuestMentorId');
const AttendanceRecord = require('../models/AttendanceRecord');
const { generateZoomSignature } = require('../utils/zoomSignature');
const { logSessionActivity } = require('../utils/sessionLogger');

/**
 * GET /api/class-sessions
 */
router.get('/class-sessions', async (req, res) => {
  try {
    let studentCourse = null;
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
        studentCourse = student.course;
      }
    }

    let query = {};
    
    if (studentCourse) {
      const allSessions = await ClassSession.find()
        .select('sessionId title meetingNumber status description createdAt updatedAt courses passcode')
        .sort({ updatedAt: -1 })
        .lean();
      
      const filteredSessions = allSessions.filter(session => {
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
        studentCourse: studentCourse
      });
    } else {
      const sessions = await ClassSession.find()
        .select('sessionId title meetingNumber status description createdAt updatedAt courses passcode')
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
        await ActiveSession.updateOne(
          { lmsId: lmsId, status: 'active' },
          { $set: { classSessionId: session.sessionId, meetingNumber: session.meetingNumber, joinedAt: new Date() } }
        );

        if (student) {
          const attendanceDate = new Date().toLocaleDateString('en-CA');
          await AttendanceRecord.updateOne(
            { lmsId, sessionId: session.sessionId },
            {
              $set: {
                lmsId,
                studentName: student.name || lmsId,
                phoneNumber: student.phoneNumber || '',
                course: Array.isArray(student.course) ? student.course[0] || '' : (student.course || ''),
                batch: student.batch || '',
                sessionId: session.sessionId,
                sessionName: session.title,
                trainerName: session.createdBy || '',
                attendanceDate,
                attendedAt: new Date(),
                status: 'present',
                source: 'session-join'
              }
            },
            { upsert: true }
          );
        }

        await logSessionActivity({
          sessionId: session.sessionId,
          sessionName: session.title,
          userName: lmsId,
          actionPerformed: 'Joined Session',
          status: 'Success',
          remarks: `Joined meeting ${session.meetingNumber}`
        });
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
        status: session.status
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
