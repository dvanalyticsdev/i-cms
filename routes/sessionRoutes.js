const express = require('express');
const router = express.Router();
const ClassSession = require('../models/ClassSession');
const ActiveSession = require('../models/ActiveSession');
const Student = require('../models/Student');
const GuestMentorId = require('../models/GuestMentorId');
const ClassAccessRule = require('../models/ClassAccessRule');
const { generateZoomSignature } = require('../utils/zoomSignature');
const {
  closeAttendanceForActiveSession,
  formatAttendanceDate,
  getActiveSessionTerminationContext,
  recordSessionJoin
} = require('../utils/attendanceTracker');
const { mapRulesByKey, isClassAccessible } = require('../utils/classAccess');
const { getAutomatedSessionState } = require('../utils/sessionAutomation');

function getSessionBatches(session) {
  if (Array.isArray(session?.batches) && session.batches.length > 0) {
    return session.batches.map(batch => String(batch || '').trim()).filter(Boolean);
  }

  const batch = String(session?.batch || '').trim();
  return batch ? [batch] : [];
}

function getStudentBatches(student) {
  if (Array.isArray(student?.batches) && student.batches.length > 0) {
    return Array.from(new Set(
      student.batches.map(batch => String(batch || '').trim()).filter(Boolean)
    ));
  }

  const batch = String(student?.batch || '').trim();
  return batch ? [batch] : [];
}

function hasStudentBatchAccess(student, session) {
  const studentBatches = getStudentBatches(student);
  const sessionBatches = getSessionBatches(session);

  if (studentBatches.length === 0 || sessionBatches.length === 0) {
    return true;
  }

  return studentBatches.some(batch => sessionBatches.includes(batch));
}

function resolveStudentBatchForSession(student, session) {
  const studentBatches = getStudentBatches(student);
  const sessionBatches = getSessionBatches(session);
  const matchedBatch = studentBatches.find(batch => sessionBatches.includes(batch));
  return matchedBatch || studentBatches[0] || '';
}

function withEffectiveSessionStatus(session, now = new Date()) {
  const automationState = getAutomatedSessionState(session, now);

  return {
    ...session,
    status: automationState.effectiveStatus,
    automation: {
      enabled: automationState.enabled,
      activeWindow: automationState.isActiveWindow,
      scheduledStartAt: automationState.startAt,
      scheduledEndAt: automationState.endAt,
      activationDurationMinutes: automationState.durationMinutes,
      inactiveReason: automationState.inactiveReason
    }
  };
}

/**
 * GET /api/class-sessions
 */
