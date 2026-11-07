// Pagination and search helpers shared by list endpoints.
const DEFAULT_PER = 20;
const MAX_PER = 100;

/** ?page=&per= -> clamped integers. Garbage falls back to defaults instead of erroring. */
function parsePaging(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const rawPer = Number.parseInt(query.per, 10);
  const per = Math.min(MAX_PER, Math.max(1, Number.isNaN(rawPer) ? DEFAULT_PER : rawPer));
  return { page, per, offset: (page - 1) * per };
}

function pageResult(items, total, { page, per }) {
  return { items, total, page, pages: Math.max(1, Math.ceil(total / per)) };
}

/** Search text -> LIKE pattern matching it anywhere; % _ \ match literally (use with ESCAPE '\'). */
function likePattern(q) {
  return `%${String(q).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

module.exports = { parsePaging, pageResult, likePattern, MAX_PER };
