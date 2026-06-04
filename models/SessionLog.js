const mongoose = require('mongoose');

const sessionLogSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      default: '',
      trim: true,
      index: true
    },
    sessionName: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    date: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    time: {
      type: String,
      required: true,
      trim: true
    },
    userName: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    actionPerformed: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    status: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    remarks: {
      type: String,
      default: '',
      trim: true
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true
    }
  },
  {
    timestamps: false,
    collection: 'session_logs'
  }
);

sessionLogSchema.index({ timestamp: -1 });
sessionLogSchema.index({ sessionName: 1, timestamp: -1 });

module.exports = mongoose.model('SessionLog', sessionLogSchema);
