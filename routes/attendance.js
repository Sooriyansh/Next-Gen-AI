const express = require('express');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const Attendance = require('../models/Attendance');
const FaceRecognitionLog = require('../models/FaceRecognitionLog');
const Student = require('../models/Student');
const { EMBEDDINGS_PATH, ensureFaceModelReady } = require('../services/faceModel');
const { logAttendanceActivity } = require('../services/systemEventLogger');
const { completeSession, startOrResumeSession } = require('../services/workSessionService');
const { getPythonExecutable, PROJECT_ROOT } = require('../services/pythonRuntime');

const router = express.Router();
const RECOGNIZE_WORKER = path.join(PROJECT_ROOT, 'python', 'recognition_worker.py');
let workerProcess = null;
let workerReadyPromise = null;
let workerStdoutBuffer = '';
let lastWorkerError = '';
let nextRequestId = 1;
let workerStartedAt = 0;
const pendingRecognitions = new Map();

function normalizeLocation(location) {
  if (!location || typeof location !== 'object') {
    return undefined;
  }

  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  const accuracy = Number(location.accuracy);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return undefined;
  }

  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return undefined;
  }

  const capturedAt = location.capturedAt ? new Date(location.capturedAt) : new Date();

  return {
    latitude,
    longitude,
    accuracy: Number.isFinite(accuracy) ? accuracy : null,
    capturedAt: Number.isNaN(capturedAt.getTime()) ? new Date() : capturedAt,
  };
}

async function markAttendanceForLabel(faceLabel, confidence = 0, markedAt, location, actorUser = null) {
  const student = await Student.findOne({ faceLabel });

  if (!student) {
    return {
      status: 404,
      body: {
        success: false,
        message: `No student found for label ${faceLabel}`,
      },
    };
  }

  const attendanceTime = markedAt ? new Date(markedAt) : new Date();
  const dateKey = attendanceTime.toISOString().slice(0, 10);

  const existing = await Attendance.findOne({
    student: student._id,
    dateKey,
  });

  if (existing) {
    await startOrResumeSession({
      user: actorUser?.role === 'employee' ? actorUser : null,
      student,
      attendance: existing,
      reason: 'Attendance Duplicate',
      source: 'attendance',
    });

    logAttendanceActivity({
      type: 'duplicate',
      student,
      record: existing,
      faceLabel,
      confidence,
      location,
    }).catch((error) => {
      console.error('Attendance system event could not be logged:', error.message);
    });

    return {
      status: 200,
      body: {
        success: true,
        duplicate: true,
        message: 'Attendance already marked for today',
        record: existing,
      },
    };
  }

  let record;
  try {
    record = await Attendance.create({
      student: student._id,
      faceLabel,
      confidence,
      markedAt: attendanceTime,
      dateKey,
      location: normalizeLocation(location),
    });
  } catch (error) {
    if (error.code !== 11000) {
      throw error;
    }

    const duplicateRecord = await Attendance.findOne({ student: student._id, dateKey }).populate('student').lean();
    await startOrResumeSession({
      user: actorUser?.role === 'employee' ? actorUser : null,
      student,
      attendance: duplicateRecord,
      reason: 'Attendance Duplicate',
      source: 'attendance',
    });

    return {
      status: 200,
      body: {
        success: true,
        duplicate: true,
        message: 'Attendance already marked for today',
        record: duplicateRecord,
      },
    };
  }

  const populated = await Attendance.findById(record._id).populate('student').lean();

  await startOrResumeSession({
    user: actorUser?.role === 'employee' ? actorUser : null,
    student,
    attendance: record,
    reason: 'Attendance Started',
    source: 'attendance',
  });

  logAttendanceActivity({
    type: 'marked',
    student,
    record: populated,
    faceLabel,
    confidence,
    location,
  }).catch((error) => {
    console.error('Attendance system event could not be logged:', error.message);
  });

  return {
    status: 201,
    body: {
      success: true,
      duplicate: false,
      message: 'Attendance marked successfully',
      record: populated,
    },
  };
}

async function runRecognition(imageBuffer) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'attendance-scan-'));
  const imagePath = path.join(tempDir, 'frame.jpg');

  try {
    await fs.writeFile(imagePath, imageBuffer);
    const worker = await getWorkerProcess();
    const requestId = String(nextRequestId++);

    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingRecognitions.delete(requestId);
        reject(new Error('Recognition timed out'));
      }, 120000);

      pendingRecognitions.set(requestId, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });

      worker.stdin.write(`${JSON.stringify({ id: requestId, imagePath })}\n`);
    });

    return result;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function rejectPendingRecognitions(message) {
  for (const [requestId, pending] of pendingRecognitions.entries()) {
    pending.reject(new Error(message));
    pendingRecognitions.delete(requestId);
  }
}

