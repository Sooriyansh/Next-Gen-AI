const mongoose = require('mongoose');

const faceRecognitionLogSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      default: null,
    },
    faceLabel: {
      type: String,
      trim: true,
      default: '',
    },
    recognized: {
      type: Boolean,
      default: false,
    },
    confidence: {
      type: Number,
      default: 0,
    },
    matchMargin: {
      type: Number,
      default: 0,
    },
    message: {
      type: String,
      trim: true,
      default: '',
    },
    scannedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

faceRecognitionLogSchema.index({ student: 1, scannedAt: -1 });
faceRecognitionLogSchema.index({ recognized: 1, scannedAt: -1 });

module.exports = mongoose.model('FaceRecognitionLog', faceRecognitionLogSchema);
