// Owner panel entry point: loads who is signed in, draws the shell, and renders the page for the route.
import { get } from './api.js';
import { currentRoute, onRoute } from './router.js';
import { renderShell, SECTION_LABELS } from './shell.js';
import * as overview from './pages/overview.js';
import * as later from './pages/later.js';
import * as products from './pages/products.js';
import * as knowledge from './pages/knowledge.js';
import * as orders from './pages/orders.js';
import * as stores from './pages/stores.js';
import * as conversations from './pages/conversations.js';
import * as assistant from './pages/assistant.js';

const PAGES = { overview, products, knowledge, orders, stores, conversations, assistant };
const main = document.getElementById('main');
let me = null;

/** Reloads the signed-in data (counts, attention, usage) and redraws the shell. */
export async function refreshMe() {
  me = await get('/api/app/me');
  renderShell(me);
  return me;
}

async function show(route, { focus = true } = {}) {
  renderShell(me);
  const page = PAGES[route.section] ?? (SECTION_LABELS[route.section] ? later : null);
  const storeId = Number(route.params.get('store')) || null;
  document.title = `${SECTION_LABELS[route.section] ?? 'صفحه پیدا نشد'} · دستیار هوشمند`;
  main.setAttribute('aria-busy', 'true');
  try {
    if (!page) {
      main.replaceChildren(el('div', { class: 'empty' }, el('strong', { text: 'این صفحه پیدا نشد' }), el('a', { class: 'btn', href: '/app', 'data-link': '', text: 'نمای کلی' })));
    } else {
      await page.render(main, { me, route, storeId, refreshMe });
    }
  } finally {
    main.setAttribute('aria-busy', 'false');
  }
  if (focus) main.focus({ preventScroll: true });
  scrollTo({ top: 0 });
}

async function boot() {
  await refreshMe();
  await show(currentRoute(), { focus: false });
  onRoute((route) => show(route));
}

boot().catch((err) => {
  main.setAttribute('aria-busy', 'false');
  main.replaceChildren(el('div', { class: 'empty' }, icon('wifi-off'), el('strong', { text: 'پنل بارگذاری نشد' }),
    el('p', { text: err.message }), el('button', { class: 'btn', type: 'button', text: 'تلاش دوباره', onclick: () => location.reload() })));
});
