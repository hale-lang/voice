// Themes at run time: which theme a choice resolves to, the custom accent
// and base hue derived against it so they stay legible, the contrast rules
// every theme and every derivation keeps, and the choice kept in a
// browser's storage. Framework-free: a vanilla page can use it as well as
// the React control in @hale/components.

import { THEMES, DEFAULT_THEME } from './themes.js';
import { parse, toHex, toRgba, toLch, fromLch, fitContrast, contrast, mix, over, distance } from './color.js';

export { THEMES, DEFAULT_THEME };

/** The theme of that name, else the default. */
export function themeNamed(name) {
  return THEMES.find((t) => t.name === name) ?? THEMES[0];
}

// ---------------------------------------------------------------- contrast

/** The surfaces text sits on: the canvas, a panel, a hovered row, a hovered button. */
export const SURFACES = ['bg-0', 'bg-1', 'bg-2', 'bg-3'];
/** Reading text. */
export const TEXT = ['text', 'text-muted'];
/** The states: ok, waiting, failed. Never derived from the accent, never overridden. */
export const STATES = { ok: 'green', wait: 'amber', fail: 'coral' };
/** Colours that carry meaning in text: activity, links, notes, structure. */
export const SIGNALS = ['cyan', 'blue', 'violet', 'slate'];
/** The accent, as text: the selected item's word, a primary button. */
export const ACCENT = ['accent', 'accent-hover'];
/**
 * Faint text (readouts' units, hints, timestamps) is held to 3:1, WCAG's
 * floor for large text and for graphics, not 4.5: it is the quiet tier, and
 * the default theme's faint has always been 3.7:1. Everything that must be
 * read is text or text-muted.
 */
export const FAINT = 3;
/** Focus rings and chart marks are graphics: WCAG 1.4.11's 3:1. */
export const GRAPHIC = 3;

/**
 * The pairs a theme must keep apart, each `{ fg, bg, min }` where a `bg`
 * of `selection/bg-1` is the selection colour composited over bg-1.
 */
export function contrastRules(theme) {
  const keys = Object.keys(theme.color);
  const min = theme.contrast;
  const rules = [];
  const add = (fgs, bgs, m) => {
    for (const fg of fgs) for (const bg of bgs) rules.push({ fg, bg, min: m });
  };
  add([...TEXT, ...Object.values(STATES), ...SIGNALS, ...ACCENT], SURFACES, min);
  add(['text-faint'], ['bg-0', 'bg-1', 'bg-2'], FAINT);
  add(['focus'], SURFACES, GRAPHIC);
  add(['text', 'accent'], ['accent-muted'], min);
  add(['text'], ['selection/bg-0', 'selection/bg-1'], min);
  add(keys.filter((k) => k.startsWith('vivid-')), ['bg-0', 'bg-1'], min);
  add(keys.filter((k) => k.startsWith('chart-') && k !== 'chart-other'), ['bg-1'], GRAPHIC);
  return rules;
}

function resolveBg(colors, bg) {
  const [top, under] = bg.split('/');
  return under ? over(parse(colors[top]), parse(colors[under])) : parse(colors[top]);
}

/** The rules `colors` breaks for `theme`, with the ratio each reached. */
export function contrastFailures(colors, theme) {
  const out = [];
  for (const r of contrastRules(theme)) {
    const ratio = contrast(parse(colors[r.fg]), resolveBg(colors, r.bg));
    if (ratio < r.min) out.push({ ...r, ratio });
  }
  return out;
}

// ---------------------------------------------------------------- derivation

/** Tokens a custom accent replaces. */
export const ACCENT_TOKENS = ['accent', 'accent-hover', 'accent-muted', 'focus', 'selection'];
/** Tokens a base hue tints, each with the least chroma it is tinted at. */
const NEUTRALS = {
  'bg-0': 0.012,
  'bg-1': 0.013,
  'bg-2': 0.015,
  'bg-3': 0.017,
  rule: 0.022,
  'rule-strong': 0.026,
  text: 0.006,
  'text-muted': 0.02,
  'text-faint': 0.024,
};
export const BASE_TOKENS = Object.keys(NEUTRALS);

/** Clears every rule by this much, so rounding to 8-bit hex never undoes a fit. */
const MARGIN = 0.05;

