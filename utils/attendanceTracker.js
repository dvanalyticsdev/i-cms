const AttendanceRecord = require('../models/AttendanceRecord');
const ActiveSession = require('../models/ActiveSession');
const ClassSession = require('../models/ClassSession');
const AttendanceWindowOverride = require('../models/AttendanceWindowOverride');

const PORTAL_STALE_TIMEOUT_MS = Math.max(parseInt(process.env.SESSION_TIMEOUT_MINUTES || '360', 10), 1) * 60 * 1000;
const ATTENDANCE_STALE_TIMEOUT_MS = Math.max(parseInt(process.env.ATTENDANCE_STALE_TIMEOUT_MINUTES || '5', 10), 1) * 60 * 1000;
const HEARTBEAT_WRITE_INTERVAL_MS = Math.max(parseInt(process.env.ATTENDANCE_HEARTBEAT_WRITE_INTERVAL_SECONDS || '120', 10), 15) * 1000;
const MAX_SINGLE_SEGMENT_MINUTES = Math.max(parseInt(process.env.ATTENDANCE_MAX_SEGMENT_MINUTES || '480', 10), 30);
const MAX_TOTAL_DURATION_MINUTES = Math.max(parseInt(process.env.ATTENDANCE_MAX_TOTAL_MINUTES || '720', 10), 60);
const MAX_SEGMENT_COUNT = Math.max(parseInt(process.env.ATTENDANCE_MAX_SEGMENTS || '12', 10), 2);
const REJOIN_IDEMPOTENCY_WINDOW_MS = Math.max(parseInt(process.env.ATTENDANCE_REJOIN_IDEMPOTENCY_SECONDS || '45', 10), 5) * 1000;

function roundMinutes(ms) {
  return Math.round((Math.max(ms, 0) / 60000) * 10) / 10;
}

function toValidDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatAttendanceDate(value = new Date()) {
  return new Date(value).toLocaleDateString('en-CA');
}

function sanitizeReason(value, fallback = '') {
  return String(value || fallback).trim().toLowerCase();
}

function buildAnomalyFlags(record) {
  const flags = [];
  const durationMinutes = Math.max(Number(record?.durationMinutes || 0), 0);
  const segmentCount = Math.max(Number(record?.sessionSegments || 0), 0);
  const openStartedAt = toValidDate(record?.currentJoinStartedAt);
  const finalizedAt = toValidDate(record?.finalizedAt);

  if (durationMinutes > MAX_TOTAL_DURATION_MINUTES) {
    flags.push('long_total_duration');
  }

  if (segmentCount > MAX_SEGMENT_COUNT) {
    flags.push('excessive_rejoins');
  }

  if (openStartedAt && !finalizedAt) {
    const openMinutes = (Date.now() - openStartedAt.getTime()) / 60000;
    if (openMinutes > MAX_SINGLE_SEGMENT_MINUTES) {
      flags.push('long_open_segment');
    }
  }

  if (Array.isArray(record?.segmentHistory)) {
    if (record.segmentHistory.some((segment) => Number(segment?.durationMinutes || 0) > MAX_SINGLE_SEGMENT_MINUTES)) {
      flags.push('long_segment_history');
    }

    if (record.segmentHistory.some((segment) => segment?.joinedAt && segment?.leftAt && new Date(segment.leftAt) < new Date(segment.joinedAt))) {
      flags.push('segment_time_inversion');
    }
  }

  return Array.from(new Set(flags));
}

function stampRecordHealth(record) {
  const anomalyFlags = buildAnomalyFlags(record);
  record.anomalyFlags = anomalyFlags;
  record.anomalyScore = anomalyFlags.length;
  if (record.reviewStatus !== 'reviewed') {
    record.reviewStatus = anomalyFlags.length > 0 ? 'flagged' : 'clean';
  }
  return record;
}

function getLastOpenSegment(record) {
  if (!Array.isArray(record?.segmentHistory) || record.segmentHistory.length === 0) {
    return null;
  }

  for (let index = record.segmentHistory.length - 1; index >= 0; index -= 1) {
    if (!record.segmentHistory[index].leftAt) {
      return record.segmentHistory[index];
    }
  }

  return null;
}

