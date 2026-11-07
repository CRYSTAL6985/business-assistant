// Owner dashboard. Talks only to /api/auth and /api/panel; the session cookie does the rest.
// Helpers el, icon, toast, confirmDialog, withBusy, toman, faNumber, faDate come from ui.js.

const ORDER_STATUSES = {
  new: { label: 'جدید', badge: 'badge-accent' },
  confirmed: { label: 'تأیید شده', badge: 'badge-warn' },
  sent: { label: 'ارسال شده', badge: 'badge-success' },
  cancelled: { label: 'لغو شده', badge: 'badge-danger' },
};
const PLAN_LABELS = { free: 'رایگان', pro: 'حرفه‌ای' };
const TABS = ['overview', 'products', 'faqs', 'orders', 'conversations'];

const $ = (selector) => document.querySelector(selector);
let state = null; // last GET /api/panel response

/** Persian/Arabic digits and separators -> plain integer string ("۴٬۹۰۰٬۰۰۰" -> "4900000"). */
function latinDigits(text) {
  return String(text)
    .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/[,٬،\s]/g, '');
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path.startsWith('/api/panel')) showAuth();
  if (res.status === 403 && data.operator) location.assign('/admin'); // signed in as the operator, who has no shop
  if (!res.ok) throw new Error(data.error || 'خطایی رخ داد. دوباره امتحان کنید.');
  return data;
}

/** Wires a form: native checks first, then onSubmit; errors appear inside the form, the button spins meanwhile. */
function handleForm(form, onSubmit) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = form.querySelector('.form-error');
    error.textContent = '';
    const firstInvalid = [...form.elements].find((field) => field.willValidate && !field.checkValidity());
    for (const field of form.elements) if (field.willValidate) field.setAttribute('aria-invalid', String(!field.checkValidity()));
    if (firstInvalid) {
      error.textContent = firstInvalid.validationMessage;
      return firstInvalid.focus();
    }
    await withBusy(form.querySelector('[type="submit"]'), async () => {
      try {
        await onSubmit(Object.fromEntries(new FormData(form)), form);
      } catch (err) {
        error.textContent = err.message;
      }
    });
  });
  form.addEventListener('input', (event) => event.target.removeAttribute?.('aria-invalid'));
}

/* ---------- auth screen ---------- */

function showAuth() {
  $('#app-view').hidden = true;
  $('#auth-view').hidden = false;
  document.title = 'ورود · پنل کسب‌وکار';
}

function selectAuthTab(which) {
  for (const name of ['login', 'register']) {
    $(`#tab-${name}`).setAttribute('aria-selected', String(name === which));
    $(`#${name}-form`).hidden = name !== which;
  }
  $(`#${which}-form input`).focus();
}

function wireAuth() {
  $('#tab-login').addEventListener('click', () => selectAuthTab('login'));
  $('#tab-register').addEventListener('click', () => selectAuthTab('register'));
  for (const toggle of document.querySelectorAll('[data-toggle-password]')) {
    toggle.addEventListener('click', () => {
      const field = toggle.previousElementSibling;
      const show = field.type === 'password';
      field.type = show ? 'text' : 'password';
      toggle.setAttribute('aria-label', show ? 'پنهان کردن رمز عبور' : 'نمایش رمز عبور');
      toggle.querySelector('use').setAttribute('href', `/icons.svg#${show ? 'eye-off' : 'eye'}`);
    });
  }
  const slug = $('#reg-slug');
  slug.addEventListener('input', () => {
    slug.value = slug.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    $('#slug-preview').textContent = slug.value ? `${location.origin}/chat/${slug.value}` : '';
  });
  handleForm($('#login-form'), async (f) => {
    const res = await api('POST', '/api/auth/login', f);
    if (res.operator && !res.hasWorkspace) return location.assign('/admin'); // the operator has no shop panel
    afterLogin();
  });
  handleForm($('#register-form'), async (f) => { await api('POST', '/api/auth/register', f); afterLogin('حساب ساخته شد. خوش آمدید!'); });
}

/* ---------- data ---------- */

async function refresh() {
  state = await api('GET', '/api/panel');
  renderOverview();
  renderProducts();
  renderFaqs();
}

