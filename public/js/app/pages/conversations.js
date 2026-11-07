// Inbox: conversation list · thread · customer panel. Owners read chats, take over from the AI,
// reply as staff and keep internal notes. Polls while visible so new messages appear on their own.
import { api, get } from '../api.js';
import { pageHead } from '../table.js';
import { explain } from '../explain.js';

const THREAD_POLL_MS = 5000;
const LIST_POLL_MS = 20000;
const STATUS_FILTERS = [{ value: '', label: 'همه' }, { value: 'waiting', label: 'منتظر پاسخ' }, { value: 'open', label: 'باز' }, { value: 'closed', label: 'بسته' }];
const SENDER = { user: 'مشتری', assistant: 'دستیار هوشمند', staff: 'شما' };
const ORDER_STATUS = { new: 'جدید', confirmed: 'تأیید شده', sent: 'ارسال شده', cancelled: 'لغو شده' };
const fa = (n, o) => Number(n).toLocaleString('fa-IR', o);
const shortTime = (s) => new Date(`${s.replace(' ', 'T')}Z`).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });

export async function render(main, { storeId, refreshMe }) {
  const params = () => new URLSearchParams(location.search);
  const setParam = (key, value) => {
    const p = params();
    if (value) p.set(key, value); else p.delete(key);
    history.replaceState(null, '', `${location.pathname}?${p}`);
  };
  let listTimer = null;
  let threadTimer = null;
  let current = null; // open conversation detail

  const search = el('input', { class: 'input', type: 'search', placeholder: 'جستجو در نام و پیام‌ها…', 'aria-label': 'جستجوی گفتگو', value: params().get('q') ?? '' });
  const statusSeg = el('div', { class: 'seg seg-sm', role: 'group', 'aria-label': 'وضعیت گفتگو' }, ...STATUS_FILTERS.map((f) => el('button', {
    type: 'button', text: f.label, 'aria-pressed': String((params().get('status') ?? '') === f.value),
    onclick: (e) => { statusSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); setParam('status', f.value); loadList(); },
  })));
  const listEl = el('ul', { class: 'list inbox-list', 'aria-label': 'گفتگوها' });
  const listPane = el('section', { class: 'card inbox-pane inbox-list-pane', 'aria-label': 'فهرست گفتگوها' },
    el('div', { class: 'inbox-tools' }, el('div', { class: 'toolbar-search' }, icon('search', 'icon icon-sm'), search), statusSeg), listEl);
  const threadPane = el('section', { class: 'card inbox-pane inbox-thread', 'aria-label': 'گفتگو' });
  const sidePane = el('aside', { class: 'card inbox-pane inbox-side', 'aria-label': 'اطلاعات مشتری' });
  const layout = el('div', { class: 'inbox' }, listPane, threadPane, sidePane);
  main.replaceChildren(pageHead('گفتگوها', 'گفتگوهای مشتری‌ها با دستیار. هر وقت لازم شد، خودتان پاسخ بدهید.'), layout);

  let searchTimer;
  search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { setParam('q', search.value.trim()); loadList(); }, 300); });

  function emptyThread() {
    layout.classList.remove('has-thread');
    threadPane.replaceChildren(el('div', { class: 'empty inbox-empty' }, icon('message-square'), el('strong', { text: 'یک گفتگو را انتخاب کنید' }), el('p', { text: 'پیام‌ها، پاسخ‌های دستیار و سفارش‌های هر گفتگو اینجا نمایش داده می‌شود.' })));
    sidePane.replaceChildren();
  }

  async function loadList() {
    const p = new URLSearchParams({ per: '50' });
    for (const k of ['q', 'status']) if (params().get(k)) p.set(k, params().get(k));
    if (storeId) p.set('store', storeId);
    try {
      const data = await get(`/api/app/conversations?${p}`);
      const selected = params().get('c');
      listEl.replaceChildren(...data.items.map((c) => el('li', {}, el('button', {
        type: 'button', class: `row-link inbox-row${c.id === selected ? ' is-selected' : ''}${c.unread ? ' is-unread' : ''}`,
        'aria-current': c.id === selected ? 'true' : null, onclick: () => open(c.id),
      },
        el('span', { class: 'row-title' }, c.unread ? el('span', { class: 'unread-dot', 'aria-label': 'خوانده‌نشده' }) : null, c.customerName || 'مشتری ناشناس'),
        el('span', { class: 'row-meta', text: shortTime(c.lastMessageAt) }),
        el('span', { class: 'row-sub', text: `${c.lastRole === 'user' ? '' : c.lastRole === 'staff' ? 'شما: ' : 'دستیار: '}${c.lastMessage ?? ''}` }),
        el('span', { class: 'row-tags' },
          c.waiting ? el('span', { class: 'pill pill-warn', text: 'منتظر' }) : null,
          c.handler === 'human' ? el('span', { class: 'pill pill-accent', text: 'شما' }) : null,
          c.status === 'closed' ? el('span', { class: 'pill', text: 'بسته' }) : null,
          storeId ? null : el('span', { class: 'subtle small', text: c.storeName }))))));
      if (!data.items.length) {
        listEl.replaceChildren(el('li', {}, el('div', { class: 'empty' }, icon('inbox'), el('strong', { text: params().get('q') || params().get('status') ? 'گفتگویی پیدا نشد' : 'هنوز گفتگویی نیست' }),
          el('p', { text: 'وقتی مشتری‌ها از ویجت یا صفحهٔ گفتگو پیام بدهند، اینجا می‌بینید.' }))));
      }
    } catch (err) {
      listEl.replaceChildren(el('li', {}, el('div', { class: 'empty' }, el('strong', { text: 'بارگذاری نشد' }), el('p', { text: err.message }))));
    }
  }

  function bubble(m) {
    const who = m.role === 'staff' ? (m.author || SENDER.staff) : SENDER[m.role];
    const tag = m.role === 'assistant' ? (m.source === 'ai' ? 'AI' : m.source === 'offline' ? 'آفلاین' : null) : null;
    const context = m.context?.order
      ? el('div', { class: `msg-note ${m.context.order.ok ? 'ok' : 'bad'}`, text: m.context.order.ok ? `سفارش #${fa(m.context.order.orderId, { useGrouping: false })} پس از بررسی سرور ثبت شد` : `سفارش رد شد: ${m.context.order.error}` })
      : null;
    const why = m.role === 'assistant' ? explain(m.context) : null;
    return el('div', { class: `ibx-msg from-${m.role}` },
      el('div', { class: 'ibx-meta' }, el('span', { text: who }), tag ? el('span', { class: `pill ${m.source === 'ai' ? 'pill-accent' : ''}`, text: tag }) : null, el('time', { text: shortTime(m.createdAt) })),
      el('div', { class: 'ibx-bubble' }, bidiText(m.content)), context, why);
  }

  function threadView(c) {
    const human = c.handler === 'human';
    const closed = c.status === 'closed';
    const back = el('button', { class: 'btn btn-ghost btn-icon only-narrow-inline', type: 'button', 'aria-label': 'بازگشت به فهرست', onclick: () => { setParam('c', ''); stopThread(); emptyThread(); } }, icon('chevron-left', 'icon flip'));
    const act = (path, message) => async (e) => withBusy(e.currentTarget, async () => {
      try { await api('POST', `/api/app/conversations/${c.id}/${path}`); toast(message); await open(c.id, { keepScroll: true }); loadList(); refreshMe(); } catch (err) { toast(err.message, 'alert'); }
    });
    const header = el('div', { class: 'ibx-head' }, back,
      el('div', { class: 'ibx-title' }, el('h2', { text: c.customerName || 'مشتری ناشناس' }),
        el('div', { class: 'subtle small' }, `${c.storeName} · `, human ? 'پاسخ با شما' : 'پاسخ با دستیار', closed ? ' · بسته' : '')),
      el('div', { class: 'page-actions' },
        human
          ? el('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: act('release', 'گفتگو به دستیار واگذار شد') }, icon('sparkles', 'icon icon-sm'), 'واگذاری به دستیار')
          : el('button', { class: 'btn btn-sm', type: 'button', onclick: act('takeover', 'از این به بعد شما پاسخ می‌دهید') }, icon('message-square', 'icon icon-sm'), 'پاسخ با من'),
        closed
          ? el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: act('reopen', 'گفتگو باز شد'), text: 'باز کردن' })
          : el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: act('close', 'گفتگو بسته شد'), text: 'بستن گفتگو' })));
    const log = el('div', { class: 'ibx-log', role: 'log', 'aria-live': 'polite' }, ...c.messages.map(bubble));
    const input = el('textarea', { class: 'textarea', rows: 2, maxlength: 2000, placeholder: human ? 'پاسخ شما به مشتری…' : 'با ارسال پاسخ، گفتگو از دستیار به شما منتقل می‌شود…', 'aria-label': 'پاسخ به مشتری' });
    const send = el('button', { class: 'btn', type: 'submit' }, icon('send', 'icon icon-sm flip'), 'ارسال');
    const composer = el('form', { class: 'ibx-composer', onsubmit: async (e) => {
      e.preventDefault();
      const content = input.value.trim();
      if (!content) return input.focus();
      await withBusy(send, async () => {
        try { await api('POST', `/api/app/conversations/${c.id}/messages`, { content }); input.value = ''; await open(c.id); loadList(); refreshMe(); } catch (err) { toast(err.message, 'alert'); }
      });
    } }, input, send);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) composer.requestSubmit(); });
    threadPane.replaceChildren(header, log, composer);
    requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
  }

  function sideView(c) {
    const name = el('input', { class: 'input', id: 'cust-name', value: c.customerName, maxlength: 80, placeholder: 'مثلاً سارا محمدی' });
    const saveName = el('button', { class: 'btn btn-secondary btn-sm', type: 'button', text: 'ذخیره', onclick: (e) => withBusy(e.currentTarget, async () => {
      try { await api('PUT', `/api/app/conversations/${c.id}`, { customerName: name.value.trim() }); toast('نام مشتری ذخیره شد'); await open(c.id, { keepScroll: true }); loadList(); } catch (err) { toast(err.message, 'alert'); }
    }) });
    const note = el('textarea', { class: 'textarea', rows: 2, maxlength: 1000, placeholder: 'یادداشت داخلی — مشتری نمی‌بیند', 'aria-label': 'یادداشت داخلی' });
    const addNote = el('button', { class: 'btn btn-secondary btn-sm', type: 'button', text: 'افزودن یادداشت', onclick: (e) => withBusy(e.currentTarget, async () => {
      if (!note.value.trim()) return note.focus();
      try { await api('POST', `/api/app/conversations/${c.id}/notes`, { body: note.value.trim() }); await open(c.id, { keepScroll: true }); } catch (err) { toast(err.message, 'alert'); }
    }) });
    sidePane.replaceChildren(
      el('div', { class: 'side-block' }, el('label', { for: 'cust-name', class: 'side-label', text: 'نام مشتری' }), el('div', { class: 'inline-form' }, name, saveName)),
      el('div', { class: 'side-block' }, el('div', { class: 'side-label', text: 'فروشگاه' }), el('div', { text: c.storeName }),
        el('a', { class: 'small', href: `/chat/${c.storeSlug}`, target: '_blank', rel: 'noopener', text: 'صفحهٔ گفتگوی مشتری' })),
      el('div', { class: 'side-block' }, el('div', { class: 'side-label', text: 'شروع گفتگو' }), el('div', { text: faDate(c.createdAt) })),
      el('div', { class: 'side-block' }, el('div', { class: 'side-label', text: 'سفارش‌های این گفتگو' }),
        c.orders.length
          ? el('ul', { class: 'plain-list' }, ...c.orders.map((o) => el('li', {}, el('a', { href: `/app/orders?q=%23${o.id}`, 'data-link': '', text: `#${fa(o.id, { useGrouping: false })} · ${fa(o.total)} تومان` }), el('span', { class: 'subtle small', text: ` (${ORDER_STATUS[o.status]})` }))))
          : el('p', { class: 'subtle small', text: 'سفارشی در این گفتگو ثبت نشده.' })),
      el('div', { class: 'side-block' }, el('div', { class: 'side-label', text: 'یادداشت‌های داخلی' }),
        ...c.notes.map((n) => el('div', { class: 'note' }, el('p', { text: n.body }), el('span', { class: 'subtle small', text: `${n.author ?? ''} · ${faDate(n.createdAt)}` }))),
        note, addNote));
  }

  function stopThread() { clearInterval(threadTimer); threadTimer = null; }

  async function open(id, { keepScroll = false } = {}) {
    setParam('c', id);
    let detail;
    try { detail = await get(`/api/app/conversations/${encodeURIComponent(id)}`); } catch (err) { toast(err.message, 'alert'); return; }
    const changed = !current || current.id !== id || current.messages.length !== detail.messages.length || current.handler !== detail.handler || current.status !== detail.status;
    const draft = threadPane.querySelector('textarea')?.value;
    current = detail;
    layout.classList.add('has-thread');
    if (changed || !keepScroll) threadView(detail);
    if (draft) threadPane.querySelector('textarea').value = draft;
    sideView(detail);
    stopThread();
    threadTimer = setInterval(async () => {
      if (document.hidden || !document.body.contains(threadPane)) return;
      const fresh = await get(`/api/app/conversations/${encodeURIComponent(id)}`).catch(() => null);
      if (fresh && fresh.messages.length !== current.messages.length) open(id, { keepScroll: true });
    }, THREAD_POLL_MS);
    loadList();
  }

  listTimer = setInterval(() => {
    if (!document.body.contains(listPane)) { clearInterval(listTimer); stopThread(); return; }
    if (!document.hidden) loadList();
  }, LIST_POLL_MS);

  await loadList();
  if (params().get('c')) await open(params().get('c')); else emptyThread();
}
