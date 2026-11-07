// The assistant's brain. Three jobs:
//   1. buildSystemPrompt — turn one business's data (info, products, FAQs) into instructions for the AI.
//   2. askModel          — send the conversation to an OpenAI-compatible chat API.
//   3. offlineAnswer     — answer from the FAQ list by keyword matching when the AI is unavailable.
// Orders: the AI writes a hidden <order>{...}</order> block once the customer confirms;
// extractOrder pulls it out and validateOrder checks it against the real product table.

const AI_TIMEOUT_MS = 30_000;
const MAX_REPLY_TOKENS = 700;
const MAX_ORDER_LINES = 20;
const MAX_QTY = 10;
const MIN_KEYWORD_SCORE = 1;

const ORDER_TAG = /<order>([\s\S]*?)<\/order>/i;

const STOP_WORDS = new Set([
  'و', 'در', 'به', 'از', 'که', 'این', 'آن', 'را', 'با', 'برای', 'است', 'هست', 'چه', 'چی', 'آیا',
  'من', 'شما', 'یک', 'ها', 'های', 'می', 'هم', 'تا', 'یا', 'رو', 'دارید', 'دارین', 'میشه', 'کنم',
  'the', 'a', 'an', 'is', 'are', 'do', 'you', 'i', 'to', 'of', 'and', 'what', 'how', 'can',
]);

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** Persian and Arabic digits -> 0-9. */
function toLatinDigits(text) {
  return String(text).replace(/[۰-۹٠-٩]/g, (d) => {
    const i = PERSIAN_DIGITS.indexOf(d);
    return String(i >= 0 ? i : ARABIC_DIGITS.indexOf(d));
  });
}

/** Lower-case, unify Arabic/Persian letters, drop punctuation — so "كتاب" and "کتاب" match. */
function normalize(text) {
  return toLatinDigits(text)
    .toLowerCase()
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[ً-ٰٟ]/g, '') // Arabic diacritics
    .replace(/‌/g, ' ') // zero-width non-joiner (نیم‌فاصله)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ');
}

function keywords(text) {
  return normalize(text).split(/\s+/).filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

function formatToman(amount) {
  return `${Number(amount).toLocaleString('fa-IR')} تومان`;
}

/** Iranian mobile in any common form (+98, 0098, Persian digits, spaces) -> 09xxxxxxxxx, or null. */
function normalizePhone(raw) {
  const digits = toLatinDigits(raw).replace(/[^\d]/g, '');
  const local = digits.replace(/^(0098|98)/, '0');
  const withZero = local.startsWith('9') ? `0${local}` : local;
  return /^09\d{9}$/.test(withZero) ? withZero : null;
}

function buildSystemPrompt(business, products, faqs) {
  const productLines = products.length
    ? products.map((p) =>
        `#${p.id} | ${p.name} | ${formatToman(p.price)} | ${p.in_stock ? 'موجود' : 'ناموجود'} | ${p.description}`)
    : ['(هنوز محصولی ثبت نشده)'];
  const faqLines = faqs.length ? faqs.map((f) => `س: ${f.question}\nج: ${f.answer}`) : ['(سؤال متداولی ثبت نشده)'];

  return [
    `You are the customer-service assistant of the business "${business.name}".`,
    business.description ? `About the business: ${business.description}` : null,
    `Tone: ${business.tone}.`,
    '',
    'RULES',
    '- Reply in the language the customer writes in (usually Persian). Keep replies short.',
    '- Use ONLY the information below. Never invent products, prices, discounts, policies or delivery times.',
    '- If the answer is not below, say you do not know and that the shop staff will follow up.',
    '- When you mention a product, give its name and price exactly as listed. Do not offer out-of-stock products.',
    '',
    'TAKING AN ORDER',
    '- Collect: which products (and how many), full name, mobile number, full delivery address.',
    '- Then show a short summary with the total and ask the customer to confirm.',
    '- ONLY after the customer clearly confirms, end your reply with this block on its own line:',
    '  <order>{"items":[{"id":PRODUCT_ID,"qty":1}],"name":"...","phone":"...","address":"..."}</order>',
    '- Use the product ids (#number) from the list. Never show or mention this block to the customer.',
    '',
    'PRODUCTS (id | name | price | stock | description)',
    ...productLines,
    '',
    'FREQUENTLY ASKED QUESTIONS',
    ...faqLines,
  ].filter((line) => line !== null).join('\n');
}

/**
 * Calls an OpenAI-compatible /chat/completions endpoint and returns the reply text.
 * Throws on network errors, timeouts, non-2xx answers and empty replies — the caller decides the fallback.
 */
async function askModel({ baseUrl, apiKey, model }, systemPrompt, history) {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.3, // low = sticks to the given facts
      max_tokens: MAX_REPLY_TOKENS,
      messages: [{ role: 'system', content: systemPrompt }, ...history],
    }),
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`AI API ${response.status}: ${body.slice(0, 200)}`);
  }
  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new Error('AI API returned an empty reply');
  return text.trim();
}

