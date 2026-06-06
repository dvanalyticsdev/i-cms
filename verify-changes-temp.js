const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mongoose = require('mongoose');
const { ensureMongoConnection } = require('./utils/mongoConnection');
const ActiveSession = require('./models/ActiveSession');
const AttendanceRecord = require('./models/AttendanceRecord');
const { recordSessionJoin, finalizeAttendanceForActiveSession, autoFinalizeStaleSessions } = require('./utils/attendanceTracker');

// Let's run a test simulation
async function runTest() {
  await ensureMongoConnection();
  console.log('Connected to MongoDB');

  // Clear existing test records if any
  await ActiveSession.deleteMany({ lmsId: 'TEST_STUDENT' });
  await AttendanceRecord.deleteMany({ lmsId: 'TEST_STUDENT' });

  // 1. Simulate Join Session on Date A
  const joinedAt = new Date(Date.now() - 3600000); // 1 hour ago
  const dateA = joinedAt.toLocaleDateString('en-CA');
  
  console.log('\n--- Day 1: Student joins ---');
  await recordSessionJoin({
    lmsId: 'TEST_STUDENT',
    studentName: 'Test Student',
    phoneNumber: '1234567890',
    course: 'TEST_COURSE',
    batch: 'TEST_BATCH',
    sessionId: 'TEST_SESSION_1',
    sessionName: 'Test Session',
    trainerName: 'Test Trainer',
    attendanceDate: dateA,
    joinedAt
  });

  const session = new ActiveSession({
    sessionToken: 'TEST_TOKEN',
    lmsId: 'TEST_STUDENT',
    name: 'Test Student',
    phoneNumber: '1234567890',
    deviceToken: 'TEST_DEVICE',
    classSessionId: 'TEST_SESSION_1',
    status: 'active',
    joinedAt
  });
  await session.save();
  console.log('Active Session created:', session);

  let record = await AttendanceRecord.findOne({ lmsId: 'TEST_STUDENT', sessionId: 'TEST_SESSION_1' });
  console.log('Attendance Record created:', record);

  // 2. Simulate Heartbeats
  console.log('\n--- Heartbeat simulates activity ---');
  const heartbeatTime = new Date(joinedAt.getTime() + 1800000); // 30 minutes after join
  session.lastSeenAt = heartbeatTime;
  await session.save();
  
  record.lastSeenAt = heartbeatTime;
  await record.save();
  console.log('Heartbeat updated lastSeenAt to:', heartbeatTime);

  // 3. Simulate Stale Session Cleanup (Auto-Finalization)
  console.log('\n--- Running Auto-Finalizer (Student went offline) ---');
  // Since student went offline 30 minutes ago, their session is stale.
  await autoFinalizeStaleSessions(120000); // threshold 2 mins

  const finalizedSession = await ActiveSession.findOne({ lmsId: 'TEST_STUDENT' });
  console.log('Finalized ActiveSession status:', finalizedSession.status, 'endedAt:', finalizedSession.endedAt);

  const finalizedRecord = await AttendanceRecord.findOne({ lmsId: 'TEST_STUDENT', sessionId: 'TEST_SESSION_1' });
  console.log('Finalized AttendanceRecord durationMinutes (expected ~30 mins):', finalizedRecord.durationMinutes);
  console.log('Finalized AttendanceRecord currentJoinStartedAt (expected null):', finalizedRecord.currentJoinStartedAt);

  // 4. Simulate Rejoin on Same Session, Different Date (e.g. tomorrow)
  console.log('\n--- Day 2: Student rejoins same session tomorrow ---');
  const rejoinTime = new Date(Date.now() + 86400000); // tomorrow
  const dateB = rejoinTime.toLocaleDateString('en-CA');

  await recordSessionJoin({
    lmsId: 'TEST_STUDENT',
    studentName: 'Test Student',
    phoneNumber: '1234567890',
    course: 'TEST_COURSE',
    batch: 'TEST_BATCH',
    sessionId: 'TEST_SESSION_1',
    sessionName: 'Test Session',
    trainerName: 'Test Trainer',
    attendanceDate: dateB,
    joinedAt: rejoinTime
  });

  // Check how many AttendanceRecords exist now
  const allRecords = await AttendanceRecord.find({ lmsId: 'TEST_STUDENT', sessionId: 'TEST_SESSION_1' });
  console.log('Total Attendance Records found (expected 2):', allRecords.length);
  allRecords.forEach(r => {
    console.log(`- Date: ${r.attendanceDate}, duration: ${r.durationMinutes}m, currentJoinStartedAt: ${r.currentJoinStartedAt}`);
  });

  // Clean up
  await ActiveSession.deleteMany({ lmsId: 'TEST_STUDENT' });
  await AttendanceRecord.deleteMany({ lmsId: 'TEST_STUDENT' });
  console.log('\nCleaned up test data.');
  
  await mongoose.connection.close();
  console.log('Done');
}

runTest().catch(console.error);
