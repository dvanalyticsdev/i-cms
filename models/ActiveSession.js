const mongoose = require('mongoose');

/**
 * ActiveSession Model
 * Tracks currently active login sessions
 * Used for preventing duplicate logins and session management
 */
const activeSessionSchema = new mongoose.Schema(
  {
    sessionToken: {
      type: String,
      unique: true,
      required: true,
      index: true
    },
    lmsId: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    phoneNumber: {
      type: String,
      required: false,
      default: null,
      trim: true
    },
    deviceToken: {
      type: String,
      required: true,
      index: true
    },
    // The class session (ClassSession.sessionId) this active login has joined, set when student joins a class
    classSessionId: {
      type: String,
      required: false,
      default: null,
      trim: true,
      index: true
    },
    // Meeting number for convenience (optional)
    meetingNumber: {
      type: String,
      required: false,
      default: null,
      trim: true
    },
    status: {
      type: String,
      enum: ['active', 'ended'],
      default: 'active',
      index: true
    },
    joinedAt: {
      type: Date,
      default: Date.now,
      index: true
    }
  },
  {
    timestamps: true,
    collection: 'active_sessions'
  }
);

// Compound index for efficient queries
activeSessionSchema.index({ lmsId: 1, status: 1 });
activeSessionSchema.index({ deviceToken: 1, status: 1 });

// TTL Index: Automatically delete sessions after 30 days of inactivity
activeSessionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2592000 });

module.exports = mongoose.model('ActiveSession', activeSessionSchema);
