const mongoose = require('mongoose');

const attendanceRecordSchema = new mongoose.Schema(
  {
    lmsId: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    studentName: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    phoneNumber: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    course: {
      type: String,
      default: '',
      trim: true,
      index: true
    },
    batch: {
      type: String,
      default: '',
      trim: true,
      index: true
    },
    sessionId: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    sessionName: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    trainerName: {
      type: String,
      default: '',
      trim: true,
      index: true
    },
    attendanceDate: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    attendedAt: {
      type: Date,
      default: Date.now,
      index: true
    },
    firstJoinedAt: {
      type: Date,
      default: null,
      index: true
    },
    currentJoinStartedAt: {
      type: Date,
      default: null,
      index: true
    },
    lastSeenAt: {
      type: Date,
      default: null,
      index: true
    },
    leftAt: {
      type: Date,
      default: null,
      index: true
    },
    durationMinutes: {
      type: Number,
      default: 0
    },
    sessionSegments: {
      type: Number,
      default: 0
    },
    status: {
      type: String,
      enum: ['present', 'absent'],
      default: 'present',
      index: true
    },
    source: {
      type: String,
      default: 'session-join',
      trim: true
    }
  },
  {
    timestamps: true,
    collection: 'attendance_records'
  }
);

attendanceRecordSchema.index({ lmsId: 1, sessionId: 1, attendanceDate: 1 }, { unique: true });
attendanceRecordSchema.index({ attendanceDate: 1, course: 1, batch: 1, sessionId: 1 });
attendanceRecordSchema.index({ trainerName: 1, sessionId: 1 });

module.exports = mongoose.model('AttendanceRecord', attendanceRecordSchema);
