import { useState, type ReactNode } from 'react';
import { Mono } from '@hale/components';
import s from './values.module.css';

/**
 * Stored JSON, read: an object as its fields, labelled; a short list on a
 * line, a long one as its count until opened; a value as itself. What the
 * UI shows in place of raw JSON (a seat's config, a change's before and
 * after).
 */
export function Value({ v, depth = 0 }: { v: unknown; depth?: number }) {
  if (v === null || v === undefined) return <span className="faint">–</span>;
  if (typeof v === 'boolean') return <>{v ? 'yes' : 'no'}</>;
  if (typeof v === 'number') return <>{v.toLocaleString()}</>;
  if (typeof v === 'string') return v.length > 40 || /^[a-z0-9_.:/-]+$/i.test(v) ? <Mono>{v}</Mono> : <>{v}</>;
  if (Array.isArray(v)) return <List items={v} depth={depth} />;
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>);
    if (!entries.length) return <span className="faint">none</span>;
    return (
      <dl className={s.fields}>
        {entries.map(([k, x]) => (
          <Field key={k} name={k}>
            <Value v={x} depth={depth + 1} />
          </Field>
        ))}
      </dl>
    );
  }
  return <>{String(v)}</>;
}

function Field({ name, children }: { name: string; children: ReactNode }) {
  return (
    <>
      <dt>{label(name)}</dt>
      <dd>{children}</dd>
    </>
  );
}

/** A list: its values on a line when they are short ones; otherwise each its own, the many folded. */
function List({ items, depth }: { items: unknown[]; depth: number }) {
  const [open, setOpen] = useState(items.length <= 6);
  if (!items.length) return <span className="faint">none</span>;
  const scalars = items.every((x) => x === null || ['string', 'number', 'boolean'].includes(typeof x));
  if (scalars && items.length <= 12) return <>{items.map((x, i) => <span key={i}>{i > 0 && ', '}<Value v={x} depth={depth + 1} /></span>)}</>;
  if (!open) {
    return (
      <button type="button" className={s.more} onClick={() => setOpen(true)}>
        {items.length} {items.length === 1 ? 'item' : 'items'} ▸
      </button>
    );
  }
  return (
    <ol className={s.list}>
      {items.map((x, i) => (
        <li key={i}>
          <Value v={x} depth={depth + 1} />
        </li>
      ))}
    </ol>
  );
}

/** `ttl_seconds` → `ttl seconds`. */
function label(k: string): string {
  return k.replace(/_/g, ' ');
}

type Leaf = { path: string; value: unknown };

/** Every leaf of `v`, by its path (`limits[0].requests`). */
function leaves(v: unknown, path = '', out: Leaf[] = []): Leaf[] {
  if (Array.isArray(v)) {
    if (!v.length) out.push({ path, value: [] });
    v.forEach((x, i) => leaves(x, `${path}[${i}]`, out));
  } else if (v && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>);
    if (!entries.length) out.push({ path, value: {} });
    for (const [k, x] of entries) leaves(x, path ? `${path}.${k}` : k, out);
  } else {
    out.push({ path, value: v });
  }
  return out;
}

/**
 * What changed between two versions of a resource: each field that differs,
 * before and after; a field only one has is added or removed. The whole of
 * each is a click away.
 */
export function Diff({ before, after }: { before: unknown; after: unknown }) {
  const [whole, setWhole] = useState(false);
  const b = new Map(leaves(before ?? {}).map((l) => [l.path, l.value]));
  const a = new Map(leaves(after ?? {}).map((l) => [l.path, l.value]));
  const paths = [...new Set([...b.keys(), ...a.keys()])].filter((p) => JSON.stringify(b.get(p)) !== JSON.stringify(a.get(p)));
  const created = before == null;
  const removed = after == null;
  return (
    <>
      {created || removed ? (
        <p className="muted">{created ? 'Made with:' : 'Removed; it was:'}</p>
      ) : paths.length === 0 ? (
        <p className="faint">No field changed.</p>
      ) : (
        <table className={s.diff}>
          <thead>
            <tr>
              <th>field</th>
              <th>before</th>
              <th>after</th>
            </tr>
          </thead>
          <tbody>
            {paths.map((p) => (
              <tr key={p}>
                <td>
                  <Mono>{p.replace(/_/g, ' ')}</Mono>
                </td>
                <td className={s.was}>{b.has(p) ? <Value v={b.get(p)} /> : <span className="faint">not set</span>}</td>
                <td className={s.now}>{a.has(p) ? <Value v={a.get(p)} /> : <span className="faint">removed</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {(created || removed) && <Value v={created ? after : before} />}
      {!created && !removed && (
        <p>
          <button type="button" className={s.more} onClick={() => setWhole(!whole)}>
            {whole ? 'hide the whole of it' : 'the whole of it, before and after'} {whole ? '▾' : '▸'}
          </button>
        </p>
      )}
      {whole && (
        <div className={s.sides}>
          <div>
            <h4>before</h4>
            <Value v={before} />
          </div>
          <div>
            <h4>after</h4>
            <Value v={after} />
          </div>
        </div>
      )}
    </>
  );
}
