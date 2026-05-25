const mongoose = require('mongoose');

const loginHistorySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: '',
    },
    role: {
      type: String,
      enum: ['admin', 'employee', 'unknown'],
      default: 'unknown',
    },
    action: {
      type: String,
      enum: ['login', 'logout', 'failed_login'],
      required: true,
    },
    success: {
      type: Boolean,
      required: true,
    },
    ipAddress: {
      type: String,
      default: '',
      trim: true,
    },
    userAgent: {
      type: String,
      default: '',
      trim: true,
    },
    occurredAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

loginHistorySchema.index({ user: 1, occurredAt: -1 });
loginHistorySchema.index({ email: 1, occurredAt: -1 });

module.exports = mongoose.model('LoginHistory', loginHistorySchema);
