const mongoose = require('mongoose');

/**
 * ClassSession Model
 * Stores Zoom class session information
 * Used for dynamic session management and meeting configuration
 */
const classSessionSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      unique: true,
      required: true,
      index: true
    },
    title: {
      type: String,
      required: true,
      trim: true
    },
    meetingNumber: {
      type: String,
      required: true,
      trim: true
    },
    passcode: {
      type: String,
      required: true,
      trim: true
    },
    status: {
      type: String,
      enum: ['on', 'off'],
      default: 'on',
      index: true
    },
    createdBy: {
      type: String,
      required: true
    },
    description: {
      type: String,
      trim: true,
      default: ''
    },
    mentorName: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    className: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    batch: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    batches: {
      type: [String],
      default: []
    },
    courses: {
      type: [String],
      default: [],
      index: true
    }
  },
  {
    timestamps: true, // Automatically adds createdAt and updatedAt fields
    collection: 'class_sessions'
  }
);

// Index for efficient queries
classSessionSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('ClassSession', classSessionSchema);
