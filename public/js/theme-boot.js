// Applies the saved theme before first paint so there is no flash of the wrong theme. A file rather
// than an inline <script> so the Content-Security-Policy can forbid inline scripts.
try { document.documentElement.dataset.theme = localStorage.getItem('theme') || 'dark'; } catch { /* storage blocked: keep dark */ }
