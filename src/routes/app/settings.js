// Owner settings: profile name, password (current one required; other sessions signed out),
// workspace name, and deleting the workspace (typed-name confirmation, cannot be undone).
const express = require('express');
const auth = require('../../auth');
const validate = require('../../validate');

const MIN_PASSWORD = 8;

function settingsRoutes(db) {
  const router = express.Router();
  const workspaceOf = (req) => db.prepare('SELECT id, name FROM workspaces WHERE id = ?').get(req.workspaceId);

  router.get('/', (req, res) => {
    const user = db.prepare('SELECT name, email FROM users WHERE id = ?').get(req.userId);
    res.json({ user, workspace: { name: workspaceOf(req).name } });
  });

  router.put('/profile', (req, res) => {
    const name = validate.text(req.body?.name, 1, 80);
    if (!name) return res.status(400).json({ error: 'نام لازم است (حداکثر ۸۰ حرف)' });
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, req.userId);
    res.json({ ok: true });
  });

  router.put('/password', async (req, res, next) => {
    try {
      const current = typeof req.body?.current === 'string' ? req.body.current : '';
      const next_ = validate.text(req.body?.next, MIN_PASSWORD, 200);
      if (!next_) return res.status(400).json({ error: `رمز جدید حداقل ${MIN_PASSWORD.toLocaleString('fa-IR')} حرف` });
      const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.userId);
      if (!(await auth.verifyPassword(current, row.password_hash))) return res.status(400).json({ error: 'رمز فعلی درست نیست' });
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await auth.hashPassword(next_), req.userId);
      // Anyone else signed in with the old password is signed out; this browser stays in.
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(req.userId, req.sessionToken);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  router.put('/workspace', (req, res) => {
    const name = validate.text(req.body?.name, 2, 80);
    if (!name) return res.status(400).json({ error: 'نام فضای کاری ۲ تا ۸۰ حرف' });
    db.prepare('UPDATE workspaces SET name = ? WHERE id = ?').run(name, req.workspaceId);
    res.json({ ok: true });
  });

  router.delete('/workspace', (req, res) => {
    const workspace = workspaceOf(req);
    if (req.body?.confirm !== workspace.name) return res.status(400).json({ error: 'برای حذف، نام فضای کاری را دقیقاً وارد کنید' });
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM workspaces WHERE id = ?').run(workspace.id); // cascades: stores and all their data, members, sessions, payments
      const user = db.prepare(`SELECT is_operator, (SELECT COUNT(*) FROM workspace_members WHERE user_id = users.id) AS memberships FROM users WHERE id = ?`).get(req.userId);
      if (!user.is_operator && !user.memberships) db.prepare('DELETE FROM users WHERE id = ?').run(req.userId);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    res.clearCookie(auth.SESSION_COOKIE);
    res.json({ ok: true });
  });

  return router;
}

module.exports = { settingsRoutes };
