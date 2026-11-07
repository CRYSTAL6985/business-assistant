// Billing: the plan this workspace really has, this month's usage, paid-until, payments the
// operator recorded, and how to upgrade (payments are made by hand; there is no gateway).
import { get } from '../api.js';
import { pageHead } from '../table.js';

const PLAN_NAMES = { free: 'رایگان', pro: 'حرفه‌ای' };
const fa = (n) => Number(n).toLocaleString('fa-IR');

function planFeatures(limits) {
  return [
    `${fa(limits.replies)} پاسخ هوشمند در ماه`,
    `${fa(limits.stores)} فروشگاه`,
    limits.integrations ? 'ووکامرس، API اختصاصی و وب‌هوک' : 'فقط ویجت گفتگو',
    'پاسخ آفلاین از پایگاه دانش، بدون محدودیت',
  ];
}

export async function render(main) {
  let b;
  try { b = await get('/api/app/billing'); } catch (err) {
    main.replaceChildren(el('div', { class: 'card empty' }, icon('alert'), el('strong', { text: 'بارگذاری نشد' }), el('p', { text: err.message })));
    return;
  }
  const share = b.usage.used / b.usage.limit;
  const validity = b.expired
    ? el('p', { class: 'warn-text', text: `پلن حرفه‌ای شما ${b.paidUntil ? `پس از ${faLastDay(b.paidUntil)} ` : ''}به پایان رسیده و فضای کاری به پلن رایگان برگشته است.` })
    : b.effectivePlan === 'pro'
      ? el('p', { class: 'muted', text: b.paidUntil ? `معتبر تا پایان ${faLastDay(b.paidUntil)}` : 'بدون تاریخ انقضا' })
      : el('p', { class: 'muted', text: 'پلن رایگان، بدون هزینه.' });

  const current = el('section', { class: 'card card-pad bill-plan' },
    el('div', { class: 'bill-plan-head' }, el('span', { class: 'subtle small', text: 'پلن فعلی' }), el('h2', { text: PLAN_NAMES[b.effectivePlan] })),
    validity,
    el('div', { class: 'bill-usage' },
      el('div', { class: 'line' }, el('span', { text: 'پاسخ هوشمند این ماه' }), el('b', { text: `${fa(b.usage.used)} از ${fa(b.usage.limit)}` })),
      el('div', { class: `meter${share >= 1 ? ' full' : share >= 0.8 ? ' warn' : ''}`, role: 'progressbar', 'aria-label': 'مصرف پاسخ هوشمند', 'aria-valuemin': '0', 'aria-valuemax': String(b.usage.limit), 'aria-valuenow': String(b.usage.used) },
        el('span', { style: `width:${Math.min(100, share * 100)}%` })),
      el('p', { class: 'subtle small', text: share >= 1 ? 'سقف پر شده؛ تا اول ماه بعد دستیار فقط پاسخ آفلاین می‌دهد.' : 'فقط پاسخ‌های هوش مصنوعی شمرده می‌شوند. شمارش اول هر ماه صفر می‌شود.' })),
    el('div', { class: 'line small' }, el('span', { class: 'muted', text: 'فروشگاه‌های متصل' }), el('b', { text: `${fa(b.stores)} از ${fa(b.limits[b.effectivePlan].stores)}` })));

  const plans = el('div', { class: 'bill-plans' }, ...['free', 'pro'].map((id) => el('section', { class: `card card-pad bill-tier${b.effectivePlan === id ? ' is-current' : ''}` },
    el('div', { class: 'bill-plan-head' }, el('h3', { text: `پلن ${PLAN_NAMES[id]}` }), b.effectivePlan === id ? el('span', { class: 'pill pill-accent', text: 'پلن شما' }) : null),
    el('ul', { class: 'plain-list bill-features' }, ...planFeatures(b.limits[id]).map((f) => el('li', {}, icon('check', 'icon icon-sm'), el('span', { text: f })))))));

  const upgrade = el('section', { class: 'card card-pad' }, el('h2', { class: 'card-title', text: 'ارتقا و تمدید' }),
    el('p', { class: 'muted', text: 'پرداخت فعلاً دستی است: پس از واریز، مدیر سامانه پرداخت را ثبت می‌کند و پلن شما تا تاریخ تمدید فعال می‌شود.' }),
    b.supportContact ? el('p', {}, el('span', { class: 'muted', text: 'تماس برای ارتقا: ' }), el('strong', { class: 'ltr-inline', text: b.supportContact })) : el('p', { class: 'subtle small', text: 'راه تماس با مدیر سامانه هنوز ثبت نشده است.' }));

  const payments = el('section', { class: 'card data-card' }, el('h2', { class: 'card-title', text: 'پرداخت‌ها' }),
    b.payments.length
      ? el('div', { class: 'table-wrap' }, el('table', { class: 'table' },
        el('thead', {}, el('tr', {}, ...['تاریخ ثبت', 'مبلغ', 'تمدید تا', 'یادداشت'].map((t) => el('th', { scope: 'col', text: t })))),
        el('tbody', {}, ...b.payments.map((p) => el('tr', {}, el('td', { text: faDate(p.createdAt) }), el('td', { class: 'strong', text: toman(p.amount) }), el('td', { text: faLastDay(p.periodEnd) }), el('td', { text: p.note || '—' }))))))
      : el('div', { class: 'empty' }, icon('card'), el('strong', { text: 'هنوز پرداختی ثبت نشده' })));

  const suspended = b.status === 'suspended'
    ? el('div', { class: 'notice-danger', role: 'alert', text: 'این فضای کاری توسط مدیر سامانه معلق شده و دستیارها پاسخ نمی‌دهند. برای رفع آن با پشتیبانی تماس بگیرید.' })
    : null;
  main.replaceChildren(...[pageHead('صورتحساب', 'پلن، مصرف این ماه و پرداخت‌های ثبت‌شده'), suspended,
    el('div', { class: 'bill-grid' }, current, upgrade, plans, payments)].filter(Boolean));
}
