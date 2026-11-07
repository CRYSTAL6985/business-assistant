// Small UI helpers shared by the chat page and the panel. Plain functions, no framework.

/** Builds an element. Text goes in through textContent only, so data can never inject HTML. */
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key in node && !key.includes('-')) node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

/** An icon from /icons.svg, hidden from screen readers (the button or text around it carries the meaning). */
function icon(name, className = 'icon') {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(ns, 'use');
  use.setAttribute('href', `/icons.svg#${name}`);
  svg.append(use);
  return svg;
}

const TOAST_MS = 3200;

/** Short confirmation at the bottom of the screen. aria-live: screen readers hear it without losing focus. */
function toast(message, iconName = 'check') {
  let region = document.querySelector('.toasts');
  if (!region) {
    region = el('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(region);
  }
  const node = el('div', { class: 'toast' }, icon(iconName, 'icon icon-sm'), el('span', { text: message }));
  region.append(node);
  setTimeout(() => {
    node.classList.add('leaving');
    node.addEventListener('animationend', () => node.remove(), { once: true });
    setTimeout(() => node.remove(), 400); // reduced-motion fallback: animationend may not fire
  }, TOAST_MS);
}

/** Accessible yes/no dialog built on <dialog>. Resolves true only on the confirm button. */
function confirmDialog({ title, body, confirmText, danger = true }) {
  return new Promise((resolve) => {
    const cancel = el('button', { type: 'button', class: 'btn btn-secondary', text: 'انصراف' });
    const ok = el('button', { type: 'button', class: `btn ${danger ? 'btn-danger-solid' : ''}`, text: confirmText });
    const dialog = el('dialog', { 'aria-labelledby': 'dlg-title' },
      el('div', { class: 'dialog-body' }, el('h2', { id: 'dlg-title', text: title }), el('p', { class: 'muted', text: body })),
      el('div', { class: 'form-actions' }, cancel, ok));
    const close = (result) => { dialog.close(); dialog.remove(); resolve(result); };
    cancel.addEventListener('click', () => close(false));
    ok.addEventListener('click', () => close(true));
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(false); }); // Esc
    document.body.append(dialog);
    dialog.showModal();
    cancel.focus(); // safe default for a destructive question
  });
}

/** Marks a button busy (spinner, no double submit) while the promise runs. */
async function withBusy(button, task) {
  if (!button) return task();
  button.setAttribute('aria-busy', 'true');
  button.disabled = true;
  try {
    return await task();
  } finally {
    button.removeAttribute('aria-busy');
    button.disabled = false;
  }
}

// A run of Latin text: starts and ends with a letter/digit, may contain spaces and & ' . - between.
const LATIN_RUN = /\p{Script=Latin}[\p{Script=Latin}\d&'’.\-\s]*[\p{Script=Latin}\d]|\p{Script=Latin}/gu; // \p{…}: accents like é count

/**
 * Text -> nodes with every English run wrapped in <bdi>. Without it, "• Garnet Knit — ۲٬۴۵۰٬۰۰۰ تومان"
 * in a right-to-left bubble gets its words reordered by the browser's bidi algorithm.
 */
function bidiText(text) {
  const nodes = [];
  let last = 0;
  for (const match of text.matchAll(LATIN_RUN)) {
    if (match.index > last) nodes.push(document.createTextNode(text.slice(last, match.index)));
    nodes.push(el('bdi', { text: match[0] }));
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(document.createTextNode(text.slice(last)));
  return nodes;
}

const faNumber = (n) => Number(n).toLocaleString('fa-IR');
const toman = (n) => `${faNumber(n)} تومان`;

/** SQLite "YYYY-MM-DD HH:MM:SS" (UTC) -> Persian (Solar Hijri) date and time. */
function faDate(sqliteDate) {
  const date = new Date(`${sqliteDate.replace(' ', 'T')}Z`);
  return date.toLocaleString('fa-IR', { dateStyle: 'medium', timeStyle: 'short' });
}
