// Orders: filters, search, details with status changes for orders the assistant took.
import { api, get } from '../api.js';
import { dataView, pageHead } from '../table.js';

export const ORDER_STATUS = {
  new: { label: 'جدید', pill: 'pill-accent' },
  confirmed: { label: 'تأیید شده', pill: 'pill-warn' },
  sent: { label: 'ارسال شده', pill: 'pill-success' },
  cancelled: { label: 'لغو شده', pill: 'pill-danger' },
};
const SOURCE = { assistant: 'دستیار', woocommerce: 'ووکامرس', api: 'API' };
const fa = (n, o) => Number(n).toLocaleString('fa-IR', o);
const statusPill = (s) => el('span', { class: `pill ${ORDER_STATUS[s].pill}`, text: ORDER_STATUS[s].label });
const number = (id) => `#${fa(id, { useGrouping: false })}`;

async function openOrder(id, onChange) {
  let order;
  try { order = await get(`/api/app/orders/${id}`); } catch (err) { toast(err.message, 'alert'); return; }
  const status = el('select', { class: 'select', id: 'o-status', disabled: order.source !== 'assistant' },
    ...Object.entries(ORDER_STATUS).map(([value, s]) => el('option', { value, text: s.label, selected: value === order.status })));
  const close = el('button', { type: 'button', class: 'btn btn-secondary', text: 'بستن' });
  const save = el('button', { type: 'button', class: 'btn', text: 'ذخیرهٔ وضعیت', hidden: order.source !== 'assistant' });
  const dialog = el('dialog', { class: 'form-dialog', 'aria-labelledby': 'o-title' },
    el('div', { class: 'dialog-body stack' },
      el('h2', { id: 'o-title' }, `سفارش ${number(order.id)} `, statusPill(order.status)),
      el('dl', { class: 'detail-grid' },
        el('dt', { text: 'مشتری' }), el('dd', { text: order.customerName }),
        el('dt', { text: 'موبایل' }), el('dd', {}, el('a', { class: 'ltr', href: `tel:${order.phone}`, text: order.phone })),
        el('dt', { text: 'آدرس' }), el('dd', { text: order.address }),
        el('dt', { text: 'فروشگاه' }), el('dd', { text: order.storeName }),
        el('dt', { text: 'تاریخ' }), el('dd', { text: faDate(order.createdAt) }),
        el('dt', { text: 'منبع' }), el('dd', { text: SOURCE[order.source] })),
      el('table', { class: 'table items-table' },
        el('thead', {}, el('tr', {}, el('th', { text: 'کالا' }), el('th', { class: 'num', text: 'تعداد' }), el('th', { class: 'num', text: 'مبلغ (تومان)' }))),
        el('tbody', {}, ...order.items.map((i) => el('tr', {}, el('td', {}, el('bdi', { text: i.name })), el('td', { class: 'num', text: fa(i.qty) }), el('td', { class: 'num', text: fa(i.price * i.qty) }))),
          el('tr', {}, el('td', { class: 'strong', text: 'جمع کل' }), el('td'), el('td', { class: 'num strong', text: fa(order.total) })))),
      el('div', { class: 'field' }, el('label', { for: 'o-status', text: 'وضعیت' }), status,
        order.source !== 'assistant' ? el('span', { class: 'hint', text: `وضعیت این سفارش را در ${SOURCE[order.source]} تغییر دهید.` }) : null)),
    el('div', { class: 'form-actions' }, close, save));
  const done = () => { dialog.close(); dialog.remove(); };
  close.addEventListener('click', done);
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); done(); });
  save.addEventListener('click', () => withBusy(save, async () => {
    try {
      await api('PUT', `/api/app/orders/${order.id}/status`, { status: status.value });
      toast('وضعیت سفارش ذخیره شد');
      done();
      onChange();
    } catch (err) { toast(err.message, 'alert'); }
  }));
  document.body.append(dialog);
  dialog.showModal();
  close.focus();
}

export async function render(main, { storeId, refreshMe }) {
  const view = dataView({
    filters: [
      { key: 'q', type: 'search', label: 'جستجوی سفارش', placeholder: 'نام، موبایل یا #شماره…' },
      { key: 'status', type: 'seg', label: 'وضعیت', options: [{ value: '', label: 'همه' }, ...Object.entries(ORDER_STATUS).map(([value, s]) => ({ value, label: s.label }))] },
      { key: 'source', type: 'select', label: 'منبع', options: [{ value: '', label: 'همهٔ منابع' }, ...Object.entries(SOURCE).map(([value, label]) => ({ value, label }))] },
      { key: 'sort', type: 'select', label: 'مرتب‌سازی', options: [{ value: '', label: 'جدیدترین' }, { value: 'created', label: 'قدیمی‌ترین' }, { value: '-total', label: 'بیشترین مبلغ' }, { value: 'total', label: 'کمترین مبلغ' }] },
      { key: 'from', type: 'date', label: 'از' },
      { key: 'to', type: 'date', label: 'تا' },
    ],
    fetchPage: (params) => {
      if (storeId) params.set('store', storeId);
      if (params.get('from') && !params.get('to')) params.set('to', params.get('from'));
      if (params.get('to') && !params.get('from')) params.set('from', params.get('to'));
      return get(`/api/app/orders?${params}`);
    },
    columns: [
      { label: 'شماره', cell: (o) => number(o.id) },
      { label: 'مشتری', cell: (o) => el('span', {}, el('span', { class: 'cell-title', text: o.customerName }), el('span', { class: 'cell-sub ltr', text: o.phone })) },
      ...(storeId ? [] : [{ label: 'فروشگاه', cell: (o) => o.storeName }]),
      { label: 'اقلام', className: 'num', cell: (o) => fa(o.itemCount) },
      { label: 'مبلغ (تومان)', className: 'num', cell: (o) => fa(o.total) },
      { label: 'تاریخ', cell: (o) => faDate(o.createdAt) },
      { label: 'وضعیت', cell: (o) => statusPill(o.status) },
      { label: 'منبع', cell: (o) => SOURCE[o.source] },
    ],
    mobileRow: (o) => [
      el('span', { class: 'row-title', text: `${number(o.id)} · ${o.customerName}` }), statusPill(o.status),
      el('span', { class: 'row-sub', text: `${fa(o.total)} تومان · ${faDate(o.createdAt)}` }), el('span', { class: 'row-meta', text: storeId ? SOURCE[o.source] : o.storeName }),
    ],
    onOpen: (o) => openOrder(o.id, () => { view.reload(); refreshMe(); }),
    empty: { icon: 'bag', title: 'هنوز سفارشی ثبت نشده', text: 'سفارش‌هایی که دستیار در گفتگو ثبت می‌کند یا از فروشگاه همگام‌سازی می‌شوند اینجا می‌آیند.' },
  });
  main.replaceChildren(pageHead('سفارش‌ها', 'مبلغ هر سفارش را سرور از قیمت‌های ثبت‌شده حساب کرده است، نه دستیار.'), view.node);
}
