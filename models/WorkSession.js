const mongoose = require('mongoose');

const activityEventSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      trim: true,
    },
    label: {
      type: String,
      default: '',
      trim: true,
    },
    occurredAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    source: {
      type: String,
      enum: ['attendance', 'employee', 'collector', 'auth', 'system'],
      default: 'system',
    },
    deviceState: {
      type: String,
      default: '',
      trim: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { _id: false }
);

const workSessionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      default: null,
      index: true,
    },
    attendance: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Attendance',
      default: null,
    },
    employeeName: {
      type: String,
      required: true,
      trim: true,
    },
    faceLabel: {
      type: String,
      default: '',
      trim: true,
    },
    dateKey: {
      type: String,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['Active', 'Idle', 'Sleep Mode', 'Locked', 'Checked Out', 'Offline', 'Incomplete', 'Monitoring Permission Denied'],
      default: 'Active',
      index: true,
    },
    deviceState: {
      type: String,
      default: 'Online',
      trim: true,
    },
    startedAt: {
      type: Date,
      required: true,
    },
    attendanceTime: {
      type: Date,
      default: null,
    },
    checkoutAt: {
      type: Date,
      default: null,
    },
    checkoutNote: {
      type: String,
      default: '',
      trim: true,
      maxlength: 2000,
    },
    monitoringConsent: {
      type: String,
      enum: ['Pending', 'Allowed', 'Denied'],
      default: 'Pending',
      index: true,
    },
    monitoringConsentAt: {
      type: Date,
      default: null,
    },
    lastActivityAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    totalActiveSeconds: {
      type: Number,
      default: 0,
    },
    totalIdleSeconds: {
      type: Number,
      default: 0,
    },
    totalBreakSeconds: {
      type: Number,
      default: 0,
    },
    productivityScore: {
      type: Number,
      default: 0,
    },
    incompleteReason: {
      type: String,
      default: '',
      trim: true,
    },
    deviceInfo: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    events: {
      type: [activityEventSchema],
      default: [],
    },
  },
  { timestamps: true }
);

workSessionSchema.index({ user: 1, dateKey: 1 }, { unique: true });
workSessionSchema.index({ status: 1, lastActivityAt: -1 });

workSessionSchema.pre('validate', function normalizeLegacyEventSources() {
  if (this.status === 'Break') {
    this.status = 'Locked';
  }

  if (Array.isArray(this.events)) {
    this.events.forEach((event) => {
      if (event?.source === 'browser') {
        event.source = 'employee';
      }
    });
  }
});

module.exports = mongoose.model('WorkSession', workSessionSchema);
