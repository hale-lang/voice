// Colour arithmetic for the themes: parsing, OKLab/OKLCH, sRGB gamut,
// WCAG contrast. Framework-free and dependency-free, so the tokens build,
// its tests and the browser share one implementation.
//
// OKLab is Björn Ottosson's (https://bottosson.github.io/posts/oklab/):
// lightness in it is perceptual, so moving a colour's L while keeping its
// hue reads as "the same colour, lighter", which is what clamping an
// accent for contrast needs.

/** @typedef {{ r: number, g: number, b: number, a: number }} Rgb  channels 0..1 */
/** @typedef {{ l: number, c: number, h: number }} Lch */

const clamp01 = (x) => Math.min(1, Math.max(0, x));

/** Parses #rgb, #rrggbb, #rrggbbaa, rgb()/rgba() (comma or space syntax). */
export function parse(css) {
  const s = String(css).trim().toLowerCase();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h.replace(/./g, (d) => d + d);
    const n = (i) => parseInt(h.slice(i, i + 2), 16) / 255;
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) : 1 };
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+)(%?))?\s*\)$/.exec(s);
  if (m) {
    const a = m[4] === undefined ? 1 : m[5] ? Number(m[4]) / 100 : Number(m[4]);
    return { r: Number(m[1]) / 255, g: Number(m[2]) / 255, b: Number(m[3]) / 255, a: clamp01(a) };
  }
  throw new Error(`not a colour: ${css}`);
}

const hex2 = (x) => Math.round(clamp01(x) * 255).toString(16).padStart(2, '0');

/** #RRGGBB, uppercase like tokens.json; alpha is dropped. */
export function toHex(c) {
  return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`.toUpperCase();
}

/** rgba(r, g, b, a) like tokens.json's translucent tokens. */
export function toRgba(c, a = c.a) {
  const n = (x) => Math.round(clamp01(x) * 255);
  return `rgba(${n(c.r)}, ${n(c.g)}, ${n(c.b)}, ${Math.round(a * 1000) / 1000})`;
}

const toLinear = (x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
const fromLinear = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);

/** sRGB (gamma) to OKLCH; hue in degrees, 0 when achromatic. */
export function toLch(c) {
  const r = toLinear(c.r), g = toLinear(c.g), b = toLinear(c.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(A, B);
  const H = C < 1e-4 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return { l: L, c: C, h: H };
}

/** OKLCH to sRGB, unclamped: a channel outside 0..1 is out of gamut. */
function lchToRgbRaw({ l: L, c: C, h: H }) {
  const A = C * Math.cos((H * Math.PI) / 180);
  const B = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return {
    r: fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    a: 1,
  };
}

const inGamut = (c) => [c.r, c.g, c.b].every((x) => x >= -1e-4 && x <= 1 + 1e-4);

/**
 * OKLCH to sRGB, inside the gamut: chroma is reduced (lightness and hue
 * kept) until the colour exists in sRGB, the CSS Color 4 way.
 */
export function fromLch(lch) {
  const l = clamp01(lch.l);
  let c = Math.max(0, lch.c);
  const raw = lchToRgbRaw({ l, c, h: lch.h });
  if (inGamut(raw)) return clampRgb(raw);
  let lo = 0, hi = c;
  for (let i = 0; i < 24; i++) {
    c = (lo + hi) / 2;
    if (inGamut(lchToRgbRaw({ l, c, h: lch.h }))) lo = c;
    else hi = c;
  }
  return clampRgb(lchToRgbRaw({ l, c: lo, h: lch.h }));
}

const clampRgb = (c) => ({ r: clamp01(c.r), g: clamp01(c.g), b: clamp01(c.b), a: c.a ?? 1 });

/** A translucent colour composited over an opaque one. */
export function over(top, under) {
  const a = top.a ?? 1;
  return { r: top.r * a + under.r * (1 - a), g: top.g * a + under.g * (1 - a), b: top.b * a + under.b * (1 - a), a: 1 };
}

/** Mixes two colours in OKLab, `t` of `b` into `a` (CSS color-mix(in oklab, a, b t)). */
export function mix(a, b, t) {
  const p = toLab(a), q = toLab(b);
  return fromLab({ L: p.L + (q.L - p.L) * t, A: p.A + (q.A - p.A) * t, B: p.B + (q.B - p.B) * t });
}

function toLab(c) {
  const { l, c: C, h } = toLch(c);
  return { L: l, A: C * Math.cos((h * Math.PI) / 180), B: C * Math.sin((h * Math.PI) / 180) };
}

function fromLab({ L, A, B }) {
  return fromLch({ l: L, c: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 });
}

/** Euclidean distance in OKLab: under ~0.1 two colours read as alike. */
export function distance(a, b) {
  const p = toLab(a), q = toLab(b);
  return Math.hypot(p.L - q.L, p.A - q.A, p.B - q.B);
}

/** sRGB in HSL terms (CSS hsl()), for the identity hues the views draw. */
export function fromHsl(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: f(0), g: f(8), b: f(4), a: 1 };
}

/** WCAG 2 relative luminance. */
export function luminance(c) {
  return 0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b);
}

/** WCAG 2 contrast ratio, 1..21; a translucent foreground is composited first. */
export function contrast(fg, bg) {
  const f = (fg.a ?? 1) < 1 ? over(fg, bg) : fg;
  const x = luminance(f), y = luminance(bg);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * The colour nearest `lch` (same hue, chroma clamped to the gamut) whose
 * contrast against every one of `bgs` is at least `min`: lightness moves
 * away from the backgrounds (up on a dark theme, down on a light one) only
 * as far as it must.
 */
export function fitContrast(lch, bgs, min, dark) {
  const ok = (l) => bgs.every((bg) => contrast(fromLch({ ...lch, l }), bg) >= min);
  if (ok(lch.l)) return fromLch(lch);
  const end = dark ? 1 : 0;
  if (!ok(end)) return fromLch({ ...lch, l: end });
  let near = lch.l, far = end;
  for (let i = 0; i < 30; i++) {
    const mid = (near + far) / 2;
    if (ok(mid)) far = mid;
    else near = mid;
  }
  return fromLch({ ...lch, l: far });
}
