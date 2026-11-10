// What makes a set of themes whole: every theme defines every colour and
// hue token the first (default) theme does, and nothing else; a scheme of
// light or dark; a pair, when it names one, of the other scheme that names
// it back; a contrast floor of at least WCAG AA's 4.5. The build refuses
// themes with any problem, so a theme missing a token never ships.

import { parse } from './color.js';

/** The problems with `tokens.themes`, as sentences; none when whole. */
export function problems(tokens) {
  const out = [];
  const themes = Object.entries(tokens.themes ?? {});
  if (themes.length === 0) return ['no themes'];
  const [first, def] = themes[0];
  const colorKeys = Object.keys(def.color ?? {});
  const hueKeys = Object.keys(def.hue ?? {});
  for (const [name, t] of themes) {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) out.push(`${name}: a theme's name is lowercase letters, digits and dashes`);
    if (typeof t.label !== 'string' || !t.label) out.push(`${name}: no label`);
    if (t.scheme !== 'light' && t.scheme !== 'dark') out.push(`${name}: scheme is light or dark, not ${t.scheme}`);
    if (!(typeof t.contrast === 'number' && t.contrast >= 4.5)) out.push(`${name}: contrast is a number of at least 4.5 (WCAG AA)`);
    for (const k of colorKeys) {
      if (!(k in (t.color ?? {}))) out.push(`${name}: missing color ${k} (${first} defines it)`);
      else {
        try { parse(t.color[k]); } catch { out.push(`${name}: color ${k} is not a colour: ${t.color[k]}`); }
      }
    }
    for (const k of Object.keys(t.color ?? {})) if (!colorKeys.includes(k)) out.push(`${name}: color ${k} is not one ${first} defines`);
    for (const k of hueKeys) if (!(k in (t.hue ?? {}))) out.push(`${name}: missing hue ${k} (${first} defines it)`);
    for (const k of Object.keys(t.hue ?? {})) if (!hueKeys.includes(k)) out.push(`${name}: hue ${k} is not one ${first} defines`);
    if (t.pair !== undefined) {
      const p = tokens.themes[t.pair];
      if (!p) out.push(`${name}: pairs with ${t.pair}, which is not a theme`);
      else if (p.scheme === t.scheme) out.push(`${name}: pairs with ${t.pair}, of the same scheme`);
      else if (p.pair !== name) out.push(`${name}: pairs with ${t.pair}, which does not pair back`);
    }
  }
  if (def.pair === undefined) out.push(`${first}: the default theme pairs with one of the other scheme, for following the system`);
  return out;
}
