// AI assistant settings for one store: edit the draft, preview it live, try it in a test chat that
// uses the draft, then publish. Customers only ever get the published version.
import { api, get } from '../api.js';
import { pageHead } from '../table.js';
import { navigate } from '../router.js';
import { explain } from '../explain.js';

const fa = (n) => Number(n).toLocaleString('fa-IR');
const TEXT_FIELDS = {
  assistantName: { label: 'نام دستیار', max: 60, hint: 'در سربرگ گفتگو به مشتری نمایش داده می‌شود.' },
  welcome: { label: 'پیام خوش‌آمد', max: 300, area: 2, hint: 'اولین پیامی که مشتری می‌بیند.' },
  tone: { label: 'لحن', max: 120, hint: 'مثلاً «رسمی و کوتاه» یا «صمیمی مثل فروشندهٔ محله»' },
  description: { label: 'معرفی کسب‌وکار', max: 1500, area: 4, hint: 'ارسال، ساعت کاری، آدرس، شیوهٔ پرداخت — فقط اطلاعات واقعی.' },
  instructions: { label: 'دستورالعمل‌های فروشگاه', max: 5000, area: 5, hint: 'مثلاً «همیشه پیشنهاد سایز بده» یا «دربارهٔ تخفیف قول نده».' },
  policies: { label: 'قوانین فروشگاه', max: 3000, area: 4, hint: 'مرجوعی، ضمانت، زمان ارسال. دستیار چیزی خارج از این‌ها قول نمی‌دهد.' },
  fallbackMessage: { label: 'پیام وقتی جواب را نمی‌داند', max: 300, area: 2, hint: 'خالی = «پاسخ این سؤال را ندارم. همکاران ما پیگیری می‌کنند.»' },
  launcherText: { label: 'متن دکمهٔ ویجت', max: 30, hint: 'خالی = فقط آیکون. مثلاً «سؤال دارید؟»' },
};
const SECTIONS = [
  { title: 'هویت', note: 'دستیار با چه نامی و چه جمله‌ای شروع کند.', fields: ['assistantName', 'welcome'] },
  { title: 'لحن', note: 'شیوهٔ حرف زدن دستیار با مشتری.', fields: ['tone'] },
  { title: 'دستورالعمل‌ها', note: 'آنچه دستیار باید دربارهٔ کسب‌وکار بداند و رعایت کند.', fields: ['description', 'instructions'] },
  { title: 'قوانین', fields: ['policies'] },
  { title: 'رفتار گفتگو', fields: ['languages', 'fallbackMessage'] },
  { title: 'ثبت سفارش', fields: ['orderTaking'] },
  { title: 'ظاهر ویجت', fields: ['color', 'position', 'launcherText'] },
];

