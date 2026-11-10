// The themes: complete, legible, and a custom accent that stays legible
// whatever is picked; the choice kept in storage and applied before render.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { problems } from './complete.js';
import { parse, contrast, distance, fromHsl, mix, toLch } from './color.js';
import {
  THEMES, DEFAULT_THEME, SURFACES, STATES, contrastFailures, deriveAccent, deriveBase, customColors,
  nearStates, defaultChoice, followPair, resolveTheme, readChoice, writeChoice, applyTheme, CUSTOM_PROPERTIES,
} from './theme.js';
import { boot, bootScript } from './boot.js';

const tokens = JSON.parse(readFileSync(new URL('./tokens.json', import.meta.url), 'utf8'));
const said = (fails) => fails.map((f) => `${f.fg} on ${f.bg}: ${f.ratio.toFixed(2)} < ${f.min}`).join('; ');

// ------------------------------------------------------------ completeness

test('every theme defines every token the default does, and no other', () => {
  assert.deepEqual(problems(tokens), []);
  assert.ok(THEMES.length >= 6, 'several themes');
  assert.equal(DEFAULT_THEME, 'carbon');
});

test('a theme missing a token, or with one of its own, is a problem the build refuses', () => {
  const broken = structuredClone(tokens);
  delete broken.themes.paper.color['accent-muted'];
  broken.themes.vfd.color.sparkle = '#FFFFFF';
  delete broken.themes.blueprint.hue['ink-l'];
  const p = problems(broken);
  assert.ok(p.some((x) => x.includes('paper: missing color accent-muted')), p.join('\n'));
  assert.ok(p.some((x) => x.includes('vfd: color sparkle is not one carbon defines')), p.join('\n'));
  assert.ok(p.some((x) => x.includes('blueprint: missing hue ink-l')), p.join('\n'));
});

test('pairs are of the other scheme and pair back; contrast floors are at least AA', () => {
  const broken = structuredClone(tokens);
  broken.themes.paper.pair = 'vfd';
  broken.themes.ledger.contrast = 3;
  const p = problems(broken);
  assert.ok(p.some((x) => x.includes('paper: pairs with vfd, of the same scheme') || x.includes('paper: pairs with vfd')));
  assert.ok(p.some((x) => x.includes('ledger: contrast')));
});

test('the built css carries every theme and every token', () => {
  const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
  for (const t of THEMES) {
    assert.ok(css.includes(`:root[data-theme="${t.name}"]`), t.name);
    const block = css.slice(css.indexOf(`:root[data-theme="${t.name}"]`)).split('}')[0];
    for (const k of Object.keys(THEMES[0].color)) assert.ok(block.includes(`--color-${k}:`), `${t.name} --color-${k}`);
    for (const k of Object.keys(THEMES[0].hue)) assert.ok(block.includes(`--hue-${k}:`), `${t.name} --hue-${k}`);
    assert.ok(block.includes(`color-scheme: ${t.scheme}`));
  }
  // the default is the page's before anything chooses
  assert.ok(css.startsWith('/* generated from tokens.json; do not edit */\n:root,\n:root[data-theme="carbon"] {'));
});

test('the default theme is the one the UI had: its original tokens unchanged', () => {
  const carbon = THEMES[0].color;
  const was = {
    'bg-0': '#0D0D11', 'bg-1': '#14141A', 'bg-2': '#1B1B23', 'bg-3': '#23232D', rule: '#2A2A36', 'rule-strong': '#3A3A48',
    text: '#E8E8EC', 'text-muted': '#9A9AA8', 'text-faint': '#6B6B7A', slate: '#94A3B8', cyan: '#5EDCF4', blue: '#6AA8FF',
    amber: '#FCBE58', coral: '#F85149', green: '#7EE787', focus: '#5EDCF4', selection: 'rgba(94, 220, 244, 0.14)',
  };
  for (const [k, v] of Object.entries(was)) assert.equal(carbon[k], v, k);
});

// ------------------------------------------------------------ contrast

test('WCAG contrast is computed as WCAG defines it', () => {
  assert.equal(contrast(parse('#000'), parse('#fff')).toFixed(2), '21.00');
  assert.equal(contrast(parse('#777777'), parse('#ffffff')).toFixed(2), '4.48');
  // a translucent colour is composited over what it sits on first
  assert.equal(contrast(parse('rgba(0, 0, 0, 0)'), parse('#ffffff')).toFixed(2), '1.00');
});

