const AttendanceRecord = require('../models/AttendanceRecord');

function roundMinutes(ms) {
  return Math.round((Math.max(ms, 0) / 60000) * 10) / 10;
}

async function recordSessionJoin({
  lmsId,
  studentName,
  phoneNumber,
  course,
  batch,
  sessionId,
  sessionName,
  trainerName,
  attendanceDate,
  source = 'session-join',
  joinedAt = new Date()
}) {
  if (!lmsId || !sessionId) {
    return null;
  }

  const existingRecord = await AttendanceRecord.findOne({ lmsId, sessionId });

  if (!existingRecord) {
    const record = new AttendanceRecord({
      lmsId,
      studentName,
      phoneNumber,
      course,
      batch,
      sessionId,
      sessionName,
      trainerName,
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
  existingRecord.phoneNumber = phoneNumber;
  existingRecord.course = course;
  existingRecord.batch = batch;
  existingRecord.sessionName = sessionName;
  existingRecord.trainerName = trainerName;
  existingRecord.attendanceDate = attendanceDate;
  existingRecord.attendedAt = joinedAt;
  existingRecord.lastSeenAt = joinedAt;
  existingRecord.status = 'present';
  existingRecord.source = source;

  if (!existingRecord.firstJoinedAt) {
    existingRecord.firstJoinedAt = joinedAt;
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

  const record = await AttendanceRecord.findOne({
    lmsId: activeSession.lmsId,
    sessionId: activeSession.classSessionId
  });

  if (!record) {
    return null;
  }

  const currentJoinStartedAt = record.currentJoinStartedAt || activeSession.joinedAt || record.firstJoinedAt;
  if (currentJoinStartedAt) {
    const segmentMinutes = roundMinutes(new Date(endedAt).getTime() - new Date(currentJoinStartedAt).getTime());
    record.durationMinutes = Math.max(Number(record.durationMinutes || 0), 0) + segmentMinutes;
  }

  record.lastSeenAt = endedAt;
  record.leftAt = endedAt;
  record.currentJoinStartedAt = null;
  await record.save();
  return record.toObject();
}

module.exports = {
  finalizeAttendanceForActiveSession,
  recordSessionJoin,
  roundMinutes
};