export async function render(main, { me, storeId }) {
  let data;
  try {
    data = await get(`/api/app/assistant${storeId ? `?store=${storeId}` : ''}`);
  } catch (err) {
    main.replaceChildren(el('div', { class: 'card empty' }, el('strong', { text: 'بارگذاری نشد' }), el('p', { text: err.message })));
    return;
  }
  let draft = structuredClone(data.draft);
  let saved = JSON.stringify(data.draft);
  const dirty = () => JSON.stringify(draft) !== saved;

  /* ---------- form ---------- */
  const status = el('p', { class: 'small', role: 'status' });
  const saveBtn = el('button', { class: 'btn btn-secondary', type: 'button', text: 'ذخیرهٔ پیش‌نویس' });
  const publishBtn = el('button', { class: 'btn', type: 'button', text: 'انتشار برای مشتری‌ها' });
  const discardBtn = el('button', { class: 'btn btn-ghost', type: 'button', text: 'بازگشت به نسخهٔ منتشرشده' });
  const formError = el('p', { class: 'form-error', role: 'alert' });

  function refreshStatus() {
    const unpublished = dirty() || data.hasChanges;
    status.textContent = dirty() ? 'تغییرات ذخیره‌نشده دارید.' : unpublished ? 'پیش‌نویس با نسخهٔ منتشرشده فرق دارد — هنوز منتشر نشده.' : `منتشرشده${data.publishedAt ? ` · ${faDate(data.publishedAt)}` : ''}`;
    status.className = `small ${unpublished ? 'warn-text' : 'subtle'}`;
    publishBtn.disabled = !unpublished;
    discardBtn.hidden = !unpublished;
  }

  function field(name) {
    if (name === 'languages') {
      const box = (code, label) => el('label', { class: 'check-row' }, el('input', { type: 'checkbox', class: 'checkbox', checked: draft.languages.includes(code), disabled: code === 'fa',
        onchange: (e) => { draft.languages = e.target.checked ? [...new Set([...draft.languages, code])] : draft.languages.filter((l) => l !== code); changed(); } }), el('span', { text: label }));
      return el('fieldset', { class: 'field plain-fieldset' }, el('legend', { text: 'زبان پاسخ' }), box('fa', 'فارسی'), box('en', 'انگلیسی (اگر مشتری انگلیسی بنویسد)'));
    }
    if (name === 'orderTaking') {
      return el('label', { class: 'check-row' }, el('input', { type: 'checkbox', class: 'checkbox', checked: draft.orderTaking, onchange: (e) => { draft.orderTaking = e.target.checked; changed(); } }),
        el('span', {}, 'دستیار در گفتگو سفارش بگیرد', el('span', { class: 'hint block', text: 'نام، موبایل و آدرس را می‌گیرد؛ سرور قیمت و موجودی را بررسی و سفارش را ثبت می‌کند.' })));
    }
    if (name === 'color') {
      return el('div', { class: 'field' }, el('label', { for: 'cfg-color', text: 'رنگ' }),
        el('div', { class: 'inline-form' }, el('input', { type: 'color', id: 'cfg-color', class: 'color-input', value: draft.color, oninput: (e) => { draft.color = e.target.value; changed(); } }),
          el('span', { class: 'ltr subtle', text: draft.color })));
    }
    if (name === 'position') {
      const seg = el('div', { class: 'seg seg-sm', role: 'group', 'aria-label': 'محل دکمه' }, ...[['right', 'راست'], ['left', 'چپ']].map(([value, label]) => el('button', {
        type: 'button', text: label, 'aria-pressed': String(draft.position === value),
        onclick: (e) => { draft.position = value; seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); changed(); },
      })));
      return el('div', { class: 'field' }, el('span', { class: 'side-label', text: 'محل دکمه در صفحه' }), seg);
    }
    const spec = TEXT_FIELDS[name];
    const id = `cfg-${name}`;
    const input = spec.area
      ? el('textarea', { class: 'textarea', id, rows: spec.area, maxlength: spec.max, value: draft[name] })
      : el('input', { class: 'input', id, maxlength: spec.max, value: draft[name] });
    input.addEventListener('input', () => { draft[name] = input.value; changed(); });
    return el('div', { class: 'field' }, el('label', { for: id, text: spec.label }), input, el('span', { class: 'hint', text: spec.hint }));
  }

  const knowledge = el('section', { class: 'card card-pad cfg-section' }, el('h2', { text: 'دانش' }),
    el('p', { class: 'muted', text: `دستیار فقط از ${fa(data.knowledge.products)} محصول (${fa(data.knowledge.inStock)} موجود) و ${fa(data.knowledge.faqs)} پرسش پایگاه دانش این فروشگاه جواب می‌دهد. قیمت و موجودی را هیچ‌وقت از خودش نمی‌سازد.` }),
    el('div', { class: 'page-actions' }, el('a', { class: 'btn btn-secondary btn-sm', href: `/app/products?store=${data.storeId}`, 'data-link': '', text: 'محصولات' }),
      el('a', { class: 'btn btn-secondary btn-sm', href: `/app/knowledge?store=${data.storeId}`, 'data-link': '', text: 'پایگاه دانش' })));
  const sections = SECTIONS.map((s) => el('section', { class: 'card card-pad cfg-section' }, el('h2', { text: s.title }), s.note ? el('p', { class: 'subtle small', text: s.note }) : null, ...s.fields.map(field)));
  sections.splice(3, 0, knowledge);

  /* ---------- preview ---------- */
  const preview = el('div', { class: 'cfg-preview', 'aria-label': 'پیش‌نمایش ویجت' });
  function drawPreview() {
    const launcher = el('div', { class: 'pv-launcher', style: `background:${draft.color};${draft.position}:14px` }, icon('message-square', 'icon icon-sm'), draft.launcherText || null);
    const card = el('div', { class: 'pv-card', style: `${draft.position}:14px` },
      el('div', { class: 'pv-head', style: `background:${draft.color}` }, el('strong', { text: draft.assistantName || '—' }), el('span', { text: data.storeName })),
      el('div', { class: 'pv-body' }, el('div', { class: 'pv-bubble', text: draft.welcome || '…' })));
    preview.replaceChildren(el('div', { class: 'pv-site', 'aria-hidden': 'true' }, el('div', { class: 'pv-bar' }), el('div', { class: 'pv-line' }), el('div', { class: 'pv-line short' })), card, launcher);
  }

  /* ---------- test chat ---------- */
  const history = [];
  const testLog = el('div', { class: 'test-log', role: 'log', 'aria-live': 'polite' },
    el('p', { class: 'subtle small', text: data.aiConnected ? 'گفتگوی آزمایشی با پیش‌نویس فعلی. چیزی ذخیره نمی‌شود و سفارشی ثبت نمی‌شود.' : 'هوش مصنوعی هنوز وصل نیست؛ پاسخ‌ها از حالت آفلاین (پایگاه دانش) است. چیزی ذخیره نمی‌شود.' }));
  const testInput = el('input', { class: 'input', placeholder: 'مثلاً: هزینهٔ ارسال چقدر است؟', 'aria-label': 'پیام آزمایشی', maxlength: 1000 });
  const testSend = el('button', { class: 'btn btn-sm', type: 'submit', text: 'ارسال' });
  const testForm = el('form', { class: 'test-form' }, testInput, testSend);
  testForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = testInput.value.trim();
    if (!message) return testInput.focus();
    await withBusy(testSend, async () => {
      try {
        if (dirty()) await save({ quiet: true });
        testLog.append(el('div', { class: 'test-msg user', text: message }));
        testInput.value = '';
        const res = await api('POST', `/api/app/assistant/${data.storeId}/test`, { history, message });
        history.push({ role: 'user', content: message }, { role: 'assistant', content: res.reply });
        testLog.append(el('div', { class: 'test-msg bot' }, el('span', { class: 'pill', text: res.source === 'ai' ? 'AI' : 'آفلاین' }), el('div', {}, bidiText(res.reply)), explain(res.context)));
        testLog.scrollTop = testLog.scrollHeight;
      } catch (err) { toast(err.message, 'alert'); }
    });
  });

  /* ---------- actions ---------- */
  function changed() { formError.textContent = ''; drawPreview(); refreshStatus(); }
  async function save({ quiet = false } = {}) {
    try {
      await api('PUT', `/api/app/assistant/${data.storeId}/draft`, { config: draft });
      saved = JSON.stringify(draft);
      data.hasChanges = saved !== JSON.stringify(data.published);
      if (!quiet) toast('پیش‌نویس ذخیره شد');
      refreshStatus();
    } catch (err) { formError.textContent = err.message; throw err; }
  }
  saveBtn.addEventListener('click', () => withBusy(saveBtn, () => save().catch(() => {})));
  publishBtn.addEventListener('click', () => withBusy(publishBtn, async () => {
    try {
      if (dirty()) await save({ quiet: true });
      await api('POST', `/api/app/assistant/${data.storeId}/publish`);
      data.published = structuredClone(draft);
      data.publishedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
      data.hasChanges = false;
      toast('منتشر شد؛ مشتری‌ها از همین حالا نسخهٔ جدید را می‌بینند');
      refreshStatus();
    } catch { /* message already shown in the form */ }
  }));
  discardBtn.addEventListener('click', async () => {
    if (!(await confirmDialog({ title: 'کنار گذاشتن پیش‌نویس؟', body: 'تغییرات منتشرنشده پاک می‌شوند و تنظیمات به نسخهٔ منتشرشده برمی‌گردد.', confirmText: 'کنار گذاشتن' }))) return;
    try { await api('POST', `/api/app/assistant/${data.storeId}/discard`); navigate(location.pathname + location.search, { replace: true }); render(main, { me, storeId }); } catch (err) { toast(err.message, 'alert'); }
  });
  const leaveGuard = (e) => { if (main.contains(saveBtn) && dirty()) { e.preventDefault(); e.returnValue = ''; } };
  addEventListener('beforeunload', leaveGuard);

  const storePicker = me.stores.length > 1
    ? el('select', { class: 'select', 'aria-label': 'فروشگاه', onchange: (e) => navigate(`/app/assistant?store=${e.target.value}`) },
      ...me.stores.map((s) => el('option', { value: s.id, text: s.name, selected: s.id === data.storeId })))
    : null;

  drawPreview();
  refreshStatus();
  main.replaceChildren(
    pageHead('دستیار هوشمند', `تنظیمات دستیار «${data.storeName}». مشتری‌ها فقط نسخهٔ منتشرشده را می‌بینند.`, storePicker),
    el('div', { class: 'cfg-layout' },
      el('div', { class: 'cfg-form' }, ...sections, el('div', { class: 'card card-pad cfg-actions' }, status, formError, el('div', { class: 'page-actions' }, saveBtn, publishBtn, discardBtn))),
      el('aside', { class: 'cfg-side' },
        el('section', { class: 'card card-pad' }, el('h2', { class: 'side-title', text: 'پیش‌نمایش' }), preview),
        el('section', { class: 'card card-pad' }, el('h2', { class: 'side-title', text: 'گفتگوی آزمایشی' }), testLog, testForm))));
}