for (const t of THEMES) {
  test(`${t.name}: text, states, signals and the accent keep ${t.contrast}:1 on every surface`, () => {
    assert.deepEqual(contrastFailures(t.color, t), [], said(contrastFailures(t.color, t)));
  });

  test(`${t.name}: ok, wait and fail stay distinct from each other and from the accent`, () => {
    const s = Object.values(STATES).map((k) => parse(t.color[k]));
    for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) assert.ok(distance(s[i], s[j]) > 0.1);
    for (const k of Object.values(STATES)) assert.ok(distance(parse(t.color.accent), parse(t.color[k])) >= 0.1, `accent near ${k}`);
  });

  test(`${t.name}: identity hues (a model's, a thread's) read at every hue`, () => {
    // as the CSS draws them: color-mix(in oklab, hsl(h s l), var(--color-text) var(--hue-mix))
    const pct = (v) => parseFloat(v) / 100;
    const fill = pct(t.hue['fill-l']), ink = pct(t.hue['ink-l']), step = pct(t.hue.step), m = pct(t.hue.mix);
    const text = parse(t.color.text);
    const drawn = (h, s, l) => mix(fromHsl(h, s, l), text, m);
    for (let h = 0; h < 360; h += 2) {
      for (const bg of ['bg-0', 'bg-1', 'bg-2']) {
        const b = parse(t.color[bg]);
        // a conversation's title (Board) and a thread's name (Conversation): text
        assert.ok(contrast(drawn(h, 0.8, ink + 4 * step), b) >= 4.5, `title ink at hue ${h} on ${bg}`);
        assert.ok(contrast(drawn(h, 0.7, ink - 4 * step), b) >= 4.5, `thread ink at hue ${h} on ${bg}`);
      }
      // a model's memory and its board rule: graphics
      assert.ok(contrast(drawn(h, 0.58, fill), parse(t.color['bg-1'])) >= 3, `fill at hue ${h}`);
      assert.ok(contrast(drawn(h, 0.7, fill), parse(t.color['bg-1'])) >= 3, `rule at hue ${h}`);
    }
  });
}

test('the high-contrast themes keep 7:1 (AAA) for text and states', () => {
  for (const t of THEMES.filter((x) => x.name.startsWith('contrast'))) {
    assert.equal(t.contrast, 7);
    for (const k of ['text', 'text-muted', ...Object.values(STATES)]) {
      for (const bg of SURFACES) assert.ok(contrast(parse(t.color[k]), parse(t.color[bg])) >= 7, `${t.name} ${k} on ${bg}`);
    }
  }
});

// ------------------------------------------------------------ the accent

const EXTREMES = ['#FFFF00', '#050505', '#000000', '#FFFFFF', '#777777', '#FF0000', '#00FF00', '#0000FF', '#FF00FF', '#00FFFF', '#7F7F00'];

test('any accent, however extreme, is derived legible in every theme', () => {
  for (const t of THEMES) {
    for (const accent of EXTREMES) {
      const derived = deriveAccent(accent, t.color, t);
      const colors = { ...t.color, ...derived };
      assert.deepEqual(contrastFailures(colors, t), [], `${t.name} ${accent}: ${said(contrastFailures(colors, t))}`);
      assert.deepEqual(Object.keys(derived).sort(), ['accent', 'accent-hover', 'accent-muted', 'focus', 'selection']);
    }
  }
});

test('pure yellow on a light theme becomes a darker yellow, near-black on a dark one a lighter grey', () => {
  const paper = THEMES.find((t) => t.name === 'paper');
  const carbon = THEMES[0];
  const y = deriveAccent('#FFFF00', paper.color, paper);
  const yl = toLch(parse(y.accent));
  assert.ok(Math.abs(yl.h - toLch(parse('#FFFF00')).h) < 3, 'keeps its hue');
  assert.ok(yl.l < 0.6, 'darkened');
  assert.ok(contrast(parse(y.accent), parse(paper.color['bg-3'])) >= 4.5);

  const k = deriveAccent('#050505', carbon.color, carbon);
  assert.ok(toLch(parse(k.accent)).l > 0.5, 'lightened');
  for (const bg of SURFACES) assert.ok(contrast(parse(k.accent), parse(carbon.color[bg])) >= 4.5);
  // hover steps away from the surfaces
  assert.ok(toLch(parse(k['accent-hover'])).l > toLch(parse(k.accent)).l);
});

