const mongoose = require('mongoose');

const issueReportSchema = new mongoose.Schema(
  {
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
      default: '',
      trim: true
    },
    description: {
      type: String,
      required: true,
      trim: true
    },
    status: {
      type: String,
      default: 'open',
      index: true
    }
  },
  {
    timestamps: true,
    collection: 'issue_reports'
  }
);

issueReportSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('IssueReport', issueReportSchema);