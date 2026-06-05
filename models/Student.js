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
    phoneNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true
    },
    batch: {
      type: String,
      default: '',
      trim: true,
      index: true
    },
    course: {
      type: [String],
      default: []
    }
  },
  {
    timestamps: true,
    collection: 'students'
  }
);

module.exports = mongoose.model('Student', studentSchema);
