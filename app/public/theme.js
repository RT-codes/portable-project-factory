// The saved look, applied before the page paints so there is no flash: dark unless light was chosen, and (in the
// desktop app) the variables and data attributes of the active theme, as src/desktop/appearance.svelte.ts left them.
// (A file of its own, not an inline script: the desktop app's content security policy runs only the app's files.)
try {
  var root = document.documentElement
  if (localStorage.getItem('factory-theme') === 'light') root.classList.remove('dark')
  var vars = JSON.parse(localStorage.getItem('factory-theme-vars') || '{}')
  for (var name in vars) {
    if (name.slice(0, 2) === '--') root.style.setProperty(name, String(vars[name]))
    else if (name.slice(0, 5) === 'data-') root.setAttribute(name, String(vars[name]))
  }
} catch {}