async function recordSessionJoin({
  lmsId,
  studentName,
  mobile,
  course,
  batch,
  sessionId,
  sessionName,
  mentorName,
  className,
  attendanceDate,
  source = 'session-join',
  joinedAt = new Date()
}) {
  if (!lmsId || !sessionId) {
    return null;
  }

  const joinedAtDate = toValidDate(joinedAt) || new Date();
  const existingRecord = await AttendanceRecord.findOne({ lmsId, sessionId, attendanceDate });

  if (!existingRecord) {
    const record = new AttendanceRecord({
      lmsId,
      studentName,
      mobile,
      course,
      batch,
      sessionId,
      sessionName,
      mentorName,
      className,
      attendanceDate,
      attendedAt: joinedAtDate,
      firstJoinedAt: joinedAtDate,
      currentJoinStartedAt: joinedAtDate,
      lastSeenAt: joinedAtDate,
      leftAt: null,
      durationMinutes: 0,
      sessionSegments: 1,
      segmentHistory: [{
        joinedAt: joinedAtDate,
        leftAt: null,
        durationMinutes: 0,
        source,
        endReason: ''
      }],
      attendanceEndReason: '',
      finalizedAt: null,
      finalizedBy: '',
      status: 'present',
      source
    });

    stampRecordHealth(record);
    await record.save();
    return record.toObject();
  }

  existingRecord.studentName = studentName;
  existingRecord.mobile = mobile;
  existingRecord.course = course;
  existingRecord.batch = batch;
  existingRecord.sessionName = sessionName;
  existingRecord.mentorName = mentorName;
  existingRecord.className = className;
  existingRecord.attendanceDate = attendanceDate;
  existingRecord.lastSeenAt = joinedAtDate;
  existingRecord.status = 'present';
  existingRecord.source = source;

  if (!existingRecord.firstJoinedAt) {
    existingRecord.firstJoinedAt = joinedAtDate;
  }

  if (!existingRecord.attendedAt) {
    existingRecord.attendedAt = existingRecord.firstJoinedAt || joinedAtDate;
  }

  const currentJoinStartedAt = toValidDate(existingRecord.currentJoinStartedAt);
  if (currentJoinStartedAt && joinedAtDate.getTime() - currentJoinStartedAt.getTime() <= REJOIN_IDEMPOTENCY_WINDOW_MS) {
    existingRecord.finalizedAt = null;
    existingRecord.finalizedBy = '';
    existingRecord.attendanceEndReason = '';
    stampRecordHealth(existingRecord);
    await existingRecord.save();
    return existingRecord.toObject();
  }

  if (!currentJoinStartedAt) {
    existingRecord.currentJoinStartedAt = joinedAtDate;
    existingRecord.leftAt = null;
    existingRecord.sessionSegments = Math.max(Number(existingRecord.sessionSegments || 0), 0) + 1;
    existingRecord.segmentHistory = Array.isArray(existingRecord.segmentHistory) ? existingRecord.segmentHistory : [];
    existingRecord.segmentHistory.push({
      joinedAt: joinedAtDate,
      leftAt: null,
      durationMinutes: 0,
      source,
      endReason: ''
    });
  }

  existingRecord.finalizedAt = null;
  existingRecord.finalizedBy = '';
  existingRecord.attendanceEndReason = '';
  stampRecordHealth(existingRecord);
  await existingRecord.save();
  return existingRecord.toObject();
}

