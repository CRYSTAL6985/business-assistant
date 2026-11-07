// Operator panel: every workspace and store, plans, manual payments, suspension. Metadata only —
// the API behind it never returns conversations, customers or order contents.
import { api, get } from '../app/api.js';
import { pageHead } from '../app/table.js';
import { formDialog } from '../app/form.js';

const TABS = [{ id: 'workspaces', label: 'فضاهای کاری' }, { id: 'stores', label: 'فروشگاه‌ها' }];
const PLAN = { free: 'رایگان', pro: 'حرفه‌ای' };
const PLATFORM = { widget: 'فقط ویجت', woocommerce: 'WooCommerce', custom: 'API اختصاصی' };
const fa = (n) => Number(n).toLocaleString('fa-IR');
const main = document.getElementById('main');
const tehranToday = () => new Date(Date.now() + 210 * 60000).toISOString().slice(0, 10);

const currentTab = () => (TABS.some((t) => t.id === new URLSearchParams(location.search).get('tab')) ? new URLSearchParams(location.search).get('tab') : 'workspaces');

function drawTabs() {
  const tab = currentTab();
  document.getElementById('tabs').replaceChildren(...TABS.map((t) => el('button', {
    type: 'button', text: t.label, 'aria-pressed': String(t.id === tab),
    onclick: () => { history.pushState(null, '', `/admin?tab=${t.id}`); show(); },
  })));
}

function table(columns, rows, onOpen) {
  return el('div', { class: 'card data-card' }, el('div', { class: 'table-wrap' }, el('table', { class: 'table' },
    el('thead', {}, el('tr', {}, ...columns.map(([label]) => el('th', { scope: 'col', text: label })))),
    el('tbody', {}, ...rows.map((row) => {
      const tr = el('tr', { class: onOpen ? 'clickable' : null }, ...columns.map(([, cell, cls]) => el('td', { class: cls ?? null }, cell(row))));
      if (onOpen) tr.addEventListener('click', () => onOpen(row));
      return tr;
    })))));
}

const statusPill = (w) => (w.status === 'suspended'
  ? el('span', { class: 'pill pill-danger', text: 'معلق' })
  : w.plan === 'pro' && w.effectivePlan === 'free' ? el('span', { class: 'pill pill-warn', text: 'منقضی' }) : el('span', { class: 'pill pill-success', text: 'فعال' }));

