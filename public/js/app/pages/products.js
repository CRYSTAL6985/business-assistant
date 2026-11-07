// Products: search, category / stock / source filters, add and edit local products.
import { api, get } from '../api.js';
import { dataView, pageHead } from '../table.js';
import { formDialog } from '../form.js';

const SOURCE = { local: { label: 'محلی', pill: '' }, woocommerce: { label: 'ووکامرس', pill: 'pill-accent' }, api: { label: 'API', pill: 'pill-accent' } };
const fa = (n) => Number(n).toLocaleString('fa-IR');

function productFields(me, storeId, categories) {
  return [
    ...(storeId ? [] : [{ name: 'storeId', label: 'فروشگاه', type: 'select', required: true, options: me.stores.map((s) => ({ value: s.id, label: s.name })) }]),
    { name: 'name', label: 'نام محصول', required: true, maxlength: 120 },
    { name: 'price', label: 'قیمت (تومان)', type: 'amount', required: true, hint: 'فقط عدد؛ مثلاً ۴۹۰۰۰۰۰' },
    { name: 'category', label: 'دسته', maxlength: 60, hint: categories.length ? `دسته‌های موجود: ${categories.join('، ')}` : 'اختیاری' },
    { name: 'description', label: 'توضیح', type: 'textarea', maxlength: 1000, hint: 'دستیار از این توضیح برای معرفی محصول استفاده می‌کند.' },
    { name: 'inStock', label: 'موجود است', type: 'checkbox' },
  ];
}

export async function render(main, { me, storeId }) {
  const storeQuery = storeId ? `?store=${storeId}` : '';
  const categories = await get(`/api/app/products/categories${storeQuery}`).catch(() => []);

  const edit = async (product) => {
    const ok = await formDialog({
      title: product ? 'ویرایش محصول' : 'محصول جدید',
      fields: productFields(me, product ? product.storeId : storeId, categories),
      initial: product ?? { inStock: true, storeId: storeId ?? me.stores[0]?.id },
      submitLabel: product ? 'ذخیره' : 'افزودن',
      onSubmit: (v) => (product
        ? api('PUT', `/api/app/products/${product.id}`, v)
        : api('POST', '/api/app/products', { ...v, storeId: Number(v.storeId ?? storeId) })),
    });
    if (ok) { toast(product ? 'محصول ذخیره شد' : 'محصول اضافه شد'); view.reload(); }
  };
  const remove = async (product) => {
    if (!(await confirmDialog({ title: `حذف «${product.name}»؟`, body: 'دستیار دیگر این محصول را معرفی نمی‌کند. سفارش‌های قبلی تغییری نمی‌کنند.', confirmText: 'حذف' }))) return;
    try { await api('DELETE', `/api/app/products/${product.id}`); toast('محصول حذف شد'); view.reload(); } catch (err) { toast(err.message, 'alert'); }
  };
  const actions = (p) => (p.source === 'local'
    ? el('span', {}, el('button', { class: 'btn btn-ghost btn-sm btn-icon', type: 'button', 'aria-label': `ویرایش ${p.name}`, onclick: () => edit(p) }, icon('pencil', 'icon icon-sm')),
      el('button', { class: 'btn btn-ghost btn-sm btn-icon', type: 'button', 'aria-label': `حذف ${p.name}`, onclick: () => remove(p) }, icon('trash', 'icon icon-sm')))
    : el('span', { class: 'lock-note', title: 'در منبع اصلی ویرایش کنید' }, icon('external', 'icon icon-sm'), 'از منبع'));
  const stock = (p) => el('span', { class: `pill ${p.inStock ? 'pill-success' : 'pill-danger'}`, text: p.inStock ? (p.stockQty !== null ? `${fa(p.stockQty)} عدد` : 'موجود') : 'ناموجود' });

  const view = dataView({
    filters: [
      { key: 'q', type: 'search', label: 'جستجوی محصول', placeholder: 'نام یا توضیح محصول…' },
      { key: 'category', type: 'select', label: 'دسته', options: [{ value: '', label: 'همهٔ دسته‌ها' }, ...categories.map((c) => ({ value: c, label: c }))] },
      { key: 'stock', type: 'seg', label: 'موجودی', options: [{ value: '', label: 'همه' }, { value: 'in', label: 'موجود' }, { value: 'out', label: 'ناموجود' }] },
      { key: 'source', type: 'select', label: 'منبع', options: [{ value: '', label: 'همهٔ منابع' }, { value: 'local', label: 'محلی' }, { value: 'woocommerce', label: 'ووکامرس' }, { value: 'api', label: 'API' }] },
    ],
    fetchPage: (params) => { if (storeId) params.set('store', storeId); return get(`/api/app/products?${params}`); },
    columns: [
      { label: 'محصول', cell: (p) => el('span', {}, el('bdi', { class: 'cell-title', text: p.name }), p.category ? el('span', { class: 'cell-sub', text: p.category }) : null) },
      ...(storeId ? [] : [{ label: 'فروشگاه', cell: (p) => p.storeName }]),
      { label: 'قیمت (تومان)', className: 'num', cell: (p) => fa(p.price) },
      { label: 'موجودی', cell: stock },
      { label: 'منبع', cell: (p) => el('span', { class: `pill ${SOURCE[p.source].pill}`, text: SOURCE[p.source].label }) },
      { label: '', className: 'actions', cell: actions },
    ],
    mobileRow: (p) => [
      el('bdi', { class: 'row-title', text: p.name }), el('span', { class: 'row-meta', text: `${fa(p.price)} تومان` }),
      el('span', { class: 'row-sub', text: [p.category, storeId ? null : p.storeName].filter(Boolean).join(' · ') || SOURCE[p.source].label }), stock(p),
    ],
    onOpen: (p) => (p.source === 'local' ? edit(p) : toast('این محصول از منبع اصلی همگام‌سازی می‌شود', 'external')),
    empty: { icon: 'package', title: 'هنوز محصولی ثبت نشده', text: 'محصولات را اضافه کنید یا فروشگاه ووکامرس را وصل کنید تا دستیار آن‌ها را معرفی کند.' },
  });
  main.replaceChildren(pageHead('محصولات', 'آنچه دستیار به مشتری معرفی می‌کند — قیمت و موجودی همیشه از همین‌جا خوانده می‌شود.',
    el('button', { class: 'btn', type: 'button', onclick: () => edit(null) }, icon('plus', 'icon icon-sm'), 'محصول جدید')), view.node);
}
