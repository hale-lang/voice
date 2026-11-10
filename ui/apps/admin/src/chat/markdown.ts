/**
 * A model's markdown, read into a tree the screen renders as React
 * elements: never HTML. Raw HTML in the text stays text (React escapes
 * it), a link keeps only an `http:`, `https:` or `mailto:` target (any
 * other is its words alone), and an image is a link to it, never loaded.
 * Paragraphs, headings, fenced and indented code, lists (nested by
 * indent), quotes, rules and tables; inline code, strong, emphasis,
 * strikethrough, links and bare URLs.
 */
export type Inline =
  | { t: 'text'; s: string }
  | { t: 'code'; s: string }
  | { t: 'strong' | 'em' | 'del'; c: Inline[] }
  | { t: 'link'; href: string; c: Inline[] }
  | { t: 'br' };

export type Block =
  | { t: 'p'; c: Inline[] }
  | { t: 'h'; level: number; c: Inline[] }
  | { t: 'code'; lang: string; s: string }
  | { t: 'list'; ordered: boolean; start: number; items: Block[][] }
  | { t: 'quote'; c: Block[] }
  | { t: 'hr' }
  | { t: 'table'; align: ('left' | 'center' | 'right' | null)[]; head: Inline[][]; rows: Inline[][][] };

/** The link target `href` is taken as, or null for one that is not followed. */
export function safeHref(href: string): string | null {
  const h = href.trim();
  // no control characters or spaces hiding a scheme
  if (!h || /[\u0000-\u001f\u007f\s]/.test(h)) return null;
  return /^(https?:\/\/|mailto:)/i.test(h) ? h : null;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:\s+(.*?))?\s*#*\s*$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const BULLET = /^( {0,3})([-*+])\s+(.*)$/;
const NUMBERED = /^( {0,3})(\d{1,9})[.)]\s+(.*)$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;

export function parse(md: string): Block[] {
  return blocks(md.replace(/\r\n?/g, '\n').split('\n'));
}

function blocks(lines: string[]): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === '') {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const mark = fence[1]!;
      const body: string[] = [];
      i++;
      while (i < lines.length && !new RegExp(`^ {0,3}${mark[0] === '`' ? '`' : '~'}{${mark.length},}\\s*$`).test(lines[i]!)) body.push(lines[i++]!);
      i++; // the closing fence, or the end
      out.push({ t: 'code', lang: fence[2] ?? '', s: body.join('\n') });
      continue;
    }
    if (/^( {4}|\t)/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && (/^( {4}|\t)/.test(lines[i]!) || (lines[i]!.trim() === '' && i + 1 < lines.length && /^( {4}|\t)/.test(lines[i + 1]!)))) {
        body.push(lines[i]!.replace(/^( {4}|\t)/, ''));
        i++;
      }
      out.push({ t: 'code', lang: '', s: body.join('\n') });
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      out.push({ t: 'h', level: h[1]!.length, c: inline(h[2] ?? '') });
      i++;
      continue;
    }
    if (RULE.test(line)) {
      out.push({ t: 'hr' });
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && lines[i]!.trim() !== '' && (QUOTE.test(lines[i]!) || body.length > 0)) {
        const q = QUOTE.exec(lines[i]!);
        body.push(q ? q[1]! : lines[i]!);
        i++;
      }
      out.push({ t: 'quote', c: blocks(body) });
      continue;
    }
    const b = BULLET.exec(line);
    const n = NUMBERED.exec(line);
    if (b || n) {
      const [list, next] = listAt(lines, i, !!n);
      out.push(list);
      i = next;
      continue;
    }
    const table = tableAt(lines, i);
    if (table) {
      out.push(table[0]);
      i = table[1];
      continue;
    }
    // a paragraph: until a blank line or a block that interrupts it
    const para: string[] = [];
    while (i < lines.length) {
      const l = lines[i]!;
      if (l.trim() === '' || FENCE.test(l) || HEADING.test(l) || RULE.test(l) || QUOTE.test(l) || BULLET.test(l) || /^ {0,3}1[.)]\s/.test(l)) {
        if (para.length) break;
      }
      para.push(l);
      i++;
    }
    out.push({ t: 'p', c: inline(para.join('\n')) });
  }
  return out;
}

