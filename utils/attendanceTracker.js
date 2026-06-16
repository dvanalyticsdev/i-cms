const AttendanceRecord = require('../models/AttendanceRecord');
const ActiveSession = require('../models/ActiveSession');

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

  // Find record for this specific day to support daily attendance records
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
      attendedAt: joinedAt,
      firstJoinedAt: joinedAt,
      currentJoinStartedAt: joinedAt,
      lastSeenAt: joinedAt,
      leftAt: null,
      durationMinutes: 0,
      sessionSegments: 1,
      status: 'present',
      source
    });

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
  existingRecord.lastSeenAt = joinedAt;
  existingRecord.status = 'present';
  existingRecord.source = source;

  if (!existingRecord.firstJoinedAt) {
    existingRecord.firstJoinedAt = joinedAt;
  }

  if (!existingRecord.attendedAt) {
    existingRecord.attendedAt = existingRecord.firstJoinedAt || joinedAt;
  }

  if (!existingRecord.currentJoinStartedAt) {
    existingRecord.currentJoinStartedAt = joinedAt;
    existingRecord.leftAt = null;
    existingRecord.sessionSegments = Math.max(Number(existingRecord.sessionSegments || 0), 0) + 1;
  }

  await existingRecord.save();
  return existingRecord.toObject();
}

async function finalizeAttendanceForActiveSession(activeSession, endedAt = new Date()) {
  if (!activeSession?.lmsId || !activeSession?.classSessionId) {
    return null;
  }

  // Look for the record where currentJoinStartedAt is active (not null)
  let record = await AttendanceRecord.findOne({
    lmsId: activeSession.lmsId,
    sessionId: activeSession.classSessionId,
    currentJoinStartedAt: { $ne: null }
  });

  // Fallback: lookup by date of the session's join timestamp
  if (!record) {
    const attendanceDate = new Date(activeSession.joinedAt || endedAt).toLocaleDateString('en-CA');
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
    const segmentMinutes = roundMinutes(endedAtDate.getTime() - segmentStart.getTime());
    record.durationMinutes = Math.max(Number(record.durationMinutes || 0), 0) + segmentMinutes;
  }

  record.lastSeenAt = endedAtDate;
  record.leftAt = endedAtDate;
  record.currentJoinStartedAt = null;
  await record.save();
  return record.toObject();
}

async function autoFinalizeStaleSessions(timeoutMs = 120000) { // Default 2 minutes
  const cutoffTime = new Date(Date.now() - timeoutMs);

  try {
    // Find all active sessions that haven't sent a heartbeat recently
    const staleSessions = await ActiveSession.find({
      status: 'active',
      lastSeenAt: { $lt: cutoffTime }
    });

    for (const session of staleSessions) {
      try {
        const endedAt = session.lastSeenAt || session.joinedAt || new Date();
        await finalizeAttendanceForActiveSession(session, endedAt);
        
        session.status = 'ended';
        session.endedAt = endedAt;
        await session.save();
        
        console.log(`[Auto-Finalizer] Finalized stale session for LMS ID: ${session.lmsId}`);
      } catch (err) {
        console.error(`[Auto-Finalizer] Error finalizing stale session for ${session.lmsId}:`, err.message);
      }
    }
  } catch (error) {
    console.error('[Auto-Finalizer] Error fetching stale sessions:', error.message);
  }
}

module.exports = {
  finalizeAttendanceForActiveSession,
  recordSessionJoin,
  roundMinutes,
  autoFinalizeStaleSessions
};
