const crypto = require('node:crypto');
const { getSetting, setSetting } = require('./db');

const COOKIE = 'sp_admin';
const SESSION_DAYS = 14;

function secret() {
  let s = process.env.SESSION_SECRET || getSetting('session_secret');
  if (!s) {
    s = crypto.randomBytes(32).toString('hex');
    setSetting('session_secret', s);
  }
  return s;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === test.length && crypto.timingSafeEqual(expected, test);
}

// On first launch the password comes from ADMIN_PASSWORD (or a default the
// dashboard warns about until it is changed).
function ensureAdminPassword() {
  if (!getSetting('admin_hash')) {
    setSetting('admin_hash', hashPassword(process.env.ADMIN_PASSWORD || 'admin123'));
    setSetting('admin_default_pw', process.env.ADMIN_PASSWORD ? '0' : '1');
  }
}

function sign(value) {
  return crypto.createHmac('sha256', secret()).update(value).digest('base64url');
}

// Session token = expiry.fingerprint.signature. The fingerprint ties sessions
// to the current password hash, so changing the password logs everyone out.
function fingerprint() {
  return sign(`pw:${getSetting('admin_hash')}`).slice(0, 12);
}

function createSessionToken() {
  const expires = Date.now() + SESSION_DAYS * 864e5;
  const body = `${expires}.${fingerprint()}`;
  return `${body}.${sign(body)}`;
}

function readSession(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [expires, fp, sig] = parts;
  const body = `${expires}.${fp}`;
  const good = Buffer.from(sign(body));
  const given = Buffer.from(sig);
  if (good.length !== given.length || !crypto.timingSafeEqual(good, given)) return null;
  if (Number(expires) < Date.now() || fp !== fingerprint()) return null;
  return token;
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookieOptions(req) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    path: '/',
  };
}

function login(req, res) {
  res.cookie(COOKIE, createSessionToken(), { ...cookieOptions(req), maxAge: SESSION_DAYS * 864e5 });
}

function logout(req, res) {
  res.clearCookie(COOKIE, cookieOptions(req));
}

function csrfToken(session) {
  return sign(`csrf:${session}`);
}

function requireAdmin(req, res, next) {
  const session = readSession(req);
  if (!session) {
    if (req.method === 'GET' && !req.path.startsWith('/api/')) {
      return res.redirect(`/admin/login?next=${encodeURIComponent(req.originalUrl)}`);
    }
    return res.status(401).json({ error: 'unauthorized' });
  }
  req.adminSession = session;
  res.locals.csrf = csrfToken(session);
  next();
}

// Must run after the body is parsed (multer for multipart forms).
function verifyCsrf(req, res, next) {
  const given = (req.body && req.body._csrf) || req.get('x-csrf-token') || '';
  const expected = csrfToken(req.adminSession);
  const a = Buffer.from(String(given));
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).send('انتهت صلاحية النموذج، أعد تحميل الصفحة وحاول مجدداً.');
  }
  next();
}

module.exports = {
  ensureAdminPassword,
  hashPassword,
  verifyPassword,
  login,
  logout,
  requireAdmin,
  verifyCsrf,
};
