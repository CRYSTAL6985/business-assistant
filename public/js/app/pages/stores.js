// Stores: add within the plan's limit, edit, disconnect / reconnect, delete, widget snippet.
import { api, get } from '../api.js';
import { pageHead } from '../table.js';
import { formDialog } from '../form.js';
import { toggleMenu, menuItem, menuSep } from '../menu.js';

const PLATFORM = { widget: 'فقط ویجت', woocommerce: 'WooCommerce', custom: 'API اختصاصی' };
const fa = (n) => Number(n).toLocaleString('fa-IR');

export function snippetFor(store) {
  return `<script src="${location.origin}/widget.js" data-business="${store.slug}" defer></script>`;
}

/** Where the widget was really seen loading — the only proof it is installed. */
export function installState(store) {
  if (!store.sightings.length) {
    return el('p', { class: 'subtle small' }, icon('alert', 'icon icon-sm'), ' ویجت هنوز روی هیچ سایتی دیده نشده.',
      store.domain ? '' : ' دامنه را ثبت کنید تا ویجت فقط روی سایت خودتان کار کند.');
  }
  return el('div', { class: 'field' }, el('span', { class: 'small muted', text: 'ویجت دیده شده روی:' }),
    el('ul', { class: 'plain-list' }, ...store.sightings.map((x) => el('li', { class: 'small' },
      el('span', { class: 'pill pill-success' }, el('span', { class: 'dot' }), el('span', { class: 'ltr', text: x.origin })),
      el('span', { class: 'subtle', text: ` آخرین بار ${faDate(x.lastSeenAt)}` })))));
}

export async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('کپی شد'); } catch { toast('کپی نشد؛ متن را دستی انتخاب کنید', 'alert'); }
}

