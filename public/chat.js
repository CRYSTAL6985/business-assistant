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
const NEAR_BOTTOM_PX = 120;
const isTouch = matchMedia('(pointer: coarse)').matches;

let shop = null;
let conversationId = readStored();
let sending = false;

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
  if (orderId) return el('span', { class: 'badge badge-success', text: `سفارش ${faNumber(orderId)} ثبت شد` });
  if (source === 'offline') return [icon('wifi-off', 'icon icon-sm'), el('span', { text: 'پاسخ خودکار از سؤالات متداول' })];
  return null;
}

function addMessage(role, text, { source, orderId } = {}) {
  const meta = metaFor(source, orderId);
  const bubble = el('div', { class: `msg ${role}` }, bidiText(text), meta && el('div', { class: 'msg-meta' }, meta));
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
  addMessage('assistant', `سلام! من دستیار ${shop.name} هستم. دربارهٔ محصولات و قیمت‌ها بپرسید، یا همین‌جا سفارش بدهید.`);
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
    addMessage('assistant', data.reply, { source: data.source, orderId: data.orderId });
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
  drawIntro();
  setSuggestionsVisible(true);
  toast('گفتگوی تازه شروع شد');
  if (!isTouch) input.focus();
});

(async () => {
  if (!(await loadShop())) return;
  await loadHistory();
  if (!isTouch) input.focus();
})();
