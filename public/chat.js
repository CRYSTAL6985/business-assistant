// Customer chat page: /chat/<slug>. Sends each message to POST /api/chat/<slug>, keeps the
// conversation id in localStorage, and redraws the earlier conversation after a reload.
const slug = decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || '');
const storageKey = `conversation:${slug}`;
const log = document.getElementById('log');
const form = document.getElementById('composer');
const input = document.getElementById('input');
const sendButton = document.getElementById('send');
const counter = document.getElementById('counter');
const suggestions = document.getElementById('suggestions');

const COUNTER_FROM = 800; // show the remaining characters only when it starts to matter
const POLL_MS = 5000;      // how often an open page checks for replies from the shop's staff
const NEAR_BOTTOM_PX = 120;
const isTouch = matchMedia('(pointer: coarse)').matches;

let shop = null;
let conversationId = readStored();
let sending = false;
let lastSeenId = 0; // newest message id this page has drawn or skipped
let config = null;  // branding from /api/chat/<slug>/config

function readStored() {
  try { return localStorage.getItem(storageKey); } catch { return null; }
}
function store(id) {
  try {
    if (id) localStorage.setItem(storageKey, id);
    else localStorage.removeItem(storageKey);
  } catch { /* private mode: the conversation just won't survive a reload */ }
}

/* ---------- drawing ---------- */

function isNearBottom() {
  return log.scrollHeight - log.scrollTop - log.clientHeight < NEAR_BOTTOM_PX;
}
function scrollToEnd(force) {
  if (force || isNearBottom()) log.scrollTo({ top: log.scrollHeight, behavior: 'smooth' });
}

function metaFor(source, orderId) {
  if (source === 'staff') return [icon('message', 'icon icon-sm'), el('span', { text: 'پشتیبان فروشگاه' })];
  if (orderId) return el('span', { class: 'badge badge-success', text: `سفارش ${faNumber(orderId)} ثبت شد` });
  if (source === 'offline') return [icon('wifi-off', 'icon icon-sm'), el('span', { text: 'پاسخ خودکار از سؤالات متداول' })];
  return null;
}

function addMessage(role, text, { source, orderId } = {}) {
  const meta = metaFor(source, orderId);
  const bubble = el('div', { class: `msg ${role === 'staff' ? 'assistant staff' : role}` }, bidiText(text), meta && el('div', { class: 'msg-meta' }, meta));
  const stick = role === 'user' || isNearBottom();
  log.append(bubble);
  scrollToEnd(stick);
  return bubble;
}

function addTyping() {
  const bubble = el('div', { class: 'msg assistant typing', 'aria-label': 'در حال نوشتن' }, el('span'), el('span'), el('span'));
  log.append(bubble);
  scrollToEnd(true);
  return bubble;
}

function addError(text, retry) {
  const bubble = el('div', { class: 'msg assistant error', role: 'alert' },
    el('div', { text }),
    el('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => { bubble.remove(); retry(); } },
      icon('rotate', 'icon icon-sm'), 'تلاش دوباره'));
  log.append(bubble);
  scrollToEnd(true);
}

function drawIntro() {
  log.replaceChildren(
    el('div', { class: 'day-intro' },
      el('div', { class: 'avatar', 'aria-hidden': 'true' }, icon('bag')),
      el('h2', { text: shop.name }),
      shop.description && el('p', { class: 'muted', text: shop.description })),
  );
  addMessage('assistant', config?.welcome ?? `سلام! من دستیار ${shop.name} هستم. دربارهٔ محصولات و قیمت‌ها بپرسید، یا همین‌جا سفارش بدهید.`);
}

/** System line (not a message), e.g. "a colleague will answer soon". Shown once in a row. */
function addNotice(text) {
  if (log.lastElementChild?.classList.contains('notice') && log.lastElementChild.textContent === text) return;
  log.append(el('div', { class: 'notice', role: 'status', text }));
  scrollToEnd(true);
}

function setSuggestionsVisible(visible) {
  suggestions.hidden = !visible;
}

/* ---------- loading ---------- */

