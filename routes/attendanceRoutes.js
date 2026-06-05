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
  if (query.course) {
    studentQuery.course = query.course;
  }
  if (query.batch) {
    studentQuery.batch = query.batch;
  }
  if (query.search) {
    const search = escapeRegex(query.search.trim());
    studentQuery.$or = [
      { lmsId: new RegExp(search, 'i') },
      { name: new RegExp(search, 'i') },
      { phoneNumber: new RegExp(search, 'i') },
      { batch: new RegExp(search, 'i') }
    ];
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
  if (query.course) {
    attendanceMatch.course = query.course;
  }
  if (query.batch) {
    attendanceMatch.batch = query.batch;
  }
  if (query.trainer) {
    attendanceMatch.trainerName = query.trainer;
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

async function buildAttendanceSnapshot(query = {}) {
  const window = resolveWindow(query);
  const studentQuery = buildStudentQuery(query);
  const attendanceMatch = buildAttendanceMatch(query, window);

  const [students, attendanceRecords, sessions] = await Promise.all([
    Student.find(studentQuery).select('lmsId name phoneNumber batch course createdAt').lean(),
    AttendanceRecord.find(attendanceMatch)
      .select('lmsId studentName phoneNumber course batch sessionId sessionName trainerName attendanceDate attendedAt status')
      .sort({ attendedAt: 1 })
      .lean(),
    ClassSession.find({}).select('sessionId title createdBy courses createdAt').sort({ createdAt: -1 }).lean()
  ]);

  const sessionTimeline = Array.from(new Map(attendanceRecords.map((record) => [record.sessionId, record.attendedAt || record.createdAt || record.updatedAt])).entries())
    .sort((left, right) => new Date(left[1]) - new Date(right[1]))
    .map(([sessionId]) => sessionId);

  const sessionsConducted = sessionTimeline.length;
  const presentStudentIdsToday = new Set(
    attendanceRecords
      .filter((record) => formatDateValue(record.attendedAt) === formatDateValue(new Date()))
      .map((record) => record.lmsId)
  );

  const studentsById = new Map(students.map((student) => [student.lmsId, student]));
  const attendanceByStudent = new Map();
  attendanceRecords.forEach((record) => {
    if (!attendanceByStudent.has(record.lmsId)) {
      attendanceByStudent.set(record.lmsId, []);
    }
    attendanceByStudent.get(record.lmsId).push(record);
  });

  const batchGroups = new Map();
  const courseGroups = new Map();
  const sessionGroups = new Map();
  students.forEach((student) => {
    const studentRecords = attendanceByStudent.get(student.lmsId) || [];
    const presentSessions = new Set(studentRecords.map((record) => record.sessionId)).size;
    const batchKey = normalizeText(student.batch) || 'Unassigned';
    const courseKey = Array.isArray(student.course) && student.course.length > 0 ? student.course[0] : (normalizeText(student.course) || 'Unassigned');

    if (!batchGroups.has(batchKey)) batchGroups.set(batchKey, { totalStudents: 0, presentSessions: 0 });
    if (!courseGroups.has(courseKey)) courseGroups.set(courseKey, { totalStudents: 0, presentSessions: 0 });

    batchGroups.get(batchKey).totalStudents += 1;
    courseGroups.get(courseKey).totalStudents += 1;
    batchGroups.get(batchKey).presentSessions += presentSessions;
    courseGroups.get(courseKey).presentSessions += presentSessions;
  });

  attendanceRecords.forEach((record) => {
    if (!sessionGroups.has(record.sessionId)) {
      sessionGroups.set(record.sessionId, {
        sessionId: record.sessionId,
        sessionName: record.sessionName,
        trainerName: record.trainerName || '',
        presentCount: 0,
        studentIds: new Set(),
        attendanceDate: record.attendanceDate || formatDateValue(record.attendedAt)
      });
    }

    const entry = sessionGroups.get(record.sessionId);
    entry.presentCount += 1;
    entry.studentIds.add(record.lmsId);
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
        course: Array.isArray(student.course) ? student.course.join(', ') : (student.course || 'Unassigned'),
        batch: normalizeText(student.batch) || 'Unassigned',
        phoneNumber: student.phoneNumber || '',
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
      phoneNumber: student.phoneNumber || '',
      course: Array.isArray(student.course) ? student.course.join(', ') : (student.course || 'Unassigned'),
      batch: normalizeText(student.batch) || 'Unassigned',
      attendancePercentage,
      presentSessions,
      absentSessions: Math.max(sessionsConducted - presentSessions, 0),
      lastAttendanceDate: lastAttendanceRecord ? lastAttendanceRecord.attendanceDate || formatDateValue(lastAttendanceRecord.attendedAt) : null
    };
  });

  const sessionSummaries = Array.from(sessionGroups.values()).map((entry) => ({
    sessionId: entry.sessionId,
    sessionName: entry.sessionName,
    trainerName: entry.trainerName || '',
    presentCount: entry.presentCount,
    uniqueStudents: entry.studentIds.size,
    attendancePercentage: getAttendanceRate(entry.studentIds.size, Math.max(students.length, 1)),
    attendanceDate: entry.attendanceDate || ''
  }));

  const batchSummaries = Array.from(batchGroups.entries()).map(([batch, value]) => ({
    batch,
    totalStudents: value.totalStudents,
    presentSessions: value.presentSessions,
    attendancePercentage: getAttendanceRate(value.presentSessions, Math.max(sessionsConducted * value.totalStudents, 1))
  }));

  const courseSummaries = Array.from(courseGroups.entries()).map(([course, value]) => ({
    course,
    totalStudents: value.totalStudents,
    presentSessions: value.presentSessions,
    attendancePercentage: getAttendanceRate(value.presentSessions, Math.max(sessionsConducted * value.totalStudents, 1))
  }));

  const trendMap = new Map();
  attendanceRecords.forEach((record) => {
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
  attendanceRecords.forEach((record) => {
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

  const totalPresentEntries = attendanceRecords.length;
  const totalPossibleEntries = students.length * Math.max(sessionsConducted, 1);
  const overallAttendancePercentage = totalPossibleEntries > 0 ? Math.round((totalPresentEntries / totalPossibleEntries) * 1000) / 10 : 0;

  return {
    window,
    filters: {
      course: normalizeText(query.course),
      batch: normalizeText(query.batch),
      trainer: normalizeText(query.trainer),
      sessionId: normalizeText(query.sessionId),
      search: normalizeText(query.search),
      threshold: atRiskThreshold
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
    batchComparison: Array.from(batchGroups.entries())
      .map(([batch, value]) => ({
        batch,
        totalStudents: value.totalStudents,
        attendancePercentage: getAttendanceRate(value.presentSessions, Math.max(sessionsConducted * value.totalStudents, 1))
      }))
      .sort((left, right) => right.attendancePercentage - left.attendancePercentage),
    coursePerformance: Array.from(courseGroups.entries())
      .map(([course, value]) => ({
        course,
        totalStudents: value.totalStudents,
        attendancePercentage: getAttendanceRate(value.presentSessions, Math.max(sessionsConducted * value.totalStudents, 1))
      }))
      .sort((left, right) => right.attendancePercentage - left.attendancePercentage),
    studentSummaries,
    sessionSummaries,
    batchSummaries,
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
    attendanceRecords,
    sessions,
    totalStudentsFiltered: students.length,
    totalAttendanceEntries: totalPresentEntries
  };
}

function toCsvRows(records) {
  const headers = ['LMS ID', 'Name', 'Phone Number', 'Course', 'Batch', 'Session', 'Trainer', 'Attendance Date', 'Status', 'Attendance Percentage', 'Last Attendance Date'];
  const lines = [headers.map(buildCsvValue).join(',')];
  records.forEach((record) => {
    lines.push([
      record.lmsId,
      record.name,
      record.phoneNumber,
      record.course,
      record.batch,
      record.sessionName || record.sessionId,
      record.trainerName,
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
    ['Batches', snapshot.batchSummaries],
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
    Course: student.course,
    Batch: student.batch,
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

    let filteredRiskStudents = snapshot.atRiskStudents;
    if (search) {
      filteredRiskStudents = filteredRiskStudents.filter((student) => {
        return [student.lmsId, student.name, student.course, student.batch, student.phoneNumber, student.lastAttendanceDate]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(search));
      });
    }

    const total = filteredRiskStudents.length;
    const totalPages = Math.max(Math.ceil(total / limit), 1);
    const pageItems = filteredRiskStudents.slice((page - 1) * limit, page * limit);

    return res.status(200).json({
      success: true,
      message: 'Attendance insights retrieved successfully',
      metrics: snapshot.metrics,
      trends: snapshot.trends,
      batchComparison: snapshot.batchComparison,
      coursePerformance: snapshot.coursePerformance,
      monthlySummaries: snapshot.monthlySummaries,
      atRiskStudents: pageItems,
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
          `${student.lmsId} | ${student.name} | ${student.course} | ${student.batch} | ${student.attendancePercentage}% | ${student.lastAttendanceDate || 'N/A'}`
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
      ...snapshot.batchComparison.map((row) => ({ section: 'batchComparison', ...row })),
      ...snapshot.coursePerformance.map((row) => ({ section: 'coursePerformance', ...row })),
      ...snapshot.monthlySummaries.map((row) => ({ section: 'monthlySummaries', ...row }))
    ]);
    const studentSheet = XLSX.utils.json_to_sheet(snapshot.studentSummaries);
    const sessionSheet = XLSX.utils.json_to_sheet(snapshot.sessionSummaries);
    const batchSheet = XLSX.utils.json_to_sheet(snapshot.batchSummaries);
    const courseSheet = XLSX.utils.json_to_sheet(snapshot.courseSummaries);
    const monthlySheet = XLSX.utils.json_to_sheet(snapshot.monthlySummaries);
    const riskSheet = XLSX.utils.json_to_sheet(toExcelSheetRows(snapshot));
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');
    XLSX.utils.book_append_sheet(workbook, studentSheet, 'Students');
    XLSX.utils.book_append_sheet(workbook, sessionSheet, 'Sessions');
    XLSX.utils.book_append_sheet(workbook, batchSheet, 'Batches');
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