/** A list from `start`: each item its marker's line and the lines indented under it. */
function listAt(lines: string[], start: number, ordered: boolean): [Block, number] {
  const marker = ordered ? NUMBERED : BULLET;
  const first = marker.exec(lines[start]!)!;
  const items: Block[][] = [];
  let i = start;
  while (i < lines.length) {
    const m = marker.exec(lines[i]!);
    if (!m) break;
    const indent = m[1]!.length + m[2]!.length + (ordered ? 2 : 1);
    const body = [m[3]!];
    i++;
    while (i < lines.length) {
      const l = lines[i]!;
      if (l.trim() === '') {
        // a blank line goes on only into more of the item
        const after = lines[i + 1];
        if (after !== undefined && leading(after) >= Math.min(indent, 2) && after.trim() !== '') {
          body.push('');
          i++;
          continue;
        }
        break;
      }
      if (leading(l) >= Math.min(indent, 2)) {
        body.push(l.slice(Math.min(leading(l), indent)));
        i++;
        continue;
      }
      // a line that is not indented and starts no block continues the item's text
      if (!marker.exec(l) && !BULLET.exec(l) && !NUMBERED.exec(l) && !FENCE.test(l) && !HEADING.test(l) && !QUOTE.test(l) && !RULE.test(l)) {
        body.push(l);
        i++;
        continue;
      }
      break;
    }
    items.push(blocks(body));
    // items apart by one blank line are still the one list
    if (i < lines.length && lines[i]!.trim() === '' && i + 1 < lines.length && marker.exec(lines[i + 1]!)) i++;
  }
  return [{ t: 'list', ordered, start: ordered ? Number(first[2]) : 1, items }, i];
}

function leading(l: string): number {
  return l.length - l.replace(/^[ \t]+/, '').length;
}

function cells(row: string): string[] {
  let r = row.trim();
  if (r.startsWith('|')) r = r.slice(1);
  if (r.endsWith('|') && !r.endsWith('\\|')) r = r.slice(0, -1);
  const out: string[] = [];
  let cur = '';
  for (let k = 0; k < r.length; k++) {
    if (r[k] === '\\' && r[k + 1] === '|') {
      cur += '|';
      k++;
    } else if (r[k] === '|') {
      out.push(cur.trim());
      cur = '';
    } else cur += r[k];
  }
  out.push(cur.trim());
  return out;
}

/** A table: a header row, a delimiter row, and its rows. */
function tableAt(lines: string[], i: number): [Block, number] | null {
  const head = lines[i]!;
  const delim = lines[i + 1];
  if (!head.includes('|') || delim === undefined || !/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(delim)) return null;
  const names = cells(head);
  const align = cells(delim).map((d) => (d.startsWith(':') && d.endsWith(':') ? 'center' : d.endsWith(':') ? 'right' : d.startsWith(':') ? 'left' : null));
  if (align.length !== names.length) return null;
  const rows: Inline[][][] = [];
  let k = i + 2;
  while (k < lines.length && lines[k]!.trim() !== '' && lines[k]!.includes('|')) {
    const cs = cells(lines[k]!);
    rows.push(names.map((_, c) => inline(cs[c] ?? '')));
    k++;
  }
  return [{ t: 'table', align, head: names.map((n) => inline(n)), rows }, k];
}