/** Logged in: go to the new panel (/app) unless ?next=panel asks for this classic panel. */
async function afterLogin(welcome) {
  if (new URLSearchParams(location.search).get('next') !== 'panel') return location.assign('/app');
  await enterApp();
  if (welcome) toast(welcome);
}

async function enterApp() {
  await refresh();
  $('#auth-view').hidden = true;
  $('#app-view').hidden = false;
  document.title = `${state.business.name} · پنل کسب‌وکار`;
  selectTab(TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview', { focus: false });
}

function renderOverview() {
  const { business, usage, stats, products, faqs } = state;
  $('#biz-title').textContent = business.name;
  $('#chat-link').href = `/chat/${business.slug}`;
  $('#biz-name').value = business.name;
  $('#biz-desc').value = business.description;
  $('#biz-tone').value = business.tone;

  $('#stat-usage').textContent = faNumber(usage.used);
  $('#stat-plan').textContent = `از ${faNumber(usage.limit)} · طرح ${PLAN_LABELS[usage.plan] || usage.plan}`;
  const meter = $('#usage-meter');
  meter.setAttribute('aria-valuemax', usage.limit);
  meter.setAttribute('aria-valuenow', usage.used);
  $('#usage-bar').style.setProperty('--fill', Math.min(1, usage.used / usage.limit));
  $('#stat-orders').textContent = faNumber(stats.newOrders);
  $('#stat-convos').textContent = faNumber(stats.conversationsThisMonth);
  $('#stat-products').textContent = faNumber(products.length);
  $('#stat-faqs').textContent = `و ${faNumber(faqs.length)} سؤال متداول`;
  const badge = $('#new-orders-count');
  badge.hidden = stats.newOrders === 0;
  badge.textContent = faNumber(stats.newOrders);
  $('#embed-code').textContent = `<script src="${location.origin}/widget.js" data-business="${business.slug}" defer></script>`;
}

/* ---------- lists ---------- */

function emptyState(iconName, text) {
  return el('div', { class: 'empty' }, icon(iconName, 'icon icon-lg'), el('p', { text }));
}

function itemActions(label, onEdit, onDelete) {
  return el('div', { class: 'item-actions' },
    el('button', { type: 'button', class: 'btn btn-ghost btn-sm btn-icon', 'aria-label': `ویرایش ${label}`, title: 'ویرایش', onclick: onEdit }, icon('pencil', 'icon icon-sm')),
    el('button', { type: 'button', class: 'btn btn-danger btn-sm btn-icon', 'aria-label': `حذف ${label}`, title: 'حذف', onclick: onDelete }, icon('trash', 'icon icon-sm')));
}

async function removeItem(path, label) {
  const ok = await confirmDialog({ title: `«${label}» حذف شود؟`, body: 'این کار برگشت‌پذیر نیست.', confirmText: 'حذف' });
  if (!ok) return;
  try {
    await api('DELETE', path);
    await refresh();
    toast('حذف شد', 'trash');
  } catch (err) {
    toast(err.message, 'alert');
  }
}

function renderProducts() {
  const list = $('#product-list');
  if (!state.products.length) return list.replaceChildren(emptyState('package', 'هنوز محصولی ثبت نشده. اولین محصول را از فرم کنار اضافه کنید.'));
  list.replaceChildren(...state.products.map((p, i) => el('article', { class: 'item', style: `animation-delay:${Math.min(i, 10) * 30}ms`, 'data-id': p.id },
    el('div', { class: 'item-head' },
      el('div', { class: 'stack-sm' },
        el('span', { class: 'item-title' }, el('bdi', { text: p.name })),
        el('div', { class: 'row' },
          el('span', { class: 'price', text: toman(p.price) }),
          el('span', { class: `badge ${p.in_stock ? 'badge-success' : 'badge-danger'}`, text: p.in_stock ? 'موجود' : 'ناموجود' }))),
      itemActions(p.name,
        () => startEdit($('#product-form'), list, p.id, { id: p.id, name: p.name, price: p.price, description: p.description, inStock: p.in_stock }),
        () => removeItem(`/api/panel/products/${p.id}`, p.name))),
    p.description && el('p', { class: 'muted small clamp', dir: 'auto', text: p.description }))));
}

function renderFaqs() {
  const list = $('#faq-list');
  if (!state.faqs.length) return list.replaceChildren(emptyState('help', 'هنوز سؤالی ثبت نشده. پرتکرارترین سؤال مشتری‌ها را اضافه کنید.'));
  list.replaceChildren(...state.faqs.map((f, i) => el('article', { class: 'item', style: `animation-delay:${Math.min(i, 10) * 30}ms`, 'data-id': f.id },
    el('div', { class: 'item-head' },
      el('span', { class: 'item-title', text: f.question }),
      itemActions(f.question,
        () => startEdit($('#faq-form'), list, f.id, f),
        () => removeItem(`/api/panel/faqs/${f.id}`, f.question))),
    el('p', { class: 'muted small', text: f.answer }))));
}

/** Loads an item into the side form, highlights it in the list, and moves focus to the form. */
function startEdit(form, list, id, values) {
  for (const [name, value] of Object.entries(values)) {
    const field = form.elements[name];
    if (!field) continue;
    if (field.type === 'checkbox') field.checked = Boolean(value);
    else field.value = value;
  }
  const title = form.querySelector('[data-form-title]');
  title.textContent = title.dataset.edit;
  for (const item of list.children) item.classList.toggle('editing', item.dataset.id === String(id));
  form.querySelector('input:not([type=hidden]), textarea').focus({ preventScroll: true });
  form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  form.dispatchEvent(new Event('input'));
}

/** Product and FAQ forms: empty id = create (POST), id = update (PUT). */
function wireCrudForm(form, path, toBody, list) {
  handleForm(form, async (fields) => {
    const body = toBody(fields, form);
    if (fields.id) await api('PUT', `${path}/${fields.id}`, body);
    else await api('POST', path, body);
    const wasEdit = Boolean(fields.id);
    form.reset();
    await refresh();
    toast(wasEdit ? 'تغییرات ذخیره شد' : 'اضافه شد');
  });
  form.addEventListener('reset', () => {
    setTimeout(() => { // after the browser clears the fields
      form.elements.id.value = '';
      const title = form.querySelector('[data-form-title]');
      title.textContent = title.dataset.new;
      form.querySelector('.form-error').textContent = '';
      for (const item of list().children) item.classList.remove('editing');
      form.dispatchEvent(new Event('input'));
    });
  });
}

/* ---------- orders & conversations ---------- */

function orderCard(order) {
  const status = el('select', { class: 'status-select', 'aria-label': `وضعیت سفارش ${faNumber(order.id)}` },
    ...Object.entries(ORDER_STATUSES).map(([value, s]) => el('option', { value, text: s.label, selected: value === order.status })));
  status.addEventListener('change', async () => {
    try {
      await api('PUT', `/api/panel/orders/${order.id}`, { status: status.value });
      await refresh();
      toast(`سفارش ${faNumber(order.id)}: ${ORDER_STATUSES[status.value].label}`);
    } catch (err) {
      status.value = order.status;
      toast(err.message, 'alert');
    }
  });
  return el('article', { class: 'item' },
    el('div', { class: 'item-head' },
      el('div', { class: 'stack-sm' },
        el('span', { class: 'item-title', text: `سفارش ${faNumber(order.id)}` }),
        el('span', { class: 'small muted', text: faDate(order.created_at) })),
      status),
    el('div', { class: 'order-lines' },
      ...order.items.map((i) => el('div', {}, el('span', {}, el('bdi', { text: i.name }), ` × ${faNumber(i.qty)}`), el('span', { class: 'num', text: toman(i.price * i.qty) }))),
      el('div', {}, el('strong', { text: 'جمع' }), el('strong', { class: 'num', text: toman(order.total) }))),
    el('dl', { class: 'kv' },
      el('dt', { text: 'نام' }), el('dd', { text: order.customer_name }),
      el('dt', { text: 'موبایل' }), el('dd', {}, el('a', { href: `tel:${order.phone}`, class: 'ltr', text: order.phone })),
      el('dt', { text: 'آدرس' }), el('dd', { text: order.address })));
}

async function renderOrders() {
  const orders = await api('GET', '/api/panel/orders');
  $('#order-list').replaceChildren(...(orders.length ? orders.map(orderCard)
    : [emptyState('inbox', 'هنوز سفارشی ثبت نشده. وقتی مشتری در گفتگو سفارشی را تأیید کند، اینجا می‌آید.')]));
}

function conversationCard(c) {
  const firstQuestion = c.messages.find((m) => m.role === 'user')?.content || '—';
  const offline = c.messages.some((m) => m.source === 'offline');
  return el('details', { class: 'item convo' },
    el('summary', {},
      el('span', { class: 'preview', text: firstQuestion }),
      offline && el('span', { class: 'badge', text: 'آفلاین' }),
      el('span', { class: 'small muted', text: `${faNumber(c.messages.length)} پیام · ${faDate(c.created_at)}` })),
    el('div', { class: 'transcript' }, ...c.messages.map((m) => el('div', { class: `msg ${m.role}` }, bidiText(m.content)))));
}

async function renderConversations() {
  const conversations = await api('GET', '/api/panel/conversations');
  $('#conversation-list').replaceChildren(...(conversations.length ? conversations.map(conversationCard)
    : [emptyState('message', 'هنوز کسی پیام نداده. نشانی صفحهٔ گفتگو را برای مشتری‌ها بفرستید.')]));
}

/* ---------- tabs ---------- */

const TAB_LOADERS = { orders: renderOrders, conversations: renderConversations };

function selectTab(name, { focus = true } = {}) {
  for (const tab of document.querySelectorAll('.tab')) {
    const selected = tab.dataset.tab === name;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1; // roving tabindex: Tab enters the tab list once, arrows move inside
    if (selected && focus) tab.focus();
    if (selected) tab.scrollIntoView({ block: 'nearest', inline: 'nearest' }); // narrow screens: tab bar scrolls sideways
  }
  for (const panel of document.querySelectorAll('.tabpanel')) panel.hidden = panel.id !== `p-${name}`;
  history.replaceState(null, '', `#${name}`);
  TAB_LOADERS[name]?.().catch((err) => toast(err.message, 'alert'));
}

function wireTabs() {
  const tabs = [...document.querySelectorAll('.tab')];
  for (const tab of tabs) tab.addEventListener('click', () => selectTab(tab.dataset.tab, { focus: false }));
  addEventListener('hashchange', () => { // a pasted or typed #orders link switches tab without a reload
    const name = location.hash.slice(1);
    if (TABS.includes(name) && !$('#app-view').hidden) selectTab(name, { focus: false });
  });
  $('.tabs').addEventListener('keydown', (event) => {
    const index = tabs.indexOf(document.activeElement);
    if (index < 0) return;
    // Right-to-left: the left arrow moves to the next tab.
    const step = { ArrowLeft: 1, ArrowRight: -1 }[event.key];
    const target = step ? tabs[(index + step + tabs.length) % tabs.length]
      : event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : null;
    if (!target) return;
    event.preventDefault();
    selectTab(target.dataset.tab);
  });
}

/* ---------- start ---------- */

function wireApp() {
  wireTabs();
  handleForm($('#business-form'), async (f) => { await api('PUT', '/api/panel/business', f); await refresh(); toast('اطلاعات ذخیره شد'); });
  wireCrudForm($('#product-form'), '/api/panel/products',
    (f, form) => ({ name: f.name, description: f.description, price: Number(latinDigits(f.price)), inStock: form.elements.inStock.checked }),
    () => $('#product-list'));
  wireCrudForm($('#faq-form'), '/api/panel/faqs', (f) => ({ question: f.question, answer: f.answer }), () => $('#faq-list'));

  const price = $('#p-price');
  $('#product-form').addEventListener('input', () => {
    const n = Number(latinDigits(price.value));
    $('#price-preview').textContent = price.value && Number.isInteger(n) ? toman(n) : '';
  });

  $('#copy-embed').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('#embed-code').textContent);
      toast('کد کپی شد', 'copy');
    } catch {
      getSelection().selectAllChildren($('#embed-code')); // clipboard blocked (http, old browser): select it for Ctrl+C
      toast('کد را انتخاب کردیم؛ Ctrl+C بزنید', 'copy');
    }
  });

  $('#logout').addEventListener('click', async () => {
    await api('POST', '/api/auth/logout').catch(() => {});
    showAuth();
    selectAuthTab('login');
  });
}

wireAuth();
wireApp();
enterApp().catch(showAuth);