function handleWorkerMessage(rawLine) {
  let message;

  try {
    message = JSON.parse(rawLine);
  } catch (error) {
    return;
  }

  if (message.type === 'result' && message.id) {
    const pending = pendingRecognitions.get(String(message.id));
    if (!pending) {
      return;
    }

    pendingRecognitions.delete(String(message.id));
    pending.resolve(message.result);
  }
}

function createWorkerProcess() {
  workerStartedAt = Date.now();
  workerProcess = spawn(getPythonExecutable(), [RECOGNIZE_WORKER], {
    cwd: PROJECT_ROOT,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  workerProcess.stdout.setEncoding('utf8');
  workerProcess.stdout.on('data', (chunk) => {
    workerStdoutBuffer += chunk;
    const lines = workerStdoutBuffer.split(/\r?\n/);
    workerStdoutBuffer = lines.pop() || '';

    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }

      try {
        const message = JSON.parse(trimmed);
        if (message.type === 'ready') {
          if (workerReadyPromise) {
            workerReadyPromise.resolve(workerProcess);
            workerReadyPromise = null;
          }
          return;
        }

        if (message.type === 'fatal') {
          const fatalError = new Error(message.message || 'Recognition worker failed to start');
          if (workerReadyPromise) {
            workerReadyPromise.reject(fatalError);
            workerReadyPromise = null;
          }
          rejectPendingRecognitions(fatalError.message);
          return;
        }

        handleWorkerMessage(trimmed);
      } catch (error) {
      }
    });
  });

  workerProcess.stderr.setEncoding('utf8');
  workerProcess.stderr.on('data', (chunk) => {
    lastWorkerError += chunk;
  });

  workerProcess.on('error', (error) => {
    if (workerReadyPromise) {
      workerReadyPromise.reject(error);
      workerReadyPromise = null;
    }
    rejectPendingRecognitions(error.message);
    workerProcess = null;
    workerStartedAt = 0;
  });

  workerProcess.on('exit', (code) => {
    const reason = lastWorkerError.trim() || `Recognition worker exited with code ${code}`;
    if (workerReadyPromise) {
      workerReadyPromise.reject(new Error(reason));
      workerReadyPromise = null;
    }
    rejectPendingRecognitions(reason);
    workerProcess = null;
    workerStartedAt = 0;
    workerStdoutBuffer = '';
    lastWorkerError = '';
  });
}

function userCanUseFaceLabel(user, faceLabel) {
  if (!user || user.role === 'admin') {
    return true;
  }

  return String(user.student?.faceLabel || '') === String(faceLabel || '');
}

async function writeFaceRecognitionLog(req, recognition, student = null, message = '') {
  try {
    await FaceRecognitionLog.create({
      user: req.user?._id || null,
      student: student?._id || null,
      faceLabel: recognition?.label || '',
      recognized: Boolean(recognition?.matched),
      confidence: Number(recognition?.confidence || 0),
      matchMargin: Number(recognition?.matchMargin || 0),
      message: message || recognition?.message || '',
    });
  } catch (error) {
    console.error('Face recognition log could not be saved:', error.message);
  }
}

async function embeddingsChangedAfterWorkerStart() {
  if (!workerProcess || !workerStartedAt) {
    return false;
  }

  const stats = await fs.stat(EMBEDDINGS_PATH);
  return stats.mtimeMs > workerStartedAt;
}

function stopWorkerProcess() {
  if (workerProcess && !workerProcess.killed) {
    workerProcess.kill();
  }

  workerProcess = null;
  workerStartedAt = 0;
  workerStdoutBuffer = '';
  lastWorkerError = '';
}

async function getWorkerProcess() {
  await ensureFaceModelReady();

  if (await embeddingsChangedAfterWorkerStart()) {
    stopWorkerProcess();
  }

  if (workerProcess && !workerProcess.killed && workerReadyPromise === null) {
    return workerProcess;
  }

  if (workerReadyPromise) {
    return workerReadyPromise.promise;
  }

  let resolveReady;
  let rejectReady;
  const promise = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  workerReadyPromise = {
    promise,
    resolve: resolveReady,
    reject: rejectReady,
  };

  createWorkerProcess();
  return promise;
}

router.get('/', async (req, res, next) => {
  try {
    const dateKey = req.query.date || new Date().toISOString().slice(0, 10);
    const query = { dateKey };

    if (req.user.role !== 'admin') {
      if (!req.user.student?._id) {
        return res.json({ success: true, records: [] });
      }
      query.student = req.user.student._id;
    }

    const records = await Attendance.find(query)
      .sort({ markedAt: -1 })
      .populate('student')
      .lean();

    res.json({ success: true, records });
  } catch (error) {
    next(error);
  }
});

