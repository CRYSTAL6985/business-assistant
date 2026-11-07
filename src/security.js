// HTTP hardening shared by every route: security headers with a Content-Security-Policy, and a CSRF
// guard for the cookie-authenticated APIs.

// Pages load only our own scripts (no inline <script>, no CDNs). Inline style="" attributes are used
// by the UI helpers, so styles allow 'unsafe-inline' — styles cannot run code.
const BASE_CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:",
  "font-src 'self'", "connect-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'",
].join('; ');
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const csp = (frameAncestors) => `${BASE_CSP}; ${frameAncestors}`;

function securityHeaders({ production }) {
  return (req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    if (production) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    // /chat/<slug> is embedded on shop websites and sets its own frame-ancestors per store.
    if (!req.path.startsWith('/chat/')) res.set('Content-Security-Policy', csp("frame-ancestors 'self'"));
    next();
  };
}

const hostOf = (origin) => { try { return new URL(origin).host; } catch { return null; } };

/**
 * CSRF guard for cookie-authenticated APIs. A write must come from our own pages (Origin = this host
 * or PUBLIC_BASE_URL; no Origin = not a browser, e.g. curl/tests) and must be JSON — a plain HTML
 * form on another site can send neither. SameSite=Lax on the cookie is the second layer.
 */
function sameOriginWrites({ publicBaseUrl }) {
  const publicHost = hostOf(publicBaseUrl);
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.get('origin');
    if (origin && hostOf(origin) !== req.get('host') && hostOf(origin) !== publicHost) {
      return res.status(403).json({ error: 'درخواست از سایت دیگری پذیرفته نمی‌شود' });
    }
    const hasBody = Number(req.get('content-length') || 0) > 0 || req.get('transfer-encoding');
    if (hasBody && !req.is('application/json')) return res.status(415).json({ error: 'درخواست باید JSON باشد' });
    next();
  };
}

module.exports = { securityHeaders, sameOriginWrites, csp };
