// Embeddable chat bubble. A business pastes ONE line on its own website:
//   <script src="https://YOUR-SERVER/widget.js" data-business="abrisham" defer></script>
// It asks the server for the store's branding (colour, side, button text) — the server only answers
// on the store's own domain — then adds a floating button that opens the chat page in an iframe.
// Self-contained: it must not depend on (or break) the host site's CSS, so all styles are inline.
(async function () {
  const script = document.currentScript;
  const slug = script && script.dataset.business;
  if (!slug) return;
  const origin = new URL(script.src).origin;
  let config;
  try {
    const res = await fetch(`${origin}/api/chat/${encodeURIComponent(slug)}/config`);
    if (!res.ok) return; // not this store's site, or store disconnected: show nothing
    config = await res.json();
  } catch {
    return; // server unreachable: no button rather than a broken one
  }
  const side = config.position === 'right' ? 'right' : 'left';
  const color = config.color;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
  const ICON_CHAT = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>';
  const ICON_CLOSE = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

  const frame = document.createElement('iframe');
  frame.title = 'گفتگو با فروشگاه';
  frame.style.cssText = [
    'position:fixed', 'bottom:92px', `${side}:16px`, 'z-index:2147483646',
    'width:min(390px,calc(100vw - 32px))', 'height:min(600px,calc(100dvh - 120px))',
    'border:0', 'border-radius:22px', 'background:#f4f1ec', 'color-scheme:normal',
    'box-shadow:0 24px 60px -16px rgba(0,0,0,.35),0 2px 8px rgba(0,0,0,.08)',
    `transform-origin:bottom ${side}`, 'opacity:0', 'transform:scale(.92) translateY(12px)',
    'pointer-events:none', 'visibility:hidden',
    `transition:opacity 220ms ${EASE},transform 280ms ${EASE},visibility 0s linear 280ms`,
  ].join(';');

  const button = document.createElement('button');
  button.type = 'button';
  button.innerHTML = ICON_CHAT; // static markup defined above, no outside data
  if (config.launcherText) button.append(config.launcherText); // appended as text, never as HTML
  button.setAttribute('aria-label', 'گفتگو با فروشگاه');
  button.setAttribute('aria-expanded', 'false');
  button.style.cssText = [
    'position:fixed', 'bottom:20px', `${side}:20px`, 'z-index:2147483647',
    'height:60px', config.launcherText ? 'padding:0 22px 0 18px' : 'width:60px', 'border-radius:999px', 'border:0', 'cursor:pointer',
    'display:flex', 'align-items:center', 'justify-content:center', 'gap:8px', `background:${color}`, 'color:#fff',
    'font:600 15px/1 Vazirmatn,Tahoma,sans-serif', 'direction:rtl',
    'box-shadow:0 10px 30px -6px rgba(0,0,0,.35)', '-webkit-tap-highlight-color:transparent',
    `transition:transform 120ms ${EASE}`,
  ].join(';');

  let open = false;
  function setOpen(next) {
    open = next;
    if (open && !frame.src) frame.src = `${origin}/chat/${encodeURIComponent(slug)}`; // load only when first opened
    Object.assign(frame.style, open
      ? { opacity: '1', transform: 'none', pointerEvents: 'auto', visibility: 'visible', transitionDelay: '0s' }
      : { opacity: '0', transform: reduceMotion ? 'none' : 'scale(.92) translateY(12px)', pointerEvents: 'none', visibility: 'hidden', transitionDelay: '0s,0s,280ms' });
    button.innerHTML = open ? ICON_CLOSE : ICON_CHAT; // static markup defined above
    if (!open && config.launcherText) button.append(config.launcherText); // text node: no HTML from the server
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', open ? 'بستن گفتگو' : 'گفتگو با فروشگاه');
  }

  button.addEventListener('pointerdown', () => { button.style.transform = 'scale(.94)'; });
  for (const type of ['pointerup', 'pointerleave', 'pointercancel']) {
    button.addEventListener(type, () => { button.style.transform = ''; });
  }
  button.addEventListener('click', () => setOpen(!open));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && open) { setOpen(false); button.focus(); }
  });

  document.body.append(frame, button);
})();
