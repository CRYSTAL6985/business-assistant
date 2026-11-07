// Which web pages may use a store's widget: the app itself plus the store's own domain (with and
// without www). A store with no domain set is not locked yet. Used for CORS on the widget config,
// for refusing chat requests from other sites, and for the chat page's frame-ancestors.

const bareHost = (domain) => domain.replace(/^www\./, '');

/** Origins (scheme://host) the store's domain allows; [] when no domain is set. */
function storeOrigins(store) {
  if (!store.domain) return [];
  const bare = bareHost(store.domain);
  return ['https', 'http'].flatMap((scheme) => [`${scheme}://${bare}`, `${scheme}://www.${bare}`]);
}

function hostOf(origin) {
  try { return new URL(origin).host; } catch { return null; } // malformed Origin header: treated as foreign
}

/** True when the request comes from the app's own pages (or has no Origin, e.g. a direct page load). */
function isOwnOrigin(req) {
  const origin = req.get('origin');
  return !origin || hostOf(origin) === req.get('host');
}

/** May this request act on the store's chat? Own pages always; other sites only from the store's domain. */
function originAllowed(req, store) {
  if (isOwnOrigin(req)) return true;
  if (!store.domain) return true;
  return storeOrigins(store).includes(req.get('origin'));
}

/** Content-Security-Policy value for /chat/<slug>: embeddable only on the store's own site. */
function frameAncestors(store) {
  const origins = storeOrigins(store);
  return origins.length ? `frame-ancestors 'self' ${origins.join(' ')}` : 'frame-ancestors *';
}

module.exports = { originAllowed, isOwnOrigin, frameAncestors, storeOrigins };
