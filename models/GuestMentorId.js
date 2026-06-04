const mongoose = require('mongoose');

const guestMentorIdSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true
    },
    type: {
      type: String,
      required: true,
      enum: ['guest', 'mentor', 'mock-interview'],
      index: true
    },
    status: {
      type: String,
      enum: ['Available', 'Active'],
      default: 'Available'
    },
    assignedName: {
      type: String,
      default: null,
      trim: true
    },
    phoneNumber: {
      type: String,
      default: null,
      trim: true
    },
    course: {
      type: String,
      default: null,
      trim: true
    }
  },
  {
    timestamps: true,
    collection: 'guest_mentor_ids'
  }
);

module.exports = mongoose.model('GuestMentorId', guestMentorIdSchema);