/** The accent `lch` moved only as far as it must to keep `min` against `bgs`, as hex. */
function fitHex(lch, bgs, min, dark) {
  let c = fitContrast(lch, bgs, min + MARGIN, dark);
  for (let i = 0; i < 60 && !bgs.every((bg) => contrast(parse(toHex(c)), bg) >= min); i++) {
    const l = toLch(c);
    c = fromLch({ ...l, l: l.l + (dark ? 0.005 : -0.005) });
  }
  return toHex(c);
}

/**
 * The accent tokens for a custom accent colour against `colors` (a theme's,
 * maybe already tinted by a base hue). The accent keeps its hue; its
 * lightness moves away from the surfaces until it reads as text on every
 * one of them at the theme's contrast, and its chroma is clamped to what
 * sRGB can show at that lightness. Hover steps further from the surfaces;
 * the muted tint and the selection are as strong as they can be while text
 * on them still reads. Pure yellow on a light theme becomes an ochre;
 * near-black on a dark one becomes a grey that reads.
 */
export function deriveAccent(input, colors, theme) {
  const dark = theme.scheme === 'dark';
  const min = theme.contrast;
  const bgs = SURFACES.map((k) => parse(colors[k]));
  const src = toLch(parse(input));
  const accent = fitHex(src, bgs, min, dark);
  const a = toLch(parse(accent));

  const step = dark ? 0.07 : -0.07;
  const further = Math.min(1, Math.max(0, a.l + step));
  const hoverL = Math.abs(further - a.l) >= 0.03 ? further : a.l - step;
  const hover = fitHex({ ...a, l: hoverL }, bgs, min, dark);

  const bg1 = parse(colors['bg-1']);
  const text = parse(colors.text);
  let muted = colors['bg-1'];
  for (let t = dark ? 0.16 : 0.12; t > 0; t -= 0.01) {
    const m = parse(toHex(mix(bg1, parse(accent), t)));
    if (contrast(text, m) >= min + MARGIN && contrast(parse(accent), m) >= min + MARGIN) {
      muted = toHex(m);
      break;
    }
  }

  let selection = toRgba(parse(accent), 0);
  for (let alpha = dark ? 0.16 : 0.22; alpha > 0; alpha -= 0.01) {
    const s = parse(toRgba(parse(accent), alpha));
    const okOn = ['bg-0', 'bg-1'].every((k) => contrast(text, over(s, parse(colors[k]))) >= min + MARGIN);
    if (okOn) {
      selection = toRgba(parse(accent), alpha);
      break;
    }
  }

  return { accent, 'accent-hover': hover, 'accent-muted': muted, focus: accent, selection };
}

/**
 * The neutral tokens tinted toward `hue` (OKLCH degrees): each keeps its
 * lightness and takes at least a little chroma at that hue, so surfaces,
 * rules and quiet text lean together. When the tint would cost any text or
 * state its contrast, it is weakened, and dropped if even the weakest
 * tint would.
 */
export function deriveBase(hue, colors, theme) {
  for (const strength of [1, 0.6, 0.3, 0]) {
    const out = {};
    for (const [k, floor] of Object.entries(NEUTRALS)) {
      const l = toLch(parse(colors[k]));
      const c = l.c + (Math.max(l.c, floor) - l.c) * strength;
      out[k] = toHex(fromLch({ l: l.l, c, h: hue }));
    }
    if (contrastFailures({ ...colors, ...out }, theme).length === 0) return out;
  }
  return {};
}

/**
 * A choice's colours for `theme`: the theme's own, tinted by the base hue
 * and with the custom accent, when the choice has them. `vars` holds only
 * what differs from the theme, as custom properties for the root element.
 * The derivations keep every contrast rule; if together they somehow did
 * not, the theme's own colours stand.
 */
export function customColors(choice, theme) {
  let colors = { ...theme.color };
  if (validHue(choice.hue)) colors = { ...colors, ...deriveBase(choice.hue, colors, theme) };
  if (validAccent(choice.accent)) colors = { ...colors, ...deriveAccent(choice.accent, colors, theme) };
  if (contrastFailures(colors, theme).length) colors = { ...theme.color };
  const vars = {};
  for (const k of [...BASE_TOKENS, ...ACCENT_TOKENS]) {
    if (colors[k] !== theme.color[k]) vars[`--color-${k}`] = colors[k];
  }
  return { colors, vars };
}

