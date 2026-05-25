const express = require('express');

const Student = require('../models/Student');
const User = require('../models/User');
const {
  clearSessionCookie,
  hashPassword,
  setSessionCookie,
  verifyPassword,
} = require('../services/auth');

const router = express.Router();

function normalizeRole(role) {
  return role === 'admin' ? 'admin' : 'employee';
}

function redirectForRole(user) {
  return user.role === 'admin' ? '/admin' : '/employee';
}

router.get('/login', (req, res) => {
  if (req.user) {
    return res.redirect(redirectForRole(req.user));
  }

  res.render('login', {
    message: req.query.message || '',
    nextUrl: req.query.next || '',
  });
});

router.get('/signup', (req, res) => {
  if (req.user) {
    return res.redirect(redirectForRole(req.user));
  }

  res.render('signup', {
    message: '',
  });
});

router.post('/signup', async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const role = normalizeRole(req.body.role);
    const faceLabel = String(req.body.faceLabel || '').trim();
    const department = String(req.body.department || '').trim();

    if (!name || !email || !password) {
      return res.status(400).render('signup', { message: 'Name, email and password are required.' });
    }

    if (password.length < 8) {
      return res.status(400).render('signup', { message: 'Password must be at least 8 characters.' });
    }

    const existingUser = await User.findOne({ email }).lean();
    if (existingUser) {
      return res.status(409).render('signup', { message: 'An account already exists for this email.' });
    }

    if (role === 'admin') {
      const adminExists = await User.exists({ role: 'admin' });
      if (adminExists) {
        return res.status(403).render('signup', {
          message: 'Admin signup is restricted after the first admin account is created. Ask an admin to manage access.',
        });
      }
    }

    let student = null;
    if (role === 'employee') {
      if (!faceLabel) {
        return res.status(400).render('signup', { message: 'Face label is required for employee signup.' });
      }

      student = await Student.findOne({ faceLabel });
      if (!student) {
        student = await Student.create({
          name,
          faceLabel,
          department,
          email,
          joiningDate: new Date(),
        });
      }
    }

    const user = await User.create({
      name,
      email,
      passwordHash: hashPassword(password),
      role,
      student: student?._id || null,
      department: department || student?.department || '',
    });

    setSessionCookie(res, user);
    res.redirect(redirectForRole(user));
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).render('signup', { message: 'An account or face label already exists with these details.' });
    }
    next(error);
  }
});

router.post('/login', async (req, res, next) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const nextUrl = String(req.body.next || '').trim();

  try {
    const user = await User.findOne({ email }).populate('student');

    if (!user || !user.isActive || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).render('login', {
        message: 'Invalid email or password.',
        nextUrl,
      });
    }

    user.lastLoginAt = new Date();
    await user.save();
    setSessionCookie(res, user);

    if (nextUrl.startsWith('/') && !nextUrl.startsWith('//')) {
      return res.redirect(nextUrl);
    }

    res.redirect(redirectForRole(user));
  } catch (error) {
    next(error);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    clearSessionCookie(res);
    res.redirect('/login?message=Signed%20out%20successfully');
  } catch (error) {
    next(error);
  }
});

module.exports = router;
