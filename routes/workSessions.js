const express = require('express');

const User = require('../models/User');
const WorkSession = require('../models/WorkSession');
const {
  appendSessionEvent,
  completeSession,
  dateKeyFor,
  markIncompleteSessions,
  publicSession,
  startAfterLoginIfAllowed,
  workSessionBus,
} = require('../services/workSessionService');

const router = express.Router();

function employeeSessionQuery(req) {
  return req.user.role === 'admin' ? {} : { user: req.user._id };
}

function offlineSessionFor(employee, dateKey) {
  return {
    _id: `offline-${employee._id}`,
    user: employee,
    student: employee.student || null,
    employeeName: employee.name,
    faceLabel: employee.student?.faceLabel || '',
    dateKey,
    status: 'Offline',
    deviceState: 'Offline',
    startedAt: null,
    attendanceTime: null,
    checkoutAt: null,
    lastActivityAt: employee.lastLoginAt || employee.updatedAt,
    totalActiveSeconds: 0,
    totalIdleSeconds: 0,
    totalBreakSeconds: 0,
    productivityScore: 0,
    events: [],
  };
}

router.get('/today', async (req, res, next) => {
  try {
    await markIncompleteSessions();
    if (req.user.role === 'employee') {
      await startAfterLoginIfAllowed(req.user, req);
    }

    const session = await WorkSession.findOne({
      ...employeeSessionQuery(req),
      dateKey: dateKeyFor(),
      ...(req.user.role === 'admin' ? {} : { user: req.user._id }),
    })
      .populate('user')
      .populate('student')
      .lean();

    res.json({ success: true, session: publicSession(session) });
  } catch (error) {
    next(error);
  }
});

router.get('/live', async (req, res, next) => {
  try {
    await markIncompleteSessions();
    const todayKey = dateKeyFor();
    const sessions = await WorkSession.find({
      ...employeeSessionQuery(req),
      dateKey: todayKey,
    })
      .sort({ lastActivityAt: -1 })
      .populate('user')
      .populate('student')
      .lean();

    if (req.user.role !== 'admin') {
      return res.json({ success: true, sessions: sessions.map(publicSession) });
    }

    const employees = await User.find({ role: 'employee' }).sort({ name: 1 }).populate('student').lean();
    const sessionByUser = new Map(sessions.map((session) => [String(session.user?._id || session.user), session]));
    const liveSessions = employees.map((employee) => publicSession(sessionByUser.get(String(employee._id)) || offlineSessionFor(employee, todayKey)));

    res.json({ success: true, sessions: liveSessions });
  } catch (error) {
    next(error);
  }
});

router.post('/activity', async (req, res, next) => {
  try {
    if (req.user.role !== 'employee') {
      return res.status(403).json({ success: false, message: 'Only employees can publish activity events.' });
    }

    const session = await WorkSession.findOne({ user: req.user._id, dateKey: dateKeyFor() });
    if (!session || session.status === 'Checked Out') {
      return res.json({ success: true, tracking: false, message: 'No active tracking session for today.' });
    }

    const eventType = String(req.body.type || 'Active Usage Time').trim().slice(0, 80);
    const allowedEmployeeEvents = new Set(['Monitoring Permission Allowed', 'Monitoring Permission Denied']);
    if (!allowedEmployeeEvents.has(eventType)) {
      return res.status(400).json({ success: false, message: 'Only monitoring permission events can be submitted from the web dashboard.' });
    }

    if (eventType === 'Monitoring Permission Allowed') {
      session.monitoringConsent = 'Allowed';
      session.monitoringConsentAt = new Date();
      session.deviceState = 'Active Working';
      session.status = 'Active';
      await session.save();
    } else if (eventType === 'Monitoring Permission Denied') {
      session.monitoringConsent = 'Denied';
      session.monitoringConsentAt = new Date();
      session.deviceState = 'Monitoring Permission Denied';
      session.status = 'Monitoring Permission Denied';
      await session.save();
    }

    const label = String(req.body.label || eventType).trim().slice(0, 500);
    const updated = await appendSessionEvent(session, {
      type: eventType,
      label,
      source: 'employee',
      deviceState: String(req.body.deviceState || session.deviceState || 'Online').trim().slice(0, 80),
      metadata: {
        consent: session.monitoringConsent,
      },
    });

    res.json({ success: true, tracking: true, session: publicSession(updated) });
  } catch (error) {
    next(error);
  }
});

router.post('/checkout', async (req, res, next) => {
  try {
    if (req.user.role !== 'employee') {
      return res.status(403).json({ success: false, message: 'Only employees can complete their own work session.' });
    }

    const note = String(req.body.note || '').trim();
    if (note.length < 8) {
      return res.status(400).json({ success: false, message: 'Please enter what work you completed today.' });
    }

    const session = await completeSession({ user: req.user, note });
    res.json({
      success: true,
      message: "Today's work session completed successfully.",
      session: publicSession(session),
    });
  } catch (error) {
    next(error);
  }
});

router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const sendSession = (session) => {
    if (req.user.role !== 'admin' && String(session.user?._id || session.user) !== String(req.user._id)) {
      return;
    }
    res.write(`data: ${JSON.stringify(session)}\n\n`);
  };

  res.write(`event: ready\ndata: ${JSON.stringify({ success: true })}\n\n`);
  workSessionBus.on('updated', sendSession);

  req.on('close', () => {
    workSessionBus.off('updated', sendSession);
    res.end();
  });
});

module.exports = router;