router.get('/class-sessions', async (req, res) => {
  try {
    let studentCourse = null;
    let studentBatch = null;
    let studentBatches = [];
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
        studentBatches = getStudentBatches(student);
        studentBatch = studentBatches[0] || null;
        const rules = await ClassAccessRule.find({}).lean();
        accessRuleMap = mapRulesByKey(rules);
      }
    }

    let query = {};
    
    if (studentCourse) {
      const allSessions = await ClassSession.find()
        .select('sessionId title meetingNumber status description posterImage createdAt updatedAt courses passcode batch batches mentorName className')
        .sort({ updatedAt: -1 })
        .lean();
      
      const now = new Date();
      const filteredSessions = allSessions.filter(session => {
        if (studentRecord && !hasStudentBatchAccess(studentRecord, session)) {
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
        sessions: filteredSessions.map(session => withEffectiveSessionStatus(session, now)),
        total: filteredSessions.length,
        studentCourse: studentCourse,
        studentBatch: studentBatch,
        studentBatches
      });
    } else {
      const sessions = await ClassSession.find()
        .select('sessionId title meetingNumber status description posterImage createdAt updatedAt courses passcode batch batches mentorName className')
        .sort({ updatedAt: -1 })
        .lean();

      const now = new Date();
      return res.status(200).json({
        success: true,
        message: 'Class sessions retrieved successfully',
        sessions: sessions.map(session => withEffectiveSessionStatus(session, now)),
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

    const effectiveSession = withEffectiveSessionStatus(session, new Date());

    if (effectiveSession.status === 'off') {
      const inactiveMessage = effectiveSession.automation?.inactiveReason === 'before_start'
        ? 'Session is scheduled but has not started yet'
        : effectiveSession.automation?.inactiveReason === 'ended'
          ? 'This scheduled session window has ended'
          : 'Session is currently inactive';

      return res.status(403).json({
        success: false,
        message: inactiveMessage,
        sessionInactive: true
      });
    }

    const joinTime = new Date();
    const joinTermination = await getActiveSessionTerminationContext({
      lmsId: req.body?.lmsId || 'anonymous',
      classSessionId: session.sessionId,
      joinedAt: joinTime
    }, joinTime);

    if (joinTermination.shouldTerminate) {
      return res.status(403).json({
        success: false,
        sessionEnded: true,
        sessionInactive: joinTermination.reason === 'session-inactive',
        attendanceWindowEnded: joinTermination.reason === 'window_end',
        message: joinTermination.reason === 'window_end'
          ? 'This class attendance window has ended.'
          : 'This session is no longer active.'
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
        if (student && !hasStudentBatchAccess(student, session)) {
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

        if (existingActiveSession?.classSessionId && existingActiveSession.classSessionId !== session.sessionId) {
          await closeAttendanceForActiveSession(existingActiveSession, new Date(), {
            reason: 'rejoin',
            finalizedBy: 'system-rejoin'
          });
        }

        const joinedAt = new Date();
        const attendanceDate = formatAttendanceDate(joinedAt);

        await ActiveSession.updateOne(
          { lmsId: lmsId, status: 'active' },
          {
            $set: {
              classSessionId: session.sessionId,
              meetingNumber: session.meetingNumber,
              joinedAt,
              lastSeenAt: joinedAt,
              attendanceLastSeenAt: joinedAt,
              endedAt: null
            }
          }
        );

        if (student) {
          await recordSessionJoin({
            lmsId,
            studentName: student.name || lmsId,
            mobile: student.mobile || '',
            course: Array.isArray(student.course) ? student.course[0] || '' : (student.course || ''),
            batch: resolveStudentBatchForSession(student, session),
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
        status: effectiveSession.status,
        mentorName: session.mentorName || '',
        className: session.className || '',
        automation: effectiveSession.automation
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

router.post('/attendance/start', async (req, res) => {
  try {
    const { sessionId, lmsId } = req.body || {};

    if (!sessionId || !lmsId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID and LMS ID are required'
      });
    }

    const [session, student, activeSession] = await Promise.all([
      ClassSession.findOne({ sessionId }).lean(),
      Student.findOne({ lmsId }).lean(),
      ActiveSession.findOne({ lmsId, status: 'active' })
    ]);

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    if (!hasStudentBatchAccess(student, session)) {
      return res.status(403).json({
        success: false,
        message: 'This session is assigned to a different batch'
      });
    }

    const joinedAt = new Date();
    const attendanceDate = formatAttendanceDate(joinedAt);

    const effectiveSession = withEffectiveSessionStatus(session, joinedAt);

    if (effectiveSession.status === 'off') {
      return res.status(403).json({
        success: false,
        message: effectiveSession.automation?.inactiveReason === 'before_start'
          ? 'Session attendance has not opened yet'
          : effectiveSession.automation?.inactiveReason === 'ended'
            ? 'Session attendance is closed because the scheduled window has ended'
            : 'Session is currently inactive'
      });
    }

    if (activeSession) {
      const termination = await getActiveSessionTerminationContext({
        _id: activeSession._id,
        lmsId: activeSession.lmsId,
        classSessionId: session.sessionId,
        joinedAt
      }, joinedAt);

      if (termination.shouldTerminate) {
        return res.status(403).json({
          success: false,
          sessionEnded: true,
          sessionInactive: termination.reason === 'session-inactive',
          attendanceWindowEnded: termination.reason === 'window_end',
          message: termination.reason === 'window_end'
            ? 'This class attendance window has ended.'
            : 'This class session is no longer active.'
        });
      }

      activeSession.classSessionId = session.sessionId;
      activeSession.meetingNumber = session.meetingNumber || activeSession.meetingNumber;
      activeSession.joinedAt = joinedAt;
      activeSession.lastSeenAt = joinedAt;
      activeSession.attendanceLastSeenAt = joinedAt;
      activeSession.endedAt = null;
      await activeSession.save();
    }

    const record = await recordSessionJoin({
      lmsId,
      studentName: student.name || lmsId,
      mobile: student.mobile || '',
      course: student.course || '',
      batch: resolveStudentBatchForSession(student, session),
      sessionId: session.sessionId,
      sessionName: session.title,
      mentorName: session.mentorName || '',
      className: session.className || '',
      attendanceDate,
      source: 'zoom-join-success',
      joinedAt
    });

    return res.status(200).json({
      success: true,
      message: 'Attendance started successfully',
      attendance: record
    });
  } catch (error) {
    console.error('Error starting attendance:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;
