// Date ranges for reports. Days are Tehran calendar days (UTC+03:30, no DST since 2022);
// the database stores UTC "YYYY-MM-DD HH:MM:SS", so range bounds are returned in that form.

const TEHRAN_OFFSET_MS = 210 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CUSTOM_DAYS = 366;
const RANGE_DAYS = { today: 1, '7d': 7, '30d': 30 };
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const toSqlite = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const tehranDay = (ms) => new Date(ms + TEHRAN_OFFSET_MS).toISOString().slice(0, 10);
/** UTC instant (ms) at which a Tehran day starts. */
const dayStartMs = (day) => Date.parse(`${day}T00:00:00Z`) - TEHRAN_OFFSET_MS;

function isRealDay(day) {
  return typeof day === 'string' && DAY_PATTERN.test(day) && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
}

/**
 * @param {{ range?: string, from?: string, to?: string }} query
 * @returns {{ start: string, end: string, prevStart: string, prevEnd: string, days: string[] } | { error: string }}
 */
function resolveRange({ range = '7d', from, to } = {}, now = new Date()) {
  let firstDay;
  let count;
  if (range === 'custom') {
    if (!isRealDay(from) || !isRealDay(to)) return { error: 'تاریخ نامعتبر است' };
    count = Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;
    if (count < 1) return { error: 'تاریخ شروع باید قبل از تاریخ پایان باشد' };
    if (count > MAX_CUSTOM_DAYS) return { error: `بازه حداکثر ${MAX_CUSTOM_DAYS.toLocaleString('fa-IR')} روز است` };
    firstDay = from;
  } else if (RANGE_DAYS[range]) {
    count = RANGE_DAYS[range];
    firstDay = tehranDay(Date.parse(`${tehranDay(now.getTime())}T00:00:00Z`) - (count - 1) * DAY_MS);
  } else {
    return { error: 'بازه زمانی نامعتبر است' };
  }
  const startMs = dayStartMs(firstDay);
  const days = Array.from({ length: count }, (_, i) => new Date(Date.parse(`${firstDay}T00:00:00Z`) + i * DAY_MS).toISOString().slice(0, 10));
  return {
    start: toSqlite(startMs),
    end: toSqlite(startMs + count * DAY_MS),
    prevStart: toSqlite(startMs - count * DAY_MS),
    prevEnd: toSqlite(startMs),
    days,
  };
}

module.exports = { resolveRange, toSqlite, tehranDay, TEHRAN_OFFSET_MS };
