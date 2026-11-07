// Analytics: daily chart for the chosen range and a per-store comparison. Only real rows; a rate
// with nothing behind it shows «—», and a range without data says so instead of drawing zeros.
import { get } from '../api.js';
import { pageHead } from '../table.js';
import { navigate } from '../router.js';
import { compactToman } from './overview.js';

const RANGES = [{ id: 'today', label: 'امروز' }, { id: '7d', label: '۷ روز' }, { id: '30d', label: '۳۰ روز' }];
const SERIES = [{ id: 'orders', label: 'سفارش‌ها', unit: 'سفارش' }, { id: 'revenue', label: 'درآمد', unit: 'درآمد' }, { id: 'conversations', label: 'گفتگوها', unit: 'گفتگو' }];
const SVG_NS = 'http://www.w3.org/2000/svg';
const CHART = { w: 720, h: 200, pad: 24 };
const fa = (n, o) => Number(n).toLocaleString('fa-IR', o);
const pct = (r) => (r === null ? '—' : `${fa(Math.round(r * 100))}٪`);
const money = (n) => { const c = compactToman(n); return `${c.value} ${c.unit}`; };
const dayLabel = (day) => new Date(`${day}T12:00:00Z`).toLocaleDateString('fa-IR', { day: 'numeric', month: 'short' });

function svg(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/** Daily bars, oldest on the left (same direction as the overview sparklines). */
function barChart(days, values, format) {
  const max = Math.max(...values);
  const slot = (CHART.w - CHART.pad) / days.length;
  const barW = Math.max(2, Math.min(28, slot * 0.6));
  const chart = svg('svg', { class: 'bars', viewBox: `0 0 ${CHART.w} ${CHART.h}`, role: 'img', 'aria-label': 'نمودار روزانه' });
  chart.style.direction = 'ltr';
  chart.append(svg('line', { x1: CHART.pad, x2: CHART.w, y1: CHART.h - CHART.pad, y2: CHART.h - CHART.pad, class: 'axis' }));
  const labelEvery = Math.ceil(days.length / 8);
  days.forEach((day, i) => {
    const h = max ? ((CHART.h - CHART.pad * 2) * values[i]) / max : 0;
    const x = CHART.pad + i * slot + (slot - barW) / 2;
    const bar = svg('rect', { x, y: CHART.h - CHART.pad - h, width: barW, height: Math.max(h, values[i] ? 2 : 0), rx: 3, class: 'bar' });
    const title = svg('title', {});
    title.textContent = `${dayLabel(day)}: ${format(values[i])}`;
    bar.append(title);
    chart.append(bar);
    if (i % labelEvery === 0) {
      const t = svg('text', { x: x + barW / 2, y: CHART.h - 6, 'text-anchor': 'middle', class: 'tick' });
      t.textContent = dayLabel(day);
      chart.append(t);
    }
  });
  return chart;
}

export async function render(main, { route, storeId }) {
  const range = RANGES.some((r) => r.id === route.params.get('range')) ? route.params.get('range') : '7d';
  let series = SERIES.some((s) => s.id === route.params.get('metric')) ? route.params.get('metric') : 'orders';
  const setParam = (key, value) => {
    const params = new URLSearchParams(location.search);
    params.set(key, value);
    return `${location.pathname}?${params}`;
  };
  const seg = (items, current, onPick, label) => el('div', { class: 'seg seg-sm', role: 'group', 'aria-label': label }, ...items.map((item) => el('button', {
    type: 'button', text: item.label, 'aria-pressed': String(item.id === current), onclick: () => onPick(item.id),
  })));
  const body = el('div', { class: 'stack' }, el('div', { class: 'skeleton', style: 'height:260px;border-radius:14px' }));
  main.replaceChildren(pageHead('تحلیل و گزارش‌ها', storeId ? 'عملکرد فروشگاه انتخاب‌شده در بازهٔ زمانی' : 'مقایسهٔ فروشگاه‌ها در بازهٔ زمانی — همه از داده‌های ثبت‌شده',
    seg(RANGES, range, (id) => navigate(setParam('range', id)), 'بازهٔ زمانی')), body);

  let data;
  try {
    data = await get(`/api/app/analytics?range=${range}${storeId ? `&store=${storeId}` : ''}`);
  } catch (err) {
    body.replaceChildren(el('div', { class: 'card empty' }, icon('alert'), el('strong', { text: 'بارگذاری نشد' }), el('p', { text: err.message })));
    return;
  }

  const chartBox = el('div', { class: 'chart-box' });
  const totalLine = el('p', { class: 'chart-total' });
  function drawChart() {
    const values = data.series[series];
    const total = values.reduce((a, b) => a + b, 0);
    const format = series === 'revenue' ? money : (n) => fa(n);
    totalLine.replaceChildren(el('strong', { text: format(total) }), el('span', { class: 'subtle', text: ` ${SERIES.find((s) => s.id === series).unit} در این بازه` }));
    chartBox.replaceChildren(total
      ? barChart(data.days, values, format)
      : el('div', { class: 'empty' }, icon('chart'), el('strong', { text: 'در این بازه داده‌ای ثبت نشده' }), el('p', { text: 'با اولین سفارش یا گفتگو، نمودار پر می‌شود.' })));
  }
  const metricSeg = seg(SERIES, series, (id) => {
    series = id;
    metricSeg.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', String(SERIES[i].id === id)));
    history.replaceState(null, '', setParam('metric', id));
    drawChart();
  }, 'شاخص نمودار');
  drawChart();

  const columns = [
    ['فروشگاه', (s) => s.name, 'strong'],
    ['سفارش', (s) => fa(s.orders)],
    ['درآمد', (s) => money(s.revenue)],
    ['گفتگو', (s) => fa(s.conversations)],
    ['پاسخ هوشمند', (s) => pct(s.aiRate)],
    ['پاسخ آفلاین', (s) => pct(s.offlineRate)],
    ['واگذاری به انسان', (s) => fa(s.takeovers)],
  ];
  const table = el('div', { class: 'table-wrap only-wide' }, el('table', { class: 'table' },
    el('thead', {}, el('tr', {}, ...columns.map(([label]) => el('th', { scope: 'col', text: label })))),
    el('tbody', {}, ...data.stores.map((s) => el('tr', {}, ...columns.map(([, cell, cls]) => el('td', { class: cls ?? null, text: cell(s) })))))));
  const list = el('ul', { class: 'list only-narrow' }, ...data.stores.map((s) => el('li', {}, el('div', { class: 'row-link an-row' },
    el('span', { class: 'row-title', text: s.name }),
    el('span', { class: 'row-sub', text: `${fa(s.orders)} سفارش · ${money(s.revenue)} · ${fa(s.conversations)} گفتگو` }),
    el('span', { class: 'row-sub', text: `پاسخ هوشمند ${pct(s.aiRate)} · آفلاین ${pct(s.offlineRate)} · واگذاری ${fa(s.takeovers)}` })))));

  body.replaceChildren(
    el('section', { class: 'card card-pad stack' }, el('div', { class: 'chart-head' }, totalLine, metricSeg), chartBox),
    el('section', { class: 'card data-card' },
      el('h2', { class: 'card-title', text: 'مقایسهٔ فروشگاه‌ها' }),
      el('p', { class: 'subtle small card-note', text: 'نرخ پاسخ هوشمند = پاسخ‌های هوش مصنوعی ÷ همهٔ پاسخ‌های دستیار. «—» یعنی در این بازه پاسخی نبوده.' }),
      table, list));
}