test('an accent that already reads is kept as picked', () => {
  const carbon = THEMES[0];
  assert.equal(deriveAccent('#5EDCF4', carbon.color, carbon).accent, '#5EDCF4');
  assert.equal(deriveAccent('#FF8800', carbon.color, carbon).accent, '#FF8800');
});

test('the states are never overridden, and never become the accent', () => {
  for (const t of THEMES) {
    const { vars } = customColors({ theme: t.name, follow: false, accent: t.color.coral, hue: 120 }, t);
    for (const k of Object.values(STATES)) assert.ok(!(`--color-${k}` in vars), k);
    for (const p of Object.keys(vars)) assert.ok(CUSTOM_PROPERTIES.includes(p), p);
  }
  const carbon = THEMES[0];
  assert.deepEqual(nearStates('#F85149', carbon.color), ['fail']);
  assert.deepEqual(nearStates('#5EDCF4', carbon.color), []);
});

test('a base hue tints the neutrals and keeps every rule, with or without an accent', () => {
  for (const t of THEMES) {
    for (let hue = 0; hue < 360; hue += 30) {
      for (const accent of [null, '#FFFF00', '#050505']) {
        const { colors, vars } = customColors({ theme: t.name, follow: false, accent, hue }, t);
        assert.deepEqual(contrastFailures(colors, t), [], `${t.name} hue ${hue} accent ${accent}`);
        if (accent === null) for (const p of Object.keys(vars)) assert.ok(!p.includes('accent'), p);
      }
    }
  }
  const carbon = THEMES[0];
  const tinted = deriveBase(30, carbon.color, carbon);
  assert.ok(Math.abs(toLch(parse(tinted["bg-1"])).h - 30) < 10, 'the surfaces take the hue');
  // lightness is kept, so the surfaces' order is kept
  assert.ok(Math.abs(toLch(parse(tinted['bg-1'])).l - toLch(parse(carbon.color['bg-1'])).l) < 0.01);
});

test('no custom colour is no override: the theme stands as written', () => {
  for (const t of THEMES) assert.deepEqual(customColors({ theme: t.name, follow: false, accent: null, hue: null }, t).vars, {});
});

// ------------------------------------------------------------ resolution

test('following the system picks the light or dark of the chosen pair, else of the default', () => {
  assert.deepEqual(followPair({ ...defaultChoice(), theme: 'carbon' }), { light: 'paper', dark: 'carbon' });
  assert.deepEqual(followPair({ ...defaultChoice(), theme: 'contrast-light' }), { light: 'contrast-light', dark: 'contrast' });
  assert.deepEqual(followPair({ ...defaultChoice(), theme: 'vfd' }), { light: 'paper', dark: 'carbon' });
  assert.equal(resolveTheme({ ...defaultChoice(), theme: 'contrast', follow: true }, true), 'contrast-light');
  assert.equal(resolveTheme({ ...defaultChoice(), theme: 'contrast', follow: true }, false), 'contrast');
  assert.equal(resolveTheme({ ...defaultChoice(), theme: 'vfd', follow: false }, true), 'vfd');
  assert.equal(resolveTheme({ ...defaultChoice(), theme: 'gone', follow: false }, true), 'carbon');
});

// ------------------------------------------------------------ persistence

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m };
}
const refusing = {
  getItem() { throw new Error('SecurityError'); },
  setItem() { throw new Error('QuotaExceededError'); },
};

test('a choice round-trips through storage', () => {
  const s = memoryStorage();
  const choice = { theme: 'blueprint', follow: false, accent: '#FF8800', hue: 210 };
  assert.equal(writeChoice('k', choice, s), true);
  assert.deepEqual(readChoice('k', s), choice);
  const kept = JSON.parse(s.map.get('k'));
  assert.equal(kept.v, 1);
  assert.deepEqual(Object.keys(kept.vars), ['blueprint']);
  assert.equal(kept.vars.blueprint['--color-accent'], '#FF8800');
});

