// The per-store assistant settings: defaults for missing keys and validation of an edited draft.
// Stored as JSON in assistant_configs.draft_json / published_json.

const COLOR = /^#[0-9a-f]{6}$/i;
const LANGUAGES = ['fa', 'en'];
const LIMITS = { assistantName: 60, tone: 120, description: 1500, instructions: 5000, policies: 3000, welcome: 300, fallbackMessage: 300, launcherText: 30 };

/** @returns the complete default config for a store */
function defaults(storeName) {
  return {
    assistantName: `دستیار ${storeName}`,
    tone: 'دوستانه و محترمانه',
    description: '',
    instructions: '',
    policies: '',
    languages: ['fa'],
    welcome: `سلام! من دستیار ${storeName} هستم. دربارهٔ محصولات و قیمت‌ها بپرسید، یا همین‌جا سفارش بدهید.`,
    orderTaking: true,
    fallbackMessage: '',
    color: '#2f6fe4',
    position: 'left',
    launcherText: '',
  };
}

/** Stored JSON (possibly from an older version with fewer keys) -> complete config. */
function normalize(raw, storeName) {
  const base = defaults(storeName);
  const value = raw && typeof raw === 'object' ? raw : {};
  const out = { ...base };
  for (const key of Object.keys(base)) if (value[key] !== undefined && value[key] !== null) out[key] = value[key];
  return out;
}

/** An edited draft from the browser -> { ok: true, value } or { ok: false, error } (Persian). */
function validateDraft(input) {
  if (!input || typeof input !== 'object') return { ok: false, error: 'تنظیمات نامعتبر است' };
  const value = {};
  for (const [key, max] of Object.entries(LIMITS)) {
    const text = input[key] ?? '';
    if (typeof text !== 'string' || text.trim().length > max) return { ok: false, error: `«${key}» حداکثر ${max.toLocaleString('fa-IR')} حرف` };
    value[key] = text.trim();
  }
  if (!value.assistantName) return { ok: false, error: 'نام دستیار لازم است' };
  if (!value.tone) return { ok: false, error: 'لحن دستیار لازم است' };
  if (!COLOR.test(input.color ?? '')) return { ok: false, error: 'رنگ باید به شکل #RRGGBB باشد' };
  if (!['left', 'right'].includes(input.position)) return { ok: false, error: 'محل دکمه باید چپ یا راست باشد' };
  const languages = Array.isArray(input.languages) ? [...new Set(input.languages)] : [];
  if (!languages.length || languages.some((l) => !LANGUAGES.includes(l))) return { ok: false, error: 'زبان‌های پاسخ نامعتبر است' };
  return {
    ok: true,
    value: { ...value, languages, orderTaking: input.orderTaking !== false, color: input.color.toLowerCase(), position: input.position },
  };
}

module.exports = { defaults, normalize, validateDraft };
