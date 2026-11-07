// In-memory token buckets keyed by client (IP or API key). Each key may burst up to `capacity`
// requests, refilled at `perMinute`. Over the limit -> 429 with Retry-After.
// shortcut: per process and reset on restart; move to the database if the app ever runs on several servers.

const SWEEP_EVERY = 1000;

/**
 * @param {{ capacity: number, perMinute: number, key?: (req) => string, now?: () => number }} options
 */
function rateLimit({ capacity, perMinute, key = (req) => req.ip, now = () => Date.now() }) {
  const buckets = new Map(); // key -> { tokens, at }
  const refillPerMs = perMinute / 60_000;
  let calls = 0;
  return (req, res, next) => {
    const t = now();
    if (++calls % SWEEP_EVERY === 0) {
      for (const [k, b] of buckets) if (b.tokens + (t - b.at) * refillPerMs >= capacity) buckets.delete(k); // full again: forget it
    }
    const id = key(req);
    const bucket = buckets.get(id) ?? { tokens: capacity, at: t };
    const tokens = Math.min(capacity, bucket.tokens + (t - bucket.at) * refillPerMs);
    if (tokens < 1) {
      buckets.set(id, { tokens, at: t });
      res.set('Retry-After', String(Math.ceil((1 - tokens) / refillPerMs / 1000)));
      return res.status(429).json({ error: 'درخواست‌ها زیاد است. کمی بعد دوباره امتحان کنید.' });
    }
    buckets.set(id, { tokens: tokens - 1, at: t });
    next();
  };
}

module.exports = { rateLimit };
