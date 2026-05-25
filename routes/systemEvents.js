const express = require('express');

const SystemEvent = require('../models/SystemEvent');
const User = require('../models/User');
const WorkSession = require('../models/WorkSession');
const { systemEventBus } = require('../services/systemEventLogger');
const { appendSessionEvent, dateKeyFor } = require('../services/workSessionService');

const router = express.Router();

const ALLOWED_EVENTS = new Set([
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
  'Attendance Marked',
  'Attendance Duplicate',
  'Monitoring Permission Allowed',
  'Monitoring Permission Denied',
]);
const ALLOWED_EVENT_LIST = Array.from(ALLOWED_EVENTS);

const WORKDAY_START_HOUR = 8;
const WORKDAY_END_HOUR = 17;

function requireAdmin(req, res) {
  if (!req.user) {
    res.status(401).json({ success: false, message: 'Authentication required' });
    return false;
  }

  if (req.user?.role === 'admin') {
    return true;
  }

  res.status(403).json({ success: false, message: 'Only admins can access system-wide activity.' });
  return false;
}

function hasValidCollectorToken(req) {
  const configuredToken = process.env.SYSTEM_COLLECTOR_TOKEN || '';
  const providedToken = String(req.headers['x-collector-token'] || req.headers.authorization?.replace(/^Bearer\s+/i, '') || '').trim();
  return Boolean(configuredToken && providedToken && configuredToken === providedToken);
}

function getWorkdayRange(now = new Date()) {
  const start = new Date(now);
  start.setHours(WORKDAY_START_HOUR, 0, 0, 0);

  const end = new Date(now);
  end.setHours(WORKDAY_END_HOUR, 0, 0, 0);

  return {
    start,
    end: now,
    fixedEnd: end,
  };
}

function parseDateQuery(value) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeSystemEvent(rawEvent) {
  if (!rawEvent || typeof rawEvent !== 'object') {
    return null;
  }

  const event = String(rawEvent.event || '').trim();
  const occurredAt = new Date(rawEvent.occurredAt);
  const eventId = Number(rawEvent.eventId);
  const sourceLog = String(rawEvent.sourceLog || '').trim();
  const externalId = String(rawEvent.externalId || '').trim();
  const user = String(rawEvent.user || rawEvent.employeeEmail || '').trim();

  if (
    !ALLOWED_EVENTS.has(event) ||
    Number.isNaN(occurredAt.getTime()) ||
    !Number.isFinite(eventId) ||
    !sourceLog ||
    !externalId
  ) {
    return null;
  }

  return {
    event,
    meaning: String(rawEvent.meaning || '').trim(),
    occurredAt,
    eventId,
    sourceLog,
    provider: String(rawEvent.provider || '').trim(),
    recordNumber: Number.isFinite(Number(rawEvent.recordNumber)) ? Number(rawEvent.recordNumber) : null,
    computer: String(rawEvent.computer || '').trim(),
    user,
    message: String(rawEvent.message || '').trim().slice(0, 2000),
    externalId,
  };
}

function deviceStateForEvent(eventName) {
  const states = {
    Startup: 'Active Working',
    Wakeup: 'Active Working',
    'Active Usage Time': 'Active Working',
    'Idle Time': 'Idle',
    Sleep: 'Sleep Mode',
    Lock: 'Locked',
    Unlock: 'Active Working',
    Shutdown: 'Shutdown',
    'Unexpected Shutdown': 'Shutdown',
    Restart: 'Restart',
    'Device Offline': 'Offline',
    'Device Online': 'Active Working',
    'Monitoring Permission Denied': 'Monitoring Permission Denied',
  };
  return states[eventName] || eventName;
}

router.get('/', async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) {
      return;
    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const mode = String(req.query.mode || '').trim();
    const selectedUser = String(req.query.user || '').trim();
    const workdayRange = getWorkdayRange();
    const from = parseDateQuery(req.query.from) || (mode === 'workday' ? workdayRange.start : null);
    const to = parseDateQuery(req.query.to) || (mode === 'workday' ? workdayRange.end : null);
    const sortDirection = String(req.query.sort || '').toLowerCase() === 'asc' ? 1 : -1;

    const query = {};
    query.event = { $in: ALLOWED_EVENT_LIST };
    if (from || to) {
      query.occurredAt = {};
      if (from) {
        query.occurredAt.$gte = from;
      }
      if (to) {
        query.occurredAt.$lte = to;
      }
    }
    if (selectedUser) {
      query.user = selectedUser;
    }

    const events = await SystemEvent.find(query)
      .sort({ occurredAt: sortDirection })
      .limit(limit)
      .lean();

    res.json({
      success: true,
      events,
      range: {
        start: from,
        end: to,
        workdayEnd: mode === 'workday' ? workdayRange.fixedEnd : null,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/stream', (req, res) => {
  if (!requireAdmin(req, res)) {
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const sendEvent = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  res.write(`event: ready\ndata: ${JSON.stringify({ success: true })}\n\n`);
  systemEventBus.on('created', sendEvent);

  req.on('close', () => {
    systemEventBus.off('created', sendEvent);
    res.end();
  });
});

// Get all unique users and their activity summary
router.get('/users/analytics', async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) {
      return;
    }

    const workdayRange = getWorkdayRange();
    const from = parseDateQuery(req.query.from) || workdayRange.start;
    const to = parseDateQuery(req.query.to) || workdayRange.end;

    const users = await SystemEvent.aggregate([
      {
        $match: {
          occurredAt: {
            $gte: from,
            $lte: to,
          },
          user: { $ne: '', $exists: true },
          event: { $in: ALLOWED_EVENT_LIST },
        },
      },
      {
        $group: {
          _id: '$user',
          totalEvents: { $sum: 1 },
          uniqueEvents: { $addToSet: '$event' },
          lastActivity: { $max: '$occurredAt' },
          firstActivity: { $min: '$occurredAt' },
          eventTypes: {
            $push: {
              event: '$event',
              count: 1,
            },
          },
        },
      },
      {
        $project: {
          user: '$_id',
          totalEvents: 1,
          uniqueEventTypes: { $size: '$uniqueEvents' },
          lastActivity: 1,
          firstActivity: 1,
          accuracy: { $literal: 100 },
          _id: 0,
        },
      },
      { $sort: { totalEvents: -1 } },
    ]);

    res.json({
      success: true,
      users,
      range: { start: from, end: to },
    });
  } catch (error) {
    next(error);
  }
});

