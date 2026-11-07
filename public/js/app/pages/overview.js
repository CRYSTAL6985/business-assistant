// Overview: performance, stores, what needs attention, recent activity. Every number comes from
// /api/app/overview; empty data shows honest empty states, never placeholders.
import { get } from '../api.js';
import { href, navigate } from '../router.js';
import { toggleMenu, menuItem } from '../menu.js';

const RANGES = [
  { id: 'today', label: 'امروز' },
  { id: '7d', label: '۷ روز' },
  { id: '30d', label: '۳۰ روز' },
  { id: 'custom', label: 'دلخواه', icon: 'calendar' },
];
const PLATFORM_LABELS = { widget: 'فقط ویجت', woocommerce: 'WooCommerce', custom: 'API اختصاصی' };
const ORDER_STATUS = { new: 'جدید', confirmed: 'تأیید شده', sent: 'ارسال شده', cancelled: 'لغو شده' };
const ACTIVITY_FILTERS = [{ id: '', label: 'همه' }, { id: 'order', label: 'سفارش‌ها' }, { id: 'conversation', label: 'گفتگوها' }];
const SEVERITY = { high: { pill: 'pill-danger', label: 'فوری' }, medium: { pill: 'pill-warn', label: 'مهم' }, low: { pill: '', label: 'اطلاع' } };
const MIN_SPARK_POINTS = 2;
const SVG_NS = 'http://www.w3.org/2000/svg';

const fa = (n, opts) => Number(n).toLocaleString('fa-IR', opts);
const relative = new Intl.RelativeTimeFormat('fa', { numeric: 'auto' });

/** "۲۰۸٫۷ میلیون" style money; the unit word (تومان) is shown next to it by the caller. */
export function compactToman(n) {
  if (n >= 1e9) return { value: fa(n / 1e9, { maximumFractionDigits: 1 }), unit: 'میلیارد تومان' };
  if (n >= 1e6) return { value: fa(n / 1e6, { maximumFractionDigits: 1 }), unit: 'میلیون تومان' };
  return { value: fa(n), unit: 'تومان' };
}

export function timeAgo(sqliteDate) {
  if (!sqliteDate) return 'بدون فعالیت';
  const seconds = (Date.parse(`${sqliteDate.replace(' ', 'T')}Z`) - Date.now()) / 1000;
  const steps = [[60, 'second'], [60, 'minute'], [24, 'hour'], [30, 'day'], [12, 'month'], [Infinity, 'year']];
  let value = seconds;
  for (const [size, unit] of steps) {
    if (Math.abs(value) < size) return relative.format(Math.round(value), unit);
    value /= size;
  }
  return '';
}

