const { EventEmitter } = require('events');

const Attendance = require('../models/Attendance');
const SystemEvent = require('../models/SystemEvent');
const User = require('../models/User');
const WorkSession = require('../models/WorkSession');
const { systemEventBus } = require('./systemEventLogger');

const workSessionBus = new EventEmitter();
const WORKDAY_START_HOUR = 8;
const IDLE_AFTER_MS = 5 * 60 * 1000;
const PUBLIC_DEVICE_EVENT_TYPES = new Set([
  'Attendance Started',
  'Attendance Marked',
  'Attendance Duplicate',
  'Monitoring Permission Allowed',
  'Monitoring Permission Denied',
  'Startup',
  'Shutdown',
  'Unexpected Shutdown',
  'Restart',
  'Sleep',
  'Wakeup',
  'Lock',
  'Unlock',
  'Idle Time',
  'Active Usage Time',
  'Device Offline',
  'Device Online',
  'Internet Connected',
  'Internet Disconnected',
  'Battery Status',
  'Check-Out Completed',
]);

function dateKeyFor(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function workdayStartFor(date = new Date()) {
  const start = new Date(date);
  start.setHours(WORKDAY_START_HOUR, 0, 0, 0);
  return start;
}

function isAfterWorkdayStart(date = new Date()) {
  return date >= workdayStartFor(date);
}

function secondsBetween(from, to) {
  const start = new Date(from || to).getTime();
  const end = new Date(to).getTime();
  return Math.max(0, Math.round((end - start) / 1000));
}

function calculateProductivityScore(session) {
  const active = Number(session.totalActiveSeconds || 0);
  const idle = Number(session.totalIdleSeconds || 0);
  const total = active + idle;
  if (!total) {
    return session.status === 'Checked Out' ? 100 : 0;
  }
  return Math.max(0, Math.min(100, Math.round((active / total) * 100)));
}

function publicSession(session) {
  if (!session) {
    return null;
  }

  const data = typeof session.toObject === 'function' ? session.toObject() : session;
  return {
    ...data,
    events: Array.isArray(data.events) ? data.events.filter((event) => PUBLIC_DEVICE_EVENT_TYPES.has(event.type)) : [],
    productivityScore: calculateProductivityScore(data),
  };
}

async function emitSession(session) {
  const fresh = await WorkSession.findById(session._id).populate('user').populate('student').lean();
  workSessionBus.emit('updated', publicSession(fresh));
  return fresh;
}

async function createSystemWorkEvent(session, { type, label, source = 'system', occurredAt = new Date(), deviceState = '', metadata = {} }) {
  const externalSuffix = `${session._id}:${type}:${new Date(occurredAt).getTime()}:${Math.random().toString(36).slice(2, 8)}`;
  const event = await SystemEvent.create({
    event: type,
    meaning: label || type,
    occurredAt,
    eventId: Number(metadata.eventId) || 9300,
    sourceLog: source === 'collector' ? 'Device Collector' : 'Work Session',
    provider: 'Smart Work Session',
    recordNumber: null,
    computer: metadata.computer || metadata.hostname || '',
    user: session.employeeName,
    message: label || type,
    externalId: `work-session:${externalSuffix}`,
    workSession: session._id,
    sessionStatus: session.status,
    deviceState: deviceState || session.deviceState,
    employee: session.user,
    student: session.student || null,
  });
  systemEventBus.emit('created', event.toObject());
  return event;
}

async function appendSessionEvent(session, eventPayload) {
  const occurredAt = eventPayload.occurredAt ? new Date(eventPayload.occurredAt) : new Date();
  const current = await WorkSession.findById(session._id);
  if (!current || current.status === 'Checked Out') {
    return current;
  }

  const delta = secondsBetween(current.lastActivityAt || current.startedAt, occurredAt);
  const type = String(eventPayload.type || 'Activity').trim();
  const lowerType = type.toLowerCase();
  let nextStatus = current.status === 'Incomplete' ? 'Incomplete' : 'Active';
  if (type === 'Idle Time') {
    nextStatus = 'Idle';
  } else if (type === 'Monitoring Permission Denied') {
    nextStatus = 'Monitoring Permission Denied';
  } else if (lowerType.includes('sleep')) {
    nextStatus = 'Sleep Mode';
  } else if (lowerType.includes('lock')) {
    nextStatus = 'Locked';
  } else if (lowerType.includes('shutdown') || lowerType.includes('restart') || lowerType === 'logout') {
    nextStatus = 'Incomplete';
    current.incompleteReason = `${type} before checkout`;
  }

  if (current.status === 'Idle') {
    current.totalIdleSeconds += delta;
  } else if (current.status === 'Sleep Mode' || current.status === 'Locked') {
    current.totalBreakSeconds += delta;
  } else {
    current.totalActiveSeconds += delta;
  }

  current.events.push({
    type,
    label: String(eventPayload.label || type).trim(),
    occurredAt,
    source: eventPayload.source || 'system',
    deviceState: eventPayload.deviceState || current.deviceState,
    metadata: eventPayload.metadata || {},
  });
  current.status = nextStatus;
  current.deviceState = eventPayload.deviceState || current.deviceState || 'Online';
  current.lastActivityAt = occurredAt;
  current.productivityScore = calculateProductivityScore(current);
  await current.save();

  await createSystemWorkEvent(current, {
    ...eventPayload,
    occurredAt,
    type,
    label: eventPayload.label || type,
  });

  await emitSession(current);
  return current;
}

async function startOrResumeSession({ user, student = null, attendance = null, reason = 'Attendance Started', source = 'attendance', deviceInfo = {} }) {
  const now = new Date();
  const dateKey = dateKeyFor(now);
  let userId = user?._id || user;
  if (!userId && student) {
    const owner = await User.findOne({ role: 'employee', student: student._id || student });
    userId = owner?._id || null;
    user = owner || user;
  }
  if (!userId) {
    return null;
  }

  const currentUser = user?.name ? user : await User.findById(userId).populate('student');
  const linkedStudent = student || currentUser?.student || null;
  const existing = await WorkSession.findOne({ user: userId, dateKey });

  if (existing?.status === 'Checked Out') {
    return existing;
  }

  if (existing) {
    existing.status = existing.status === 'Incomplete' ? 'Incomplete' : 'Active';
    existing.deviceState = 'Online';
    existing.lastActivityAt = now;
    existing.deviceInfo = { ...existing.deviceInfo, ...deviceInfo };
    if (attendance && !existing.attendance) {
      existing.attendance = attendance._id || attendance;
      existing.attendanceTime = attendance.markedAt || now;
    }
    await existing.save();
    await appendSessionEvent(existing, {
      type: reason,
      label: `${reason} - monitoring active`,
      source,
      deviceState: 'Online',
      metadata: { trigger: source },
    });
    return existing;
  }

  const session = await WorkSession.create({
    user: userId,
    student: linkedStudent?._id || linkedStudent || null,
    attendance: attendance?._id || attendance || null,
    employeeName: currentUser?.name || linkedStudent?.name || 'Employee',
    faceLabel: linkedStudent?.faceLabel || '',
    dateKey,
    status: 'Active',
    deviceState: 'Online',
    monitoringConsent: 'Pending',
    startedAt: now,
    attendanceTime: attendance?.markedAt || (source === 'attendance' ? now : null),
    lastActivityAt: now,
    deviceInfo,
  });

  await appendSessionEvent(session, {
    type: reason,
    label: `${reason} - tracking session started`,
    source,
    deviceState: 'Online',
    metadata: { trigger: source },
  });

  return session;
}

async function startAfterLoginIfAllowed(user, req) {
  if (!user || user.role !== 'employee' || !isAfterWorkdayStart()) {
    return null;
  }

  return startOrResumeSession({
    user,
    student: user.student || null,
    reason: 'Login',
    source: 'auth',
    deviceInfo: {
      userAgent: req?.headers?.['user-agent'] || '',
      ipAddress: req?.ip || req?.socket?.remoteAddress || '',
    },
  });
}

async function completeSession({ user, note }) {
  const dateKey = dateKeyFor();
  const session = await WorkSession.findOne({ user: user._id || user, dateKey });
  if (!session) {
    throw new Error('No active work session found for today.');
  }
  if (session.status === 'Checked Out') {
    return session;
  }

  const now = new Date();
  session.totalActiveSeconds += secondsBetween(session.lastActivityAt || session.startedAt, now);
  session.status = 'Checked Out';
  session.deviceState = 'Checked Out';
  session.checkoutAt = now;
  session.checkoutNote = String(note || '').trim();
  session.lastActivityAt = now;
  session.productivityScore = calculateProductivityScore(session);
  session.events.push({
    type: 'Check-Out Completed',
    label: session.checkoutNote,
    occurredAt: now,
    source: 'employee',
    deviceState: 'Checked Out',
    metadata: {},
  });
  await session.save();

  if (session.attendance) {
    await Attendance.findByIdAndUpdate(session.attendance, { checkOutAt: now });
  } else if (session.student) {
    await Attendance.findOneAndUpdate({ student: session.student, dateKey }, { checkOutAt: now });
  }

  await createSystemWorkEvent(session, {
    type: 'Check-Out Completed',
    label: session.checkoutNote || 'Daily task completed.',
    source: 'employee',
    occurredAt: now,
    deviceState: 'Checked Out',
  });
  await emitSession(session);
  return session;
}

async function markIncompleteSessions() {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - IDLE_AFTER_MS);
  const sessions = await WorkSession.find({
    dateKey: dateKeyFor(now),
    status: { $nin: ['Checked Out', 'Incomplete'] },
    lastActivityAt: { $lt: staleBefore },
  });

  await Promise.all(
    sessions.map(async (session) => {
      session.status = 'Idle';
      session.deviceState = 'Idle';
      session.productivityScore = calculateProductivityScore(session);
      await session.save();
      await emitSession(session);
    })
  );
}

module.exports = {
  appendSessionEvent,
  completeSession,
  dateKeyFor,
  markIncompleteSessions,
  publicSession,
  startAfterLoginIfAllowed,
  startOrResumeSession,
  workSessionBus,
};