// Get detailed activity for a specific user
router.get('/users/:userId/activity', async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) {
      return;
    }

    const userId = String(req.params.userId || '').trim();
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);
    const workdayRange = getWorkdayRange();
    const from = parseDateQuery(req.query.from) || workdayRange.start;
    const to = parseDateQuery(req.query.to) || workdayRange.end;

    const events = await SystemEvent.find({
      user: userId,
      event: { $in: ALLOWED_EVENT_LIST },
      occurredAt: {
        $gte: from,
        $lte: to,
      },
    })
      .sort({ occurredAt: -1 })
      .limit(limit)
      .lean();

    const stats = {
      totalEvents: events.length,
      uniqueEventTypes: new Set(events.map((e) => e.event)).size,
      eventBreakdown: {},
      accuracy: 100,
      user: userId,
    };

    events.forEach((event) => {
      if (!stats.eventBreakdown[event.event]) {
        stats.eventBreakdown[event.event] = 0;
      }
      stats.eventBreakdown[event.event] += 1;
    });

    res.json({
      success: true,
      user: userId,
      events,
      stats,
      range: { start: from, end: to },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/ingest', async (req, res, next) => {
  try {
    const collectorAuthorized = hasValidCollectorToken(req);
    if (!req.user && !collectorAuthorized) {
      return res.status(401).json({ success: false, message: 'Authentication or collector token required' });
    }

    const payloadEvents = Array.isArray(req.body.events) ? req.body.events : [req.body];
    const scopedPayloadEvents = payloadEvents.map((event) => {
      if (collectorAuthorized || req.user?.role === 'admin') {
        return event;
      }

      return {
        ...event,
        user: req.user.name || req.user.email,
      };
    });
    const events = scopedPayloadEvents.map(normalizeSystemEvent).filter(Boolean);

    if (events.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid system events were provided',
      });
    }

    const acceptedEvents = [];

    for (const event of events) {
      const employeeQuery =
        collectorAuthorized || req.user?.role === 'admin'
          ? {
              role: 'employee',
              $or: [{ name: event.user }, { email: event.user }, { email: event.employeeEmail }],
            }
          : {
              _id: req.user._id,
              role: 'employee',
            };

      const employee = await User.findOne(employeeQuery)
        .populate('student')
        .lean();

      if (employee) {
        const session = await WorkSession.findOne({
          user: employee._id,
          dateKey: dateKeyFor(event.occurredAt),
        });

        if (!session || session.status === 'Checked Out') {
          continue;
        }

        if (session.monitoringConsent !== 'Allowed' && !['Monitoring Permission Allowed', 'Monitoring Permission Denied'].includes(event.event)) {
          continue;
        }

        event.employee = employee._id;
        event.student = employee.student?._id || employee.student || null;
        event.workSession = session._id;
        event.sessionStatus = session.status;
        event.deviceState = deviceStateForEvent(event.event);

        await appendSessionEvent(session, {
          type: event.event,
          label: event.message || event.meaning || event.event,
          source: 'collector',
          occurredAt: event.occurredAt,
          deviceState: event.deviceState,
          metadata: {
            eventId: event.eventId,
            computer: event.computer,
            sourceLog: event.sourceLog,
          },
        });
      }

      acceptedEvents.push(event);
    }

    if (acceptedEvents.length === 0) {
      return res.json({
        success: true,
        received: events.length,
        inserted: 0,
        ignored: events.length,
        message: 'Events were ignored because no active work session is open, or the employee already checked out.',
      });
    }

    const result = await SystemEvent.bulkWrite(
      acceptedEvents.map((event) => ({
        updateOne: {
          filter: { externalId: event.externalId },
          update: { $setOnInsert: event },
          upsert: true,
        },
      })),
      { ordered: false }
    );

    res.status(201).json({
      success: true,
      received: events.length,
      accepted: acceptedEvents.length,
      inserted: result.upsertedCount || 0,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
