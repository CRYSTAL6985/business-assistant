// History-API router. Links with data-link navigate without a reload; the store filter (?store=)
// is carried across pages so switching section keeps the chosen store.
const listeners = new Set();

export function currentRoute() {
  const url = new URL(location.href);
  const path = url.pathname.replace(/\/+$/, '') || '/app';
  return { path, section: path.split('/')[2] || 'overview', params: url.searchParams };
}

/** Builds an /app URL that keeps the current ?store= unless overridden (store: null removes it). */
export function href(path, { store } = {}) {
  const params = new URLSearchParams();
  const current = new URLSearchParams(location.search).get('store');
  const next = store === undefined ? current : store;
  if (next) params.set('store', String(next));
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function navigate(url, { replace = false } = {}) {
  if (url === location.pathname + location.search) return;
  history[replace ? 'replaceState' : 'pushState'](null, '', url);
  listeners.forEach((fn) => fn(currentRoute()));
}

export function onRoute(fn) {
  listeners.add(fn);
}

addEventListener('popstate', () => listeners.forEach((fn) => fn(currentRoute())));
document.addEventListener('click', (event) => {
  const link = event.target.closest('a[data-link]');
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
  event.preventDefault();
  navigate(link.getAttribute('href'));
});
