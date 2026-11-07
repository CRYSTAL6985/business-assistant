// Data views for list pages: filter toolbar, table on wide screens / two-line list on phones, pager.
// Filters and page live in the URL (replaceState), so reload and back keep what the user chose.
const fa = (n) => Number(n).toLocaleString('fa-IR');
const SEARCH_DEBOUNCE_MS = 300;

/**
 * @param {{
 *   filters: Array<{ key: string, type: 'search'|'select'|'seg'|'date', label: string, options?: {value:string,label:string}[], placeholder?: string }>,
 *   fetchPage: (params: URLSearchParams) => Promise<{ items: object[], total: number, page: number, pages: number }>,
 *   columns: Array<{ label: string, cell: (item) => Node|string, className?: string }>,
 *   mobileRow: (item) => Node[],
 *   onOpen?: (item) => void,
 *   empty: { icon: string, title: string, text: string, filteredText?: string },
 * }} options
 * @returns {{ node: HTMLElement, reload: () => Promise<void> }}
 */
export function dataView({ filters, fetchPage, columns, mobileRow, onOpen, empty }) {
  const params = new URLSearchParams(location.search);
  const filterKeys = filters.map((f) => f.key);
  const sync = () => history.replaceState(null, '', `${location.pathname}${params.toString() ? `?${params}` : ''}`);
  const set = (key, value) => {
    if (value) params.set(key, value); else params.delete(key);
    if (key !== 'page') params.delete('page');
    sync();
    load();
  };

  const toolbar = el('div', { class: 'toolbar', role: 'search' }, ...filters.map((f) => {
    if (f.type === 'search') {
      let timer;
      const input = el('input', { class: 'input', type: 'search', placeholder: f.placeholder ?? 'جستجو…', 'aria-label': f.label, value: params.get(f.key) ?? '' });
      input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => set(f.key, input.value.trim()), SEARCH_DEBOUNCE_MS); });
      return el('div', { class: 'toolbar-search' }, icon('search', 'icon icon-sm'), input);
    }
    if (f.type === 'select') {
      const select = el('select', { class: 'select', 'aria-label': f.label, onchange: (e) => set(f.key, e.target.value) },
        ...f.options.map((o) => el('option', { value: o.value, text: o.label, selected: (params.get(f.key) ?? '') === o.value })));
      return select;
    }
    if (f.type === 'date') {
      return el('label', { class: 'toolbar-date' }, el('span', { class: 'subtle small', text: f.label }),
        el('input', { class: 'input', type: 'date', value: params.get(f.key) ?? '', onchange: (e) => set(f.key, e.target.value) }));
    }
    const seg = el('div', { class: 'seg seg-sm', role: 'group', 'aria-label': f.label }, ...f.options.map((o) => el('button', {
      type: 'button', text: o.label, 'aria-pressed': String((params.get(f.key) ?? '') === o.value),
      onclick: (e) => { seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); set(f.key, o.value); },
    })));
    return seg;
  }));

  const head = el('thead', {}, el('tr', {}, ...columns.map((c) => el('th', { scope: 'col', class: c.className ?? null, text: c.label }))));
  const tbody = el('tbody');
  const table = el('div', { class: 'table-wrap only-wide' }, el('table', { class: 'table' }, head, tbody));
  const list = el('ul', { class: 'list only-narrow' });
  const state = el('div', { class: 'view-state' });
  const pager = el('nav', { class: 'pager', 'aria-label': 'صفحه‌بندی' });
  const card = el('div', { class: 'card data-card' }, table, list, state, pager);

  function skeletonRows() {
    tbody.replaceChildren(...Array.from({ length: 5 }, () => el('tr', {}, ...columns.map(() => el('td', {}, el('div', { class: 'skeleton', style: 'height:14px' }))))));
    list.replaceChildren(...Array.from({ length: 4 }, () => el('li', {}, el('div', { class: 'skeleton', style: 'height:48px;margin:8px' }))));
  }

  async function load() {
    skeletonRows();
    state.replaceChildren();
    pager.replaceChildren();
    card.setAttribute('aria-busy', 'true');
    try {
      const data = await fetchPage(new URLSearchParams(params));
      tbody.replaceChildren(...data.items.map((item) => {
        const tr = el('tr', { class: onOpen ? 'clickable' : null }, ...columns.map((c) => el('td', { class: c.className ?? null }, c.cell(item))));
        if (onOpen) tr.addEventListener('click', (e) => { if (!e.target.closest('button, a')) onOpen(item); });
        return tr;
      }));
      list.replaceChildren(...data.items.map((item) => {
        const children = mobileRow(item);
        return el('li', {}, onOpen ? el('button', { type: 'button', class: 'row-link', onclick: () => onOpen(item) }, ...children) : el('div', { class: 'row-link' }, ...children));
      }));
      table.hidden = !data.items.length;
      list.hidden = !data.items.length;
      if (!data.items.length) {
        const filtered = filterKeys.some((k) => params.get(k));
        state.replaceChildren(el('div', { class: 'empty' }, icon(empty.icon), el('strong', { text: filtered ? 'نتیجه‌ای پیدا نشد' : empty.title }),
          el('p', { text: filtered ? (empty.filteredText ?? 'فیلترها یا عبارت جستجو را تغییر دهید.') : empty.text })));
      }
      if (data.pages > 1) {
        pager.replaceChildren(
          el('button', { class: 'btn btn-secondary btn-sm', type: 'button', disabled: data.page <= 1, text: 'قبلی', onclick: () => set('page', String(data.page - 1)) }),
          el('span', { class: 'subtle small', text: `صفحهٔ ${fa(data.page)} از ${fa(data.pages)} · ${fa(data.total)} مورد` }),
          el('button', { class: 'btn btn-secondary btn-sm', type: 'button', disabled: data.page >= data.pages, text: 'بعدی', onclick: () => set('page', String(data.page + 1)) }));
      } else if (data.total) {
        pager.replaceChildren(el('span', { class: 'subtle small', text: `${fa(data.total)} مورد` }));
      }
    } catch (err) {
      tbody.replaceChildren();
      list.replaceChildren();
      state.replaceChildren(el('div', { class: 'empty' }, icon('alert'), el('strong', { text: 'بارگذاری نشد' }), el('p', { text: err.message }),
        el('button', { class: 'btn btn-secondary btn-sm', type: 'button', text: 'تلاش دوباره', onclick: load })));
    } finally {
      card.setAttribute('aria-busy', 'false');
    }
  }

  load();
  return { node: el('div', { class: 'data-view' }, toolbar, card), reload: load };
}

/** Page header with title, subtitle and actions — same on every page. */
export function pageHead(title, subtitle, ...actions) {
  return el('div', { class: 'page-head' }, el('div', {}, el('h1', { text: title }), subtitle ? el('p', { text: subtitle }) : null),
    el('div', { class: 'page-actions' }, ...actions));
}

/** Store selector for create forms: the current store when one is selected, otherwise a choice. */
export function storeField(me, storeId) {
  return {
    name: 'storeId', label: 'فروشگاه', type: 'select', required: true,
    options: me.stores.map((s) => ({ value: s.id, label: s.name })),
    initialValue: storeId ?? me.stores[0]?.id,
  };
}
