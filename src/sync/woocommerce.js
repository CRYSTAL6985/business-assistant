// WooCommerce REST API v3 client and the mapping from WooCommerce rows to ours.
// Errors carry a plain Persian message for the owner (shown on the integrations page); `kind`
// tells the queue whether a retry can help (network/http) or not (auth, currency, format).

const TIMEOUT_MS = 20_000;
const PER_PAGE = 100;
const MAX_PAGES = 200; // 20,000 rows: a guard against a server that reports pages forever

// Toman per one unit of the store's currency. Iranian WooCommerce plugins use IRT/IRHT/IRHR.
const CURRENCY_TO_TOMAN = { IRT: 1, IRR: 0.1, IRHT: 1000, IRHR: 100 };
// Spec §14: pending/on-hold -> new, processing -> confirmed, completed -> sent, the rest -> cancelled.
const STATUS_MAP = { pending: 'new', 'on-hold': 'new', processing: 'confirmed', completed: 'sent', cancelled: 'cancelled', refunded: 'cancelled', failed: 'cancelled' };

class WooError extends Error {
  /** @param {'auth'|'currency'|'format'|'http'|'network'|'redirect'} kind */
  constructor(kind, message) { super(message); this.kind = kind; }
  get retryable() { return this.kind === 'http' || this.kind === 'network'; }
}

/**
 * @param {{ siteUrl: string, key: string, secret: string, fetch?: typeof fetch }} options
 */
function wooClient({ siteUrl, key, secret, fetch: doFetch = fetch }) {
  const base = `${siteUrl.replace(/\/+$/, '')}/wp-json/wc/v3`;
  const authorization = `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`;

  async function call(method, path, body) {
    let res;
    try {
      res = await doFetch(base + path, {
        method,
        headers: { Authorization: authorization, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new WooError('network', 'سایت در دسترس نبود یا دیر پاسخ داد');
    }
    if (res.status === 401 || res.status === 403) throw new WooError('auth', 'ووکامرس کلیدها را نپذیرفت. کلید و رمز را دوباره بسازید (دسترسی «خواندن/نوشتن»).');
    if (res.status >= 300 && res.status < 400) throw new WooError('redirect', 'آدرس سایت به جای دیگری منتقل می‌شود؛ آدرس نهایی سایت (همان که در مرورگر می‌بینید) را وارد کنید.');
    if (res.status === 404) throw new WooError('format', 'API ووکامرس در این آدرس پیدا نشد. آیا ووکامرس نصب و «پیوندهای یکتا» فعال است؟');
    if (!res.ok) throw new WooError('http', `سایت خطای ${res.status} داد`);
    let data;
    try { data = await res.json(); } catch { throw new WooError('format', 'پاسخ سایت قابل خواندن نبود — آیا این آدرس یک فروشگاه ووکامرس است؟'); }
    return { data, pages: Number(res.headers.get('x-wp-totalpages')) || 1 };
  }

  return {
    /** Store currency code, e.g. 'IRT'. */
    async currency() {
      const { data } = await call('GET', '/settings/general/woocommerce_currency');
      return String(data?.value ?? '');
    },
    /** Yields one page (array) at a time. */
    async *pages(path, params = {}) {
      for (let page = 1; page <= MAX_PAGES; page++) {
        const query = new URLSearchParams({ ...params, per_page: String(PER_PAGE), page: String(page) });
        const { data, pages } = await call('GET', `${path}?${query}`);
        if (!Array.isArray(data)) throw new WooError('format', 'پاسخ ووکامرس فهرست نبود');
        yield data;
        if (page >= pages || data.length < PER_PAGE) return;
      }
    },
    createWebhook: (topic, deliveryUrl, webhookSecret) => call('POST', '/webhooks', {
      name: `دستیار هوشمند — ${topic}`, topic, delivery_url: deliveryUrl, secret: webhookSecret, status: 'active',
    }),
  };
}

/** Toman multiplier for a currency code, or throws a WooError the owner can act on. */
function tomanFactor(currency) {
  const factor = CURRENCY_TO_TOMAN[currency];
  if (!factor) throw new WooError('currency', `واحد پول فروشگاه «${currency || 'نامشخص'}» است؛ فقط ریال و تومان پشتیبانی می‌شود.`);
  return factor;
}

const toToman = (value, factor) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * factor) : null;
};
const plain = (html, max) => String(html ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const sqliteDate = (gmt) => (typeof gmt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(gmt) ? gmt.slice(0, 19).replace('T', ' ') : null);

/** A simple product or one variation -> our product row; null when it can't be sold (no price, not published). */
function productRow(p, factor, parent = null) {
  if (!parent && p.status && p.status !== 'publish') return null;
  const price = toToman(p.price, factor);
  if (price === null || p.price === '') return null;
  const options = parent ? (p.attributes ?? []).map((a) => a.option).filter(Boolean).join('، ') : '';
  return {
    externalId: parent ? `${parent.id}:${p.id}` : String(p.id),
    name: plain(parent ? `${parent.name}${options ? ` — ${options}` : ''}` : p.name, 120) || 'بدون نام',
    description: plain(parent ? parent.short_description || parent.description : p.short_description || p.description, 1000),
    category: plain((parent ?? p).categories?.[0]?.name, 60),
    price,
    inStock: p.stock_status !== 'outofstock',
    stockQty: p.manage_stock && Number.isInteger(p.stock_quantity) ? p.stock_quantity : null,
  };
}

function orderRow(o, factor) {
  const b = o.billing ?? {};
  return {
    externalId: String(o.id),
    customerName: plain(`${b.first_name ?? ''} ${b.last_name ?? ''}`, 80) || 'مشتری ووکامرس',
    phone: plain(b.phone, 30),
    address: [b.state, b.city, b.address_1, b.address_2].map((x) => plain(x, 200)).filter(Boolean).join('، ').slice(0, 500),
    items: (o.line_items ?? []).map((li) => ({ name: plain(li.name, 120), qty: Number(li.quantity) || 1, price: toToman(li.price, factor) ?? 0 })),
    total: toToman(o.total, factor) ?? 0,
    status: STATUS_MAP[o.status] ?? 'new',
    createdAt: sqliteDate(o.date_created_gmt),
  };
}

module.exports = { wooClient, WooError, tomanFactor, productRow, orderRow, CURRENCY_TO_TOMAN };
