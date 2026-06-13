const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { generateToken, verifyAdminCredentials, getAdminCredentialVersion } = require('../utils/jwtUtils');
const ClassSession = require('../models/ClassSession');
const Course = require('../models/Course');
const ClassAccessRule = require('../models/ClassAccessRule');
const ActiveSession = require('../models/ActiveSession');
const Student = require('../models/Student');
const GuestMentorId = require('../models/GuestMentorId');
const IssueReport = require('../models/IssueReport');
const SessionLog = require('../models/SessionLog');
const { logSessionActivity, getTimestampParts } = require('../utils/sessionLogger');
const { sanitizeLmsId } = require('../utils/studentValidation');
const { finalizeAttendanceForActiveSession } = require('../utils/attendanceTracker');
const { normalizePaymentStatus } = require('../utils/classAccess');
const CLASS_ACCESS_PAYMENT_STATUSES = ['DEFAULT', 'FULLY PAID', 'PENDING'];
const SESSION_LOG_ALLOWED_ACTIONS = ['Created Session', 'Updated Session', 'Session Status Updated', 'Deleted Session'];
const { syncWorkbookData } = require('../utils/workbookSync');
const XLSX = require('xlsx');
const crypto = require('crypto');

function normalizeText(value) {
  return String(value || '').trim();
}

function ensureAdminRole(req, res) {
  if (!req.admin || req.admin.role !== 'admin') {
    res.status(403).json({ success: false, message: 'Admin access required' });
    return false;
  }

  return true;
}

function parseCourseNames(courses) {
  if (!Array.isArray(courses)) {
    return [];
  }

  return courses
    .map(course => normalizeText(course))
    .filter(Boolean);
}

function parseBatchNames(batches) {
  const values = Array.isArray(batches) ? batches : [batches];

  return Array.from(
    new Set(
      values
        .map(batch => normalizeText(batch))
        .filter(Boolean)
    )
  );
}

