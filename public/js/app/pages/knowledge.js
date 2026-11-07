// Knowledge base: the FAQs and policies the assistant may answer from.
import { api, get } from '../api.js';
import { dataView, pageHead } from '../table.js';
import { formDialog } from '../form.js';

export async function render(main, { me, storeId }) {
  const edit = async (faq) => {
    const ok = await formDialog({
      title: faq ? 'ویرایش پرسش' : 'پرسش جدید',
      intro: 'فقط اطلاعات واقعی بنویسید؛ دستیار دقیقاً از همین پاسخ استفاده می‌کند.',
      fields: [
        ...(faq || storeId ? [] : [{ name: 'storeId', label: 'فروشگاه', type: 'select', required: true, options: me.stores.map((s) => ({ value: s.id, label: s.name })) }]),
        { name: 'question', label: 'پرسش مشتری', required: true, maxlength: 300, placeholder: 'مثلاً: هزینهٔ ارسال چقدر است؟' },
        { name: 'answer', label: 'پاسخ', type: 'textarea', required: true, maxlength: 2000 },
      ],
      initial: faq ?? { storeId: me.stores[0]?.id },
      submitLabel: faq ? 'ذخیره' : 'افزودن',
      onSubmit: (v) => (faq ? api('PUT', `/api/app/faqs/${faq.id}`, v) : api('POST', '/api/app/faqs', { ...v, storeId: Number(v.storeId ?? storeId) })),
    });
    if (ok) { toast(faq ? 'پرسش ذخیره شد' : 'پرسش اضافه شد'); view.reload(); }
  };
  const remove = async (faq) => {
    if (!(await confirmDialog({ title: 'حذف این پرسش؟', body: faq.question, confirmText: 'حذف' }))) return;
    try { await api('DELETE', `/api/app/faqs/${faq.id}`); toast('پرسش حذف شد'); view.reload(); } catch (err) { toast(err.message, 'alert'); }
  };
  const view = dataView({
    filters: [{ key: 'q', type: 'search', label: 'جستجو در پرسش‌ها', placeholder: 'جستجو در پرسش و پاسخ…' }],
    fetchPage: (params) => { if (storeId) params.set('store', storeId); return get(`/api/app/faqs?${params}`); },
    columns: [
      { label: 'پرسش و پاسخ', cell: (f) => el('span', {}, el('span', { class: 'cell-title', text: f.question }), el('span', { class: 'cell-sub faq-answer', text: f.answer })) },
      ...(storeId ? [] : [{ label: 'فروشگاه', cell: (f) => f.storeName }]),
      { label: '', className: 'actions', cell: (f) => el('span', {},
        el('button', { class: 'btn btn-ghost btn-sm btn-icon', type: 'button', 'aria-label': 'ویرایش', onclick: () => edit(f) }, icon('pencil', 'icon icon-sm')),
        el('button', { class: 'btn btn-ghost btn-sm btn-icon', type: 'button', 'aria-label': 'حذف', onclick: () => remove(f) }, icon('trash', 'icon icon-sm'))) },
    ],
    mobileRow: (f) => [el('span', { class: 'row-title', text: f.question }), el('span'), el('span', { class: 'row-sub', text: f.answer })],
    onOpen: edit,
    empty: { icon: 'book', title: 'پایگاه دانش خالی است', text: 'پرسش‌های پرتکرار مشتری‌ها و قوانین فروشگاه (ارسال، مرجوعی، ساعت کاری) را اینجا بنویسید.' },
  });
  main.replaceChildren(pageHead('پایگاه دانش', 'دستیار فقط از این پاسخ‌ها و اطلاعات محصولات جواب می‌دهد و چیزی از خودش نمی‌سازد.',
    el('button', { class: 'btn', type: 'button', onclick: () => edit(null) }, icon('plus', 'icon icon-sm'), 'پرسش جدید')), view.node);
}
