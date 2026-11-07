// Input checks shared by the routes. Everything that arrives from a browser goes through here.

const SLUG_PATTERN = /^[a-z0-9-]{3,30}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_PRICE = 1_000_000_000_000;

/** Trimmed string between min and max characters, or null. */
function text(value, min, max) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length >= min && trimmed.length <= max ? trimmed : null;
}

/** Whole number of toman between 0 and MAX_PRICE, or null. */
function price(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= MAX_PRICE ? n : null;
}

function slug(value) {
  const s = text(value, 3, 30)?.toLowerCase();
  return s && SLUG_PATTERN.test(s) ? s : null;
}

function email(value) {
  const e = text(value, 5, 120)?.toLowerCase();
  return e && EMAIL_PATTERN.test(e) ? e : null;
}

/** Route id parameter -> positive integer, or null. */
function id(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

module.exports = { text, price, slug, email, id };