async function finalizeAttendanceForActiveSession(activeSession, endedAt = new Date(), options = {}) {
  if (!activeSession?.lmsId || !activeSession?.classSessionId) {
    return null;
  }

  let record = await AttendanceRecord.findOne({
    lmsId: activeSession.lmsId,
    sessionId: activeSession.classSessionId,
    currentJoinStartedAt: { $ne: null }
  });

  if (!record) {
    const attendanceDate = formatAttendanceDate(activeSession.joinedAt || endedAt);
    record = await AttendanceRecord.findOne({
      lmsId: activeSession.lmsId,
      sessionId: activeSession.classSessionId,
      attendanceDate
    });
  }

  if (!record) {
    return null;
  }

  const endedAtDate = toValidDate(endedAt) || new Date();
  const reason = sanitizeReason(options.reason, 'manual');
  const finalizedBy = String(options.finalizedBy || '').trim();
  const startCandidates = [
    toValidDate(record.currentJoinStartedAt),
    toValidDate(activeSession.joinedAt),
    toValidDate(record.attendedAt),
    toValidDate(record.firstJoinedAt)
  ].filter(Boolean);
  const validStartCandidates = startCandidates.filter((date) => date.getTime() <= endedAtDate.getTime());
  const segmentStart = validStartCandidates.length > 0
    ? validStartCandidates.sort((left, right) => right.getTime() - left.getTime())[0]
    : null;

  if (segmentStart) {
    const rawSegmentMinutes = roundMinutes(endedAtDate.getTime() - segmentStart.getTime());
    const segmentMinutes = Math.min(rawSegmentMinutes, MAX_SINGLE_SEGMENT_MINUTES);
    record.durationMinutes = Math.min(Math.max(Number(record.durationMinutes || 0), 0) + segmentMinutes, MAX_TOTAL_DURATION_MINUTES);
  }

  record.lastSeenAt = endedAtDate;
  record.leftAt = endedAtDate;
  record.currentJoinStartedAt = null;
  record.attendanceEndReason = reason;
  record.finalizedAt = endedAtDate;
  record.finalizedBy = finalizedBy || (reason.startsWith('admin') ? 'admin' : 'system');

  record.segmentHistory = Array.isArray(record.segmentHistory) ? record.segmentHistory : [];
  const openSegment = getLastOpenSegment(record);
  if (openSegment) {
    openSegment.leftAt = endedAtDate;
    openSegment.durationMinutes = Math.min(
      roundMinutes(endedAtDate.getTime() - new Date(openSegment.joinedAt || segmentStart || endedAtDate).getTime()),
      MAX_SINGLE_SEGMENT_MINUTES
    );
    openSegment.endReason = reason;
  } else if (segmentStart) {
    record.segmentHistory.push({
      joinedAt: segmentStart,
      leftAt: endedAtDate,
      durationMinutes: Math.min(roundMinutes(endedAtDate.getTime() - segmentStart.getTime()), MAX_SINGLE_SEGMENT_MINUTES),
      source: record.source || 'session-join',
      endReason: reason
    });
  }

  stampRecordHealth(record);
  await record.save();
  return record.toObject();
}

async function closeAttendanceForActiveSession(activeSession, endedAt = new Date(), options = {}) {
  if (!activeSession?._id || !activeSession?.classSessionId) {
    return null;
  }

  const endedAtDate = toValidDate(endedAt) || new Date();
  await finalizeAttendanceForActiveSession(activeSession, endedAtDate, options);
  await ActiveSession.updateOne(
    { _id: activeSession._id, status: 'active' },
    {
      $set: {
        classSessionId: null,
        meetingNumber: null,
        joinedAt: null,
        attendanceLastSeenAt: null,
        lastSeenAt: endedAtDate
      }
    }
  );

  return endedAtDate;
}

async function endActiveSession(activeSession, endedAt = new Date(), options = {}) {
  if (!activeSession?._id) {
    return null;
  }

  const endedAtDate = toValidDate(endedAt) || new Date();
  await finalizeAttendanceForActiveSession(activeSession, endedAtDate, options);
  await ActiveSession.updateOne(
    { _id: activeSession._id, status: 'active' },
    { $set: { status: 'ended', endedAt: endedAtDate, lastSeenAt: endedAtDate, attendanceLastSeenAt: endedAtDate } }
  );

  return endedAtDate;
}