/**
 * The states a colour could be mistaken for: their OKLab distance from it
 * is under 0.1. The states keep their own colours (and their words); this
 * is for saying so beside the picker.
 */
export function nearStates(color, colors) {
  const c = parse(color);
  return Object.entries(STATES)
    .filter(([, k]) => distance(c, parse(colors[k])) < 0.1)
    .map(([state]) => state);
}

// ---------------------------------------------------------------- the choice

/** @typedef {{ theme: string, follow: boolean, accent: string | null, hue: number | null }} Choice */

/** @returns {Choice} */
export function defaultChoice() {
  return { theme: DEFAULT_THEME, follow: false, accent: null, hue: null };
}

const validAccent = (a) => typeof a === 'string' && /^#[0-9a-fA-F]{6}$/.test(a);
const validHue = (h) => typeof h === 'number' && Number.isFinite(h) && h >= 0 && h < 360;

/** The two themes following the system picks between: the choice's pair, else the default's. */
export function followPair(choice) {
  const t = themeNamed(choice.theme);
  const from = t.pair ? t : themeNamed(DEFAULT_THEME);
  const other = themeNamed(from.pair);
  return from.scheme === 'light' ? { light: from.name, dark: other.name } : { light: other.name, dark: from.name };
}

/** The theme a choice shows, given whether the system prefers light. */
export function resolveTheme(choice, prefersLight) {
  if (!choice.follow) return themeNamed(choice.theme).name;
  const p = followPair(choice);
  return prefersLight ? p.light : p.dark;
}

/**
 * The choice kept under `key`, else the default. Storage that is missing,
 * refuses to be read or holds something else gives the default: the page
 * still has a theme.
 */
export function readChoice(key, storage) {
  try {
    // acquired here, guarded: reading `localStorage` itself throws where
    // the browser denies storage
    const st = arguments.length > 1 ? storage : globalThis.localStorage;
    const s = JSON.parse(st?.getItem(key) ?? 'null');
    if (!s || s.v !== 1) return defaultChoice();
    return {
      theme: themeNamed(s.theme).name,
      follow: s.follow === true,
      accent: validAccent(s.accent) ? s.accent.toUpperCase() : null,
      hue: validHue(s.hue) ? s.hue : null,
    };
  } catch {
    return defaultChoice();
  }
}

/**
 * Keeps a choice under `key`, with the custom properties of each theme it
 * can show (both of a followed pair), so the page can apply them before
 * anything renders (boot.js). True when kept; false when storage refused,
 * and the choice holds for this visit only.
 */
export function writeChoice(key, choice, storage) {
  const pair = followPair(choice);
  const shown = choice.follow ? [pair.light, pair.dark] : [themeNamed(choice.theme).name];
  const vars = {};
  for (const name of shown) {
    const v = customColors(choice, themeNamed(name)).vars;
    if (Object.keys(v).length) vars[name] = v;
  }
  try {
    const st = arguments.length > 2 ? storage : globalThis.localStorage;
    st.setItem(key, JSON.stringify({ v: 1, ...choice, ...pair, vars }));
    return true;
  } catch {
    return false;
  }
}

/** Every custom property a choice may set on the root. */
export const CUSTOM_PROPERTIES = [...new Set([...BASE_TOKENS, ...ACCENT_TOKENS])].map((k) => `--color-${k}`);

/** Shows theme `name` with `vars` on `root` (the document element), replacing what was there. */
export function applyTheme(root, name, vars) {
  root.setAttribute('data-theme', name);
  for (const p of CUSTOM_PROPERTIES) if (!(p in vars)) root.style.removeProperty(p);
  for (const [p, v] of Object.entries(vars)) root.style.setProperty(p, v);
}

/** A CSS gradient through every base hue, for the hue slider's track. */
export function hueGradient() {
  const stops = [];
  for (let h = 0; h <= 360; h += 30) stops.push(toHex(fromLch({ l: 0.7, c: 0.12, h: h % 360 })));
  return `linear-gradient(to right, ${stops.join(', ')})`;
}
