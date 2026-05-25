const crypto = require('crypto');

const User = require('../models/User');
const LoginHistory = require('../models/LoginHistory');

const COOKIE_NAME = 'faceai_session';
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_SECRET = process.env.SESSION_SECRET || process.env.AUTH_SECRET || 'change-this-faceai-session-secret';

function parseCookies(cookieHeader = '') {
  return cookieHeader.split(';').reduce((cookies, cookie) => {
    const [rawName, ...rawValue] = cookie.trim().split('=');
    if (!rawName) {
      return cookies;
    }

    cookies[rawName] = decodeURIComponent(rawValue.join('=') || '');
    return cookies;
  }, {});
}

function base64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function signPayload(payload) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
}

function createSessionToken(user) {
  const payload = base64Url(
    JSON.stringify({
      sub: String(user._id),
      role: user.role,
      exp: Date.now() + SESSION_MAX_AGE_MS,
    })
  );
  return `${payload}.${signPayload(payload)}`;
}

function verifySessionToken(token) {
  if (!token || !token.includes('.')) {
    return null;
  }

  const [payload, signature] = token.split('.');
  const expectedSignature = signPayload(payload);
  const signatureBuffer = Buffer.from(signature || '');
  const expectedBuffer = Buffer.from(expectedSignature);

  if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.sub || !data.exp || Date.now() > Number(data.exp)) {
      return null;
    }
    return data;
  } catch (error) {
    return null;
  }
}

function setSessionCookie(res, user) {
  const token = createSessionToken(user);
  const isSecure = process.env.NODE_ENV === 'production';
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure,
    maxAge: SESSION_MAX_AGE_MS,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const hash = crypto.scryptSync(password, salt, 64).toString('base64url');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
  const [algorithm, salt, hash] = String(storedHash || '').split('$');
  if (algorithm !== 'scrypt' || !salt || !hash) {
    return false;
  }

  const attemptedHash = crypto.scryptSync(password, salt, 64);
  const storedBuffer = Buffer.from(hash, 'base64url');
  return storedBuffer.length === attemptedHash.length && crypto.timingSafeEqual(storedBuffer, attemptedHash);
}

function requestMeta(req) {
  return {
    ipAddress: req.ip || req.socket?.remoteAddress || '',
    userAgent: String(req.headers['user-agent'] || '').slice(0, 1000),
  };
}

async function recordLoginHistory(req, { user = null, email = '', role = 'unknown', action, success }) {
  await LoginHistory.create({
    user: user?._id || user || null,
    email,
    role,
    action,
    success,
    ...requestMeta(req),
  });
}

async function authContext(req, res, next) {
  try {
    const cookies = parseCookies(req.headers.cookie || '');
    const tokenData = verifySessionToken(cookies[COOKIE_NAME]);
    let currentUser = null;

    if (tokenData) {
      currentUser = await User.findById(tokenData.sub).populate('student').lean();
      if (currentUser && !currentUser.isActive) {
        currentUser = null;
      }
    }

    req.user = currentUser;
    res.locals.currentUser = currentUser;
    res.locals.currentRole = currentUser?.role || 'guest';
    res.locals.isAdmin = currentUser?.role === 'admin';
    next();
  } catch (error) {
    next(error);
  }
}

function wantsJson(req) {
  return req.originalUrl.startsWith('/api/') || req.headers.accept?.includes('application/json');
}

function requireAuth(req, res, next) {
  if (req.user) {
    return next();
  }

  if (wantsJson(req)) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl || '/')}`);
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return requireAuth(req, res, next);
    }

    if (allowedRoles.includes(req.user.role)) {
      return next();
    }

    if (wantsJson(req)) {
      return res.status(403).json({ success: false, message: 'You do not have permission to access this resource' });
    }

    return res.status(403).render('error', {
      message: 'You do not have permission to access this page.',
    });
  };
}

module.exports = {
  authContext,
  clearSessionCookie,
  hashPassword,
  recordLoginHistory,
  requireAuth,
  requireRole,
  setSessionCookie,
  verifyPassword,
};
