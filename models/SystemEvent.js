const mongoose = require('mongoose');

const systemEventSchema = new mongoose.Schema(
  {
    event: {
      type: String,
      required: true,
      trim: true,
    },
    meaning: {
      type: String,
      default: '',
      trim: true,
    },
    occurredAt: {
      type: Date,
      required: true,
      index: true,
    },
    eventId: {
      type: Number,
      required: true,
    },
    sourceLog: {
      type: String,
      required: true,
      trim: true,
    },
    provider: {
      type: String,
      default: '',
      trim: true,
    },
    recordNumber: {
      type: Number,
      default: null,
    },
    computer: {
      type: String,
      default: '',
      trim: true,
    },
    user: {
      type: String,
      default: '',
      trim: true,
    },
    message: {
      type: String,
      default: '',
      trim: true,
    },
    externalId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    workSession: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WorkSession',
      default: null,
      index: true,
    },
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      default: null,
    },
    sessionStatus: {
      type: String,
      default: '',
      trim: true,
    },
    deviceState: {
      type: String,
      default: '',
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

systemEventSchema.index({ event: 1, occurredAt: -1 });

module.exports = mongoose.model('SystemEvent', systemEventSchema);