/** Splits the AI reply into the text the customer sees and the parsed order block (if any). */
function extractOrder(reply) {
  const match = reply.match(ORDER_TAG);
  if (!match) return { text: reply, order: null, error: null };
  const text = reply.replace(ORDER_TAG, '').trim();
  try {
    return { text, order: JSON.parse(match[1]), error: null };
  } catch {
    return { text, order: null, error: 'اطلاعات سفارش خوانا نبود' };
  }
}

function cleanString(value, min, max) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length >= min && trimmed.length <= max ? trimmed : null;
}

/**
 * Checks an order the AI produced. The AI is NOT trusted: product ids must belong to this
 * business and be in stock, and prices/total come from the database, never from the AI.
 * Returns { ok: true, value } or { ok: false, error } with a Persian message for the customer.
 */
function validateOrder(order, products) {
  if (!order || typeof order !== 'object') return { ok: false, error: 'اطلاعات سفارش ناقص است' };
  const { items } = order;
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ORDER_LINES) {
    return { ok: false, error: 'هیچ محصولی در سفارش نیست' };
  }

  const byId = new Map(products.map((p) => [p.id, p]));
  const lines = [];
  for (const item of items) {
    const product = byId.get(Number(item?.id));
    const qty = Number(item?.qty);
    if (!product) return { ok: false, error: 'یکی از محصولات سفارش پیدا نشد' };
    if (!product.in_stock) return { ok: false, error: `«${product.name}» در حال حاضر موجود نیست` };
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) return { ok: false, error: 'تعداد سفارش نامعتبر است' };
    lines.push({ id: product.id, name: product.name, price: product.price, qty });
  }

  const name = cleanString(order.name, 2, 80);
  const phone = normalizePhone(order.phone ?? '');
  const address = cleanString(order.address, 5, 300);
  if (!name) return { ok: false, error: 'نام سفارش‌دهنده لازم است' };
  if (!phone) return { ok: false, error: 'شماره موبایل معتبر نیست (مثال: 09121234567)' };
  if (!address) return { ok: false, error: 'آدرس کامل لازم است' };

  const total = lines.reduce((sum, line) => sum + line.price * line.qty, 0);
  return { ok: true, value: { name, phone, address, items: lines, total } };
}

const PRODUCT_LIST_WORDS = ['محصول', 'محصولات', 'قیمت', 'لیست', 'چی دارید', 'چه دارید', 'products', 'price'];

/**
 * Offline mode: no AI, just keyword overlap between the question and each FAQ / product.
 * Deliberately simple — it keeps the bot useful when the AI service is down or unpaid.
 */
function offlineAnswer(question, products, faqs) {
  const words = new Set(keywords(question));
  const score = (text) => keywords(text).filter((w) => words.has(w)).length;

  const bestFaq = faqs
    .map((faq) => ({ faq, points: score(faq.question) * 2 + score(faq.answer) }))
    .sort((a, b) => b.points - a.points)[0];
  if (bestFaq && bestFaq.points >= MIN_KEYWORD_SCORE * 2) return bestFaq.faq.answer;

  const inStock = products.filter((p) => p.in_stock);
  const matched = inStock.filter((p) => score(`${p.name} ${p.description}`) >= MIN_KEYWORD_SCORE);
  const askedForList = PRODUCT_LIST_WORDS.some((w) => normalize(question).includes(normalize(w)));
  const toShow = matched.length ? matched : askedForList ? inStock : [];
  if (toShow.length) {
    const list = toShow.map((p) => `• ${p.name} — ${formatToman(p.price)}`).join('\n');
    return `${list}\n\nبرای ثبت سفارش، نام محصول، نام و نام خانوادگی، شماره موبایل و آدرس را بفرستید تا همکاران ما پیگیری کنند.`;
  }

  return 'پاسخ این سؤال را ندارم. پیام شما ثبت شد و همکاران ما به‌زودی پیگیری می‌کنند.';
}

module.exports = {
  buildSystemPrompt,
  askModel,
  extractOrder,
  validateOrder,
  offlineAnswer,
  normalizePhone,
  normalize,
  formatToman,
};
