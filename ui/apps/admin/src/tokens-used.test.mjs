// The UI draws only in its theme's tokens: every colour or hue token it
// names is one every theme defines, and no stylesheet or component writes a
// colour of its own (which a theme could not reach). Charts, the memory
// cards and the network field included.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ui = new URL('../../../', import.meta.url).pathname;
const tokens = JSON.parse(readFileSync(join(ui, 'packages/tokens/tokens.json'), 'utf8'));
const roots = [join(ui, 'apps/admin/src'), join(ui, 'packages/components/src')];

function files(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(css|tsx?)$/.test(f) && !f.endsWith('.d.ts') ? [p] : [];
  });
}
const sources = roots.flatMap(files).map((p) => ({ p: p.slice(ui.length), text: readFileSync(p, 'utf8') }));

test('every colour and hue token the UI names is defined by every theme', () => {
  const missing = [];
  for (const { p, text } of sources) {
    for (const [, group, name] of text.matchAll(/--(color|hue)-([a-z0-9]+(?:-[a-z0-9]+)*)(?![a-z0-9-]|\$)/g)) {
      for (const [theme, t] of Object.entries(tokens.themes)) {
        if (!(name in (group === 'color' ? t.color : t.hue))) missing.push(`${p}: --${group}-${name} (not in ${theme})`);
      }
    }
  }
  assert.deepEqual([...new Set(missing)], []);
});

test('no stylesheet or component writes a colour of its own', () => {
  const found = [];
  for (const { p, text } of sources) {
    // comments say colours; code draws them
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const m of code.matchAll(/#[0-9a-fA-F]{3,8}\b(?![-\w])|\brgba?\(|\bhsla?\((?!var\(--(?:h|hue)\b)|\boklch\(/g)) {
      const line = code.slice(0, m.index).split('\n').length;
      const around = code.split('\n')[line - 1].trim();
      // ids in hrefs and keys ('#/nodes', '#top') are not colours
      if (/^#[0-9a-fA-F]{3,8}$/.test(m[0]) && /['"`]#|href/.test(around) && !/:\s*['"]?#/.test(around)) continue;
      found.push(`${p}:${line}: ${around.slice(0, 100)}`);
    }
  }
  assert.deepEqual(found, []);
});
