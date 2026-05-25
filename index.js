require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');

const authRoutes = require('./routes/auth');
const attendanceRoutes = require('./routes/attendance');
const reportRoutes = require('./routes/reports');
const studentRoutes = require('./routes/students');
const systemEventRoutes = require('./routes/systemEvents');
const workSessionRoutes = require('./routes/workSessions');
const Attendance = require('./models/Attendance');
const FaceRecognitionLog = require('./models/FaceRecognitionLog');
const Student = require('./models/Student');
const SystemEvent = require('./models/SystemEvent');
const User = require('./models/User');
const WorkSession = require('./models/WorkSession');
const { authContext, requireAuth, requireRole } = require('./services/auth');
const { DATASET_ROOT } = require('./services/faceModel');
const { dateKeyFor, publicSession } = require('./services/workSessionService');

const app = express();
const PORT = process.env.PORT || 8080;
const MONGO_URI= "mongodb+srv://mahakalkheti:oI7inIFpRPh1pNrz@cluster0.m0ab8.mongodb.net/faceAttendance?retryWrites=true&w=majority";
// const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/faceAttendance';

mongoose
  .connect(MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch((error) => console.error('MongoDB connection error:', error.message));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/local-dataset', express.static(DATASET_ROOT));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(authContext);
app.use((req, res, next) => {
  res.locals.studentCount = 0;
  res.locals.todayAttendanceCount = 0;
  res.locals.recentAttendance = [];
  res.locals.students = [];
  res.locals.records = [];
  res.locals.currentRole = req.user?.role || 'guest';
  next();
});

app.get('/', (req, res) => {
  if (!req.user) {
    return res.redirect('/login');
  }
  res.redirect(req.user.role === 'admin' ? '/admin' : '/employee');
});

app.use(authRoutes);

app.get('/admin', requireRole('admin'), async (req, res, next) => {
  try {
    const todayKey = new Date().toISOString().slice(0, 10);
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [
      studentCount,
      todayAttendanceCount,
      monthlyAttendanceCount,
      recentAttendance,
      students,
      faceRecognitionLogs,
      employees,
      liveWorkSessions,
    ] = await Promise.all([
      Student.countDocuments(),
      Attendance.countDocuments({ dateKey: todayKey }),
      Attendance.countDocuments({ markedAt: { $gte: monthStart } }),
      Attendance.find()
        .sort({ markedAt: -1 })
        .limit(12)
        .populate('student')
        .lean(),
      Student.find().sort({ createdAt: -1 }).limit(12).lean(),
      FaceRecognitionLog.find().sort({ scannedAt: -1 }).limit(8).populate('student').populate('user').lean(),
      User.find({ role: 'employee' }).sort({ name: 1 }).populate('student').lean(),
      WorkSession.find({ dateKey: todayKey }).sort({ lastActivityAt: -1 }).populate('user').populate('student').lean(),
    ]);
    const sessionByUser = new Map(liveWorkSessions.map((session) => [String(session.user?._id || session.user), session]));
    const liveSessionSummaries = employees.map((employee) => {
      const session = sessionByUser.get(String(employee._id));
      if (session) {
        return publicSession(session);
      }

      return {
        _id: `offline-${employee._id}`,
        user: employee,
        student: employee.student || null,
        employeeName: employee.name,
        faceLabel: employee.student?.faceLabel || '',
        dateKey: todayKey,
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
    });

    res.render('index', {
      studentCount,
      employeeCount: employees.length,
      todayAttendanceCount,
      monthlyAttendanceCount,
      recentAttendance,
      safeRecentAttendance: Array.isArray(recentAttendance) ? recentAttendance : [],
      students,
      loginHistory: [],
      faceRecognitionLogs,
      liveWorkSessions: liveSessionSummaries,
      currentRole: 'admin',
    });
  } catch (error) {
    next(error);
  }
});

app.get('/employee', requireRole('employee'), async (req, res, next) => {
  try {
    const studentId = req.user.student?._id || req.user.student || null;
    const student = studentId ? await Student.findById(studentId).lean() : null;
    let records = [];
    let faceLogs = [];
    let monthRecords = [];

    if (student) {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      [records, monthRecords, faceLogs] = await Promise.all([
        Attendance.find({ student: student._id }).sort({ markedAt: -1 }).limit(60).populate('student').lean(),
        Attendance.find({ student: student._id, markedAt: { $gte: monthStart } }).sort({ markedAt: -1 }).lean(),
        FaceRecognitionLog.find({ student: student._id }).sort({ scannedAt: -1 }).limit(10).lean(),
      ]);
    }

    const todayWorkSession = await WorkSession.findOne({
      user: req.user._id,
      dateKey: dateKeyFor(),
    })
      .populate('user')
      .populate('student')
      .lean();

    res.render('employee-dashboard', {
      currentRole: 'employee',
      faceLabel: student?.faceLabel || '',
      student,
      records,
      monthRecords,
      faceLogs,
      todayWorkSession: publicSession(todayWorkSession),
    });
  } catch (error) {
    next(error);
  }
});

app.get('/student-dashboard', requireAuth, (req, res) => {
  res.redirect(req.user.role === 'admin' ? '/admin' : '/employee');
});

app.get('/attendance', requireAuth, async (req, res, next) => {
  try {
    const query = {};
    if (req.user.role !== 'admin') {
      if (!req.user.student?._id && !req.user.student) {
        query.student = null;
      } else {
        query.student = req.user.student?._id || req.user.student;
      }
    }

    const records = await Attendance.find(query)
      .sort({ markedAt: -1 })
      .limit(20)
      .populate('student')
      .lean();

    res.render('attendance', { records });
  } catch (error) {
    next(error);
  }
});

app.get('/system-events', requireRole('admin'), async (req, res, next) => {
  try {
    const now = new Date();
    const workdayStart = new Date(now);
    workdayStart.setHours(8, 0, 0, 0);

    const workdayEnd = new Date(now);
    workdayEnd.setHours(17, 0, 0, 0);

    const rangeEnd = now;
    const selectedUser = String(req.query.user || '').trim();
    const eventQuery = {
      event: {
        $in: [
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
        ],
      },
      occurredAt: {
        $gte: workdayStart,
        $lte: rangeEnd,
      },
    };

    if (selectedUser) {
      eventQuery.user = selectedUser;
    }

    const [systemEvents, students] = await Promise.all([
      SystemEvent.find(eventQuery)
      .sort({ occurredAt: 1 })
      .limit(500)
      .lean(),
      Student.find().sort({ name: 1 }).lean(),
    ]);

    res.render('system-events', {
      systemEvents,
      students,
      selectedUser,
      systemEventRange: {
        start: workdayStart,
        end: rangeEnd,
        workdayEnd,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ success: true, user: req.user });
});

app.use('/api/students', requireAuth, studentRoutes);
app.use('/api/attendance', requireAuth, attendanceRoutes);
app.use('/api/reports', requireRole('admin'), reportRoutes);
app.use('/api/system-events', systemEventRoutes);
app.use('/api/work-sessions', requireAuth, workSessionRoutes);
app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    message: `API route not found: ${req.originalUrl}`,
  });
});

app.use((error, req, res, next) => {
  console.error(error);

  if (req.originalUrl.startsWith('/api/')) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
    });
  }

  res.status(500).render('error', {
    message: error.message || 'Internal server error',
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port http://localhost:${PORT}`);
});
