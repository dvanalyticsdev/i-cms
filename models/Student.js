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
