const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const Student = require('../models/Student');
const ClassSession = require('../models/ClassSession');
const AttendanceRecord = require('../models/AttendanceRecord');
const ActiveSession = require('../models/ActiveSession');
const { logSessionActivity } = require('../utils/sessionLogger');

const PRESENT_ATTENDANCE_THRESHOLD = 0.8;
const PARTIAL_ATTENDANCE_THRESHOLD = 0.3;

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
  if (query.attendanceDate) {
    attendanceMatch.attendanceDate = query.attendanceDate;
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

function toValidDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
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

function resolveAttendanceDate(record) {
  return normalizeText(record?.attendanceDate) || formatDateValue(record?.attendedAt) || formatDateValue(record?.createdAt) || '';
}

function sanitizeSheetName(value, fallback = 'Attendance') {
  const sanitized = String(value || fallback)
    .replace(/[\\/*?:[\]]/g, ' ')
    .trim()
    .slice(0, 31);
  return sanitized || fallback;
}

function sanitizeFileName(value, fallback = 'attendance') {
  const sanitized = String(value || fallback)
    .replace(/[<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return sanitized || fallback;
}

function buildOccurrenceKey(sessionId, attendanceDate) {
  return `${normalizeText(sessionId)}__${normalizeText(attendanceDate || 'undated')}`;
}

function resolveAttendanceStatus(durationMinutes, occurrenceDurationMinutes) {
  const safeDurationMinutes = Math.max(Number(durationMinutes || 0), 0);
  const safeOccurrenceDurationMinutes = Math.max(Number(occurrenceDurationMinutes || 0), 0);
  const attendanceRatio = safeOccurrenceDurationMinutes > 0
    ? safeDurationMinutes / safeOccurrenceDurationMinutes
    : (safeDurationMinutes > 0 ? 1 : 0);
  const attendancePercentage = Math.round(attendanceRatio * 1000) / 10;

  if (attendanceRatio >= PRESENT_ATTENDANCE_THRESHOLD) {
    return { status: 'present', attendancePercentage };
  }

  if (attendanceRatio >= PARTIAL_ATTENDANCE_THRESHOLD) {
    return { status: 'partial present', attendancePercentage };
  }

  return { status: 'low present', attendancePercentage };
}

function resolveDurationMinutes(record) {
  const baseMinutes = Math.max(Number(record.durationMinutes || 0), 0);
  if (record.currentJoinStartedAt) {
    const currentSegmentMs = Date.now() - new Date(record.currentJoinStartedAt).getTime();
    return Math.round((baseMinutes + (currentSegmentMs / 60000)) * 10) / 10;
  }

  if (baseMinutes > 0) {
    return Math.round(baseMinutes * 10) / 10;
  }

  const startCandidates = [record.attendedAt, record.firstJoinedAt, record.createdAt]
    .map((value) => (value ? new Date(value) : null))
    .filter((value) => value && !Number.isNaN(value.getTime()));
  const startedAt = startCandidates.sort((left, right) => left.getTime() - right.getTime())[0] || null;

  if (!startedAt) {
    return 0;
  }

  const endCandidates = [record.leftAt, record.lastSeenAt, record.updatedAt]
    .map((value) => (value ? new Date(value) : null))
    .filter((value) => value && !Number.isNaN(value.getTime()))
    .filter((value) => value.getTime() >= startedAt.getTime());
  const endedAt = endCandidates.sort((left, right) => right.getTime() - left.getTime())[0] || null;

  if (!endedAt) {
    return 0;
  }

  return Math.round((Math.max(endedAt.getTime() - startedAt.getTime(), 0) / 60000) * 10) / 10;
}

function resolveRecordStartedAt(record) {
  return [record.firstJoinedAt, record.attendedAt, record.createdAt]
    .map(toValidDate)
    .filter(Boolean)
    .sort((left, right) => left.getTime() - right.getTime())[0] || null;
}

function resolveRecordEndedAt(record) {
  const startedAt = resolveRecordStartedAt(record);
  const endCandidates = [
    record.leftAt,
    record.lastSeenAt,
    record.currentJoinStartedAt ? new Date() : null,
    record.updatedAt
  ]
    .map(toValidDate)
    .filter(Boolean);

  if (!startedAt) {
    return endCandidates.sort((left, right) => right.getTime() - left.getTime())[0] || null;
  }

  return endCandidates
    .filter((value) => value.getTime() >= startedAt.getTime())
    .sort((left, right) => right.getTime() - left.getTime())[0] || null;
}

function mergeRecordWithActiveSession(record, activeSession) {
  if (!record || !activeSession) {
    return record;
  }

  const activeJoinedAt = toValidDate(activeSession.joinedAt);
  const activeLastSeenAt = toValidDate(activeSession.lastSeenAt) || new Date();
  const currentJoinStartedAt = toValidDate(record.currentJoinStartedAt) || activeJoinedAt;
  const firstJoinedAt = toValidDate(record.firstJoinedAt) || activeJoinedAt;
  const attendedAt = toValidDate(record.attendedAt) || firstJoinedAt || activeJoinedAt;

  return {
    ...record,
    attendedAt: attendedAt || record.attendedAt,
    firstJoinedAt: firstJoinedAt || record.firstJoinedAt,
    currentJoinStartedAt: currentJoinStartedAt || record.currentJoinStartedAt,
    lastSeenAt: activeLastSeenAt,
    leftAt: null
  };
}

function buildOccurrenceAnalytics(records = []) {
  const recordsByOccurrence = new Map();

  records.forEach((record) => {
    const attendanceDate = resolveAttendanceDate(record);
    if (!attendanceDate) {
      return;
    }

    const occurrenceKey = buildOccurrenceKey(record.sessionId, attendanceDate);
    if (!recordsByOccurrence.has(occurrenceKey)) {
      recordsByOccurrence.set(occurrenceKey, []);
    }
    recordsByOccurrence.get(occurrenceKey).push(record);
  });

  const analyticsByOccurrence = new Map();
  recordsByOccurrence.forEach((occurrenceRecords, occurrenceKey) => {
    const startTimes = occurrenceRecords
      .map(resolveRecordStartedAt)
      .filter(Boolean)
      .sort((left, right) => left.getTime() - right.getTime());
    const endTimes = occurrenceRecords
      .map(resolveRecordEndedAt)
      .filter(Boolean)
      .sort((left, right) => right.getTime() - left.getTime());
    const occurrenceDurationMinutes = startTimes.length > 0 && endTimes.length > 0
      ? Math.max((endTimes[0].getTime() - startTimes[0].getTime()) / 60000, 0)
      : 0;
    const thresholdMinutes = occurrenceDurationMinutes * PRESENT_ATTENDANCE_THRESHOLD;
    const partialThresholdMinutes = occurrenceDurationMinutes * PARTIAL_ATTENDANCE_THRESHOLD;
    const attendeeStats = new Map();

    occurrenceRecords.forEach((record) => {
      const durationMinutes = resolveDurationMinutes(record);
      const attendance = resolveAttendanceStatus(durationMinutes, occurrenceDurationMinutes);

      attendeeStats.set(record.lmsId, {
        durationMinutes,
        status: attendance.status,
        attendancePercentage: attendance.attendancePercentage
      });
    });

    analyticsByOccurrence.set(occurrenceKey, {
      occurrenceDurationMinutes: Math.round(occurrenceDurationMinutes * 10) / 10,
      thresholdMinutes: Math.round(thresholdMinutes * 10) / 10,
      partialThresholdMinutes: Math.round(partialThresholdMinutes * 10) / 10,
      attendeeStats,
      presentStudentIds: new Set(
        Array.from(attendeeStats.entries())
          .filter(([, value]) => value.status === 'present')
          .map(([lmsId]) => lmsId)
      )
    });
  });

  return analyticsByOccurrence;
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

  const [students, attendanceRecords, sessions, activeSessions] = await Promise.all([
    Student.find(studentQuery).select('lmsId name mobile batch course createdAt').lean(),
    AttendanceRecord.find(attendanceMatch)
      .select('lmsId studentName mobile course batch sessionId sessionName mentorName className attendanceDate attendedAt status firstJoinedAt currentJoinStartedAt lastSeenAt leftAt durationMinutes createdAt updatedAt')
      .sort({ attendedAt: 1 })
      .lean(),
    ClassSession.find(sessionQuery).select('sessionId title mentorName className batch batches courses status createdAt').sort({ createdAt: -1 }).lean(),
    ActiveSession.find({ status: 'active' })
      .select('lmsId classSessionId joinedAt lastSeenAt status')
      .lean()
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

    return true;
  });

  const sessionsById = new Map(filteredSessions.map((session) => [session.sessionId, session]));
  const relevantSessionIds = new Set(filteredSessions.map((session) => session.sessionId));
  const activeSessionsByKey = new Map(
    activeSessions
      .filter((session) => session.lmsId && session.classSessionId && relevantSessionIds.has(session.classSessionId))
      .map((session) => [`${session.lmsId}__${session.classSessionId}`, session])
  );
  const relevantAttendanceRecords = attendanceRecords
    .filter((record) => relevantSessionIds.has(record.sessionId))
    .map((record) => mergeRecordWithActiveSession(record, activeSessionsByKey.get(`${record.lmsId}__${record.sessionId}`)));

  const occurrenceMap = new Map();
  relevantAttendanceRecords.forEach((record) => {
    const attendanceDate = resolveAttendanceDate(record);
    if (!attendanceDate) {
      return;
    }

    const occurrenceKey = buildOccurrenceKey(record.sessionId, attendanceDate);
    const session = sessionsById.get(record.sessionId);

    if (!occurrenceMap.has(occurrenceKey)) {
      occurrenceMap.set(occurrenceKey, {
        occurrenceKey,
        sessionId: record.sessionId,
        sessionName: session?.title || record.sessionName || record.sessionId,
        batch: session ? formatSessionBatch(session) : (normalizeText(record.batch) || 'Unassigned'),
        course: session && Array.isArray(session.courses) && session.courses.length > 0
          ? session.courses.join(', ')
          : (normalizeText(record.course) || ''),
        mentorName: session?.mentorName || record.mentorName || '',
        className: session?.className || record.className || '',
        attendanceDate,
        uniqueStudents: new Set(),
        sortDate: new Date(`${attendanceDate}T00:00:00.000Z`),
        createdAt: session?.createdAt || record.createdAt || record.attendedAt || null
      });
    }

    occurrenceMap.get(occurrenceKey).uniqueStudents.add(record.lmsId);
  });

  const search = normalizeText(query.search).toLowerCase();
  const occurrenceSummaries = Array.from(occurrenceMap.values())
    .filter((occurrence) => {
      if (!search) {
        return true;
      }

      const haystack = [
        occurrence.sessionId,
        occurrence.sessionName,
        occurrence.batch,
        occurrence.course,
        occurrence.className,
        occurrence.mentorName,
        occurrence.attendanceDate
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(search);
    });

  const sessionTimeline = occurrenceSummaries
    .slice()
    .sort((left, right) => {
      const leftTime = left.sortDate instanceof Date && !Number.isNaN(left.sortDate.getTime()) ? left.sortDate.getTime() : 0;
      const rightTime = right.sortDate instanceof Date && !Number.isNaN(right.sortDate.getTime()) ? right.sortDate.getTime() : 0;
      if (leftTime !== rightTime) {
        return leftTime - rightTime;
      }
      return left.sessionId.localeCompare(right.sessionId);
    })
    .map((occurrence) => occurrence.occurrenceKey);

  const relevantOccurrenceKeys = new Set(occurrenceSummaries.map((occurrence) => occurrence.occurrenceKey));
  const filteredAttendanceRecords = relevantAttendanceRecords.filter((record) => {
    const attendanceDate = resolveAttendanceDate(record);
    return attendanceDate && relevantOccurrenceKeys.has(buildOccurrenceKey(record.sessionId, attendanceDate));
  });
  const occurrenceAnalytics = buildOccurrenceAnalytics(filteredAttendanceRecords);
  const enrichedAttendanceRecords = filteredAttendanceRecords.map((record) => {
    const attendanceDate = resolveAttendanceDate(record);
    const occurrenceKey = buildOccurrenceKey(record.sessionId, attendanceDate);
    const analytics = occurrenceAnalytics.get(occurrenceKey);
    const attendeeStats = analytics?.attendeeStats?.get(record.lmsId);

    return {
      ...record,
      attendanceDate,
      occurrenceKey,
      durationMinutes: attendeeStats?.durationMinutes ?? resolveDurationMinutes(record),
      status: attendeeStats?.status || record.status || 'low present',
      attendancePercentage: attendeeStats?.attendancePercentage ?? 0,
      occurrenceDurationMinutes: analytics?.occurrenceDurationMinutes ?? 0,
      thresholdMinutes: analytics?.thresholdMinutes ?? 0,
      partialThresholdMinutes: analytics?.partialThresholdMinutes ?? 0
    };
  });

  const sessionsConducted = occurrenceSummaries.length;
  const presentStudentIdsToday = new Set(
    enrichedAttendanceRecords
      .filter((record) => record.status === 'present')
      .filter((record) => record.attendanceDate === formatDateValue(new Date()))
      .map((record) => record.lmsId)
  );

  const attendanceByStudent = new Map();
  enrichedAttendanceRecords.forEach((record) => {
    if (!attendanceByStudent.has(record.lmsId)) {
      attendanceByStudent.set(record.lmsId, []);
    }
    attendanceByStudent.get(record.lmsId).push(record);
  });

  const courseGroups = new Map();
  students.forEach((student) => {
    const studentRecords = attendanceByStudent.get(student.lmsId) || [];
    const presentSessions = new Set(
      studentRecords
        .filter((record) => record.status === 'present')
        .map((record) => record.occurrenceKey || buildOccurrenceKey(record.sessionId, resolveAttendanceDate(record)))
    ).size;
    const courseKey = normalizeText(student.course) || 'Unassigned';

    if (!courseGroups.has(courseKey)) courseGroups.set(courseKey, { totalStudents: 0, presentSessions: 0 });

    courseGroups.get(courseKey).totalStudents += 1;
    courseGroups.get(courseKey).presentSessions += presentSessions;
  });

  const atRiskThreshold = Math.max(Number(query.threshold || 75), 1);
  const atRiskStudents = students
    .map((student) => {
      const studentRecords = attendanceByStudent.get(student.lmsId) || [];
      const attendedSessionSet = new Set(
        studentRecords
          .filter((record) => record.status === 'present')
          .map((record) => record.occurrenceKey || buildOccurrenceKey(record.sessionId, resolveAttendanceDate(record)))
      );
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
    const attendedSessionSet = new Set(
      studentRecords
        .filter((record) => record.status === 'present')
        .map((record) => record.occurrenceKey || buildOccurrenceKey(record.sessionId, resolveAttendanceDate(record)))
    );
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

  const sessionSummaries = occurrenceSummaries
    .slice()
    .sort((left, right) => {
      const leftTime = left.sortDate instanceof Date && !Number.isNaN(left.sortDate.getTime()) ? left.sortDate.getTime() : 0;
      const rightTime = right.sortDate instanceof Date && !Number.isNaN(right.sortDate.getTime()) ? right.sortDate.getTime() : 0;
      if (leftTime !== rightTime) {
        return rightTime - leftTime;
      }
      return left.sessionId.localeCompare(right.sessionId);
    })
    .map((occurrence) => {
      const analytics = occurrenceAnalytics.get(occurrence.occurrenceKey);
      const presentStudents = analytics?.presentStudentIds?.size || 0;
      const joinedStudents = occurrence.uniqueStudents.size;
      return {
        occurrenceKey: occurrence.occurrenceKey,
        sessionId: occurrence.sessionId,
        sessionName: occurrence.sessionName,
        batch: occurrence.batch,
        course: occurrence.course,
        mentorName: occurrence.mentorName,
        className: occurrence.className,
        presentCount: presentStudents,
        uniqueStudents: joinedStudents,
        joinedCount: joinedStudents,
        attendancePercentage: getAttendanceRate(presentStudents, Math.max(students.length, 1)),
        attendanceDate: occurrence.attendanceDate || '',
        occurrenceDurationMinutes: analytics?.occurrenceDurationMinutes ?? 0,
        thresholdMinutes: analytics?.thresholdMinutes ?? 0
      };
    });

  const courseSummaries = Array.from(courseGroups.entries()).map(([course, value]) => ({
    course,
    totalStudents: value.totalStudents,
    presentSessions: value.presentSessions,
    attendancePercentage: getAttendanceRate(value.presentSessions, Math.max(sessionsConducted * value.totalStudents, 1))
  }));

  const trendMap = new Map();
  enrichedAttendanceRecords
    .filter((record) => record.status === 'present')
    .forEach((record) => {
    const dateKey = resolveAttendanceDate(record);
    if (!dateKey) return;
    if (!trendMap.has(dateKey)) {
      trendMap.set(dateKey, { date: dateKey, present: 0, students: new Set(), sessions: new Set() });
    }
    const entry = trendMap.get(dateKey);
    entry.present += 1;
    entry.students.add(record.lmsId);
    entry.sessions.add(buildOccurrenceKey(record.sessionId, dateKey));
    });

  const monthlyMap = new Map();
  enrichedAttendanceRecords
    .filter((record) => record.status === 'present')
    .forEach((record) => {
    const attendedAt = record.attendedAt ? new Date(record.attendedAt) : null;
    if (!attendedAt || Number.isNaN(attendedAt.getTime())) return;
    const monthKey = `${attendedAt.getFullYear()}-${String(attendedAt.getMonth() + 1).padStart(2, '0')}`;
    if (!monthlyMap.has(monthKey)) {
      monthlyMap.set(monthKey, { month: monthKey, present: 0, students: new Set(), sessions: new Set() });
    }
    const entry = monthlyMap.get(monthKey);
    entry.present += 1;
    entry.students.add(record.lmsId);
    entry.sessions.add(buildOccurrenceKey(record.sessionId, resolveAttendanceDate(record)));
    });

  const totalPresentEntries = enrichedAttendanceRecords.filter((record) => record.status === 'present').length;
  const totalPossibleEntries = students.length * Math.max(sessionsConducted, 1);
  const overallAttendancePercentage = totalPossibleEntries > 0 ? Math.round((totalPresentEntries / totalPossibleEntries) * 1000) / 10 : 0;

  return {
    window,
    filters: {
      batch: normalizeText(query.batch),
      course: normalizeText(query.course),
      sessionId: normalizeText(query.sessionId),
      attendanceDate: normalizeText(query.attendanceDate),
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
    attendanceRecords: enrichedAttendanceRecords,
    sessions: filteredSessions,
    totalStudentsFiltered: students.length,
    totalAttendanceEntries: totalPresentEntries
  };
}

async function loadSessionAttendanceData(sessionId, query = {}) {
  const attendanceDate = normalizeText(query.attendanceDate);
  const window = resolveWindow(query);
  const attendanceMatch = buildAttendanceMatch({ ...query, sessionId }, window);
  const session = await ClassSession.findOne({ sessionId }).select('sessionId title batch batches className courses mentorName status').lean();
  const [rawRecords, activeSessions] = await Promise.all([
    AttendanceRecord.find(attendanceMatch)
      .select('lmsId studentName mobile course batch sessionId sessionName mentorName className attendanceDate attendedAt status firstJoinedAt currentJoinStartedAt lastSeenAt leftAt durationMinutes createdAt updatedAt')
      .sort({ attendedAt: 1 })
      .lean(),
    ActiveSession.find({ status: 'active', classSessionId: sessionId })
      .select('lmsId classSessionId joinedAt lastSeenAt status')
      .lean()
  ]);
  const activeSessionsByLmsId = new Map(activeSessions.map((activeSession) => [activeSession.lmsId, activeSession]));
  const allRecords = rawRecords.map((record) => mergeRecordWithActiveSession(record, activeSessionsByLmsId.get(record.lmsId)));
  const occurrenceKey = buildOccurrenceKey(sessionId, attendanceDate || allRecords[0]?.attendanceDate || formatDateValue(allRecords[0]?.attendedAt) || '');
  const occurrenceAnalytics = buildOccurrenceAnalytics(allRecords);
  const occurrenceInfo = occurrenceAnalytics.get(occurrenceKey);
  const records = allRecords.map((record) => {
    const recordAttendanceDate = resolveAttendanceDate(record);
    const recordOccurrenceKey = buildOccurrenceKey(record.sessionId, recordAttendanceDate);
    const analytics = occurrenceAnalytics.get(recordOccurrenceKey);
    const attendeeStats = analytics?.attendeeStats?.get(record.lmsId);

    return {
      lmsId: record.lmsId,
      studentName: record.studentName,
      mobile: record.mobile || '',
      mentorName: record.mentorName || '',
      className: record.className || '',
      attendedAt: record.attendedAt,
      attendanceDate: recordAttendanceDate || null,
      status: attendeeStats?.status || record.status || 'low present',
      durationMinutes: attendeeStats?.durationMinutes ?? resolveDurationMinutes(record),
      attendancePercentage: attendeeStats?.attendancePercentage ?? 0
    };
  });

  return {
    session: {
      sessionId,
      sessionName: session?.title || allRecords[0]?.sessionName || sessionId,
      occurrenceKey,
      batch: formatSessionBatch(session) || allRecords[0]?.batch || '',
      course: Array.isArray(session?.courses) ? session.courses.join(', ') : (allRecords[0]?.course || ''),
      mentorName: session?.mentorName || allRecords[0]?.mentorName || '',
      className: session?.className || allRecords[0]?.className || '',
      attendanceDate: attendanceDate || allRecords[0]?.attendanceDate || formatDateValue(allRecords[0]?.attendedAt) || null,
      occurrenceDurationMinutes: occurrenceInfo?.occurrenceDurationMinutes ?? 0,
      thresholdMinutes: occurrenceInfo?.thresholdMinutes ?? 0,
      partialThresholdMinutes: occurrenceInfo?.partialThresholdMinutes ?? 0
    },
    records
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

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
    const sessionAttendance = await loadSessionAttendanceData(sessionId, req.query);
    const total = sessionAttendance.records.length;
    const totalPages = Math.max(Math.ceil(total / limit), 1);
    const safePage = Math.min(page, totalPages);
    const records = sessionAttendance.records.slice((safePage - 1) * limit, safePage * limit);

    return res.status(200).json({
      success: true,
      message: 'Session attendance retrieved successfully',
      session: sessionAttendance.session,
      pagination: {
        page: safePage,
        limit,
        total,
        totalPages
      },
      records
    });
  } catch (error) {
    console.error('Error loading session attendance:', error.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/session/:sessionId/export', authMiddleware, async (req, res) => {
  try {
    if (!ensureAdminRole(req, res)) {
      return;
    }

    const sessionId = normalizeText(req.params.sessionId);
    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'Session ID is required' });
    }

    const sessionAttendance = await loadSessionAttendanceData(sessionId, req.query);
    const XLSX = require('xlsx');
    const workbook = XLSX.utils.book_new();
    const sheetRows = sessionAttendance.records.map((record) => ({
      'LMS ID': record.lmsId,
      Name: record.studentName || '',
      Mobile: record.mobile || '',
      Mentor: record.mentorName || sessionAttendance.session.mentorName || '',
      'Joined At': record.attendedAt ? new Date(record.attendedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '',
      'Attendance Date': record.attendanceDate || '',
      'Duration (Minutes)': Math.round(Number(record.durationMinutes || 0) * 10) / 10,
      'Attendance %': Math.round(Number(record.attendancePercentage || 0) * 10) / 10,
      Status: record.status
    }));
    const worksheet = XLSX.utils.json_to_sheet(sheetRows);
    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      sanitizeSheetName(`${sessionAttendance.session.sessionName || sessionId} ${sessionAttendance.session.attendanceDate || ''}`.trim(), 'Attendance')
    );
    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
    const fileName = sanitizeFileName(`${sessionAttendance.session.sessionName || sessionId}-${sessionAttendance.session.attendanceDate || 'attendance'}`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}.xlsx"`);
    return res.status(200).send(buffer);
  } catch (error) {
    console.error('Error exporting session attendance:', error.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.delete('/session/:sessionId/occurrence', authMiddleware, async (req, res) => {
  try {
    if (!ensureAdminRole(req, res)) {
      return;
    }

    const sessionId = normalizeText(req.params.sessionId);
    const attendanceDate = normalizeText(req.query.attendanceDate);

    if (!sessionId || !attendanceDate) {
      return res.status(400).json({ success: false, message: 'Session ID and attendance date are required' });
    }

    const session = await ClassSession.findOne({ sessionId }).select('sessionId title').lean();
    const result = await AttendanceRecord.deleteMany({ sessionId, attendanceDate });

    await logSessionActivity({
      sessionId,
      sessionName: session?.title || sessionId,
      userName: req.admin.username,
      actionPerformed: 'Cleared Attendance',
      status: 'success',
      remarks: `Deleted ${result.deletedCount || 0} attendance record(s) for ${attendanceDate}`
    });

    return res.status(200).json({
      success: true,
      message: `Cleared ${result.deletedCount || 0} attendance record(s) for ${attendanceDate}`,
      deletedCount: result.deletedCount || 0
    });
  } catch (error) {
    console.error('Error clearing attendance occurrence:', error.message);
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
