// Sidebar, header, store switcher, search, notifications, theme and profile menus.
// Re-rendered whenever the route or the signed-in data (me) changes.
import { href, navigate, currentRoute } from './router.js';
import { toggleMenu, menuItem, menuLabel, menuSep, closeMenu } from './menu.js';
import { api } from './api.js';

export const NAV = [
  { label: 'عمومی', items: [
    { id: 'overview', label: 'نمای کلی', icon: 'dashboard' },
    { id: 'stores', label: 'فروشگاه‌ها', icon: 'store' },
  ] },
  { label: 'عملیات', items: [
    { id: 'conversations', label: 'گفتگوها', icon: 'message-square', count: 'unanswered' },
    { id: 'orders', label: 'سفارش‌ها', icon: 'bag', count: 'newOrders' },
    { id: 'products', label: 'محصولات', icon: 'package' },
  ] },
  { label: 'هوش مصنوعی', items: [
    { id: 'assistant', label: 'دستیار هوشمند', icon: 'sparkles' },
    { id: 'knowledge', label: 'پایگاه دانش', icon: 'book' },
  ] },
  { label: 'مدیریت', items: [
    { id: 'integrations', label: 'یکپارچه‌سازی‌ها', icon: 'plug' },
    { id: 'analytics', label: 'تحلیل و گزارش‌ها', icon: 'chart' },
    { id: 'billing', label: 'صورتحساب', icon: 'card' },
    { id: 'settings', label: 'تنظیمات', icon: 'settings' },
  ] },
];
export const SECTION_LABELS = Object.fromEntries(NAV.flatMap((g) => g.items.map((i) => [i.id, i.label])));
const PLAN_LABELS = { free: 'پلن رایگان', pro: 'پلن حرفه‌ای' };
export const THEMES = [
  { id: 'system', label: 'مطابق سیستم', icon: 'monitor' },
  { id: 'dark', label: 'تیره', icon: 'moon' },
  { id: 'light', label: 'روشن', icon: 'sun' },
];
const USAGE_WARN = 0.8;
const fa = (n) => Number(n).toLocaleString('fa-IR');

export function savedTheme() {
  try { return localStorage.getItem('theme') || 'dark'; } catch { return 'dark'; }
}
export function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('theme', theme); } catch { /* storage blocked: theme lasts for this page only */ }
}

const appEl = () => document.getElementById('app');
export function setDrawer(open) {
  appEl().classList.toggle('drawer-open', open);
  document.querySelector('.scrim')?.remove();
  if (open) {
    appEl().append(el('div', { class: 'scrim', onclick: () => setDrawer(false) }));
    document.querySelector('#sidebar .nav-link')?.focus();
  }
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && appEl()?.classList.contains('drawer-open')) { setDrawer(false); document.querySelector('.menu-toggle')?.focus(); }
});

function renderSidebar(me, route) {
  const side = document.getElementById('sidebar');
  const groups = NAV.map((group) => el('nav', { class: 'nav-group', 'aria-label': group.label },
    el('div', { class: 'nav-label', text: group.label }),
    ...group.items.map((item) => {
      const n = item.count ? me.counts[item.count] : 0;
      return el('a', {
        class: 'nav-link', href: href(`/app/${item.id === 'overview' ? '' : item.id}`.replace(/\/$/, '')), 'data-link': '',
        'aria-current': route.section === item.id ? 'page' : null, title: item.label,
        onclick: () => setDrawer(false),
      }, icon(item.icon), el('span', { class: 'label', text: item.label }),
      n ? el('span', { class: 'count', text: fa(n), 'aria-label': `${fa(n)} مورد` }) : null);
    })));
  const share = me.usage.used / me.usage.limit;
  const plan = el('a', { class: 'plan-box', href: href('/app/billing'), 'data-link': '' },
    el('div', { class: 'line' }, el('span', { text: PLAN_LABELS[me.usage.plan] }), el('b', { text: `${fa(Math.round(share * 100))}٪` })),
    el('div', { class: `meter${share >= 1 ? ' full' : share >= USAGE_WARN ? ' warn' : ''}`, role: 'progressbar', 'aria-label': 'مصرف پاسخ هوشمند', 'aria-valuemin': '0', 'aria-valuemax': String(me.usage.limit), 'aria-valuenow': String(me.usage.used) },
      el('span', { style: `width:${Math.min(100, share * 100)}%` })),
    el('div', { class: 'subtle small', text: `${fa(me.usage.used)} از ${fa(me.usage.limit)} پاسخ هوشمند این ماه` }));
  side.replaceChildren(
    el('a', { class: 'brand', href: href('/app'), 'data-link': '' }, el('span', { class: 'brand-mark', text: 'د', 'aria-hidden': 'true' }), el('span', { text: 'دستیار هوشمند' })),
    ...groups, plan);
}

