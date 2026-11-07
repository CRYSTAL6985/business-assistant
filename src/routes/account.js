// Sign-up, login and logout for shop owners. Signing up creates the user, their workspace and its first store.
const express = require('express');
const auth = require('../auth');
const validate = require('../validate');

const MIN_PASSWORD = 8;
const SQLITE_CONSTRAINT_UNIQUE = 2067;
const DEFAULT_TONE = 'دوستانه و محترمانه';

/**
 * Creates user + workspace + owner membership + first store + assistant config in one transaction.
 * @returns {{ userId: number, workspaceId: number, storeId: number }}
 */
function createAccount(db, { name, slug, email, passwordHash, description = '', tone = DEFAULT_TONE, plan = 'free' }) {
  const config = JSON.stringify({ description, tone });
  db.exec('BEGIN');
  try {
    const userId = Number(db.prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)').run(email, passwordHash, name).lastInsertRowid);
    const workspaceId = Number(db.prepare('INSERT INTO workspaces (name, plan) VALUES (?, ?)').run(name, plan).lastInsertRowid);
    db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'owner')").run(workspaceId, userId);
    const storeId = Number(db.prepare('INSERT INTO stores (workspace_id, slug, name) VALUES (?, ?, ?)').run(workspaceId, slug, name).lastInsertRowid);
    db.prepare("INSERT INTO assistant_configs (store_id, draft_json, published_json, published_at) VALUES (?, ?, ?, datetime('now'))")
      .run(storeId, config, config);
    db.exec('COMMIT');
    return { userId, workspaceId, storeId };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** The workspace a user lands in after login: the first one they belong to. */
function firstWorkspaceId(db, userId) {
  return db.prepare('SELECT workspace_id FROM workspace_members WHERE user_id = ? ORDER BY workspace_id LIMIT 1').get(userId)?.workspace_id;
}

function accountRoutes(db) {
  const router = express.Router();
  const limiter = auth.createLoginLimiter();

  router.post('/register', async (req, res, next) => {
    try {
      const name = validate.text(req.body?.name, 2, 80);
      const slug = validate.slug(req.body?.slug);
      const email = validate.email(req.body?.email);
      const password = validate.text(req.body?.password, MIN_PASSWORD, 200);
      if (!name) return res.status(400).json({ error: 'نام کسب‌وکار لازم است' });
      if (!slug) return res.status(400).json({ error: 'آدرس صفحه فقط حروف انگلیسی کوچک، عدد و خط تیره (۳ تا ۳۰ حرف)' });
      if (!email) return res.status(400).json({ error: 'ایمیل معتبر نیست' });
      if (!password) return res.status(400).json({ error: `رمز عبور حداقل ${MIN_PASSWORD} حرف` });

      const taken = db.prepare('SELECT 1 FROM users WHERE email = ? UNION ALL SELECT 1 FROM stores WHERE slug = ?').get(email, slug);
      if (taken) return res.status(409).json({ error: 'این ایمیل یا آدرس صفحه قبلاً ثبت شده' });

      const passwordHash = await auth.hashPassword(password);
      let account;
      try {
        account = createAccount(db, { name, slug, email, passwordHash });
      } catch (err) {
        // Another sign-up with the same email/slug finished while this one was hashing its password.
        if (err.errcode === SQLITE_CONSTRAINT_UNIQUE) return res.status(409).json({ error: 'این ایمیل یا آدرس صفحه قبلاً ثبت شده' });
        throw err;
      }
      const { userId, workspaceId } = account;
      auth.setSessionCookie(res, auth.createSession(db, userId, workspaceId));
      res.status(201).json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.post('/login', async (req, res, next) => {
    try {
      const email = validate.email(req.body?.email);
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      if (!email) return res.status(400).json({ error: 'ایمیل معتبر نیست' });
      if (limiter.isLocked(email)) return res.status(429).json({ error: 'تلاش‌های ناموفق زیاد بود. ۱۵ دقیقه دیگر امتحان کنید.' });

      const row = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(email);
      const ok = row ? await auth.verifyPassword(password, row.password_hash) : false;
      if (!ok) {
        limiter.fail(email);
        return res.status(401).json({ error: 'ایمیل یا رمز عبور اشتباه است' }); // same message either way: don't reveal which emails exist
      }
      limiter.succeed(email);
      const workspaceId = firstWorkspaceId(db, row.id);
      if (!workspaceId) return res.status(403).json({ error: 'این حساب به هیچ فضای کاری متصل نیست' });
      auth.setSessionCookie(res, auth.createSession(db, row.id, workspaceId));
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.post('/logout', (req, res) => {
    const token = auth.readCookie(req, auth.SESSION_COOKIE);
    if (token) auth.deleteSession(db, token);
    res.clearCookie(auth.SESSION_COOKIE);
    res.json({ ok: true });
  });

  return router;
}

module.exports = { accountRoutes, createAccount };
