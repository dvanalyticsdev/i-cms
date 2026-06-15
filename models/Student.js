const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema(
  {
    lmsId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    mobile: {
      type: String,
      default: '',
      trim: true,
      index: true
    },
    emailId: {
      type: String,
      default: '',
      trim: true,
      lowercase: true
    },
    batch: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    course: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    year: {
      type: String,
      default: '',
      trim: true,
      index: true
    },
    paymentStatus: {
      type: String,
      enum: ['FULLY PAID', 'PENDING', 'DEFAULT'],
      default: 'DEFAULT',
      trim: true,
      index: true
    },
    feeStatusException: {
      type: Boolean,
      default: false,
      index: true
    }
  },
  {
    timestamps: true,
    collection: 'students'
  }
);

module.exports = mongoose.model('Student', studentSchema);
