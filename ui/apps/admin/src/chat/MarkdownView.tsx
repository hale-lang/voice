import { useMemo, useState, type ReactNode } from 'react';
import { parse, type Block, type Inline } from './markdown';
import s from './Chat.module.css';

/**
 * A model's markdown as React elements (markdown.ts reads it): nothing
 * of it is ever set as HTML, so markup in the text is shown, not run.
 */
export function Markdown({ text }: { text: string }) {
  const tree = useMemo(() => parse(text), [text]);
  return <div className={s.md}>{tree.map((b, i) => block(b, i))}</div>;
}

function block(b: Block, key: number): ReactNode {
  switch (b.t) {
    case 'p':
      return <p key={key}>{inlines(b.c)}</p>;
    case 'h': {
      const H = (['h4', 'h4', 'h5', 'h5', 'h6', 'h6'] as const)[b.level - 1] ?? 'h6';
      return <H key={key}>{inlines(b.c)}</H>;
    }
    case 'code':
      return <CodeBlock key={key} lang={b.lang} text={b.s} />;
    case 'list': {
      const items = b.items.map((it, i) => <li key={i}>{it.length === 1 && it[0]!.t === 'p' ? inlines(it[0]!.c) : it.map((x, k) => block(x, k))}</li>);
      return b.ordered ? <ol key={key} start={b.start}>{items}</ol> : <ul key={key}>{items}</ul>;
    }
    case 'quote':
      return <blockquote key={key}>{b.c.map((x, k) => block(x, k))}</blockquote>;
    case 'hr':
      return <hr key={key} />;
    case 'table':
      return (
        <div key={key} className={s.tableWrap}>
          <table>
            <thead>
              <tr>{b.head.map((h, i) => <th key={i} style={{ textAlign: b.align[i] ?? undefined }}>{inlines(h)}</th>)}</tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => (
                <tr key={i}>{r.map((c, k) => <td key={k} style={{ textAlign: b.align[k] ?? undefined }}>{inlines(c)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

function inlines(xs: Inline[]): ReactNode[] {
  return xs.map((x, i) => {
    switch (x.t) {
      case 'text':
        return x.s;
      case 'code':
        return <code key={i}>{x.s}</code>;
      case 'strong':
        return <strong key={i}>{inlines(x.c)}</strong>;
      case 'em':
        return <em key={i}>{inlines(x.c)}</em>;
      case 'del':
        return <del key={i}>{inlines(x.c)}</del>;
      case 'link':
        return (
          <a key={i} href={x.href} target="_blank" rel="noopener noreferrer nofollow">
            {inlines(x.c)}
          </a>
        );
      case 'br':
        return <br key={i} />;
    }
  });
}

/** A code block with its language and a copy button. */
function CodeBlock({ lang, text }: { lang: string; text: string }) {
  return (
    <div className={s.code}>
      <div className={s.codeHead}>
        <span className="readout">{lang || 'code'}</span>
        <CopyButton text={text} />
      </div>
      <pre>
        <code>{text}</code>
      </pre>
    </div>
  );
}

/** Copy `text`; says `copied` once it is, `not copied` when the browser refuses. */
export function CopyButton({ text, label = 'copy' }: { text: string; label?: string }) {
  const [said, setSaid] = useState<string | null>(null);
  return (
    <button
      type="button"
      className={s.quiet}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setSaid('copied');
        } catch {
          setSaid('not copied');
        }
        setTimeout(() => setSaid(null), 1500);
      }}
    >
      {said ?? label}
    </button>
  );
}