test('following the system keeps the custom properties of both themes it can show', () => {
  const s = memoryStorage();
  writeChoice('k', { theme: 'carbon', follow: true, accent: '#FFFF00', hue: null }, s);
  const kept = JSON.parse(s.map.get('k'));
  assert.deepEqual([kept.light, kept.dark], ['paper', 'carbon']);
  assert.deepEqual(Object.keys(kept.vars).sort(), ['carbon', 'paper']);
  assert.notEqual(kept.vars.paper['--color-accent'], kept.vars.carbon['--color-accent']);
});

test('storage that is missing, refuses, or holds something else gives the default and never throws', () => {
  assert.deepEqual(readChoice('k', null), defaultChoice());
  assert.deepEqual(readChoice('k', undefined), defaultChoice());
  assert.deepEqual(readChoice('k', refusing), defaultChoice());
  assert.equal(writeChoice('k', defaultChoice(), refusing), false);
  assert.equal(writeChoice('k', defaultChoice(), null), false);
  const s = memoryStorage();
  for (const junk of ['{', '42', '"x"', '{"v":2,"theme":"paper"}', 'null']) {
    s.setItem('k', junk);
    assert.deepEqual(readChoice('k', s), defaultChoice(), junk);
  }
  s.setItem('k', JSON.stringify({ v: 1, theme: 'gone', follow: 'yes', accent: 'red', hue: 400 }));
  assert.deepEqual(readChoice('k', s), defaultChoice());
});

// ------------------------------------------------------------ applying

function fakeRoot() {
  const attrs = {}, props = {};
  return {
    attrs, props,
    setAttribute: (k, v) => { attrs[k] = v; },
    style: { setProperty: (k, v) => { props[k] = v; }, removeProperty: (k) => { delete props[k]; } },
  };
}

test('applying a theme sets data-theme and replaces the previous custom properties', () => {
  const root = fakeRoot();
  applyTheme(root, 'paper', { '--color-accent': '#123456', '--color-bg-0': '#FFFFFF' });
  assert.equal(root.attrs['data-theme'], 'paper');
  assert.equal(root.props['--color-accent'], '#123456');
  applyTheme(root, 'carbon', {});
  assert.equal(root.attrs['data-theme'], 'carbon');
  assert.deepEqual(root.props, {});
});

function fakeWindow(stored, prefersLight) {
  const root = fakeRoot();
  return {
    root,
    localStorage: { getItem: () => stored },
    matchMedia: (q) => ({ matches: q.includes('light') && prefersLight }),
    document: { documentElement: root },
  };
}

test('boot applies what writeChoice kept, before anything renders', () => {
  const s = memoryStorage();
  writeChoice('voice.theme', { theme: 'carbon', follow: true, accent: '#FF8800', hue: null }, s);
  const light = fakeWindow(s.map.get('voice.theme'), true);
  boot('voice.theme', light);
  assert.equal(light.root.attrs['data-theme'], 'paper');
  assert.equal(light.root.props['--color-accent'], customColors({ theme: 'paper', follow: false, accent: '#FF8800', hue: null }, THEMES.find((t) => t.name === 'paper')).vars['--color-accent']);
  const dark = fakeWindow(s.map.get('voice.theme'), false);
  boot('voice.theme', dark);
  assert.equal(dark.root.attrs['data-theme'], 'carbon');
  assert.equal(dark.root.props['--color-accent'], '#FF8800');
});

test('boot does nothing with nothing saved, junk, a refusing storage, or values that are not colours', () => {
  for (const stored of [null, '{', '{"v":2}', JSON.stringify({ v: 1, theme: '"><script>' })]) {
    const w = fakeWindow(stored, false);
    boot('k', w);
    assert.deepEqual(w.root.attrs, {}, String(stored));
  }
  const w = fakeWindow(null, false);
  w.localStorage = { getItem() { throw new Error('SecurityError'); } };
  assert.doesNotThrow(() => boot('k', w));
  const sneaky = fakeWindow(JSON.stringify({ v: 1, theme: 'vfd', vars: { vfd: { '--color-accent': 'url(https://x/y)', 'background': 'red', '--color-focus': '#ABCDEF' } } }), false);
  boot('k', sneaky);
  assert.deepEqual(sneaky.root.props, { '--color-focus': '#ABCDEF' });
});

test('the inline script is boot itself, called with the key', () => {
  const src = bootScript('voice.theme');
  assert.ok(src.startsWith('(function boot(key'));
  assert.ok(src.endsWith(')("voice.theme");'));
  // it runs as a classic script: no module syntax
  assert.doesNotThrow(() => new Function(src));
});
