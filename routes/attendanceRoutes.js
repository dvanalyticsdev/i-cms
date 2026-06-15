const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const Student = require('../models/Student');
const ClassSession = require('../models/ClassSession');
const AttendanceRecord = require('../models/AttendanceRecord');
const { logSessionActivity } = require('../utils/sessionLogger');

function ensureAdminRole(req, res) {
  if (!req.admin || req.admin.role !== 'admin') {
    res.status(403).json({ success: false, message: 'Admin access required' });
    return false;
  }

  return true;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getSessionBatches(session) {
  if (Array.isArray(session?.batches) && session.batches.length > 0) {
    return session.batches.map(batch => normalizeText(batch)).filter(Boolean);
  }

  const batch = normalizeText(session?.batch);
  return batch ? [batch] : [];
}

function formatSessionBatch(session) {
  const batches = getSessionBatches(session);
  return batches.length > 0 ? batches.join(', ') : 'Unassigned';
}

function toStartOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function toEndOfDay(date) {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function resolveWindow(query = {}) {
  const timeframe = normalizeText(query.timeframe || 'monthly').toLowerCase();
  const now = new Date();
  let start = null;
  let end = null;

  if (timeframe === 'daily') {
    start = toStartOfDay(now);
    end = toEndOfDay(now);
  } else if (timeframe === 'weekly') {
    start = toStartOfDay(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000));
    end = toEndOfDay(now);
  } else if (timeframe === 'monthly') {
    start = toStartOfDay(new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000));
    end = toEndOfDay(now);
  } else if (timeframe === 'custom') {
    if (query.from) {
      start = toStartOfDay(new Date(query.from));
    }
    if (query.to) {
      end = toEndOfDay(new Date(query.to));
    }
  }

  return { timeframe, start, end };
}

function buildStudentQuery(query = {}) {
  const studentQuery = {};
  if (query.batch) {
    studentQuery.batch = query.batch;
  }
  if (query.course) {
    studentQuery.course = query.course;
  }

  return studentQuery;
}

function buildAttendanceMatch(query = {}, window = {}) {
  const attendanceMatch = {};
  if (window.start || window.end) {
    attendanceMatch.attendedAt = {};
    if (window.start) attendanceMatch.attendedAt.$gte = window.start;
    if (window.end) attendanceMatch.attendedAt.$lte = window.end;
  }
  if (query.batch) {
    attendanceMatch.batch = query.batch;
  }
  if (query.course) {
    attendanceMatch.course = query.course;
  }
  if (query.mentorName) {
    attendanceMatch.mentorName = query.mentorName;
  }
  if (query.sessionId) {
    attendanceMatch.sessionId = query.sessionId;
  }
  return attendanceMatch;
}

function getAttendanceRate(presentCount, sessionsCount) {
  if (!sessionsCount) return 0;
  return Math.round((presentCount / sessionsCount) * 1000) / 10;
}

function getCurrentMissStreak(sessionIds, attendedSessionSet) {
  let streak = 0;
  for (let index = sessionIds.length - 1; index >= 0; index -= 1) {
    if (attendedSessionSet.has(sessionIds[index])) break;
    streak += 1;
  }
  return streak;
}

