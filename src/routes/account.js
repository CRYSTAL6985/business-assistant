// Sign-up, login and logout for business owners.
const express = require('express');
const auth = require('../auth');
const validate = require('../validate');

const MIN_PASSWORD = 8;

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

      const taken = db.prepare('SELECT 1 FROM businesses WHERE slug = ? OR email = ?').get(slug, email);
      if (taken) return res.status(409).json({ error: 'این ایمیل یا آدرس صفحه قبلاً ثبت شده' });

      const hash = await auth.hashPassword(password);
      const info = db.prepare('INSERT INTO businesses (slug, name, email, password_hash) VALUES (?, ?, ?, ?)')
        .run(slug, name, email, hash);
      auth.setSessionCookie(res, auth.createSession(db, Number(info.lastInsertRowid)));
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

      const row = db.prepare('SELECT id, password_hash FROM businesses WHERE email = ?').get(email);
      const ok = row ? await auth.verifyPassword(password, row.password_hash) : false;
      if (!ok) {
        limiter.fail(email);
        return res.status(401).json({ error: 'ایمیل یا رمز عبور اشتباه است' }); // same message either way: don't reveal which emails exist
      }
      limiter.succeed(email);
      auth.setSessionCookie(res, auth.createSession(db, row.id));
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

module.exports = { accountRoutes };
