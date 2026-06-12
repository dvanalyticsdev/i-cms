const mongoose = require('mongoose');

const classAccessRuleSchema = new mongoose.Schema(
  {
    course: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    paymentStatus: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    accessMap: {
      type: Map,
      of: Boolean,
      default: {}
    },
    source: {
      type: String,
      default: 'manual',
      trim: true
    }
  },
  {
    timestamps: true,
    collection: 'class_access_rules'
  }
);

classAccessRuleSchema.index({ course: 1, paymentStatus: 1 }, { unique: true });

module.exports = mongoose.model('ClassAccessRule', classAccessRuleSchema);