function escapeCsvValue(value) {
  const text = value === undefined || value === null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function flattenDocument(document) {
  const flattened = {};

  Object.entries(document || {}).forEach(([key, value]) => {
    if (value instanceof Date) {
      flattened[key] = value.toISOString();
      return;
    }

    if (Array.isArray(value)) {
      flattened[key] = value.map(item => (item && typeof item === 'object' ? JSON.stringify(item) : item)).join('; ');
      return;
    }

    if (value && typeof value === 'object') {
      flattened[key] = JSON.stringify(value);
      return;
    }

    flattened[key] = value;
  });

  return flattened;
}

async function getAllowedCourseNames() {
  const [courses, students, sessions] = await Promise.all([
    Course.find({ status: 'active' }).select('courseName').lean(),
    Student.find({}).select('course').lean(),
    ClassSession.find({}).select('courses').lean()
  ]);

  const allowedNames = new Set();

  courses.forEach(course => {
    if (course.courseName) {
      allowedNames.add(course.courseName);
    }
  });

  students.forEach(student => {
    const studentCourses = Array.isArray(student.course) ? student.course : (student.course ? [student.course] : []);
    studentCourses.forEach(courseName => {
      if (courseName) {
        allowedNames.add(courseName);
      }
    });
  });

  sessions.forEach(session => {
    const sessionCourses = Array.isArray(session.courses) ? session.courses : [];
    sessionCourses.forEach(courseName => {
      if (courseName) {
        allowedNames.add(courseName);
      }
    });
  });

  return allowedNames;
}

async function validateSelectedCourses(courses) {
  if (!courses || courses.length === 0) {
    const error = new Error('At least one course must be selected');
    error.status = 400;
    throw error;
  }

  const allowedCourseNames = await getAllowedCourseNames();
  const invalidCourses = courses.filter(course => !allowedCourseNames.has(course));

  if (invalidCourses.length > 0) {
    const error = new Error(`Invalid or inactive courses: ${invalidCourses.join(', ')}`);
    error.status = 400;
    throw error;
  }

  return courses;
}

async function getClassCatalog() {
  const rules = await ClassAccessRule.find({}).lean();
  const classNames = new Set();

  rules.forEach((rule) => {
    const accessMap = rule.accessMap instanceof Map ? Object.fromEntries(rule.accessMap.entries()) : (rule.accessMap || {});
    Object.keys(accessMap).forEach((className) => {
      if (className) {
        classNames.add(className);
      }
    });
  });

  return Array.from(classNames).sort();
}

async function ensureClassAccessRulesForCourses(courseNames = []) {
  const normalizedCourseNames = Array.from(
    new Set(
      courseNames
        .map((courseName) => normalizeText(courseName))
        .filter(Boolean)
    )
  );

  if (normalizedCourseNames.length === 0) {
    return;
  }

  await ClassAccessRule.bulkWrite(
    normalizedCourseNames.flatMap((courseName) =>
      CLASS_ACCESS_PAYMENT_STATUSES.map((paymentStatus) => ({
        updateOne: {
          filter: { course: courseName, paymentStatus },
          update: {
            $setOnInsert: {
              accessMap: {},
              source: 'dashboard'
            }
          },
          upsert: true
        }
      }))
    ),
    { ordered: false }
  );
}

async function ensureClassAccessRulesForAllCourses() {
  const courses = await Course.find({}, { courseName: 1 }).lean();
  await ensureClassAccessRulesForCourses(courses.map((course) => course.courseName));
}

/**
 * GET /api/admin/issues
 */
router.get('/issues', authMiddleware, async (req, res) => {
  try {
    const issues = await IssueReport.find().sort({ createdAt: -1 }).lean();
    return res.status(200).json({
      success: true,
      message: 'Issues retrieved successfully',
      issues,
      total: issues.length
    });
  } catch (error) {
    console.error('Error retrieving issues:', error.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * DELETE /api/admin/issues/:id
 */
router.delete('/issues/:id', authMiddleware, async (req, res) => {
  try {
    const deletedIssue = await IssueReport.findByIdAndDelete(req.params.id);

    if (!deletedIssue) {
      return res.status(404).json({ success: false, message: 'Issue not found' });
    }

    return res.status(200).json({
      success: true,
      message: 'Issue deleted successfully',
      issue: deletedIssue
    });
  } catch (error) {
    console.error('Error deleting issue:', error.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * GET /api/admin/session-logs
 */
router.get('/session-logs', authMiddleware, async (req, res) => {
  try {
    if (!ensureAdminRole(req, res)) {
      return;
    }

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    const search = normalizeText(req.query.search).toLowerCase();
    const status = normalizeText(req.query.status);
    const action = normalizeText(req.query.action);
    const sortBy = ['timestamp', 'sessionName', 'userName', 'status', 'actionPerformed', 'date', 'time'].includes(req.query.sortBy)
      ? req.query.sortBy
      : 'timestamp';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;

    const query = {
      actionPerformed: { $in: SESSION_LOG_ALLOWED_ACTIONS }
    };

    if (status) {
      query.status = new RegExp(`^${status.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    }

    if (action) {
      if (SESSION_LOG_ALLOWED_ACTIONS.includes(action)) {
        query.actionPerformed = action;
      }
    }

    if (search) {
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$and = [{
        $or: [
          { sessionName: new RegExp(escapedSearch, 'i') },
          { userName: new RegExp(escapedSearch, 'i') },
          { actionPerformed: new RegExp(escapedSearch, 'i') },
          { remarks: new RegExp(escapedSearch, 'i') }
        ]
      }];
    }

    const total = await SessionLog.countDocuments(query);
    const logs = await SessionLog.find(query)
      .sort({ [sortBy]: sortOrder, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();
    const normalizedLogs = logs.map(log => {
      if (!log.timestamp) {
        return log;
      }

      const formatted = getTimestampParts(new Date(log.timestamp));
      return {
        ...log,
        date: formatted.date,
        time: formatted.time
      };
    });

    return res.status(200).json({
      success: true,
      message: 'Session logs retrieved successfully',
      logs: normalizedLogs,
      total,
      page,
      limit,
      totalPages: Math.max(Math.ceil(total / limit), 1)
    });
  } catch (error) {
    console.error('Error retrieving session logs:', error.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * DELETE /api/admin/session-logs
 */
router.delete('/session-logs', authMiddleware, async (req, res) => {
  try {
    if (!ensureAdminRole(req, res)) {
      return;
    }

    const result = await SessionLog.deleteMany({});
    return res.status(200).json({
      success: true,
      message: 'Session logs cleared successfully',
      deletedCount: result.deletedCount || 0
    });
  } catch (error) {
    console.error('Error clearing session logs:', error.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * POST /api/admin/login
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password are required' });
    }

    const isValid = verifyAdminCredentials(username, password);
    if (!isValid) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const token = generateToken({
      username,
      role: 'admin',
      credentialVersion: getAdminCredentialVersion()
    }, 86400);

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      expiresIn: 86400
    });
  } catch (error) {
    console.error('Error in admin login:', error.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * POST /api/admin/session
 */
router.post('/session', authMiddleware, async (req, res) => {
  try {
    if (!ensureAdminRole(req, res)) {
      return;
    }

    const { title, meetingNumber, passcode, description, courses, batch, batches, mentorName, className } = req.body;
    const normalizedBatches = parseBatchNames(batches !== undefined ? batches : batch);
    const normalizedMentorName = normalizeText(mentorName);
    const normalizedClassName = normalizeText(className);

    if (!title || !meetingNumber || !passcode || normalizedBatches.length === 0 || !normalizedMentorName || !normalizedClassName) {
      return res.status(400).json({ success: false, message: 'Title, Meeting Number, Passcode, at least one Batch, Mentor Name, and Class Name are required' });
    }

    const sanitizedMeetingNumber = meetingNumber.toString().replace(/\s/g, '');
    if (!/^\d+$/.test(sanitizedMeetingNumber)) {
      return res.status(400).json({ success: false, message: 'Meeting Number must contain only digits' });
    }

    const normalizedCourses = parseCourseNames(courses);
    await validateSelectedCourses(normalizedCourses);

    const sessionId = `SESSION_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    const newSession = new ClassSession({
      sessionId,
      title: title.trim(),
      meetingNumber: sanitizedMeetingNumber,
      passcode: passcode.toString().trim(),
      description: (description || '').trim(),
      mentorName: normalizedMentorName,
      className: normalizedClassName,
      batch: normalizedBatches[0],
      batches: normalizedBatches,
      courses: normalizedCourses,
      status: 'on',
      createdBy: req.admin.username
    });

    await newSession.save();

    await logSessionActivity({
      sessionId: newSession.sessionId,
      sessionName: newSession.title,
      userName: req.admin.username,
      actionPerformed: 'Created Session',
      status: 'Success',
      remarks: `Created meeting ${newSession.meetingNumber}`
    });

    return res.status(201).json({ success: true, message: 'Session created successfully', session: newSession });
  } catch (error) {
    console.error('Error creating session:', error.message);
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: 'Session ID already exists' });
    }
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Server error',
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
    });
  }
});

/**
 * GET /api/admin/sessions
 */
router.get('/sessions', authMiddleware, async (req, res) => {
  try {
    const sessions = await ClassSession.find().sort({ createdAt: -1 }).lean();
    return res.status(200).json({ success: true, message: 'Sessions retrieved successfully', sessions, total: sessions.length });
  } catch (error) {
    console.error('Error retrieving sessions:', error.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * GET /api/admin/session/:id
 */
router.get('/session/:id', authMiddleware, async (req, res) => {
  try {
    const session = await ClassSession.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    return res.status(200).json({ success: true, session });
  } catch (error) {
    console.error('Error retrieving session:', error.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * PUT /api/admin/session/:id
 */
router.put('/session/:id', authMiddleware, async (req, res) => {
  try {
    if (!ensureAdminRole(req, res)) {
      return;
    }

    const { title, meetingNumber, passcode, description, courses, batch, batches, mentorName, className } = req.body;
    if (!title && !meetingNumber && !passcode && !description && !courses && batch === undefined && batches === undefined && mentorName === undefined && className === undefined) {
      return res.status(400).json({ success: false, message: 'At least one field must be provided for update' });
    }

    const existingSession = await ClassSession.findById(req.params.id).lean();
    if (!existingSession) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    const updateData = {};
    if (title) updateData.title = title.trim();
    if (meetingNumber) {
      const sanitized = meetingNumber.toString().replace(/\s/g, '');
      if (!/^\d+$/.test(sanitized)) return res.status(400).json({ success: false, message: 'Meeting Number must contain only digits' });
      updateData.meetingNumber = sanitized;
    }
    if (passcode) updateData.passcode = passcode.toString().trim();
    if (description !== undefined) updateData.description = (description || '').trim();
    if (mentorName !== undefined) {
      const normalizedMentorName = normalizeText(mentorName);
      if (!normalizedMentorName) {
        return res.status(400).json({ success: false, message: 'Mentor Name is required' });
      }
      updateData.mentorName = normalizedMentorName;
    }
    if (className !== undefined) {
      const normalizedClassName = normalizeText(className);
      if (!normalizedClassName) {
        return res.status(400).json({ success: false, message: 'Class Name is required' });
      }
      updateData.className = normalizedClassName;
    }
    if (batch !== undefined || batches !== undefined) {
      const normalizedBatches = parseBatchNames(batches !== undefined ? batches : batch);
      if (normalizedBatches.length === 0) {
        return res.status(400).json({ success: false, message: 'At least one batch is required' });
      }
      updateData.batch = normalizedBatches[0];
      updateData.batches = normalizedBatches;
    }
    if (courses !== undefined) {
      const normalizedCourses = parseCourseNames(courses);
      await validateSelectedCourses(normalizedCourses);
      updateData.courses = normalizedCourses;
    }

    const updatedSession = await ClassSession.findByIdAndUpdate(req.params.id, updateData, { new: true, runValidators: true });
    if (!updatedSession) return res.status(404).json({ success: false, message: 'Session not found' });

    await logSessionActivity({
      sessionId: updatedSession.sessionId,
      sessionName: updatedSession.title,
      userName: req.admin.username,
      actionPerformed: 'Updated Session',
      status: 'Success',
      remarks: `Updated session details for ${updatedSession.title}`
    });

    return res.status(200).json({ success: true, message: 'Session updated successfully', session: updatedSession });
  } catch (error) {
    console.error('Error updating session:', error.message);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Server error',
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
    });
  }
});

/**
 * PATCH /api/admin/session/:id/status
 */
router.patch('/session/:id/status', authMiddleware, async (req, res) => {
  try {
    if (!ensureAdminRole(req, res)) {
      return;
    }

    const { status } = req.body;
    if (!status || !['on', 'off'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Status must be "on" or "off"' });
    }

    const updatedSession = await ClassSession.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!updatedSession) return res.status(404).json({ success: false, message: 'Session not found' });

    await logSessionActivity({
      sessionId: updatedSession.sessionId,
      sessionName: updatedSession.title,
      userName: req.admin.username,
      actionPerformed: 'Session Status Updated',
      status: 'Success',
      remarks: `Session status changed to ${status.toUpperCase()}`
    });

    return res.status(200).json({ success: true, message: `Session status updated to ${status}`, session: updatedSession });
  } catch (error) {
    console.error('Error updating session status:', error.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * DELETE /api/admin/session/:id
 */
router.delete('/session/:id', authMiddleware, async (req, res) => {
  try {
    if (!ensureAdminRole(req, res)) {
      return;
    }

    const deletedSession = await ClassSession.findByIdAndDelete(req.params.id);
    if (!deletedSession) return res.status(404).json({ success: false, message: 'Session not found' });

    const activeSessions = await ActiveSession.find({ status: 'active' });
    for (const activeSession of activeSessions) {
      await finalizeAttendanceForActiveSession(activeSession, new Date());
      activeSession.status = 'ended';
      activeSession.endedAt = new Date();
      await activeSession.save();
    }
    await logSessionActivity({
      sessionId: deletedSession.sessionId,
      sessionName: deletedSession.title,
      userName: req.admin.username,
      actionPerformed: 'Deleted Session',
      status: 'Success',
      remarks: `Deleted session ${deletedSession.title}`
    });
    return res.status(200).json({ success: true, message: 'Session deleted successfully', session: deletedSession });
  } catch (error) {
    console.error('Error deleting session:', error.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * GET /api/admin/active-sessions
 */
router.get('/active-sessions', authMiddleware, async (req, res) => {
  try {
    const activeSessions = await ActiveSession.find({ status: 'active' }).sort({ joinedAt: -1 }).lean();
    if (!Array.isArray(activeSessions) || activeSessions.length === 0) {
      return res.status(200).json({ success: true, message: 'No active students', students: [], total: 0 });
    }

    const studentsList = [];
    for (const s of activeSessions) {
      const joinedAt = s.joinedAt || s.loginTime || null;
      const joinedAtDate = joinedAt ? new Date(joinedAt) : null;
      const totalMeetingTimeMs = joinedAtDate && !Number.isNaN(joinedAtDate.getTime()) ? Date.now() - joinedAtDate.getTime() : 0;

      let classTitle = null;
      let mentorName = null;
      let className = null;
      if (s.classSessionId) {
        try {
          const cs = await ClassSession.findOne({ sessionId: s.classSessionId }).lean();
          if (cs) {
            classTitle = cs.title || null;
            mentorName = cs.mentorName || null;
            className = cs.className || null;
          }
        } catch (err) {
          console.warn('Error looking up class session title:', err.message);
        }
      }

      studentsList.push({
        lmsId: s.lmsId,
        name: s.name,
        joinedAt,
        currentStatus: 'In Meeting',
        totalMeetingTimeMs,
        deviceToken: s.deviceToken || '',
        classSessionId: s.classSessionId || null,
        classSessionTitle: classTitle,
        mentorName,
        className,
        meetingNumber: s.meetingNumber || null
      });
    }

    return res.status(200).json({ success: true, message: 'Active students retrieved successfully', students: studentsList, total: studentsList.length });
  } catch (error) {
    console.error('Error retrieving active sessions:', error.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * GET /api/admin/courses
 */
router.get('/courses', authMiddleware, async (req, res) => {
  try {
    if (!ensureAdminRole(req, res)) {
      return;
    }

    await Course.updateMany({ status: { $ne: 'active' } }, { $set: { status: 'active' } });
    const [courses, classNames] = await Promise.all([
      Course.find({}).sort({ createdAt: -1 }).lean(),
      getClassCatalog()
    ]);
    return res.status(200).json({
      success: true,
      message: 'Courses retrieved successfully',
      courses,
      courseNames: courses.map(course => course.courseName),
      classNames,
      total: courses.length
    });
  } catch (error) {
    console.error('Error retrieving courses:', error.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * GET /api/admin/validate
 */
router.get('/validate', authMiddleware, async (req, res) => {
  return res.status(200).json({
    success: true,
    message: 'Session is valid',
    admin: {
      username: req.admin.username,
      role: req.admin.role
    }
  });
});

/**
 * GET /api/admin/class-access-rules
 */
router.get('/class-access-rules', authMiddleware, async (req, res) => {
  try {
    if (!ensureAdminRole(req, res)) {
      return;
    }

    await ensureClassAccessRulesForAllCourses();
    const rules = await ClassAccessRule.find({}).sort({ course: 1, paymentStatus: 1 }).lean();
    const classNames = await getClassCatalog();

    return res.status(200).json({
      success: true,
      message: 'Class access rules retrieved successfully',
      classNames,
      rules: rules.map((rule) => ({
        ...rule,
        accessMap: rule.accessMap instanceof Map ? Object.fromEntries(rule.accessMap.entries()) : (rule.accessMap || {})
      }))
    });
  } catch (error) {
    console.error('Error retrieving class access rules:', error.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * PUT /api/admin/class-access-rules
 */
router.put('/class-access-rules', authMiddleware, async (req, res) => {
  try {
    if (!ensureAdminRole(req, res)) {
      return;
    }

    const rules = Array.isArray(req.body.rules) ? req.body.rules : [];
    if (rules.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one rule row is required' });
    }

    await ClassAccessRule.bulkWrite(
      rules.map((rule) => ({
        updateOne: {
          filter: {
            course: normalizeText(rule.course),
            paymentStatus: normalizePaymentStatus(rule.paymentStatus)
          },
          update: {
            $set: {
              accessMap: rule.accessMap || {},
              source: 'dashboard'
            }
          },
          upsert: true
        }
      })),
      { ordered: false }
    );

    return res.status(200).json({ success: true, message: 'Class access rules updated successfully' });
  } catch (error) {
    console.error('Error updating class access rules:', error.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * POST /api/admin/system-sync
 */
router.post('/system-sync', authMiddleware, async (req, res) => {
  try {
    if (!ensureAdminRole(req, res)) {
      return;
    }

    const summary = await syncWorkbookData(req.body || {});
    return res.status(200).json({
      success: true,
      message: 'Workbook data synced successfully',
      summary
    });
  } catch (error) {
    console.error('Error syncing workbook data:', error.message);
    return res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * POST /api/admin/courses
 */
router.post('/courses', authMiddleware, async (req, res) => {
  try {
    if (!ensureAdminRole(req, res)) {
      return;
    }

    const { courseName, description, category, duration, instructorName, status } = req.body;

    if (!normalizeText(courseName)) {
      return res.status(400).json({ success: false, message: 'Course Name is required' });
    }

    const newCourse = new Course({
      courseName: normalizeText(courseName),
      description: normalizeText(description),
      category: normalizeText(category) || 'General',
      duration: normalizeText(duration),
      instructorName: normalizeText(instructorName),
      status: status === 'inactive' ? 'inactive' : 'active',
      createdBy: req.admin.username
    });

    await newCourse.save();
    await ensureClassAccessRulesForCourses([newCourse.courseName]);

    return res.status(201).json({ success: true, message: 'Course created successfully', course: newCourse });
  } catch (error) {
    console.error('Error creating course:', error.message);
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: 'Course with this name already exists' });
    }
    return res.status(400).json({ success: false, message: error.message || 'Failed to create course' });
  }
});

/**
 * PUT /api/admin/courses/:id
 */
router.put('/courses/:id', authMiddleware, async (req, res) => {
  try {
    if (!ensureAdminRole(req, res)) {
      return;
    }

    const { courseName, description, category, duration, instructorName, status } = req.body;
    const updateData = {};

    if (courseName !== undefined) updateData.courseName = normalizeText(courseName);
    if (description !== undefined) updateData.description = normalizeText(description);
    if (category !== undefined) updateData.category = normalizeText(category) || 'General';
    if (duration !== undefined) updateData.duration = normalizeText(duration);
    if (instructorName !== undefined) updateData.instructorName = normalizeText(instructorName);
    if (status !== undefined) updateData.status = status === 'inactive' ? 'inactive' : 'active';

    if (updateData.courseName === '') {
      return res.status(400).json({ success: false, message: 'Course Name is required' });
    }

    const updatedCourse = await Course.findByIdAndUpdate(req.params.id, updateData, { new: true, runValidators: true });
    if (!updatedCourse) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    return res.status(200).json({ success: true, message: 'Course updated successfully', course: updatedCourse });
  } catch (error) {
    console.error('Error updating course:', error.message);
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: 'Course with this name already exists' });
    }
    return res.status(400).json({ success: false, message: error.message || 'Failed to update course' });
  }
});

/**
 * DELETE /api/admin/courses/:id
 */
router.delete('/courses/:id', authMiddleware, async (req, res) => {
  try {
    if (!ensureAdminRole(req, res)) {
      return;
    }

    const deletedCourse = await Course.findByIdAndDelete(req.params.id);
    if (!deletedCourse) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    await ClassAccessRule.deleteMany({ course: deletedCourse.courseName });

    return res.status(200).json({ success: true, message: 'Course deleted successfully', course: deletedCourse });
  } catch (error) {
    console.error('Error deleting course:', error.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * GET /api/admin/export-database
 */
router.get('/export-database', authMiddleware, async (req, res) => {
  try {
    if (!ensureAdminRole(req, res)) {
      return;
    }

    const format = normalizeText(req.query.format || 'json').toLowerCase();
    const scope = normalizeText(req.query.scope || 'all').toLowerCase();
    if (!['csv', 'excel', 'json'].includes(format)) {
      return res.status(400).json({ success: false, message: 'Format must be csv, excel, or json' });
    }
    if (!['all', 'students'].includes(scope)) {
      return res.status(400).json({ success: false, message: 'Scope must be all or students' });
    }

    const [courses, sessions, sessionLogs, students, activeSessions, guestIds, issues] = await Promise.all([
      Course.find({}).sort({ createdAt: -1 }).lean(),
      ClassSession.find({}).sort({ createdAt: -1 }).lean(),
      SessionLog.find({}).sort({ timestamp: -1 }).lean(),
      Student.find({}).sort({ createdAt: -1 }).lean(),
      ActiveSession.find({}).sort({ createdAt: -1 }).lean(),
      GuestMentorId.find({}).sort({ createdAt: -1 }).lean(),
      IssueReport.find({}).sort({ createdAt: -1 }).lean()
    ]);

    if (scope === 'students') {
      const studentPayload = {
        exportedAt: new Date().toISOString(),
        exportedBy: req.admin.username,
        students
      };

      if (format === 'json') {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="dv-student-database-export-${Date.now()}.json"`);
        return res.status(200).send(JSON.stringify(studentPayload, null, 2));
      }

      if (format === 'csv') {
        const csvLines = ['collection,field,value'];
        students.forEach(record => {
          const flattened = flattenDocument(record);
          csvLines.push([
            escapeCsvValue('students'),
            escapeCsvValue('documentId'),
            escapeCsvValue(record._id ? String(record._id) : '')
          ].join(','));
          Object.entries(flattened).forEach(([key, value]) => {
            csvLines.push([
              escapeCsvValue('students'),
              escapeCsvValue(key),
              escapeCsvValue(value)
            ].join(','));
          });
        });

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="dv-student-database-export-${Date.now()}.csv"`);
        return res.status(200).send(csvLines.join('\n'));
      }

      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(students.map(flattenDocument));
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Students');
      const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="dv-student-database-export-${Date.now()}.xlsx"`);
      return res.status(200).send(buffer);
    }

    const exportPayload = {
      exportedAt: new Date().toISOString(),
      exportedBy: req.admin.username,
      courses,
      classSessions: sessions,
      sessionLogs,
      students,
      activeSessions,
      guestMentorIds: guestIds,
      issueReports: issues
    };

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="dv-database-export-${Date.now()}.json"`);
      return res.status(200).send(JSON.stringify(exportPayload, null, 2));
    }

    if (format === 'csv') {
      const csvLines = ['collection,field,value'];
      Object.entries(exportPayload).forEach(([collectionName, records]) => {
        if (!Array.isArray(records)) {
          csvLines.push([
            escapeCsvValue('metadata'),
            escapeCsvValue(collectionName),
            escapeCsvValue(JSON.stringify(records))
          ].join(','));
          return;
        }

        records.forEach(record => {
          const flattened = flattenDocument(record);
          csvLines.push([
            escapeCsvValue(collectionName),
            escapeCsvValue('documentId'),
            escapeCsvValue(record._id ? String(record._id) : '')
          ].join(','));
          Object.entries(flattened).forEach(([key, value]) => {
            csvLines.push([
              escapeCsvValue(collectionName),
              escapeCsvValue(key),
              escapeCsvValue(value)
            ].join(','));
          });
        });
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="dv-database-export-${Date.now()}.csv"`);
      return res.status(200).send(csvLines.join('\n'));
    }

    const workbook = XLSX.utils.book_new();
    const sheets = [
      ['Courses', courses],
      ['ClassSessions', sessions],
      ['SessionLogs', sessionLogs],
      ['Students', students],
      ['ActiveSessions', activeSessions],
      ['GuestMentorIds', guestIds],
      ['IssueReports', issues]
    ];

    sheets.forEach(([sheetName, records]) => {
      const worksheet = XLSX.utils.json_to_sheet(records.map(flattenDocument));
      XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));
    });

    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="dv-database-export-${Date.now()}.xlsx"`);
    return res.status(200).send(buffer);
  } catch (error) {
    console.error('Error exporting database:', error.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * GET /api/admin/guest-ids
 */
router.get('/guest-ids', authMiddleware, async (req, res) => {
  try {
    const guestIds = await GuestMentorId.find({ type: 'guest' }).sort({ id: 1 }).lean();
    return res.status(200).json({
      success: true, message: 'Guest IDs retrieved successfully', ids: guestIds, total: guestIds.length,
      available: guestIds.filter(id => id.status === 'Available').length, active: guestIds.filter(id => id.status === 'Active').length
    });
  } catch (error) {
    console.error('Error retrieving guest IDs:', error.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * GET /api/admin/mentor-ids
 */
router.get('/mentor-ids', authMiddleware, async (req, res) => {
  try {
    const mentorIds = await GuestMentorId.find({ type: 'mentor' }).sort({ id: 1 }).lean();
    return res.status(200).json({
      success: true, message: 'Mentor IDs retrieved successfully', ids: mentorIds, total: mentorIds.length,
      available: mentorIds.filter(id => id.status === 'Available').length, active: mentorIds.filter(id => id.status === 'Active').length
    });
  } catch (error) {
    console.error('Error retrieving mentor IDs:', error.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * GET /api/admin/mock-interview-ids
 */
router.get('/mock-interview-ids', authMiddleware, async (req, res) => {
  try {
    const mockInterviewIds = await GuestMentorId.find({ type: 'mock-interview' }).sort({ id: 1 }).lean();
    return res.status(200).json({
      success: true, message: 'Mock Interview IDs retrieved successfully', ids: mockInterviewIds, total: mockInterviewIds.length,
      available: mockInterviewIds.filter(id => id.status === 'Available').length, active: mockInterviewIds.filter(id => id.status === 'Active').length
    });
  } catch (error) {
    console.error('Error retrieving mock interview IDs:', error.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * POST /api/admin/assign-id
 */
router.post('/assign-id', authMiddleware, async (req, res) => {
  try {
    const { type, idToAssign, name, phoneNumber, course } = req.body;
    if (!type || !['guest', 'mentor', 'mock-interview'].includes(type)) {
      return res.status(400).json({ success: false, message: 'Type must be "guest", "mentor", or "mock-interview"' });
    }
    if (!idToAssign || !name || !phoneNumber || !course) {
      return res.status(400).json({ success: false, message: 'ID, Name, Phone Number, and Course are required' });
    }

    const updated = await GuestMentorId.findOneAndUpdate(
      { id: idToAssign, type },
      { status: 'Active', assignedName: name.trim(), phoneNumber: phoneNumber.toString().trim(), course: course.trim() },
      { new: true }
    ).lean();

    if (!updated) return res.status(404).json({ success: false, message: `${type.toUpperCase()} ID not found` });

    return res.status(200).json({
      success: true,
      message: `${type === 'mock-interview' ? 'Mock Interview' : type.charAt(0).toUpperCase() + type.slice(1)} ID assigned successfully`,
      id: updated
    });
  } catch (error) {
    console.error('Error assigning ID:', error.message);
    return res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * DELETE /api/admin/revoke-id
 */
router.delete('/revoke-id', authMiddleware, async (req, res) => {
  try {
    const { type, idToRevoke } = req.body;
    if (!type || !['guest', 'mentor', 'mock-interview'].includes(type)) {
      return res.status(400).json({ success: false, message: 'Type must be "guest", "mentor", or "mock-interview"' });
    }
    if (!idToRevoke) return res.status(400).json({ success: false, message: 'ID to revoke is required' });

    const updated = await GuestMentorId.findOneAndUpdate(
      { id: idToRevoke, type },
      { status: 'Available', assignedName: null, phoneNumber: null, course: null },
      { new: true }
    ).lean();

    if (!updated) return res.status(404).json({ success: false, message: `${type.toUpperCase()} ID not found` });

    try {
      const activeSessions = await ActiveSession.find({ lmsId: idToRevoke, status: 'active' });
      for (const activeSession of activeSessions) {
        await finalizeAttendanceForActiveSession(activeSession, new Date());
        activeSession.status = 'ended';
        activeSession.endedAt = new Date();
        await activeSession.save();
      }
    } catch (dbError) {
      console.warn('Could not end active sessions in MongoDB:', dbError.message);
    }

    const typeLabel = type === 'mock-interview' ? 'Mock Interview' : type.charAt(0).toUpperCase() + type.slice(1);
    return res.status(200).json({
      success: true,
      message: `${typeLabel} ID revoked successfully and user logged out from all devices`,
      id: updated
    });
  } catch (error) {
    console.error('Error revoking ID:', error.message);
    return res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * GET /api/admin/students/batches
 */
router.get('/students/batches', authMiddleware, async (req, res) => {
  try {
    const batches = await Student.distinct('batch');
    return res.status(200).json({ success: true, batches: batches.filter(Boolean) });
  } catch (error) {
    console.error('Error retrieving student batches:', error.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * GET /api/admin/students
 */
router.get('/students', authMiddleware, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const search = req.query.search ? String(req.query.search).trim() : '';
    const course = req.query.course ? String(req.query.course).trim() : '';
    const paymentStatus = req.query.paymentStatus ? normalizePaymentStatus(req.query.paymentStatus) : '';

    const query = {};

    if (course) {
      query.course = course;
    }

    if (paymentStatus) {
      query.paymentStatus = paymentStatus;
    }

    if (search) {
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [
        { lmsId: new RegExp(escapedSearch, 'i') },
        { name: new RegExp(escapedSearch, 'i') },
        { batch: new RegExp(escapedSearch, 'i') },
        { mobile: new RegExp(escapedSearch, 'i') },
        { emailId: new RegExp(escapedSearch, 'i') },
        { paymentStatus: new RegExp(escapedSearch, 'i') }
      ];
    }

    const total = await Student.countDocuments(query);
    const students = await Student.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    return res.status(200).json({
      success: true,
      message: 'Students retrieved successfully',
      students,
      total,
      page,
      limit,
      totalPages: Math.max(Math.ceil(total / limit), 1)
    });
  } catch (error) {
    console.error('Error retrieving students:', error.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * POST /api/admin/students
 */
router.post('/students', authMiddleware, async (req, res) => {
  try {
    const { lmsId, name, mobile, emailId, batch, course, year, paymentStatus } = req.body;
    const sanitizedLmsId = sanitizeLmsId(lmsId);
    const normalizedBatch = normalizeText(batch);
    const normalizedCourse = normalizeText(course);

    if (!sanitizedLmsId || !name || !normalizedBatch || !normalizedCourse) {
      return res.status(400).json({ success: false, message: 'LMS ID, Name, Batch, and Course are required' });
    }

    const duplicateLmsId = await Student.findOne({ lmsId: sanitizedLmsId }).lean();
    if (duplicateLmsId) {
      return res.status(400).json({ success: false, message: 'Student with this LMS ID already exists' });
    }

    const newStudent = new Student({
      lmsId: sanitizedLmsId,
      name: name.trim(),
      mobile: normalizeText(mobile).replace(/\D/g, ''),
      emailId: normalizeText(emailId).toLowerCase(),
      batch: normalizedBatch,
      course: normalizedCourse,
      year: normalizeText(year),
      paymentStatus: normalizePaymentStatus(paymentStatus)
    });
    
    await newStudent.save();

    return res.status(201).json({ success: true, message: 'Student added successfully', student: newStudent });
  } catch (error) {
    console.error('Error adding student:', error.message);
    if (error.code === 11000) return res.status(400).json({ success: false, message: 'Student with this LMS ID already exists' });
    return res.status(400).json({ success: false, message: error.message || 'Failed to add student' });
  }
});

/**
 * PUT /api/admin/students/:lmsId
 */
router.put('/students/:lmsId', authMiddleware, async (req, res) => {
  try {
    const { lmsId } = req.params;
    const { name, mobile, emailId, batch, course, year, paymentStatus } = req.body;
    const sanitizedLmsId = sanitizeLmsId(lmsId);
    const normalizedBatch = normalizeText(batch);
    const normalizedCourse = normalizeText(course);

    if (!name || !normalizedBatch || !normalizedCourse) {
      return res.status(400).json({ success: false, message: 'Name, Batch, and Course are required' });
    }

    const existingStudent = await Student.findOne({ lmsId: sanitizedLmsId }).lean();
    if (!existingStudent) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    const updated = await Student.findOneAndUpdate(
      { lmsId: sanitizedLmsId },
      {
        name: name.trim(),
        mobile: normalizeText(mobile).replace(/\D/g, ''),
        emailId: normalizeText(emailId).toLowerCase(),
        batch: normalizedBatch,
        course: normalizedCourse,
        year: normalizeText(year),
        paymentStatus: normalizePaymentStatus(paymentStatus)
      },
      { new: true }
    ).lean();

    if (!updated) return res.status(404).json({ success: false, message: 'Student not found' });

    return res.status(200).json({ success: true, message: 'Student updated successfully', student: updated });
  } catch (error) {
    console.error('Error updating student:', error.message);
    return res.status(400).json({ success: false, message: error.message || 'Failed to update student' });
  }
});

/**
 * DELETE /api/admin/students/:lmsId
 */
router.delete('/students/:lmsId', authMiddleware, async (req, res) => {
  try {
    const { lmsId } = req.params;
    if (!lmsId) return res.status(400).json({ success: false, message: 'LMS ID is required' });

    const deleted = await Student.findOneAndDelete({ lmsId });
    if (!deleted) return res.status(404).json({ success: false, message: 'Student not found' });

    return res.status(200).json({ success: true, message: 'Student deleted successfully', lmsId });
  } catch (error) {
    console.error('Error deleting student:', error.message);
    return res.status(400).json({ success: false, message: error.message || 'Failed to delete student' });
  }
});

module.exports = router;