function storeSwitcher(me, route) {
  const storeId = Number(route.params.get('store')) || null;
  const current = me.stores.find((s) => s.id === storeId);
  const button = el('button', { class: 'store-switch', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': 'انتخاب فروشگاه' },
    el('span', { class: 'dot', 'aria-hidden': 'true' }), el('span', { text: current ? current.name : 'همه فروشگاه‌ها' }), icon('chevron-down', 'icon icon-sm'));
  button.addEventListener('click', () => toggleMenu(button, () => [
    menuLabel('نمایش اطلاعات'),
    menuItem({ label: 'همه فروشگاه‌ها', checked: !current, onclick: () => navigate(href(route.path, { store: null })) }),
    ...me.stores.map((s) => menuItem({ label: s.name, checked: current?.id === s.id, onclick: () => navigate(href(route.path, { store: s.id })) })),
    menuSep(),
    menuItem({ label: 'مدیریت فروشگاه‌ها', iconName: 'store', href: href('/app/stores') }),
  ], { start: true }));
  return el('div', { class: 'menu-anchor' }, button);
}

/** Search box: filters sections and stores (global record search arrives with the data pages). */
function searchBox(me) {
  const input = el('input', { class: 'input', type: 'search', placeholder: 'جستجو…', 'aria-label': 'جستجو در بخش‌ها و فروشگاه‌ها', autocomplete: 'off' });
  const wrap = el('div', { class: 'search menu-anchor', role: 'search' }, icon('search', 'icon icon-sm'), input, el('kbd', { text: 'Ctrl K' }));
  const show = () => {
    wrap.querySelector('.menu')?.remove();
    const q = input.value.trim();
    if (!q) return;
    const sections = NAV.flatMap((g) => g.items).filter((i) => i.label.includes(q));
    const stores = me.stores.filter((s) => s.name.includes(q) || s.slug.includes(q.toLowerCase()));
    const items = [
      ...sections.map((i) => menuItem({ label: i.label, iconName: i.icon, href: href(`/app/${i.id === 'overview' ? '' : i.id}`.replace(/\/$/, '')) })),
      ...stores.map((s) => menuItem({ label: s.name, iconName: 'store', href: href('/app', { store: s.id }) })),
    ];
    wrap.append(el('div', { class: 'menu search-results', role: 'menu' }, ...(items.length ? items : [el('div', { class: 'menu-label', text: 'نتیجه‌ای پیدا نشد' })])));
  };
  input.addEventListener('input', show);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { input.value = ''; show(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); wrap.querySelector('.menu-item')?.focus(); }
  });
  input.addEventListener('blur', () => setTimeout(() => { if (!wrap.contains(document.activeElement)) wrap.querySelector('.menu')?.remove(); }, 150));
  return wrap;
}
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); document.querySelector('.search input')?.focus(); }
});

function bell(me) {
  const n = me.attention.length;
  const button = el('button', { class: 'round-btn', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': n ? `اعلان‌ها: ${fa(n)} مورد نیازمند توجه` : 'اعلان‌ها' },
    icon('bell'), n ? el('span', { class: 'badge', 'aria-hidden': 'true' }) : null);
  button.addEventListener('click', () => toggleMenu(button, () => (n
    ? [menuLabel('نیازمند توجه'), ...me.attention.map((a) => menuItem({ label: a.title, iconName: 'alert', href: a.action.href }))]
    : [el('div', { class: 'menu-label', text: 'موردی نیازمند توجه نیست' })])));
  return el('div', { class: 'menu-anchor' }, button);
}

function themeButton() {
  const theme = savedTheme();
  const button = el('button', { class: 'round-btn', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': 'پوسته' },
    icon(THEMES.find((t) => t.id === theme)?.icon ?? 'moon'));
  button.addEventListener('click', () => toggleMenu(button, () => [
    menuLabel('پوسته'),
    ...THEMES.map((t) => menuItem({ label: t.label, iconName: t.icon, checked: savedTheme() === t.id, onclick: () => { setTheme(t.id); button.replaceChildren(icon(t.icon)); } })),
  ]));
  return el('div', { class: 'menu-anchor theme-anchor' }, button);
}

function profile(me) {
  const initial = (me.user.name || me.user.email).trim().charAt(0);
  const button = el('button', { class: 'avatar', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': 'حساب کاربری', text: initial });
  button.addEventListener('click', () => toggleMenu(button, () => [
    el('div', { class: 'menu-label' }, el('div', { text: me.user.name, style: 'color:var(--ink);font-weight:700' }), el('div', { class: 'ltr', text: me.user.email })),
    menuSep(),
    menuItem({ label: 'تنظیمات', iconName: 'settings', href: href('/app/settings') }),
    menuSep(),
    menuLabel('پوسته'),
    ...THEMES.map((t) => menuItem({ label: t.label, iconName: t.icon, checked: savedTheme() === t.id, onclick: () => { setTheme(t.id); renderShell(me); } })),
    menuItem({ label: 'پنل قدیمی', iconName: 'external', href: '/panel?next=panel', external: true }),
    menuSep(),
    menuItem({ label: 'خروج', iconName: 'logout', danger: true, onclick: async () => { await api('POST', '/api/auth/logout'); location.assign('/panel'); } }),
  ]));
  return el('div', { class: 'menu-anchor' }, button);
}

export function renderShell(me) {
  closeMenu({ restoreFocus: false });
  const route = currentRoute();
  renderSidebar(me, route);
  const toggle = el('button', { class: 'round-btn menu-toggle', type: 'button', 'aria-label': 'باز کردن منو', 'aria-controls': 'sidebar', onclick: () => setDrawer(true) }, icon('menu'));
  document.getElementById('topbar').replaceChildren(toggle, storeSwitcher(me, route), searchBox(me), bell(me), themeButton(), profile(me));
  // Suspension is the operator's decision; the owner must see it on every page, with what it means.
  document.getElementById('notice').replaceChildren(me.workspace.status === 'suspended'
    ? el('div', { class: 'notice-danger', role: 'alert' }, icon('alert', 'icon icon-sm'),
      el('span', { text: 'این فضای کاری توسط مدیر سامانه معلق شده؛ دستیارها به مشتری‌ها پاسخ نمی‌دهند. ' }),
      el('a', { href: href('/app/billing'), 'data-link': '', text: 'جزئیات' }))
    : '');
}