async function loadShop() {
  const res = await fetch(`/api/chat/${encodeURIComponent(slug)}`);
  if (!res.ok) {
    document.getElementById('shop-name').textContent = 'فروشگاه پیدا نشد';
    document.getElementById('status').hidden = true;
    log.replaceChildren(el('div', { class: 'empty', style: 'margin:auto' },
      icon('alert', 'icon icon-lg'), el('p', { text: 'این صفحهٔ گفتگو وجود ندارد. نشانی را بررسی کنید.' })));
    form.closest('.composer-wrap').hidden = true;
    return false;
  }
  shop = await res.json();
  config = await fetch(`/api/chat/${encodeURIComponent(slug)}/config`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (config?.color) document.documentElement.style.setProperty('--accent', config.color);
  if (config?.color) document.documentElement.style.setProperty('--bubble-user', config.color);
  document.title = `گفتگو با ${shop.name}`;
  document.getElementById('shop-name').textContent = shop.name;
  return true;
}

async function loadHistory() {
  drawIntro();
  if (!conversationId) return;
  try {
    const res = await fetch(`/api/chat/${encodeURIComponent(slug)}/history/${encodeURIComponent(conversationId)}`);
    const messages = res.ok ? await res.json() : [];
    if (!messages.length) return store((conversationId = null));
    for (const m of messages) addMessage(m.role, m.content, { source: m.source });
    lastSeenId = messages.at(-1).id;
    setSuggestionsVisible(false);
    log.scrollTop = log.scrollHeight;
  } catch {
    /* history is a convenience: on a network error the page still works as a fresh chat */
  }
}

/* ---------- sending ---------- */

async function send(text, { echo = true } = {}) {
  if (sending) return;
  sending = true;
  updateSendState();
  setSuggestionsVisible(false);
  if (echo) addMessage('user', text);
  const typing = addTyping();

  try {
    const res = await fetch(`/api/chat/${encodeURIComponent(slug)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId, message: text }),
    });
    const data = await res.json().catch(() => ({}));
    typing.remove();
    if (!res.ok) {
      addError(data.error || 'پیام ارسال نشد.', () => send(text, { echo: false }));
      return;
    }
    conversationId = data.conversationId;
    store(conversationId);
    if (data.reply) addMessage('assistant', data.reply, { source: data.source, orderId: data.orderId });
    if (data.notice) addNotice(data.notice);
    startPolling();
  } catch {
    typing.remove();
    addError('اتصال به اینترنت برقرار نشد.', () => send(text, { echo: false }));
  } finally {
    sending = false;
    updateSendState();
    if (!isTouch) input.focus();
  }
}

function updateSendState() {
  const length = input.value.trim().length;
  sendButton.disabled = sending || length === 0;
  counter.hidden = input.value.length < COUNTER_FROM;
  counter.textContent = faNumber(input.maxLength - input.value.length);
}

function autosize() {
  input.style.height = 'auto';
  input.style.height = `${input.scrollHeight}px`;
}

function submitInput() {
  const text = input.value.trim();
  if (!text || sending) return;
  input.value = '';
  autosize();
  updateSendState();
  send(text);
}

/* ---------- staff replies ---------- */

let pollTimer = null;
/** While the page is open, fetch messages newer than lastSeenId and draw the staff's replies. */
async function poll() {
  if (!conversationId || document.hidden || sending) return;
  try {
    const res = await fetch(`/api/chat/${encodeURIComponent(slug)}/history/${encodeURIComponent(conversationId)}?after=${lastSeenId}`);
    if (!res.ok) return;
    const fresh = await res.json();
    for (const m of fresh) {
      // Own messages and assistant replies were already drawn by send(); only staff replies are new here.
      if (m.role === 'staff') addMessage('staff', m.content, { source: 'staff' });
      lastSeenId = Math.max(lastSeenId, m.id);
    }
  } catch { /* offline for a moment: the next poll tries again */ }
}
function startPolling() {
  if (!pollTimer) pollTimer = setInterval(poll, POLL_MS);
}

/* ---------- events ---------- */

form.addEventListener('submit', (event) => {
  event.preventDefault();
  submitInput();
});

input.addEventListener('input', () => {
  autosize();
  updateSendState();
});

input.addEventListener('keydown', (event) => {
  // Desktop: Enter sends, Shift+Enter is a new line. Phones keep Enter as a new line and use the button.
  // isComposing: don't send while a Persian/IME composition is still in progress.
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !isTouch) {
    event.preventDefault();
    submitInput();
  }
});

suggestions.addEventListener('click', (event) => {
  const chip = event.target.closest('.chip');
  if (chip && !sending) send(chip.textContent);
});

document.getElementById('new-chat').addEventListener('click', () => {
  if (sending) return;
  store((conversationId = null));
  lastSeenId = 0;
  drawIntro();
  setSuggestionsVisible(true);
  toast('گفتگوی تازه شروع شد');
  if (!isTouch) input.focus();
});

(async () => {
  if (!(await loadShop())) return;
  await loadHistory();
  if (conversationId) startPolling();
  if (!isTouch) input.focus();
})();
