const { EventEmitter } = require('events');

const SystemEvent = require('../models/SystemEvent');

const systemEventBus = new EventEmitter();

const ATTENDANCE_EVENT_IDS = {
  marked: 9101,
  duplicate: 9102,
};

function getStudentName(student, fallbackLabel) {
  return student?.name || fallbackLabel || 'Unknown Student';
}

function formatLocation(location) {
  if (!location || location.latitude == null || location.longitude == null) {
    return 'Location not captured';
  }

  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  const accuracy = Number(location.accuracy || 0);
  const accuracyText = accuracy ? `, accuracy +/- ${Math.round(accuracy)}m` : '';
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}${accuracyText}`;
}

async function createSystemEvent(eventPayload) {
  try {
    const event = await SystemEvent.create(eventPayload);
    systemEventBus.emit('created', event.toObject());
    return event;
  } catch (error) {
    if (error.code === 11000) {
      return SystemEvent.findOne({ externalId: eventPayload.externalId });
    }

    throw error;
  }
}

async function logAttendanceActivity({ type, student, record, faceLabel, confidence = 0, location }) {
  const occurredAt = new Date();
  const studentName = getStudentName(student || record?.student, faceLabel || record?.faceLabel);
  const label = faceLabel || record?.faceLabel || student?.faceLabel || '';
  const event = type === 'duplicate' ? 'Attendance Duplicate' : 'Attendance Marked';
  const eventId = type === 'duplicate' ? ATTENDANCE_EVENT_IDS.duplicate : ATTENDANCE_EVENT_IDS.marked;
  const recordId = record?._id ? String(record._id) : `${label}-${occurredAt.getTime()}`;
  const externalId =
    type === 'duplicate'
      ? `attendance:${recordId}:duplicate:${occurredAt.getTime()}`
      : `attendance:${recordId}:marked`;

  return createSystemEvent({
    event,
    meaning:
      type === 'duplicate'
        ? 'Student tried to mark attendance again after it was already recorded.'
        : 'Student attendance was marked successfully by face recognition.',
    occurredAt,
    eventId,
    sourceLog: 'Attendance',
    provider: 'FaceAI Attendance',
    recordNumber: null,
    computer: '',
    user: studentName,
    message: [
      `Student: ${studentName}`,
      `Face label: ${label || '-'}`,
      `Status: ${record?.status || 'Present'}`,
      `Confidence: ${Number(confidence || record?.confidence || 0).toFixed(4)}`,
      `Marked at: ${record?.markedAt ? new Date(record.markedAt).toLocaleString() : occurredAt.toLocaleString()}`,
      `Location: ${formatLocation(location || record?.location)}`,
    ].join(' | '),
    externalId,
  });
}

module.exports = {
  logAttendanceActivity,
  systemEventBus,
};
