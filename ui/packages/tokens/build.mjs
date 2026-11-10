// Compiles tokens.json to tokens.css and themes.js. Every colour and hue
// leaf of a theme becomes a custom property: the first theme's on :root
// (so the page has a theme before anything chooses one) and on
// [data-theme="<name>"], each further theme's on [data-theme="<name>"].
// themes.js carries the same themes as data, for the theme picker and for
// deriving a custom accent. A theme missing a token fails the build
// (complete.js). Framework-free by construction.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { problems } from './complete.js';

const here = dirname(fileURLToPath(import.meta.url));
const tokens = JSON.parse(readFileSync(join(here, 'tokens.json'), 'utf8'));

const wrong = problems(tokens);
if (wrong.length) {
  console.error(`tokens.json: ${wrong.length} problem(s)\n  ${wrong.join('\n  ')}`);
  process.exit(1);
}

const lines = ['/* generated from tokens.json; do not edit */'];
const themes = Object.entries(tokens.themes);
themes.forEach(([name, t], i) => {
  lines.push(i === 0 ? `:root,\n:root[data-theme="${name}"] {` : `:root[data-theme="${name}"] {`);
  lines.push(`  color-scheme: ${t.scheme};`);
  for (const [k, v] of Object.entries(t.color)) lines.push(`  --color-${k}: ${v};`);
  for (const [k, v] of Object.entries(t.hue)) lines.push(`  --hue-${k}: ${v};`);
  lines.push('}');
});
lines.push(':root {');
for (const group of ['font', 'size', 'space', 'radius', 'cut', 'line', 'motion', 'layer']) {
  for (const [k, v] of Object.entries(tokens[group])) lines.push(`  --${group}-${k}: ${v};`);
}
lines.push('}');
lines.push('@media (prefers-reduced-motion: reduce) { :root { --motion-fast: 0ms; --motion-normal: 0ms; --motion-afterglow: 0ms; } }');
writeFileSync(join(here, 'tokens.css'), lines.join('\n') + '\n');

const data = themes.map(([name, t]) => ({ name, label: t.label, scheme: t.scheme, pair: t.pair ?? null, contrast: t.contrast, color: t.color, hue: t.hue }));
writeFileSync(
  join(here, 'themes.js'),
  `// generated from tokens.json; do not edit\nexport const THEMES = ${JSON.stringify(data, null, 2)};\nexport const DEFAULT_THEME = ${JSON.stringify(themes[0][0])};\n`,
);
console.log(`tokens.css: ${themes.length} theme(s)`);