function sparkline(series) {
  if (series.filter((v) => v > 0).length < MIN_SPARK_POINTS) return null;
  const max = Math.max(...series);
  const step = series.length > 1 ? 100 / (series.length - 1) : 100;
  const points = series.map((v, i) => [i * step, 30 - (v / max) * 28]);
  const line = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'spark');
  svg.setAttribute('viewBox', '0 0 100 32');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.direction = 'ltr';
  for (const [cls, d] of [['area', `${line} L100,32 L0,32 Z`], ['', line]]) {
    const path = document.createElementNS(SVG_NS, 'path');
    if (cls) path.setAttribute('class', cls);
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

function delta(metric, { percent = false } = {}) {
  const { value, previous } = metric;
  if (value === null || previous === null) return el('span', { class: 'subtle', text: 'دادهٔ دورهٔ قبل نیست' });
  if (percent) {
    const diff = Math.round((value - previous) * 100);
    if (!diff) return el('span', { class: 'subtle', text: 'بدون تغییر نسبت به دورهٔ قبل' });
    return el('span', {}, el('b', { class: diff > 0 ? 'up' : 'down', text: `${diff > 0 ? '↑' : '↓'} ${fa(Math.abs(diff))} واحد درصد` }), ' نسبت به دورهٔ قبل');
  }
  if (!previous) return el('span', { class: 'subtle', text: value ? 'دورهٔ قبل صفر بود' : 'بدون تغییر نسبت به دورهٔ قبل' });
  const change = Math.round(((value - previous) / previous) * 100);
  if (!change) return el('span', { class: 'subtle', text: 'بدون تغییر نسبت به دورهٔ قبل' });
  return el('span', {}, el('b', { class: change > 0 ? 'up' : 'down', text: `${change > 0 ? '↑' : '↓'} ${fa(Math.abs(change))}٪` }), ' نسبت به دورهٔ قبل');
}

function metricCard({ label, hint, valueNode, metric, percent }) {
  return el('article', { class: 'card metric' },
    el('div', { class: 'metric-top' }, el('h3', { text: label }), el('span', { class: 'subtle small', text: hint })),
    valueNode,
    el('div', { class: 'metric-delta small' }, delta(metric, { percent })),
    sparkline(metric.series));
}

function metricsSection(data) {
  const { metrics } = data;
  const money = compactToman(metrics.revenue.value);
  return el('section', { class: 'metrics', 'aria-label': 'عملکرد' },
    metricCard({ label: 'درآمد', hint: 'سفارش‌های تأیید و ارسال‌شده', metric: metrics.revenue,
      valueNode: el('p', { class: 'metric-value' }, money.value, el('small', { text: money.unit })) }),
    metricCard({ label: 'سفارش‌ها', hint: 'همهٔ وضعیت‌ها', metric: metrics.orders, valueNode: el('p', { class: 'metric-value', text: fa(metrics.orders.value) }) }),
    metricCard({ label: 'گفتگوها', hint: 'گفتگوهای تازه', metric: metrics.conversations, valueNode: el('p', { class: 'metric-value', text: fa(metrics.conversations.value) }) }),
    metricCard({ label: 'نرخ پاسخ هوشمند', hint: 'پاسخ AI از کل پاسخ‌ها', metric: metrics.aiRate, percent: true,
      valueNode: el('p', { class: 'metric-value', text: metrics.aiRate.value === null ? '—' : `${fa(Math.round(metrics.aiRate.value * 100))}٪` }) }));
}

function storeCard(store) {
  const money = compactToman(store.revenue);
  const more = el('button', { class: 'btn btn-ghost btn-icon btn-sm', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': `گزینه‌های ${store.name}` }, icon('more'));
  more.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMenu(more, () => [
      menuItem({ label: 'مدیریت فروشگاه', iconName: 'store', href: href('/app/stores', { store: store.id }) }),
      menuItem({ label: 'سفارش‌ها', iconName: 'bag', href: href('/app/orders', { store: store.id }) }),
      menuItem({ label: 'گفتگوها', iconName: 'message-square', href: href('/app/conversations', { store: store.id }) }),
      menuItem({ label: 'تنظیم دستیار', iconName: 'sparkles', href: href('/app/assistant', { store: store.id }) }),
      menuItem({ label: 'صفحهٔ گفتگوی مشتری', iconName: 'external', href: `/chat/${encodeURIComponent(store.slug)}`, external: true }),
    ]);
  });
  const open = () => navigate(href('/app', { store: store.id }));
  return el('article', { class: 'card store-card', tabindex: '0', 'aria-label': `${store.name}، نمایش آمار این فروشگاه`, onclick: open, onkeydown: (e) => { if (e.key === 'Enter') open(); } },
    el('div', { class: 'store-top' },
      el('div', { class: 'store-id' }, el('h3', { text: store.name }),
        el('div', { class: 'store-meta' }, el('span', { class: 'ltr', text: PLATFORM_LABELS[store.platform] ?? store.platform }), store.domain ? el('span', { class: 'ltr', text: store.domain }) : null)),
      el('div', { class: 'menu-anchor' }, more)),
    el('div', { class: 'store-hero' }, el('span', { class: 'subtle small', text: 'درآمد این بازه' }), el('strong', {}, money.value, el('small', { text: money.unit }))),
    el('div', { class: 'store-facts' },
      el('span', {}, el('b', { text: fa(store.orders) }), ' سفارش'),
      el('span', {}, el('b', { text: store.aiRate === null ? '—' : `${fa(Math.round(store.aiRate * 100))}٪` }), ' پاسخ هوشمند')),
    el('div', { class: 'store-foot subtle small', text: `آخرین فعالیت: ${timeAgo(store.lastActivityAt)}` }));
}

function storesSection(data, storeId) {
  return el('section', { 'aria-labelledby': 'stores-title' },
    el('div', { class: 'section-head' },
      el('h2', { class: 'section-title', id: 'stores-title', text: storeId ? 'این فروشگاه' : 'فروشگاه‌ها' }),
      el('div', { class: 'page-actions' },
        storeId ? el('a', { class: 'btn btn-secondary btn-sm', href: href('/app', { store: null }), 'data-link': '', text: 'نمایش همهٔ فروشگاه‌ها' }) : null,
        el('a', { class: 'btn', href: href('/app/stores'), 'data-link': '' }, icon('plus', 'icon icon-sm'), 'اتصال فروشگاه جدید'))),
    data.stores.length
      ? el('div', { class: 'stores-grid' }, ...data.stores.map(storeCard))
      : el('div', { class: 'card empty' }, icon('store'), el('strong', { text: 'هنوز فروشگاهی وصل نشده' }), el('p', { text: 'اولین فروشگاه را وصل کنید تا دستیار شروع به پاسخ دادن کند.' })));
}

/** Adds the current ?store= to an /app link that may already carry its own query. */
function withStore(link) {
  const url = new URL(link, location.origin);
  const store = new URLSearchParams(location.search).get('store');
  if (store) url.searchParams.set('store', store);
  return url.pathname + url.search;
}

function attentionCard(items) {
  const body = items.length
    ? el('ul', { class: 'list' }, ...items.map((item) => el('li', {},
        el('a', { class: 'row-link attention-row', href: withStore(item.action.href), 'data-link': '' },
          el('span', { class: 'row-title' }, item.title),
          el('span', { class: `pill ${SEVERITY[item.severity].pill}` }, el('span', { class: 'dot' }), SEVERITY[item.severity].label),
          el('span', { class: 'row-sub', text: item.detail }),
          el('span', { class: 'row-meta', text: `${item.action.label} ←` })))))
    : el('div', { class: 'empty attention-ok' }, icon('check-circle'), el('strong', { text: 'همه‌چیز مرتب است' }), el('p', { text: 'موردی نیازمند توجه شما نیست.' }));
  return el('section', { class: 'card attention', 'aria-labelledby': 'att-title' },
    el('div', { class: 'card-head' }, el('h2', { id: 'att-title', text: 'نیازمند توجه' }), items.length ? el('span', { class: 'count', text: fa(items.length) }) : null),
    body);
}

function activityRow(item, showStore) {
  const kinds = {
    'order.created': { title: 'سفارش جدید', sub: item.summary ? `از ${item.summary}` : '', pill: 'pill-accent', label: 'سفارش', to: '/app/orders' },
    'order.status': { title: `سفارش #${fa(item.refId, { useGrouping: false })}`, sub: `وضعیت: ${ORDER_STATUS[item.summary] ?? item.summary}`, pill: '', label: 'وضعیت', to: '/app/orders' },
    'conversation.started': { title: 'گفتگوی جدید', sub: 'مشتری گفتگو را شروع کرد', pill: '', label: 'گفتگو', to: '/app/conversations' },
    'conversation.takeover': { title: 'واگذاری به انسان', sub: 'گفتگو از دستیار به شما سپرده شد', pill: '', label: 'گفتگو', to: '/app/conversations' },
  };
  const kind = kinds[item.type] ?? { title: item.type, sub: item.summary, pill: '', label: '', to: '/app' };
  return el('li', {}, el('a', { class: 'row-link', href: href(kind.to, { store: item.storeId }), 'data-link': '' },
    el('span', { class: 'row-title' }, kind.title, showStore ? el('span', { class: 'subtle small row-store', text: item.storeName }) : null),
    el('span', { class: 'row-meta', text: timeAgo(item.createdAt) }),
    el('span', { class: 'row-sub', text: kind.sub }),
    el('span', { class: `pill ${kind.pill}`, text: kind.label })));
}

function activityCard(storeId, showStore) {
  let filter = '';
  let nextBefore = null;
  const list = el('ul', { class: 'list' });
  const moreBtn = el('button', { class: 'btn btn-secondary btn-sm', type: 'button', text: 'موارد بیشتر', hidden: true });
  const status = el('div', { class: 'activity-status' });
  const filters = el('div', { class: 'seg seg-sm', role: 'group', 'aria-label': 'نوع فعالیت' },
    ...ACTIVITY_FILTERS.map((f) => el('button', { type: 'button', 'aria-pressed': String(f.id === filter), text: f.label, onclick: (e) => {
      filter = f.id;
      filters.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
      load(true);
    } })));

  async function load(reset) {
    const params = new URLSearchParams();
    if (storeId) params.set('store', storeId);
    if (filter) params.set('type', filter);
    if (!reset && nextBefore) params.set('before', nextBefore);
    if (reset) { list.replaceChildren(...Array.from({ length: 4 }, () => el('li', {}, el('div', { class: 'skeleton', style: 'height:44px;margin:6px' })))); }
    await withBusy(reset ? null : moreBtn, async () => {
      try {
        const data = await get(`/api/app/activity?${params}`);
        if (reset) list.replaceChildren();
        list.append(...data.items.map((item) => activityRow(item, showStore)));
        nextBefore = data.nextBefore;
        moreBtn.hidden = !nextBefore;
        status.replaceChildren(list.children.length ? '' : el('div', { class: 'empty' }, icon('inbox'), el('strong', { text: 'هنوز فعالیتی ثبت نشده' }), el('p', { text: 'سفارش‌ها و گفتگوهای تازه اینجا نمایش داده می‌شوند.' })));
      } catch (err) {
        if (reset) list.replaceChildren();
        status.replaceChildren(el('div', { class: 'empty' }, el('strong', { text: 'فعالیت‌ها بارگذاری نشد' }), el('p', { text: err.message }),
          el('button', { class: 'btn btn-secondary btn-sm', type: 'button', text: 'تلاش دوباره', onclick: () => load(true) })));
      }
    });
  }
  moreBtn.addEventListener('click', () => load(false));
  load(true);
  return el('section', { class: 'card activity', 'aria-labelledby': 'act-title' },
    el('div', { class: 'card-head' }, el('h2', { id: 'act-title', text: 'فعالیت اخیر' }), filters),
    list, status, el('div', { class: 'activity-more' }, moreBtn));
}

function placeThumb(seg) {
  const thumb = seg.querySelector('.seg-thumb');
  const active = seg.querySelector('button[aria-pressed="true"]');
  if (!thumb || !active) return;
  const segBox = seg.getBoundingClientRect();
  const box = active.getBoundingClientRect();
  thumb.style.width = `${box.width}px`;
  thumb.style.transform = `translateX(${box.left - segBox.left}px)`;
  thumb.style.insetInlineStart = 'auto';
  thumb.style.left = '0';
}

function skeleton() {
  return el('div', { class: 'overview-skeleton', 'aria-hidden': 'true' },
    el('div', { class: 'metrics' }, ...Array.from({ length: 4 }, () => el('div', { class: 'card metric' }, el('div', { class: 'skeleton', style: 'height:14px;width:40%' }), el('div', { class: 'skeleton', style: 'height:34px;width:60%;margin-top:14px' })))),
    el('div', { class: 'stores-grid', style: 'margin-top:40px' }, ...Array.from({ length: 3 }, () => el('div', { class: 'card', style: 'height:190px' }))));
}

export async function render(main, { route, storeId }) {
  const query = new URLSearchParams();
  const range = route.params.get('range') || '7d';
  query.set('range', range);
  if (range === 'custom') { query.set('from', route.params.get('from') || ''); query.set('to', route.params.get('to') || ''); }
  if (storeId) query.set('store', storeId);

  const setQuery = (changes) => {
    const params = new URLSearchParams(location.search);
    for (const [k, v] of Object.entries(changes)) (v ? params.set(k, v) : params.delete(k));
    navigate(`${location.pathname}?${params}`);
  };

  const seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'بازهٔ زمانی' }, el('span', { class: 'seg-thumb' }),
    ...RANGES.map((r) => el('button', { type: 'button', 'aria-pressed': String(r.id === range), onclick: () => {
      seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.textContent === r.label)));
      placeThumb(seg);
      if (r.id === 'custom') { custom.hidden = false; custom.querySelector('input').focus(); return; }
      setQuery({ range: r.id, from: null, to: null });
    } }, r.icon ? icon(r.icon, 'icon icon-sm') : null, r.label)));
  const today = new Date(Date.now() + 210 * 60000).toISOString().slice(0, 10);
  const custom = el('form', { class: 'custom-range', hidden: range !== 'custom', onsubmit: (e) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setQuery({ range: 'custom', from: data.get('from'), to: data.get('to') });
  } },
    el('label', { class: 'sr-only', for: 'r-from', text: 'از تاریخ' }), el('input', { class: 'input', type: 'date', id: 'r-from', name: 'from', required: true, max: today, value: route.params.get('from') || '' }),
    el('span', { class: 'subtle', text: 'تا' }),
    el('label', { class: 'sr-only', for: 'r-to', text: 'تا تاریخ' }), el('input', { class: 'input', type: 'date', id: 'r-to', name: 'to', required: true, max: today, value: route.params.get('to') || '' }),
    el('button', { class: 'btn btn-sm', type: 'submit', text: 'نمایش' }));
  const refresh = el('button', { class: 'btn btn-secondary btn-icon', type: 'button', 'aria-label': 'به‌روزرسانی', title: 'به‌روزرسانی' }, icon('refresh', 'icon icon-sm'));

  const head = el('div', { class: 'page-head' },
    el('div', {}, el('h1', { text: 'نمای کلی فضای کاری' }), el('p', { text: 'وضعیت عملکرد فروشگاه‌ها و دستیارهای هوشمند شما' })),
    el('div', { class: 'page-actions' }, seg, refresh, custom));
  const body = el('div', { class: 'overview-body' }, skeleton());
  main.replaceChildren(head, body);
  requestAnimationFrame(() => placeThumb(seg));

  async function load() {
    try {
      const data = await get(`/api/app/overview?${query}`);
      body.replaceChildren(
        metricsSection(data),
        storesSection(data, storeId),
        el('div', { class: 'overview-bottom' }, attentionCard(data.attention), activityCard(storeId, !storeId)));
    } catch (err) {
      body.replaceChildren(el('div', { class: 'card empty' }, icon('alert'), el('strong', { text: 'اطلاعات بارگذاری نشد' }), el('p', { text: err.message }),
        el('button', { class: 'btn btn-secondary', type: 'button', text: 'تلاش دوباره', onclick: load })));
    }
  }
  refresh.addEventListener('click', () => withBusy(refresh, load));
  await load();
}