async function getActiveSessionTerminationContext(activeSession, referenceTime = new Date()) {
  if (!activeSession?.classSessionId) {
    return { shouldTerminate: false, reason: null, endedAt: null, session: null, override: null };
  }

  const referenceDate = toValidDate(referenceTime) || new Date();
  const classSession = await ClassSession.findOne({ sessionId: activeSession.classSessionId })
    .select('sessionId title status')
    .lean();

  if (!classSession) {
    return {
      shouldTerminate: true,
      reason: 'session-missing',
      endedAt: referenceDate,
      session: null,
      override: null
    };
  }

  if (classSession.status === 'off') {
    return {
      shouldTerminate: true,
      reason: 'session-inactive',
      endedAt: referenceDate,
      session: classSession,
      override: null
    };
  }

  const attendanceDate = formatAttendanceDate(activeSession.joinedAt || referenceDate);
  const overrideRecord = await AttendanceWindowOverride.findOne({
    sessionId: activeSession.classSessionId,
    attendanceDate
  })
    .select('sessionId attendanceDate classStartAt classEndAt')
    .lean();

  const overrideEndAt = toValidDate(overrideRecord?.classEndAt);
  if (overrideEndAt && overrideEndAt.getTime() <= referenceDate.getTime()) {
    return {
      shouldTerminate: true,
      reason: 'window_end',
      endedAt: overrideEndAt,
      session: classSession,
      override: overrideRecord
    };
  }

  const attendanceLastSeenAt = toValidDate(activeSession.attendanceLastSeenAt || activeSession.lastSeenAt || activeSession.joinedAt);
  if (attendanceLastSeenAt && referenceDate.getTime() - attendanceLastSeenAt.getTime() > ATTENDANCE_STALE_TIMEOUT_MS) {
    return {
      shouldTerminate: true,
      reason: 'stale',
      endedAt: attendanceLastSeenAt,
      session: classSession,
      override: overrideRecord || null
    };
  }

  return {
    shouldTerminate: false,
    reason: null,
    endedAt: null,
    session: classSession,
    override: overrideRecord || null
  };
}

function shouldPersistHeartbeat(lastSeenAt, seenAt = new Date()) {
  const previous = toValidDate(lastSeenAt);
  const current = toValidDate(seenAt) || new Date();
  return !previous || current.getTime() - previous.getTime() >= HEARTBEAT_WRITE_INTERVAL_MS;
}

async function touchActiveAttendanceHeartbeat(activeSession, seenAt = new Date()) {
  if (!activeSession?._id) {
    return { wrotePortalHeartbeat: false, wroteAttendanceHeartbeat: false };
  }

  const seenAtDate = toValidDate(seenAt) || new Date();
  const writes = { wrotePortalHeartbeat: false, wroteAttendanceHeartbeat: false };
  const sessionUpdate = {};

  if (shouldPersistHeartbeat(activeSession.lastSeenAt, seenAtDate)) {
    sessionUpdate.lastSeenAt = seenAtDate;
    writes.wrotePortalHeartbeat = true;
  }

  if (activeSession.classSessionId && shouldPersistHeartbeat(activeSession.attendanceLastSeenAt || activeSession.lastSeenAt, seenAtDate)) {
    sessionUpdate.attendanceLastSeenAt = seenAtDate;
    writes.wroteAttendanceHeartbeat = true;
  }

  if (Object.keys(sessionUpdate).length > 0) {
    await ActiveSession.updateOne(
      { _id: activeSession._id, status: 'active' },
      { $set: sessionUpdate }
    );
  }

  if (writes.wroteAttendanceHeartbeat) {
    await AttendanceRecord.updateOne(
      {
        lmsId: activeSession.lmsId,
        sessionId: activeSession.classSessionId,
        currentJoinStartedAt: { $ne: null }
      },
      { $set: { lastSeenAt: seenAtDate } }
    );
  }

  return writes;
}