/** Inline markdown: code first (nothing inside it is read), then the rest. */
export function inline(s: string): Inline[] {
  const out: Inline[] = [];
  let text = '';
  const flush = () => {
    if (text) out.push({ t: 'text', s: text });
    text = '';
  };
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    const rest = s.slice(i);
    if (ch === '\\' && i + 1 < s.length && /[\\`*_{}[\]()#+\-.!|~<>]/.test(s[i + 1]!)) {
      text += s[i + 1];
      i += 2;
      continue;
    }
    if (ch === '\\' && s[i + 1] === '\n') {
      flush();
      out.push({ t: 'br' });
      i += 2;
      continue;
    }
    if (ch === '\n') {
      // two spaces before it: a hard break; otherwise a space
      if (text.endsWith('  ')) {
        text = text.replace(/ +$/, '');
        flush();
        out.push({ t: 'br' });
      } else text = text.replace(/ +$/, '') + ' ';
      i++;
      continue;
    }
    if (ch === '`') {
      const run = /^`+/.exec(rest)![0];
      const close = s.indexOf(run, i + run.length);
      if (close > 0 && s[close + run.length] !== '`') {
        flush();
        let code = s.slice(i + run.length, close).replace(/\n/g, ' ');
        if (/^ .* $/.test(code)) code = code.slice(1, -1);
        out.push({ t: 'code', s: code });
        i = close + run.length;
        continue;
      }
      text += run;
      i += run.length;
      continue;
    }
    const delim = /^(\*\*|__|~~|\*|_)/.exec(rest);
    if (delim) {
      const d = delim[1]!;
      // `_` inside a word is a word's (snake_case), not emphasis
      const inWord = d[0] === '_' && i > 0 && /\w/.test(s[i - 1]!);
      const close = inWord ? -1 : closing(s, i + d.length, d);
      if (close > i + d.length) {
        flush();
        const t = d === '~~' ? 'del' : d.length === 2 ? 'strong' : 'em';
        out.push({ t, c: inline(s.slice(i + d.length, close)) });
        i = close + d.length;
        continue;
      }
      text += d;
      i += d.length;
      continue;
    }
    if (ch === '!' && s[i + 1] === '[') {
      const l = linkAt(s, i + 1);
      if (l) {
        flush();
        const href = safeHref(l.href);
        const label: Inline[] = [{ t: 'text', s: l.label ? `image: ${l.label}` : 'image' }];
        out.push(href ? { t: 'link', href, c: label } : label[0]!);
        i = l.end;
        continue;
      }
    }
    if (ch === '[') {
      const l = linkAt(s, i);
      if (l) {
        flush();
        const href = safeHref(l.href);
        const c = inline(l.label);
        if (href) out.push({ t: 'link', href, c });
        else out.push(...c);
        i = l.end;
        continue;
      }
    }
    if (ch === '<') {
      const auto = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i.exec(rest);
      if (auto) {
        flush();
        out.push({ t: 'link', href: auto[1]!, c: [{ t: 'text', s: auto[1]! }] });
        i += auto[0].length;
        continue;
      }
    }
    if ((ch === 'h' || ch === 'H') && (i === 0 || /[\s(]/.test(s[i - 1]!))) {
      const bare = /^https?:\/\/[^\s<>()]*[^\s<>().,:;!?'"*_~]/i.exec(rest);
      if (bare) {
        flush();
        out.push({ t: 'link', href: bare[0], c: [{ t: 'text', s: bare[0] }] });
        i += bare[0].length;
        continue;
      }
    }
    text += ch;
    i++;
  }
  flush();
  return out;
}

/** Where `d` closes emphasis begun before `from`: not after a space, and skipping code spans. */
function closing(s: string, from: number, d: string): number {
  if (s[from] === ' ' || s[from] === '\n' || from >= s.length) return -1;
  let i = from;
  while (i < s.length) {
    if (s[i] === '\\') {
      i += 2;
      continue;
    }
    if (s[i] === '`') {
      const run = /^`+/.exec(s.slice(i))![0];
      const close = s.indexOf(run, i + run.length);
      i = close > 0 ? close + run.length : i + run.length;
      continue;
    }
    if (s.startsWith(d, i) && s[i - 1] !== ' ' && s[i - 1] !== '\n') {
      // `**` is not the end of `*`
      if (d.length === 1 && s[i + 1] === d) {
        i += 2;
        continue;
      }
      // `_` closing inside a word is not one
      if (d[0] === '_' && i + d.length < s.length && /\w/.test(s[i + d.length]!)) {
        i++;
        continue;
      }
      return i;
    }
    i++;
  }
  return -1;
}

/** A `[label](href)` at `i`: its parts and where it ends. */
function linkAt(s: string, i: number): { label: string; href: string; end: number } | null {
  let depth = 0;
  let k = i;
  for (; k < s.length; k++) {
    if (s[k] === '\\') {
      k++;
      continue;
    }
    if (s[k] === '[') depth++;
    else if (s[k] === ']') {
      depth--;
      if (depth === 0) break;
    }
  }
  if (k >= s.length || s[k + 1] !== '(') return null;
  const m = /^\(\s*<?([^\s()<>]*(?:\([^\s()]*\)[^\s()<>]*)*)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/.exec(s.slice(k + 1));
  if (!m) return null;
  return { label: s.slice(i + 1, k), href: m[1]!, end: k + 1 + m[0].length };
}
