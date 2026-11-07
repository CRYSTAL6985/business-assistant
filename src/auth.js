// Owner accounts: password hashing, login sessions (user + active workspace), brute-force lockout.
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

function createSession(db, userId, workspaceId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, active_workspace_id, expires_at) VALUES (?, ?, ?, ?)')
    .run(token, userId, workspaceId, Date.now() + SESSION_MS);
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

/** The request's live session (expired ones are removed), or null. */
function sessionOf(db, req) {
  const token = readCookie(req, SESSION_COOKIE);
  const row = token && db.prepare(`SELECT s.user_id, s.active_workspace_id, s.expires_at, u.is_operator
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`).get(token);
  if (!row) return null;
  if (row.expires_at < Date.now()) { deleteSession(db, token); return null; }
  return { token, userId: row.user_id, workspaceId: row.active_workspace_id, isOperator: Boolean(row.is_operator) };
}

/** Express middleware for the owner panel: a valid session with a workspace; sets req.userId and req.workspaceId. */
function requireUser(db) {
  return (req, res, next) => {
    const session = sessionOf(db, req);
    if (!session) return res.status(401).json({ error: 'ابتدا وارد شوید' });
    if (!session.workspaceId) return res.status(403).json({ error: 'این حساب فروشگاهی ندارد', operator: session.isOperator });
    req.userId = session.userId;
    req.workspaceId = session.workspaceId;
    req.sessionToken = session.token;
    next();
  };
}

/** Express middleware for /api/admin: only users marked is_operator. */
function requireOperator(db) {
  return (req, res, next) => {
    const session = sessionOf(db, req);
    if (!session) return res.status(401).json({ error: 'ابتدا وارد شوید' });
    if (!session.isOperator) return res.status(403).json({ error: 'دسترسی ندارید' });
    req.userId = session.userId;
    next();
  };
}

/** Creates the first operator account from env when none exists (startup). */
async function ensureOperator(db, email, password) {
  if (!email || !password) return false;
  if (db.prepare('SELECT 1 FROM users WHERE is_operator = 1').get()) return false;
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) db.prepare('UPDATE users SET is_operator = 1 WHERE id = ?').run(existing.id);
  else db.prepare("INSERT INTO users (email, password_hash, name, is_operator) VALUES (?, ?, 'اپراتور', 1)").run(email.toLowerCase(), await hashPassword(password));
  return true;
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
  requireUser,
  requireOperator,
  ensureOperator,
  sessionOf,
  createLoginLimiter,
};