async function reconcileAttendanceRecords({ finalizedBy = 'system-reconcile' } = {}) {
  const repaired = {
    closedAttendanceRecords: 0,
    endedPortalSessions: 0,
    flaggedRecords: 0
  };

  const now = new Date();
  const openRecords = await AttendanceRecord.find({ currentJoinStartedAt: { $ne: null } });
  for (const record of openRecords) {
    const matchingSession = await ActiveSession.findOne({
      status: 'active',
      lmsId: record.lmsId,
      classSessionId: record.sessionId
    });

    if (!matchingSession) {
      const endedAt = toValidDate(record.lastSeenAt) || now;
      record.currentJoinStartedAt = null;
      record.leftAt = endedAt;
      record.finalizedAt = endedAt;
      record.finalizedBy = finalizedBy;
      record.attendanceEndReason = 'reconciled_orphan';
      const openSegment = getLastOpenSegment(record);
      if (openSegment) {
        openSegment.leftAt = endedAt;
        openSegment.durationMinutes = Math.min(roundMinutes(endedAt.getTime() - new Date(openSegment.joinedAt || endedAt).getTime()), MAX_SINGLE_SEGMENT_MINUTES);
        openSegment.endReason = 'reconciled_orphan';
      }
      stampRecordHealth(record);
      await record.save();
      repaired.closedAttendanceRecords += 1;
      continue;
    }

    stampRecordHealth(record);
    if (record.anomalyFlags.length > 0) {
      await record.save();
      repaired.flaggedRecords += 1;
    }
  }

  const stalePortalCutoff = new Date(now.getTime() - PORTAL_STALE_TIMEOUT_MS);
  const stalePortalSessions = await ActiveSession.find({
    status: 'active',
    lastSeenAt: { $lt: stalePortalCutoff }
  });

  for (const session of stalePortalSessions) {
    await endActiveSession(session, session.lastSeenAt || now, { reason: 'portal_stale', finalizedBy });
    repaired.endedPortalSessions += 1;
  }

  return repaired;
}

async function autoFinalizeStaleSessions() {
  try {
    const activeSessions = await ActiveSession.find({ status: 'active' });
    const now = new Date();

    for (const session of activeSessions) {
      try {
        const termination = await getActiveSessionTerminationContext(session, now);
        if (termination.shouldTerminate) {
          await closeAttendanceForActiveSession(
            session,
            termination.endedAt || now,
            { reason: termination.reason, finalizedBy: 'system-auto' }
          );
          console.log(`[Auto-Finalizer] Closed attendance ${termination.reason} for LMS ID: ${session.lmsId}`);
          continue;
        }

        const portalLastSeenAt = toValidDate(session.lastSeenAt);
        if (portalLastSeenAt && now.getTime() - portalLastSeenAt.getTime() > PORTAL_STALE_TIMEOUT_MS) {
          await endActiveSession(session, portalLastSeenAt, { reason: 'portal_stale', finalizedBy: 'system-auto' });
          console.log(`[Auto-Finalizer] Ended stale portal session for LMS ID: ${session.lmsId}`);
        }
      } catch (err) {
        console.error(`[Auto-Finalizer] Error processing session for ${session.lmsId}:`, err.message);
      }
    }

    await reconcileAttendanceRecords({ finalizedBy: 'system-auto' });
  } catch (error) {
    console.error('[Auto-Finalizer] Error fetching stale sessions:', error.message);
  }
}

module.exports = {
  ATTENDANCE_STALE_TIMEOUT_MS,
  HEARTBEAT_WRITE_INTERVAL_MS,
  MAX_SEGMENT_COUNT,
  MAX_SINGLE_SEGMENT_MINUTES,
  MAX_TOTAL_DURATION_MINUTES,
  PORTAL_STALE_TIMEOUT_MS,
  autoFinalizeStaleSessions,
  buildAnomalyFlags,
  closeAttendanceForActiveSession,
  endActiveSession,
  finalizeAttendanceForActiveSession,
  formatAttendanceDate,
  getActiveSessionTerminationContext,
  reconcileAttendanceRecords,
  recordSessionJoin,
  roundMinutes,
  shouldPersistHeartbeat,
  stampRecordHealth,
  touchActiveAttendanceHeartbeat
};
