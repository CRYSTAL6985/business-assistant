// "Why did the assistant say this?" — turns a reply's stored context into plain Persian lines.
const fa = (n) => Number(n).toLocaleString('fa-IR');

/** @returns {HTMLDetailsElement|null} */
export function explain(context) {
  if (!context) return null;
  const lines = [];
  if (context.mode === 'ai') {
    lines.push(`پاسخ هوش مصنوعی، فقط با اطلاعات ${fa(context.productIds?.length ?? 0)} محصول و ${fa(context.faqIds?.length ?? 0)} پرسش پایگاه دانش همین فروشگاه.`);
  } else if (context.matched === 'faq') {
    lines.push(`پاسخ آفلاین از پرسش پایگاه دانش: «${context.faqQuestion ?? ''}»`);
  } else if (context.matched === 'products') {
    lines.push(`پاسخ آفلاین: فهرست ${fa(context.productIds.length)} محصول موجود که با پیام مشتری جور بود.`);
  } else if (context.mode === 'offline') {
    lines.push('پاسخ آفلاین: چیزی در پایگاه دانش یا محصولات پیدا نشد، پیام جایگزین نمایش داده شد.');
  }
  if (context.order) {
    lines.push(context.order.ok
      ? `سفارش را سرور با قیمت‌های ثبت‌شده بررسی کرد${context.order.total ? ` (جمع: ${fa(context.order.total)} تومان)` : ''}.`
      : `سفارش رد شد: ${context.order.error}`);
  }
  if (!lines.length) return null;
  return el('details', { class: 'explain' }, el('summary', { text: 'این پاسخ بر اساس چه بود؟' }), ...lines.map((text) => el('p', { text })));
}