export async function render(main, { refreshMe }) {
  const body = el('div', { class: 'stack' }, el('div', { class: 'skeleton', style: 'height:180px;border-radius:14px' }));
  const addBtn = el('button', { class: 'btn', type: 'button' }, icon('plus', 'icon icon-sm'), 'افزودن فروشگاه');
  const limitLine = el('p', { class: 'limit-line small' });
  main.replaceChildren(pageHead('فروشگاه‌ها', 'هر وب‌سایت یک فروشگاه است با محصولات، سفارش‌ها و دستیار جداگانه.', addBtn), limitLine, body);

  async function load() {
    let data;
    try { data = await get('/api/app/stores'); } catch (err) {
      body.replaceChildren(el('div', { class: 'card empty' }, el('strong', { text: 'بارگذاری نشد' }), el('p', { text: err.message }), el('button', { class: 'btn btn-secondary', type: 'button', text: 'تلاش دوباره', onclick: load })));
      return;
    }
    const full = data.used >= data.limit;
    addBtn.disabled = full;
    addBtn.title = full ? 'سقف فروشگاه‌های پلن پر است' : '';
    limitLine.replaceChildren(`${fa(data.used)} از ${fa(data.limit)} فروشگاه متصل در پلن فعلی. `,
      full ? el('a', { href: '/app/billing', 'data-link': '', text: 'ارتقای پلن برای فروشگاه بیشتر' }) : '');
    body.replaceChildren(el('div', { class: 'store-list' }, ...data.items.map((s) => storeCard(s, full))));
  }

  const after = async (message) => { toast(message); await load(); await refreshMe(); };

  function storeCard(store, full) {
    const off = Boolean(store.disconnectedAt);
    const more = el('button', { class: 'btn btn-ghost btn-icon btn-sm', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': `گزینه‌های ${store.name}` }, icon('more'));
    more.addEventListener('click', () => toggleMenu(more, () => [
      menuItem({ label: 'ویرایش نام و دامنه', iconName: 'pencil', onclick: () => editStore(store) }),
      menuItem({ label: 'صفحهٔ گفتگوی مشتری', iconName: 'external', href: `/chat/${store.slug}`, external: true }),
      menuSep(),
      off
        ? menuItem({ label: 'اتصال دوباره', iconName: 'rotate', onclick: () => act(() => api('POST', `/api/app/stores/${store.id}/reconnect`), 'فروشگاه دوباره متصل شد') })
        : menuItem({ label: 'قطع اتصال', iconName: 'wifi-off', onclick: () => disconnect(store) }),
      menuItem({ label: 'حذف فروشگاه', iconName: 'trash', danger: true, onclick: () => removeStore(store) }),
    ]));
    return el('article', { class: `card store-admin${off ? ' is-off' : ''}` },
      el('div', { class: 'store-top' },
        el('div', {}, el('h2', { text: store.name }),
          el('div', { class: 'meta' }, el('span', { class: 'ltr', text: PLATFORM[store.platform] }), store.domain ? el('span', { class: 'ltr', text: store.domain }) : el('span', { text: 'دامنه ثبت نشده' }))),
        el('div', { class: 'page-actions' }, el('span', { class: `pill ${off ? 'pill-danger' : ''}`, text: off ? 'قطع شده' : 'متصل به حساب' }), el('div', { class: 'menu-anchor' }, more))),
      off
        ? el('p', { class: 'muted small', text: 'دستیار این فروشگاه پاسخ نمی‌دهد. اطلاعات آن حفظ شده است.' })
        : el('div', { class: 'stack' },
            el('div', { class: 'field' }, el('span', { class: 'small muted', text: 'کد ویجت — قبل از </body> سایت قرار دهید' }),
              el('div', { class: 'snippet' }, el('code', { text: snippetFor(store) }),
                el('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => copy(snippetFor(store)) }, icon('copy', 'icon icon-sm'), 'کپی'))),
            installState(store)));
  }

  async function act(task, message) {
    try { await task(); await after(message); } catch (err) { toast(err.message, 'alert'); }
  }

  function editStore(store) {
    formDialog({
      title: 'ویرایش فروشگاه',
      fields: [{ name: 'name', label: 'نام فروشگاه', required: true, minlength: 2, maxlength: 80 }, { name: 'domain', label: 'دامنهٔ سایت', ltr: true, placeholder: 'shop.ir', hint: 'ویجت فقط روی این دامنه کار خواهد کرد.' }],
      initial: store, submitLabel: 'ذخیره',
      onSubmit: (v) => api('PUT', `/api/app/stores/${store.id}`, v),
    }).then((ok) => ok && after('فروشگاه ذخیره شد'));
  }

  async function disconnect(store) {
    const ok = await confirmDialog({ title: `قطع اتصال «${store.name}»؟`, body: 'دستیار این فروشگاه دیگر به مشتری‌ها پاسخ نمی‌دهد. محصولات، سفارش‌ها و گفتگوها حفظ می‌شوند و می‌توانید دوباره وصلش کنید.', confirmText: 'قطع اتصال' });
    if (ok) act(() => api('POST', `/api/app/stores/${store.id}/disconnect`), 'اتصال فروشگاه قطع شد');
  }

  function removeStore(store) {
    formDialog({
      title: `حذف «${store.name}»`, danger: true,
      intro: 'همهٔ محصولات، سفارش‌ها، گفتگوها و تنظیمات این فروشگاه برای همیشه پاک می‌شوند. این کار برگشت‌پذیر نیست.',
      fields: [{ name: 'confirm', label: `برای تأیید، نام فروشگاه («${store.name}») را بنویسید`, required: true }],
      submitLabel: 'حذف برای همیشه',
      onSubmit: (v) => api('DELETE', `/api/app/stores/${store.id}`, { confirm: v.confirm }),
    }).then((ok) => ok && after('فروشگاه حذف شد'));
  }

  addBtn.addEventListener('click', () => {
    const preview = el('p', { class: 'hint ltr', text: `${location.origin}/chat/…` });
    formDialog({
      title: 'افزودن فروشگاه',
      intro: 'بعد از ساخت، کد ویجت را روی سایت قرار دهید یا ووکامرس را از بخش یکپارچه‌سازی‌ها وصل کنید.',
      fields: [
        { name: 'name', label: 'نام فروشگاه', required: true, minlength: 2, maxlength: 80 },
        { name: 'slug', label: 'آدرس صفحهٔ گفتگو', required: true, ltr: true, pattern: '[a-z0-9-]{3,30}', placeholder: 'my-shop', hint: 'حروف کوچک انگلیسی، عدد و خط تیره · ۳ تا ۳۰ حرف' },
        { name: 'domain', label: 'دامنهٔ سایت', ltr: true, placeholder: 'shop.ir' },
      ],
      extra: preview, submitLabel: 'ساخت فروشگاه',
      onSubmit: (v) => api('POST', '/api/app/stores', v),
    }).then((ok) => ok && after('فروشگاه ساخته شد'));
    document.querySelector('#f-slug')?.addEventListener('input', (e) => { preview.textContent = `${location.origin}/chat/${e.target.value || '…'}`; });
  });

  await load();
}
