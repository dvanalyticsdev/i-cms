const mongoose = require('mongoose');

const attendanceWindowOverrideSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    attendanceDate: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    classStartAt: {
      type: Date,
      required: true
    },
    classEndAt: {
      type: Date,
      required: true
    },
    updatedBy: {
      type: String,
      default: '',
      trim: true
    }
  },
  {
    timestamps: true,
    collection: 'attendance_window_overrides'
  }
);

attendanceWindowOverrideSchema.index(
  { sessionId: 1, attendanceDate: 1 },
  { unique: true }
);

module.exports = mongoose.model('AttendanceWindowOverride', attendanceWindowOverrideSchema);