const sightingsCell = (s) => (s.sightings.length
  ? el('span', { class: 'ltr small', text: s.sightings.map((x) => x.origin.replace(/^https?:\/\//, '')).join('، ') })
  : el('span', { class: 'subtle small', text: 'دیده نشده' }));

async function showWorkspaces() {
  const rows = await get('/api/admin/workspaces');
  const open = (w) => workspaceDialog(w.id);
  main.replaceChildren(pageHead('فضاهای کاری', `${fa(rows.length)} فضای کاری · فقط اطلاعات حساب و مصرف، بدون گفتگو و اطلاعات مشتری`),
    rows.length ? table([
      ['نام', (w) => el('button', { class: 'link-btn', type: 'button', text: w.name, onclick: (e) => { e.stopPropagation(); open(w); } }), 'strong'],
      ['مالک', (w) => el('span', { class: 'ltr small', text: w.ownerEmail ?? '—' })],
      ['فروشگاه', (w) => fa(w.stores)],
      ['پلن', (w) => PLAN[w.effectivePlan]],
      ['تا', (w) => (w.paidUntil ? faLastDay(w.paidUntil) : '—')],
      ['مصرف این ماه', (w) => `${fa(w.usage.used)} از ${fa(w.usage.limit)}`],
      ['وضعیت', statusPill],
    ], rows, open) : el('div', { class: 'card empty' }, el('strong', { text: 'هنوز فضای کاری‌ای ساخته نشده' })));
}

async function showStores() {
  const rows = await get('/api/admin/stores');
  main.replaceChildren(pageHead('فروشگاه‌ها', 'ویجت «دیده شده» یعنی واقعاً از آن سایت بارگذاری شده است.'),
    rows.length ? table([
      ['فروشگاه', (s) => s.name, 'strong'],
      ['فضای کاری', (s) => el('button', { class: 'link-btn', type: 'button', text: s.workspaceName, onclick: () => workspaceDialog(s.workspaceId) })],
      ['دامنه', (s) => el('span', { class: 'ltr small', text: s.domain || '—' })],
      ['اتصال', (s) => PLATFORM[s.platform] + (s.integrationStatus === 'error' ? ' · خطا' : '')],
      ['ویجت دیده شده روی', sightingsCell],
      ['وضعیت', (s) => (s.disconnectedAt ? el('span', { class: 'pill', text: 'قطع' }) : el('span', { class: 'pill pill-success', text: 'متصل' }))],
    ], rows) : el('div', { class: 'card empty' }, el('strong', { text: 'هنوز فروشگاهی ساخته نشده' })));
}

async function workspaceDialog(id) {
  let w;
  try { w = await get(`/api/admin/workspaces/${id}`); } catch (err) { toast(err.message, 'alert'); return; }
  const dialog = el('dialog', { class: 'form-dialog admin-dialog', 'aria-labelledby': 'ws-title' });
  const close = () => { dialog.close(); dialog.remove(); };
  const after = async (message) => { toast(message); close(); await show(); await workspaceDialog(id); };
  const pay = el('button', { class: 'btn', type: 'button', text: 'ثبت پرداخت' });
  pay.addEventListener('click', () => formDialog({
    title: `ثبت پرداخت — ${w.name}`, intro: 'پلن حرفه‌ای تا پایان روزِ «تمدید تا» (به وقت تهران) فعال می‌شود.',
    fields: [
      { name: 'amount', label: 'مبلغ (تومان)', type: 'amount', required: true },
      { name: 'periodEnd', label: 'تمدید تا', type: 'date', required: true },
      { name: 'note', label: 'یادداشت', maxlength: 200, placeholder: 'مثلاً کارت به کارت، پیگیری ۱۲۳۴' },
    ],
    initial: { periodEnd: tehranToday() }, submitLabel: 'ثبت',
    onSubmit: (v) => api('POST', `/api/admin/workspaces/${id}/payments`, v),
  }).then((ok) => ok && after('پرداخت ثبت شد')));
  const plan = el('button', { class: 'btn btn-secondary', type: 'button', text: 'تغییر پلن' });
  plan.addEventListener('click', () => formDialog({
    title: `تغییر پلن — ${w.name}`, intro: 'بدون ثبت پرداخت؛ برای هدیه یا اصلاح. تاریخ خالی = بدون انقضا.',
    fields: [
      { name: 'plan', label: 'پلن', type: 'select', options: [{ value: 'free', label: 'رایگان' }, { value: 'pro', label: 'حرفه‌ای' }] },
      { name: 'paidUntil', label: 'تا تاریخ (فقط حرفه‌ای)', type: 'date' },
    ],
    initial: { plan: w.plan, paidUntil: '' }, submitLabel: 'ذخیره',
    onSubmit: (v) => api('PUT', `/api/admin/workspaces/${id}/plan`, { plan: v.plan, paidUntil: v.paidUntil || null }),
  }).then((ok) => ok && after('پلن تغییر کرد')));
  const suspended = w.status === 'suspended';
  const toggle = el('button', { class: `btn ${suspended ? 'btn-secondary' : 'btn-ghost danger-text'}`, type: 'button', text: suspended ? 'فعال کردن دوباره' : 'تعلیق' });
  toggle.addEventListener('click', async () => {
    const ok = await confirmDialog(suspended
      ? { title: 'فعال کردن دوباره؟', body: 'دستیارهای این فضای کاری دوباره پاسخ می‌دهند.', confirmText: 'فعال کن', danger: false }
      : { title: `تعلیق «${w.name}»؟`, body: 'دستیارها به مشتری‌ها فقط پیام «در دسترس نیست» می‌دهند و صاحب فروشگاه دلیل را در پنل می‌بیند. اطلاعات حفظ می‌شود.', confirmText: 'تعلیق' });
    if (!ok) return;
    try { await api('POST', `/api/admin/workspaces/${id}/${suspended ? 'reactivate' : 'suspend'}`); await after(suspended ? 'فعال شد' : 'معلق شد'); } catch (err) { toast(err.message, 'alert'); }
  });

  const facts = [
    ['مالک', el('span', { class: 'ltr', text: w.ownerEmail ?? '—' })], ['پلن', PLAN[w.effectivePlan] + (w.plan === 'pro' && w.effectivePlan === 'free' ? ' (منقضی)' : '')],
    ['تا', w.paidUntil ? faLastDay(w.paidUntil) : '—'], ['مصرف این ماه', `${fa(w.usage.used)} از ${fa(w.usage.limit)} پاسخ هوشمند`],
    ['تعداد', `${fa(w.counts.conversations)} گفتگو · ${fa(w.counts.orders)} سفارش · ${fa(w.counts.products)} محصول`], ['ساخته شده', faDate(w.createdAt)],
  ];
  dialog.append(el('div', { class: 'dialog-body stack' },
    el('div', { class: 'line' }, el('h2', { id: 'ws-title', text: w.name }), statusPill(w)),
    el('dl', { class: 'facts' }, ...facts.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', {}, v)])),
    el('h3', { class: 'side-label', text: 'فروشگاه‌ها' }),
    el('ul', { class: 'plain-list' }, ...w.stores.map((s) => el('li', { class: 'small' }, el('strong', { text: s.name }), ' · ', PLATFORM[s.platform], ' · ',
      el('span', { class: 'ltr', text: s.domain || 'بدون دامنه' }), ' · ', sightingsCell(s)))),
    el('h3', { class: 'side-label', text: 'پرداخت‌ها' }),
    w.payments.length
      ? el('ul', { class: 'plain-list' }, ...w.payments.map((p) => el('li', { class: 'small' }, `${toman(p.amount)} · تا ${faLastDay(p.periodEnd)} · ${faDate(p.createdAt)}${p.note ? ` · ${p.note}` : ''}`)))
      : el('p', { class: 'subtle small', text: 'پرداختی ثبت نشده.' })),
  el('div', { class: 'form-actions admin-actions' }, toggle, plan, pay, el('button', { class: 'btn btn-ghost', type: 'button', text: 'بستن', onclick: close })));
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  document.body.append(dialog);
  dialog.showModal();
}

async function show() {
  drawTabs();
  main.setAttribute('aria-busy', 'true');
  try {
    await (currentTab() === 'stores' ? showStores() : showWorkspaces());
  } catch (err) {
    const notOperator = /دسترسی/.test(err.message);
    main.replaceChildren(el('div', { class: 'card empty' }, icon('alert'), el('strong', { text: notOperator ? 'این بخش فقط برای مدیر سامانه است' : 'بارگذاری نشد' }),
      el('p', { text: err.message }), notOperator ? el('a', { class: 'btn', href: '/app', text: 'پنل فروشگاه' }) : null));
  } finally {
    main.setAttribute('aria-busy', 'false');
  }
}

document.getElementById('logout').addEventListener('click', async () => { await api('POST', '/api/auth/logout'); location.assign('/panel'); });
addEventListener('popstate', show);
show();
