// The saved theme, applied before anything renders: inlined into the page's
// <head> as a classic script (bootScript), so the first paint is already
// in the chosen theme. It reads what theme.js's writeChoice kept, resolves
// following the system with matchMedia, and sets data-theme and the custom
// accent's properties on the root. Self-contained on purpose (it is
// serialized with Function.prototype.toString), and silent on any failure:
// the default theme then shows, as it would with nothing saved.

export function boot(key, w = window) {
  try {
    var s = JSON.parse(w.localStorage.getItem(key) || 'null');
    if (!s || s.v !== 1) return;
    var light = w.matchMedia && w.matchMedia('(prefers-color-scheme: light)').matches;
    var name = s.follow ? (light ? s.light : s.dark) : s.theme;
    if (typeof name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(name)) return;
    var root = w.document.documentElement;
    root.setAttribute('data-theme', name);
    var vars = s.vars && s.vars[name];
    if (vars && typeof vars === 'object') {
      for (var k in vars) {
        if (/^--color-[a-z0-9-]+$/.test(k) && typeof vars[k] === 'string' && /^[#a-zA-Z0-9(),. %/-]+$/.test(vars[k])) {
          root.style.setProperty(k, vars[k]);
        }
      }
    }
  } catch (e) {
    // no storage, or not ours: the default theme
  }
}

/** The page's inline script: boot, called with `key`. */
export function bootScript(key) {
  return '(' + boot.toString() + ')(' + JSON.stringify(key) + ');';
}
