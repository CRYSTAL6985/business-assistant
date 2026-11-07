// Popover menus anchored to a button: one open at a time, Esc / outside click closes and returns
// focus to the button, arrow keys move between items. Helpers el/icon come from /ui.js (global).
let openMenu = null;

export function closeMenu({ restoreFocus = true } = {}) {
  if (!openMenu) return;
  const { node, button } = openMenu;
  openMenu = null;
  node.remove();
  button.setAttribute('aria-expanded', 'false');
  if (restoreFocus) button.focus();
}

/**
 * @param {HTMLButtonElement} button  the trigger (inside a .menu-anchor)
 * @param {() => Node[]} build        returns the menu's children (use menuItem / menuLabel / menuSep)
 * @param {{ start?: boolean }} [options] start: open towards the inline-start side
 */
export function toggleMenu(button, build, { start = false } = {}) {
  const wasOpen = openMenu?.button === button;
  closeMenu({ restoreFocus: false });
  if (wasOpen) return;
  const node = el('div', { class: `menu${start ? ' menu-start' : ''}`, role: 'menu' }, ...build());
  button.parentElement.append(node);
  button.setAttribute('aria-expanded', 'true');
  openMenu = { node, button };
  node.querySelector('.menu-item')?.focus();
}

export const menuLabel = (text) => el('div', { class: 'menu-label', text });
export const menuSep = () => el('div', { class: 'menu-sep', role: 'separator' });

/** A menu row: a link when href is given (router link if it starts with /app), otherwise a button. */
export function menuItem({ label, iconName, href, onclick, checked, danger, external }) {
  const children = [iconName ? icon(iconName, 'icon icon-sm') : null, el('span', { text: label })];
  const attrs = { class: `menu-item${danger ? ' danger' : ''}`, role: checked === undefined ? 'menuitem' : 'menuitemradio' };
  if (checked !== undefined) attrs['aria-checked'] = String(checked);
  if (href) {
    return el('a', { ...attrs, href, 'data-link': href.startsWith('/app') && !external ? '' : null, target: external ? '_blank' : null, rel: external ? 'noopener' : null, onclick: () => closeMenu({ restoreFocus: false }) }, ...children);
  }
  return el('button', { ...attrs, type: 'button', onclick: (e) => { closeMenu({ restoreFocus: false }); onclick?.(e); } }, ...children);
}

document.addEventListener('click', (event) => {
  if (openMenu && !openMenu.node.contains(event.target) && !openMenu.button.contains(event.target)) closeMenu({ restoreFocus: false });
});
document.addEventListener('keydown', (event) => {
  if (!openMenu) return;
  if (event.key === 'Escape') { event.preventDefault(); closeMenu(); return; }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  const items = [...openMenu.node.querySelectorAll('.menu-item')];
  const index = items.indexOf(document.activeElement);
  const next = event.key === 'ArrowDown' ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
  items[next]?.focus();
});