function formatDateValue(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function buildCsvValue(value) {
  const text = value === undefined || value === null ? '' : String(value);
  return '"' + text.replace(/"/g, '""') + '"';
}

function buildSectionRows(sectionName, records) {
  return records.map((record) => ({
    section: sectionName,
    ...record
  }));
}

function resolveDurationMinutes(record) {
  const baseMinutes = Math.max(Number(record.durationMinutes || 0), 0);
  if (record.currentJoinStartedAt) {
    const currentSegmentMs = Date.now() - new Date(record.currentJoinStartedAt).getTime();
    return Math.round((baseMinutes + (currentSegmentMs / 60000)) * 10) / 10;
  }

  return Math.round(baseMinutes * 10) / 10;
}

async function buildAttendanceSnapshot(query = {}) {
  const window = resolveWindow(query);
  const studentQuery = buildStudentQuery(query);
  const attendanceMatch = buildAttendanceMatch(query, window);

  const sessionQuery = {};
  if (query.batch) {
    sessionQuery.$or = [{ batch: query.batch }, { batches: query.batch }];
  }
  if (query.course) {
    sessionQuery.courses = query.course;
  }
  if (query.sessionId) {
    sessionQuery.sessionId = query.sessionId;
  }
  if (query.mentorName) {
    sessionQuery.mentorName = query.mentorName;
  }
  if (window.start || window.end) {
    sessionQuery.createdAt = {};
    if (window.start) sessionQuery.createdAt.$gte = window.start;
    if (window.end) sessionQuery.createdAt.$lte = window.end;
  }

  const [students, attendanceRecords, sessions] = await Promise.all([
    Student.find(studentQuery).select('lmsId name mobile batch course createdAt').lean(),
    AttendanceRecord.find(attendanceMatch)
      .select('lmsId studentName mobile course batch sessionId sessionName mentorName className attendanceDate attendedAt status firstJoinedAt currentJoinStartedAt lastSeenAt leftAt durationMinutes')
      .sort({ attendedAt: 1 })
      .lean(),
    ClassSession.find(sessionQuery).select('sessionId title mentorName className batch batches courses createdAt').sort({ createdAt: -1 }).lean()
  ]);

  const filteredSessions = sessions.filter((session) => {
    if (query.batch && !getSessionBatches(session).includes(query.batch)) {
      return false;
    }

    if (query.course) {
      const sessionCourses = Array.isArray(session.courses) ? session.courses : [];
      if (!sessionCourses.includes(query.course)) {
        return false;
      }
    }

    if (query.sessionId && session.sessionId !== query.sessionId) {
      return false;
    }

    if (query.search) {
      const search = query.search.trim().toLowerCase();
      const haystack = [
        session.sessionId,
        session.title,
        formatSessionBatch(session),
        ...(Array.isArray(session.courses) ? session.courses : [])
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      if (!haystack.includes(search)) {
        return false;
      }
    }

    if (window.start || window.end) {
      const createdAt = session.createdAt ? new Date(session.createdAt) : null;
      if (!createdAt || Number.isNaN(createdAt.getTime())) {
        return false;
      }
      if (window.start && createdAt < window.start) {
        return false;
      }
      if (window.end && createdAt > window.end) {
        return false;
      }
    }

    return true;
  });

  const sessionsById = new Map(filteredSessions.map((session) => [session.sessionId, session]));
  const relevantSessionIds = new Set(filteredSessions.map((session) => session.sessionId));
  const relevantAttendanceRecords = attendanceRecords.filter((record) => relevantSessionIds.has(record.sessionId));
  const sessionTimeline = filteredSessions
    .slice()
    .sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt))
    .map((session) => session.sessionId);

  const sessionsConducted = sessionTimeline.length;
  const presentStudentIdsToday = new Set(
    relevantAttendanceRecords
      .filter((record) => formatDateValue(record.attendedAt) === formatDateValue(new Date()))
      .map((record) => record.lmsId)
  );

  const attendanceByStudent = new Map();
  relevantAttendanceRecords.forEach((record) => {
    if (!attendanceByStudent.has(record.lmsId)) {
      attendanceByStudent.set(record.lmsId, []);
    }
    attendanceByStudent.get(record.lmsId).push(record);
  });

  const courseGroups = new Map();
  students.forEach((student) => {
    const studentRecords = attendanceByStudent.get(student.lmsId) || [];
    const presentSessions = new Set(studentRecords.map((record) => record.sessionId)).size;
    const courseKey = normalizeText(student.course) || 'Unassigned';

    if (!courseGroups.has(courseKey)) courseGroups.set(courseKey, { totalStudents: 0, presentSessions: 0 });

    courseGroups.get(courseKey).totalStudents += 1;
    courseGroups.get(courseKey).presentSessions += presentSessions;
  });

  const atRiskThreshold = Math.max(Number(query.threshold || 75), 1);
  const atRiskStudents = students
    .map((student) => {
      const studentRecords = attendanceByStudent.get(student.lmsId) || [];
      const attendedSessionSet = new Set(studentRecords.map((record) => record.sessionId));
      const presentSessions = attendedSessionSet.size;
      const attendancePercentage = getAttendanceRate(presentSessions, sessionsConducted);
      const missedSessions = Math.max(sessionsConducted - presentSessions, 0);
      const consecutiveMissedSessions = getCurrentMissStreak(sessionTimeline, attendedSessionSet);
      const lastAttendanceRecord = studentRecords[studentRecords.length - 1] || null;
      const riskReasons = [];

      if (attendancePercentage < atRiskThreshold) {
        riskReasons.push('Low attendance percentage');
      }
      if (missedSessions >= 3) {
        riskReasons.push('Frequent absences');
      }
      if (consecutiveMissedSessions >= 2) {
        riskReasons.push('Consecutive missed sessions');
      }

      return {
        lmsId: student.lmsId,
        name: student.name,
        batch: student.batch || 'Unassigned',
        course: student.course || 'Unassigned',
        mobile: student.mobile || '',
        attendancePercentage,
        missedSessions,
        consecutiveMissedSessions,
        lastAttendanceDate: lastAttendanceRecord ? lastAttendanceRecord.attendanceDate || formatDateValue(lastAttendanceRecord.attendedAt) : null,
        riskReasons,
        totalAttendanceSessions: presentSessions
      };
    })
    .filter((student) => student.riskReasons.length > 0)
    .sort((left, right) => left.attendancePercentage - right.attendancePercentage || right.consecutiveMissedSessions - left.consecutiveMissedSessions);

  const studentSummaries = students.map((student) => {
    const studentRecords = attendanceByStudent.get(student.lmsId) || [];
    const attendedSessionSet = new Set(studentRecords.map((record) => record.sessionId));
    const presentSessions = attendedSessionSet.size;
    const attendancePercentage = getAttendanceRate(presentSessions, sessionsConducted);
    const lastAttendanceRecord = studentRecords[studentRecords.length - 1] || null;

    return {
      lmsId: student.lmsId,
      name: student.name,
      mobile: student.mobile || '',
      batch: student.batch || 'Unassigned',
      course: student.course || 'Unassigned',
      attendancePercentage,
      presentSessions,
      absentSessions: Math.max(sessionsConducted - presentSessions, 0),
      lastAttendanceDate: lastAttendanceRecord ? lastAttendanceRecord.attendanceDate || formatDateValue(lastAttendanceRecord.attendedAt) : null
    };
  });

  const sessionSummaries = filteredSessions.map((session) => {
    const recordsForSession = relevantAttendanceRecords.filter((record) => record.sessionId === session.sessionId);
    const uniqueStudents = new Set(recordsForSession.map((record) => record.lmsId)).size;
    const attendanceDate = recordsForSession[0]?.attendanceDate || formatDateValue(session.createdAt);

    return {
      sessionId: session.sessionId,
      sessionName: session.title,
      batch: formatSessionBatch(session),
      course: Array.isArray(session.courses) ? session.courses.join(', ') : '',
      mentorName: session.mentorName || '',
      className: session.className || '',
      presentCount: uniqueStudents,
      uniqueStudents,
      attendancePercentage: getAttendanceRate(uniqueStudents, Math.max(students.length, 1)),
      attendanceDate: attendanceDate || ''
    };
  });

  const courseSummaries = Array.from(courseGroups.entries()).map(([course, value]) => ({
    course,
    totalStudents: value.totalStudents,
    presentSessions: value.presentSessions,
    attendancePercentage: getAttendanceRate(value.presentSessions, Math.max(sessionsConducted * value.totalStudents, 1))
  }));

  const trendMap = new Map();
  relevantAttendanceRecords.forEach((record) => {
    const dateKey = record.attendanceDate || formatDateValue(record.attendedAt);
    if (!dateKey) return;
    if (!trendMap.has(dateKey)) {
      trendMap.set(dateKey, { date: dateKey, present: 0, students: new Set(), sessions: new Set() });
    }
    const entry = trendMap.get(dateKey);
    entry.present += 1;
    entry.students.add(record.lmsId);
    entry.sessions.add(record.sessionId);
  });

  const monthlyMap = new Map();
  relevantAttendanceRecords.forEach((record) => {
    const attendedAt = record.attendedAt ? new Date(record.attendedAt) : null;
    if (!attendedAt || Number.isNaN(attendedAt.getTime())) return;
    const monthKey = `${attendedAt.getFullYear()}-${String(attendedAt.getMonth() + 1).padStart(2, '0')}`;
    if (!monthlyMap.has(monthKey)) {
      monthlyMap.set(monthKey, { month: monthKey, present: 0, students: new Set(), sessions: new Set() });
    }
    const entry = monthlyMap.get(monthKey);
    entry.present += 1;
    entry.students.add(record.lmsId);
    entry.sessions.add(record.sessionId);
  });

  const totalPresentEntries = relevantAttendanceRecords.length;
  const totalPossibleEntries = students.length * Math.max(sessionsConducted, 1);
  const overallAttendancePercentage = totalPossibleEntries > 0 ? Math.round((totalPresentEntries / totalPossibleEntries) * 1000) / 10 : 0;

  return {
    window,
    filters: {
      batch: normalizeText(query.batch),
      course: normalizeText(query.course),
      sessionId: normalizeText(query.sessionId),
      search: normalizeText(query.search)
    },
    metrics: {
      totalStudents: students.length,
      presentToday: presentStudentIdsToday.size,
      absentToday: Math.max(students.length - presentStudentIdsToday.size, 0),
      overallAttendancePercentage,
      studentsAtRisk: atRiskStudents.length,
      totalSessionsConducted: sessionsConducted
    },
    trends: Array.from(trendMap.values())
      .map((entry) => ({
        date: entry.date,
        present: entry.present,
        uniqueStudents: entry.students.size,
        sessions: entry.sessions.size
      }))
      .sort((left, right) => new Date(left.date) - new Date(right.date)),
    coursePerformance: Array.from(courseGroups.entries())
      .map(([course, value]) => ({
        course,
        totalStudents: value.totalStudents,
        attendancePercentage: getAttendanceRate(value.presentSessions, Math.max(sessionsConducted * value.totalStudents, 1))
      }))
      .sort((left, right) => right.attendancePercentage - left.attendancePercentage),
    studentSummaries,
    sessionSummaries,
    courseSummaries,
    monthlySummaries: Array.from(monthlyMap.values())
      .map((entry) => ({
        month: entry.month,
        present: entry.present,
        uniqueStudents: entry.students.size,
        sessions: entry.sessions.size
      }))
      .sort((left, right) => left.month.localeCompare(right.month)),
    atRiskStudents,
    students,
    attendanceRecords: relevantAttendanceRecords,
    sessions: filteredSessions,
    totalStudentsFiltered: students.length,
    totalAttendanceEntries: totalPresentEntries
  };
}

function toCsvRows(records) {
  const headers = ['LMS ID', 'Name', 'Mobile', 'Batch', 'Course', 'Session', 'Mentor', 'Attendance Date', 'Status', 'Attendance Percentage', 'Last Attendance Date'];
  const lines = [headers.map(buildCsvValue).join(',')];
  records.forEach((record) => {
    lines.push([
      record.lmsId,
      record.name,
      record.mobile,
      record.batch,
      record.course,
      record.sessionName || record.sessionId,
      record.mentorName,
      record.attendanceDate,
      record.status,
      record.attendancePercentage !== undefined ? `${record.attendancePercentage}%` : '',
      record.lastAttendanceDate || ''
    ].map(buildCsvValue).join(','));
  });
  return lines.join('\n');
}

function toComprehensiveCsv(snapshot) {
  const rows = [];
  rows.push(['section', 'metric', 'value'].map(buildCsvValue).join(','));

  Object.entries(snapshot.metrics).forEach(([key, value]) => {
    rows.push(['Summary', key, value].map(buildCsvValue).join(','));
  });

  [
    ['Students', snapshot.studentSummaries],
    ['Sessions', snapshot.sessionSummaries],
    ['Courses', snapshot.courseSummaries],
    ['Monthly', snapshot.monthlySummaries],
    ['At-Risk', snapshot.atRiskStudents]
  ].forEach(([sectionName, records]) => {
    records.forEach((record) => {
      Object.entries(record).forEach(([key, value]) => {
        rows.push([sectionName, key, value].map(buildCsvValue).join(','));
      });
    });
  });

  return rows.join('\n');
}

function toExcelSheetRows(snapshot) {
  return snapshot.atRiskStudents.map((student) => ({
    'LMS ID': student.lmsId,
    Name: student.name,
    Batch: student.batch,
    Course: student.course,
    'Attendance Percentage': student.attendancePercentage,
    'Missed Sessions': student.missedSessions,
    'Consecutive Missed Sessions': student.consecutiveMissedSessions,
    'Last Attendance Date': student.lastAttendanceDate || '',
    'Risk Reasons': student.riskReasons.join('; ')
  }));
}

/**
 * GET /api/admin/attendance/insights
 */
router.get('/insights', authMiddleware, async (req, res) => {
  try {
    if (!ensureAdminRole(req, res)) {
      return;
    }

    const snapshot = await buildAttendanceSnapshot(req.query);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    const search = normalizeText(req.query.search).toLowerCase();
    let filteredSessions = snapshot.sessionSummaries;

    if (search) {
      filteredSessions = filteredSessions.filter((session) => {
        return [session.sessionId, session.sessionName, session.batch, session.course, session.attendanceDate]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(search));
      });
    }

    const total = filteredSessions.length;
    const totalPages = Math.max(Math.ceil(total / limit), 1);
    const pageItems = filteredSessions.slice((page - 1) * limit, page * limit);

    return res.status(200).json({
      success: true,
      message: 'Attendance insights retrieved successfully',
      metrics: snapshot.metrics,
      sessionSummaries: pageItems,
      pagination: {
        page,
        limit,
        total,
        totalPages
      },
      filters: snapshot.filters
    });
  } catch (error) {
    console.error('Error loading attendance insights:', error.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * GET /api/admin/attendance/session/:sessionId
 */
router.get('/session/:sessionId', authMiddleware, async (req, res) => {
  try {
    if (!ensureAdminRole(req, res)) {
      return;
    }

    const sessionId = normalizeText(req.params.sessionId);
    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'Session ID is required' });
    }

    const window = resolveWindow(req.query);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
    const attendanceMatch = buildAttendanceMatch({ ...req.query, sessionId }, window);
    const allRecords = await AttendanceRecord.find(attendanceMatch)
      .select('lmsId studentName mobile course batch sessionId sessionName mentorName className attendanceDate attendedAt status')
      .sort({ attendedAt: 1 })
      .lean();

    const total = allRecords.length;
    const totalPages = Math.max(Math.ceil(total / limit), 1);
    const safePage = Math.min(page, totalPages);
    const records = allRecords.slice((safePage - 1) * limit, safePage * limit);

    const session = await ClassSession.findOne({ sessionId }).select('sessionId title batch batches className courses mentorName').lean();

    return res.status(200).json({
      success: true,
      message: 'Session attendance retrieved successfully',
      session: {
        sessionId,
        sessionName: session?.title || allRecords[0]?.sessionName || sessionId,
        batch: formatSessionBatch(session) || allRecords[0]?.batch || '',
        course: Array.isArray(session?.courses) ? session.courses.join(', ') : (allRecords[0]?.course || ''),
        mentorName: session?.mentorName || allRecords[0]?.mentorName || '',
        className: session?.className || allRecords[0]?.className || '',
        attendanceDate: allRecords[0]?.attendanceDate || null
      },
      pagination: {
        page: safePage,
        limit,
        total,
        totalPages
      },
      records: records.map((record) => ({
        lmsId: record.lmsId,
        studentName: record.studentName,
        mobile: record.mobile || '',
        mentorName: record.mentorName || '',
        className: record.className || '',
        attendedAt: record.attendedAt,
        attendanceDate: record.attendanceDate || null,
        status: record.status || 'present',
        durationMinutes: resolveDurationMinutes(record)
      }))
    });
  } catch (error) {
    console.error('Error loading session attendance:', error.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * GET /api/admin/attendance/roster
 */
router.get('/roster', authMiddleware, async (req, res) => {
  try {
    if (!ensureAdminRole(req, res)) {
      return;
    }

    const snapshot = await buildAttendanceSnapshot(req.query);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const search = normalizeText(req.query.search).toLowerCase();
    const attendanceBand = normalizeText(req.query.attendanceBand || 'all').toLowerCase();
    const sortBy = normalizeText(req.query.sortBy || 'attendance-desc').toLowerCase();

    let roster = snapshot.studentSummaries;

    if (search) {
      roster = roster.filter((student) => {
        return [student.lmsId, student.name, student.mobile, student.batch, student.course]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(search));
      });
    }

    if (attendanceBand === 'perfect') {
      roster = roster.filter((student) => Number(student.attendancePercentage || 0) === 100);
    } else if (attendanceBand === 'above75') {
      roster = roster.filter((student) => Number(student.attendancePercentage || 0) >= 75);
    } else if (attendanceBand === 'below75') {
      roster = roster.filter((student) => Number(student.attendancePercentage || 0) < 75);
    } else if (attendanceBand === 'below50') {
      roster = roster.filter((student) => Number(student.attendancePercentage || 0) < 50);
    }

    if (sortBy === 'attendance-asc') {
      roster = roster.sort((left, right) => left.attendancePercentage - right.attendancePercentage || left.name.localeCompare(right.name));
    } else if (sortBy === 'name-asc') {
      roster = roster.sort((left, right) => left.name.localeCompare(right.name));
    } else if (sortBy === 'name-desc') {
      roster = roster.sort((left, right) => right.name.localeCompare(left.name));
    } else {
      roster = roster.sort((left, right) => right.attendancePercentage - left.attendancePercentage || left.name.localeCompare(right.name));
    }

    const total = roster.length;
    const totalPages = Math.max(Math.ceil(total / limit), 1);
    const pageItems = roster.slice((page - 1) * limit, page * limit);

    return res.status(200).json({
      success: true,
      message: 'Attendance roster retrieved successfully',
      students: pageItems,
      pagination: {
        page,
        limit,
        total,
        totalPages
      }
    });
  } catch (error) {
    console.error('Error loading attendance roster:', error.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * GET /api/admin/attendance/report
 */
router.get('/report', authMiddleware, async (req, res) => {
  try {
    if (!ensureAdminRole(req, res)) {
      return;
    }

    const format = normalizeText(req.query.format || 'excel').toLowerCase();
    const reportType = normalizeText(req.query.reportType || 'monthly').toLowerCase();
    const snapshot = await buildAttendanceSnapshot({ ...req.query, timeframe: reportType === 'complete' ? 'complete' : reportType });

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="attendance-report-${Date.now()}.json"`);
      return res.status(200).send(JSON.stringify(snapshot, null, 2));
    }

    if (format === 'csv') {
      const csv = toComprehensiveCsv(snapshot);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="attendance-report-${reportType}-${Date.now()}.csv"`);
      return res.status(200).send(csv);
    }

    if (format === 'pdf') {
      const pdfkit = require('pdfkit');
      const doc = new pdfkit({ size: 'A4', margin: 36 });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="attendance-report-${reportType}-${Date.now()}.pdf"`);
      doc.pipe(res);

      doc.fontSize(18).text('Attendance Report', { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(10).text(`Generated by: ${req.admin.username}`);
      doc.text(`Report Type: ${reportType}`);
      doc.text(`Total Students: ${snapshot.metrics.totalStudents}`);
      doc.text(`Present Today: ${snapshot.metrics.presentToday}`);
      doc.text(`Absent Today: ${snapshot.metrics.absentToday}`);
      doc.text(`Overall Attendance Percentage: ${snapshot.metrics.overallAttendancePercentage}%`);
      doc.text(`Students at Risk: ${snapshot.metrics.studentsAtRisk}`);
      doc.text(`Total Sessions Conducted: ${snapshot.metrics.totalSessionsConducted}`);
      doc.moveDown();

      doc.fontSize(12).text('At-Risk Students', { underline: true });
      snapshot.atRiskStudents.slice(0, 20).forEach((student) => {
        doc.moveDown(0.25);
        doc.fontSize(9).text(
          `${student.lmsId} | ${student.name} | ${student.course} | ${student.attendancePercentage}% | ${student.lastAttendanceDate || 'N/A'}`
        );
      });
      doc.end();
      return;
    }

    const XLSX = require('xlsx');
    const workbook = XLSX.utils.book_new();
    const summarySheet = XLSX.utils.json_to_sheet([
      snapshot.metrics,
      ...snapshot.trends.map((row) => ({ section: 'trend', ...row })),
      ...snapshot.coursePerformance.map((row) => ({ section: 'coursePerformance', ...row })),
      ...snapshot.monthlySummaries.map((row) => ({ section: 'monthlySummaries', ...row }))
    ]);
    const studentSheet = XLSX.utils.json_to_sheet(snapshot.studentSummaries);
    const sessionSheet = XLSX.utils.json_to_sheet(snapshot.sessionSummaries);
    const courseSheet = XLSX.utils.json_to_sheet(snapshot.courseSummaries);
    const monthlySheet = XLSX.utils.json_to_sheet(snapshot.monthlySummaries);
    const riskSheet = XLSX.utils.json_to_sheet(toExcelSheetRows(snapshot));
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');
    XLSX.utils.book_append_sheet(workbook, studentSheet, 'Students');
    XLSX.utils.book_append_sheet(workbook, sessionSheet, 'Sessions');
    XLSX.utils.book_append_sheet(workbook, courseSheet, 'Courses');
    XLSX.utils.book_append_sheet(workbook, monthlySheet, 'Monthly');
    XLSX.utils.book_append_sheet(workbook, riskSheet, 'At-Risk Students');
    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="attendance-report-${reportType}-${Date.now()}.xlsx"`);
    return res.status(200).send(buffer);
  } catch (error) {
    console.error('Error exporting attendance report:', error.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
