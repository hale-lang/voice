import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, inline, safeHref } from './markdown.ts';

/** Every link target in a tree. */
function hrefs(node, out = []) {
  if (Array.isArray(node)) node.forEach((n) => hrefs(n, out));
  else if (node && typeof node === 'object') {
    if (node.t === 'link') out.push(node.href);
    for (const v of Object.values(node)) if (v && typeof v === 'object') hrefs(v, out);
  }
  return out;
}

/** Every text in a tree, joined. */
function text(node) {
  if (Array.isArray(node)) return node.map(text).join('');
  if (!node || typeof node !== 'object') return '';
  if (node.t === 'text' || node.t === 'code') return node.s;
  return Object.values(node).filter((v) => v && typeof v === 'object').map(text).join('');
}

test('raw HTML stays text: no element is ever made from it', () => {
  const md = '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)> and <b>bold</b>';
  const tree = parse(md);
  assert.deepEqual(tree.map((b) => b.t), ['p', 'p']);
  assert.equal(text(tree[0]), '<script>alert(1)</script>');
  assert.match(text(tree[1]), /<img src=x onerror=alert\(1\)>/);
  assert.deepEqual(hrefs(tree), []);
});

test('only http, https and mailto links are followed', () => {
  assert.equal(safeHref('https://voice.example/x'), 'https://voice.example/x');
  assert.equal(safeHref('mailto:ops@example.org'), 'mailto:ops@example.org');
  for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<b>', 'vbscript:x', '/relative', '#frag', ' javascript:x', '']) {
    assert.equal(safeHref(bad), null, bad);
  }
  const t = inline('[click](javascript:alert(1)) and [ok](https://a.example)');
  assert.deepEqual(hrefs(t), ['https://a.example']);
  assert.equal(text(t), 'click and ok', 'a refused link keeps its words');
});

test('an image is a link to it, never loaded', () => {
  const t = inline('![chart](https://img.example/c.png) ![x](javascript:alert(1))');
  assert.deepEqual(hrefs(t), ['https://img.example/c.png']);
  assert.equal(text(t), 'image: chart image: x');
});

test('fenced code keeps its text whole, markup and all', () => {
  const tree = parse('Here:\n\n```ts\nconst a = "<b>" + `x` ** 2;\n```\nafter');
  assert.deepEqual(tree.map((b) => b.t), ['p', 'code', 'p']);
  assert.equal(tree[1].lang, 'ts');
  assert.equal(tree[1].s, 'const a = "<b>" + `x` ** 2;');
  const open = parse('```\nunclosed\nstill code');
  assert.equal(open[0].t, 'code');
  assert.equal(open[0].s, 'unclosed\nstill code', 'a stream cut mid-fence is still code');
});

test('inline code, strong, emphasis, strikethrough and snake_case', () => {
  const t = inline('use `a*b*c` and **bold _it_** ~~old~~ snake_case_name *em*');
  assert.deepEqual(t.map((n) => n.t), ['text', 'code', 'text', 'strong', 'text', 'del', 'text', 'em']);
  assert.equal(t[1].s, 'a*b*c');
  assert.equal(t[3].c[1].t, 'em');
  assert.equal(text(t[6]), ' snake_case_name ');
});

test('headings, lists nested by indent, quotes, rules and tables', () => {
  const tree = parse('# Title\n\n- one\n- two\n  - deep\n\n1. first\n2. second\n\n> quoted **x**\n\n---\n\n| a | b |\n|:--|--:|\n| 1 | `2` |\n');
  assert.deepEqual(tree.map((b) => b.t), ['h', 'list', 'list', 'quote', 'hr', 'table']);
  assert.equal(tree[0].level, 1);
  assert.equal(tree[1].items.length, 2);
  assert.equal(tree[1].items[1][1].t, 'list', 'the nested list');
  assert.equal(tree[2].ordered, true);
  assert.deepEqual(tree[5].align, ['left', 'right']);
  assert.equal(tree[5].rows[0][1][0].t, 'code');
});

test('bare and angle-bracket URLs are links; a trailing period is not part of one', () => {
  const t = inline('see https://voice.example/a_b. or <https://x.example>');
  assert.deepEqual(hrefs(t), ['https://voice.example/a_b', 'https://x.example']);
});

test('backslash escapes and hard breaks', () => {
  const t = inline('\\*not em\\* line  \nnext');
  assert.equal(t[0].s, '*not em* line');
  assert.equal(t[1].t, 'br');
});
