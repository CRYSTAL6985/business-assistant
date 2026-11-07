// Honest placeholder for sections whose new page is built in a later phase. Where the feature exists
// in the classic panel today, it links there instead of pretending.
const CLASSIC = {
  conversations: { tab: 'conversations', note: 'گفتگوهای مشتریان را فعلاً در پنل قدیمی ببینید.' },
  assistant: { tab: 'overview', note: 'توضیحات کسب‌وکار و لحن دستیار فعلاً در پنل قدیمی تنظیم می‌شود.' },
  settings: { tab: 'overview', note: 'نام کسب‌وکار فعلاً در پنل قدیمی تغییر می‌کند.' },
};

export async function render(main, { route }) {
  const classic = CLASSIC[route.section];
  const storeQuery = route.params.get('store') ? `&store=${encodeURIComponent(route.params.get('store'))}` : '';
  main.replaceChildren(
    el('div', { class: 'card empty' },
      icon('sliders'),
      el('strong', { text: 'این بخش در مرحلهٔ بعدی ساخته می‌شود' }),
      el('p', { text: classic ? classic.note : 'این بخش هنوز ساخته نشده است.' }),
      classic ? el('a', { class: 'btn btn-secondary', href: `/panel?next=panel${storeQuery}#${classic.tab}`, text: 'رفتن به پنل قدیمی' }) : null,
      el('a', { class: 'btn btn-ghost', href: '/app', 'data-link': '', text: 'بازگشت به نمای کلی' })));
}