router.get('/student/:faceLabel', async (req, res, next) => {
  try {
    const faceLabel = String(req.params.faceLabel || '').trim();

    if (!faceLabel) {
      return res.status(400).json({
        success: false,
        message: 'faceLabel is required',
      });
    }

    if (!userCanUseFaceLabel(req.user, faceLabel)) {
      return res.status(403).json({
        success: false,
        message: 'Employees can only view their own attendance records',
      });
    }

    const student = await Student.findOne({ faceLabel }).lean();

    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found',
      });
    }

    const records = await Attendance.find({ student: student._id })
      .sort({ markedAt: -1 })
      .limit(60)
      .populate('student')
      .lean();

    res.json({ success: true, student, records });
  } catch (error) {
    next(error);
  }
});

router.post('/mark', async (req, res, next) => {
  try {
    const { faceLabel, confidence = 0, markedAt, location } = req.body;

    if (!faceLabel) {
      return res.status(400).json({
        success: false,
        message: 'faceLabel is required',
      });
    }

    if (!userCanUseFaceLabel(req.user, faceLabel)) {
      return res.status(403).json({
        success: false,
        message: 'Employees can only mark attendance for their own face label',
      });
    }

    const result = await markAttendanceForLabel(faceLabel, confidence, markedAt, location, req.user);
    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
});

router.post('/scan', async (req, res, next) => {
  try {
    const { image, location } = req.body;

    if (!image || typeof image !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'image is required',
      });
    }

    const [, encoded] = image.split(',');
    if (!encoded) {
      return res.status(400).json({
        success: false,
        message: 'Invalid image payload',
      });
    }

    let recognition;

    try {
      const imageBuffer = Buffer.from(encoded, 'base64');
      recognition = await runRecognition(imageBuffer);
    } catch (error) {
      return res.status(500).json({
        success: false,
        message:
          'Python recognition service is unavailable. Please complete `npm run setup:python` and `npm run py:train` first.',
        details: error.message,
      });
    }

    if (!recognition.success) {
      await writeFaceRecognitionLog(req, recognition, null, recognition.message || 'Recognition failed');
      return res.status(500).json({
        success: false,
        message: recognition.message || 'Recognition failed',
      });
    }

    if (!recognition.matched) {
      await writeFaceRecognitionLog(req, recognition, null, recognition.message || 'Face not recognized');
      return res.json({
        success: true,
        recognized: false,
        message: recognition.message || 'Face not recognized',
        confidence: recognition.confidence || 0,
        matchMargin: recognition.matchMargin || 0,
        threshold: recognition.threshold,
        marginThreshold: recognition.marginThreshold,
      });
    }

    const recognizedStudent = await Student.findOne({ faceLabel: recognition.label }).lean();
    await writeFaceRecognitionLog(req, recognition, recognizedStudent, 'Face recognized');

    if (!userCanUseFaceLabel(req.user, recognition.label)) {
      return res.status(403).json({
        success: false,
        recognized: true,
        message: 'This face belongs to another employee. You can only mark your own attendance.',
      });
    }

    const attendanceResult = await markAttendanceForLabel(recognition.label, recognition.confidence, undefined, location, req.user);

    return res.status(attendanceResult.status).json({
      ...attendanceResult.body,
      recognized: true,
      recognition: {
        label: recognition.label,
        confidence: recognition.confidence,
        matchMargin: recognition.matchMargin,
        box: recognition.box,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/checkout', async (req, res, next) => {
  try {
    const studentId = req.user.role === 'admin' ? req.body.studentId : req.user.student?._id;

    if (!studentId) {
      return res.status(400).json({ success: false, message: 'Employee profile is not linked to attendance identity' });
    }

    const dateKey = new Date().toISOString().slice(0, 10);
    const note = String(req.body.note || '').trim();
    if (req.user.role !== 'admin' && note.length < 8) {
      return res.status(400).json({ success: false, message: 'Please enter what work you completed today.' });
    }

    if (req.user.role !== 'admin') {
      const session = await completeSession({ user: req.user, note });
      return res.json({
        success: true,
        message: "Today's work session completed successfully.",
        session,
      });
    }

    const record = await Attendance.findOne({ student: studentId, dateKey }).populate('student');

    if (!record) {
      return res.status(404).json({ success: false, message: 'No check-in record found for today' });
    }

    record.checkOutAt = new Date();
    await record.save();

    return res.json({
      success: true,
      message: 'Check-out saved successfully',
      record,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
