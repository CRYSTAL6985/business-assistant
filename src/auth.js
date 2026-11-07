// Business-owner accounts: password hashing, login sessions, brute-force lockout.
const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);

const SESSION_COOKIE = 'sid';
const SESSION_DAYS = 7;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

/** scrypt with a random salt; stored as "salt:hash" in hex. */
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [saltHex, hashHex] = stored.split(':');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual); // constant time: no timing leak
}

function createSession(db, businessId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, business_id, expires_at) VALUES (?, ?, ?)')
    .run(token, businessId, Date.now() + SESSION_MS);
  return token;
}

function deleteSession(db, token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  const match = header.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

function setSessionCookie(res, token) {
  // HttpOnly: page scripts can't read it. SameSite=Lax: other sites can't send it with POST/PUT.
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', maxAge: SESSION_MS });
}

/** Express middleware: rejects the request unless it carries a valid session; sets req.businessId. */
function requireAuth(db) {
  return (req, res, next) => {
    const token = readCookie(req, SESSION_COOKIE);
    const row = token && db.prepare('SELECT business_id, expires_at FROM sessions WHERE token = ?').get(token);
    if (!row || row.expires_at < Date.now()) {
      if (row) deleteSession(db, token);
      return res.status(401).json({ error: 'ابتدا وارد شوید' });
    }
    req.businessId = row.business_id;
    req.sessionToken = token;
    next();
  };
}

/**
 * In-memory login lockout: 5 wrong passwords for an email locks it for 15 minutes.
 * shortcut: resets when the server restarts; move into the database if this ever runs on several servers.
 */
function createLoginLimiter(now = () => Date.now()) {
  const failures = new Map(); // email -> { count, lockedUntil }
  return {
    isLocked(email) {
      const entry = failures.get(email);
      return Boolean(entry && entry.lockedUntil > now());
    },
    fail(email) {
      const entry = failures.get(email) || { count: 0, lockedUntil: 0 };
      const count = entry.count + 1;
      const lockedUntil = count >= MAX_FAILED_LOGINS ? now() + LOCKOUT_MS : 0;
      failures.set(email, { count: lockedUntil ? 0 : count, lockedUntil });
    },
    succeed(email) {
      failures.delete(email);
    },
  };
}

module.exports = {
  SESSION_COOKIE,
  hashPassword,
  verifyPassword,
  createSession,
  deleteSession,
  readCookie,
  setSessionCookie,
  requireAuth,
  createLoginLimiter,
};
