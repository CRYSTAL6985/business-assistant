// Integrations of one store: WooCommerce, own-site API (keys + docs), outbound webhooks, widget.
// Everything shown is the server's real state; secrets appear once, right after they are created.
import { api, get } from '../api.js';
import { pageHead } from '../table.js';
import { navigate } from '../router.js';
import { formDialog } from '../form.js';
import { snippetFor, installState, copy } from './stores.js';

const POLL_MS = 3000;
const RUN_KIND = { full: 'ورود کامل', incremental: 'به‌روزرسانی' };
const RUN_STATUS = { running: ['در حال اجرا', 'pill-warn'], ok: ['موفق', 'pill-success'], error: ['ناموفق', 'pill-danger'] };
const WOO_STATUS = { pending: ['در حال اولین همگام‌سازی', 'pill-warn'], ok: ['متصل', 'pill-success'], error: ['خطا', 'pill-danger'] };
const EVENT_LABELS = { 'order.created': 'سفارش جدید از دستیار', 'conversation.waiting': 'گفتگوی بی‌پاسخ (۱۰ دقیقه)' };
const fa = (n) => Number(n).toLocaleString('fa-IR');

/** Shows a just-created secret once, with copy. Resolves when closed. */
function secretDialog(title, body, secret) {
  return new Promise((resolve) => {
    const done = el('button', { type: 'button', class: 'btn', text: 'ذخیره کردم' });
    const dialog = el('dialog', { 'aria-labelledby': 'secret-title' },
      el('div', { class: 'dialog-body stack' }, el('h2', { id: 'secret-title', text: title }), el('p', { class: 'muted', text: body }),
        el('div', { class: 'snippet' }, el('code', { text: secret }), el('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => copy(secret) }, icon('copy', 'icon icon-sm'), 'کپی'))),
      el('div', { class: 'form-actions' }, done));
    const close = () => { dialog.close(); dialog.remove(); resolve(); };
    done.addEventListener('click', close);
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    document.body.append(dialog);
    dialog.showModal();
    done.focus();
  });
}

const section = (title, note, ...children) => el('section', { class: 'card card-pad cfg-section' },
  el('h2', { text: title }), note ? el('p', { class: 'subtle small', text: note }) : null, ...children);

export async function render(main, { me, storeId }) {
  let timer = null;
  const body = el('div', { class: 'int-grid' }, el('div', { class: 'skeleton', style: 'height:220px;border-radius:14px' }));
  const storePicker = me.stores.length > 1
    ? el('select', { class: 'select', 'aria-label': 'فروشگاه', onchange: (e) => navigate(`/app/integrations?store=${e.target.value}`) },
      ...me.stores.map((s) => el('option', { value: s.id, text: s.name, selected: s.id === (storeId ?? me.stores[0]?.id) })))
    : null;
  const head = pageHead('یکپارچه‌سازی‌ها', 'اتصال فروشگاه به سایت: ووکامرس، API اختصاصی یا فقط ویجت.', storePicker);
  main.replaceChildren(head, body);

  async function load() {
    clearTimeout(timer);
    if (!main.contains(body)) return; // left the page: stop polling
    let data;
    try { data = await get(`/api/app/integrations${storeId ? `?store=${storeId}` : ''}`); } catch (err) {
      body.replaceChildren(el('div', { class: 'card empty' }, el('strong', { text: 'بارگذاری نشد' }), el('p', { text: err.message }), el('button', { class: 'btn btn-secondary', type: 'button', text: 'تلاش دوباره', onclick: load })));
      return;
    }
    head.querySelector('p').textContent = `اتصال «${data.storeName}» به سایت: ووکامرس، API اختصاصی یا فقط ویجت.`;
    body.replaceChildren(...[
      data.allowed ? null : el('div', { class: 'card card-pad int-locked' }, icon('plug'),
        el('div', {}, el('strong', { text: 'ووکامرس، API و وب‌هوک در پلن حرفه‌ای' }), el('p', { class: 'muted small', text: 'در پلن رایگان، فروشگاه فقط با ویجت کار می‌کند. محصولات را دستی وارد کنید.' })),
        el('a', { class: 'btn btn-secondary btn-sm', href: '/app/billing', 'data-link': '', text: 'ارتقای پلن' })),
      wooSection(data), apiSection(data), webhookSection(data), widgetSection(data)].filter(Boolean));
    const busy = data.woocommerce?.syncing || data.syncRuns[0]?.status === 'running';
    if (busy) timer = setTimeout(load, POLL_MS);
  }

  const act = async (task, message) => {
    try { await task(); if (message) toast(message); } catch (err) { toast(err.message, 'alert'); }
    await load();
  };

  function wooSection(data) {
    const w = data.woocommerce;
    if (!w) {
      const error = el('p', { class: 'form-error', role: 'alert' });
      const field = (name, label, attrs) => el('div', { class: 'field' }, el('label', { for: `woo-${name}`, text: label }),
        el('input', { class: 'input ltr', id: `woo-${name}`, name, required: true, autocomplete: 'off', disabled: !data.allowed, ...attrs }));
      const submit = el('button', { class: 'btn', type: 'submit', text: 'اتصال و بررسی', disabled: !data.allowed });
      const form = el('form', { class: 'stack', novalidate: true },
        field('siteUrl', 'آدرس سایت', { type: 'url', placeholder: 'https://shop.ir' }),
        field('consumerKey', 'کلید مصرف‌کننده (Consumer key)', { placeholder: 'ck_…' }),
        field('consumerSecret', 'رمز مصرف‌کننده (Consumer secret)', { type: 'password', placeholder: 'cs_…' }),
        error, el('div', { class: 'page-actions' }, submit));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        error.textContent = '';
        const values = Object.fromEntries(new FormData(form));
        withBusy(submit, async () => {
          try {
            const res = await api('POST', `/api/app/integrations/${data.storeId}/woocommerce`, values);
            toast(res.webhooks ? 'وصل شد؛ ورود محصولات و سفارش‌ها شروع شد' : 'وصل شد؛ وب‌هوک ثبت نشد، هر ۱۵ دقیقه همگام می‌شود');
            await load();
          } catch (err) { error.textContent = err.message; }
        });
      });
      return section('ووکامرس', 'محصولات، موجودی و سفارش‌های ووکامرس خودکار وارد می‌شوند. کلید را در وردپرس از «ووکامرس › تنظیمات › پیشرفته › REST API» با دسترسی «خواندن/نوشتن» بسازید.', form);
    }
    const [statusText, statusClass] = WOO_STATUS[w.status] ?? [w.status, ''];
    const runs = data.syncRuns.length
      ? el('ul', { class: 'plain-list run-list' }, ...data.syncRuns.map((r) => {
        const [label, cls] = RUN_STATUS[r.status];
        return el('li', { class: 'run-row' },
          el('span', { class: `pill ${cls}`, text: label }),
          el('span', { class: 'small', text: `${RUN_KIND[r.kind]} · ${faDate(r.startedAt)}` }),
          el('span', { class: 'subtle small', text: r.status === 'running' ? '…' : `${fa(r.created)} ردیف جدید · ${fa(r.updated)} به‌روزشده` }),
          r.error ? el('span', { class: 'small danger-text run-error', text: r.error }) : null);
      }))
      : el('p', { class: 'subtle small', text: 'هنوز همگام‌سازی انجام نشده.' });
    const syncBtn = el('button', { class: 'btn btn-secondary btn-sm', type: 'button', disabled: w.syncing || !data.allowed }, icon('refresh', 'icon icon-sm'), w.syncing ? 'در حال همگام‌سازی…' : 'همگام‌سازی الان');
    syncBtn.addEventListener('click', () => withBusy(syncBtn, () => act(() => api('POST', `/api/app/integrations/${data.storeId}/woocommerce/sync`), 'همگام‌سازی شروع شد')));
    const disconnect = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'قطع ووکامرس' });
    disconnect.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'قطع اتصال ووکامرس؟', body: 'همگام‌سازی متوقف می‌شود. محصولات و سفارش‌هایی که وارد شده‌اند حفظ می‌شوند.', confirmText: 'قطع اتصال' });
      if (ok) act(() => api('DELETE', `/api/app/integrations/${data.storeId}/woocommerce`), 'ووکامرس جدا شد');
    });
    return section('ووکامرس', null,
      el('div', { class: 'int-status' }, el('span', { class: `pill ${statusClass}`, text: statusText }), el('span', { class: 'ltr small', text: w.siteUrl }),
        w.currency ? el('span', { class: 'subtle small', text: `واحد پول: ${w.currency}` }) : null),
      w.lastError ? el('p', { class: 'small danger-text', role: 'alert', text: w.lastError }) : null,
      el('p', { class: 'subtle small', text: w.webhooks
        ? 'تغییرات ووکامرس با وب‌هوک فوراً می‌رسد؛ هر ۱۵ دقیقه هم برای اطمینان همگام می‌شود.'
        : 'ووکامرس وب‌هوک‌ها را نپذیرفت؛ هر ۱۵ دقیقه خودکار همگام می‌شود.' }),
      el('div', { class: 'page-actions' }, syncBtn, disconnect),
      el('h3', { class: 'side-label', text: 'تاریخچهٔ همگام‌سازی' }), runs);
  }

  function apiSection(data) {
    const base = data.publicBaseUrl;
    const add = el('button', { class: 'btn btn-secondary btn-sm', type: 'button', disabled: !data.allowed }, icon('plus', 'icon icon-sm'), 'کلید جدید');
    add.addEventListener('click', () => formDialog({
      title: 'کلید API جدید', fields: [{ name: 'label', label: 'نام کلید (اختیاری)', maxlength: 60, placeholder: 'مثلاً سایت اصلی' }], submitLabel: 'ساخت کلید',
      onSubmit: async (v) => {
        const res = await api('POST', `/api/app/integrations/${data.storeId}/api-keys`, v);
        setTimeout(() => secretDialog('کلید API ساخته شد', 'این کلید فقط همین یک بار نمایش داده می‌شود. آن را جای امنی در سرور سایت نگه دارید.', res.key).then(load));
      },
    }));
    const keys = data.apiKeys.length
      ? el('ul', { class: 'plain-list' }, ...data.apiKeys.map((k) => el('li', { class: 'run-row' },
        el('span', { class: 'ltr small', text: `ba_${k.prefix}_…` }), el('span', { class: 'small', text: k.label || 'بدون نام' }),
        el('span', { class: 'subtle small', text: k.lastUsedAt ? `آخرین استفاده ${faDate(k.lastUsedAt)}` : 'هنوز استفاده نشده' }),
        el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'باطل کردن', onclick: async () => {
          if (await confirmDialog({ title: 'باطل کردن کلید؟', body: 'سایتی که از این کلید استفاده می‌کند دیگر به API دسترسی ندارد.', confirmText: 'باطل کن' })) {
            act(() => api('DELETE', `/api/app/integrations/${data.storeId}/api-keys/${k.id}`), 'کلید باطل شد');
          }
        } }))))
      : el('p', { class: 'subtle small', text: 'کلیدی ساخته نشده.' });
    const example = `curl -X PUT ${base}/api/v1/products/SKU-1 \\\n  -H "Authorization: Bearer ba_…" -H "Content-Type: application/json" \\\n  -d '{"name":"شال ابریشم","price":1200000,"stockQty":4}'`;
    const endpoints = [
      ['PUT', '/api/v1/products/:externalId', 'افزودن یا به‌روزرسانی محصول — name, price (تومان), description, category, stockQty'],
      ['DELETE', '/api/v1/products/:externalId', 'حذف محصول'],
      ['PUT', '/api/v1/orders/:externalId', 'ثبت یا به‌روزرسانی سفارش — customerName, phone, address, items[{name,price,qty}], status؛ جمع را سرور حساب می‌کند'],
      ['GET', '/api/v1/conversations', 'فهرست گفتگوها (?page=)'],
      ['GET', '/api/v1/conversations/:id', 'پیام‌های یک گفتگو'],
      ['POST', '/api/v1/conversations/:id/messages', 'پاسخ از طرف فروشگاه — content؛ دستیار از آن گفتگو کنار می‌رود'],
      ['GET · POST · DELETE', '/api/v1/webhooks', 'مدیریت وب‌هوک‌ها'],
    ];
    const docs = el('details', { class: 'int-docs' }, el('summary', { text: 'راهنمای API' }),
      el('p', { class: 'small muted', text: 'هر درخواست باید هدر Authorization: Bearer <کلید> داشته باشد. حداکثر ۱۲۰ درخواست در دقیقه.' }),
      el('ul', { class: 'plain-list' }, ...endpoints.map(([method, path, text]) => el('li', { class: 'small' },
        el('code', { class: 'ltr', text: `${method} ${path}` }), el('span', { class: 'subtle', text: ` — ${text}` })))),
      el('pre', { class: 'code-block ltr', text: example }));
    return section('API اختصاصی', 'برای سایت‌هایی که ووکامرس نیستند: سایت شما محصولات و سفارش‌ها را به این API می‌فرستد.',
      el('div', { class: 'page-actions' }, add), keys, docs);
  }

  function webhookSection(data) {
    const add = el('button', { class: 'btn btn-secondary btn-sm', type: 'button', disabled: !data.allowed }, icon('plus', 'icon icon-sm'), 'وب‌هوک جدید');
    add.addEventListener('click', () => formDialog({
      title: 'وب‌هوک جدید', intro: 'هر رویداد با یک درخواست POST امضاشده به این آدرس فرستاده می‌شود.',
      fields: [
        { name: 'url', label: 'آدرس دریافت', required: true, ltr: true, type: 'url', placeholder: 'https://shop.ir/hooks/assistant' },
        { name: 'order', label: EVENT_LABELS['order.created'], type: 'checkbox' },
        { name: 'waiting', label: EVENT_LABELS['conversation.waiting'], type: 'checkbox' },
      ],
      submitLabel: 'ساخت',
      onSubmit: async (v) => {
        const events = [v.order && 'order.created', v.waiting && 'conversation.waiting'].filter(Boolean);
        if (!events.length) throw new Error('حداقل یک رویداد را انتخاب کنید');
        const res = await api('POST', `/api/app/integrations/${data.storeId}/webhooks`, { url: v.url, events });
        setTimeout(() => secretDialog('وب‌هوک ساخته شد', 'با این رمز، امضای هدر X-Signature (sha256=HMAC بدنهٔ درخواست) را بررسی کنید. فقط همین یک بار نمایش داده می‌شود.', res.secret).then(load));
      },
    }));
    const list = data.webhooks.length
      ? el('ul', { class: 'plain-list' }, ...data.webhooks.map((h) => el('li', { class: 'run-row' },
        el('span', { class: 'ltr small', text: h.url }), el('span', { class: 'subtle small', text: h.events.map((e) => EVENT_LABELS[e]).join('، ') }),
        el('span', { class: 'subtle small', text: h.lastStatus ? `آخرین ارسال: ${h.lastStatus}` : 'هنوز ارسالی نبوده' }),
        el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'حذف', onclick: async () => {
          if (await confirmDialog({ title: 'حذف وب‌هوک؟', body: h.url, confirmText: 'حذف' })) act(() => api('DELETE', `/api/app/integrations/${data.storeId}/webhooks/${h.id}`), 'وب‌هوک حذف شد');
        } }))))
      : el('p', { class: 'subtle small', text: 'وب‌هوکی ساخته نشده.' });
    return section('وب‌هوک‌ها', 'سیستم خودتان را از سفارش‌های دستیار و گفتگوهای بی‌پاسخ باخبر کنید.', el('div', { class: 'page-actions' }, add), list);
  }

  function widgetSection(data) {
    const store = { slug: data.slug, domain: data.domain, sightings: data.sightings };
    return section('ویجت گفتگو', 'روی هر پلنی کار می‌کند. ویجت فقط روی دامنهٔ ثبت‌شدهٔ فروشگاه باز می‌شود.',
      el('div', { class: 'snippet' }, el('code', { text: snippetFor(store) }),
        el('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => copy(snippetFor(store)) }, icon('copy', 'icon icon-sm'), 'کپی')),
      installState(store));
  }

  await load();
}
