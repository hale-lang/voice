import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import s from './Shell.module.css';
import { DetailContext, type DetailLayout, type DetailState } from './Detail';

/**
 * The instrument's frame: context rail, canvas, evidence strip, and the item
 * opened from a list (`detail`), shown as `layout` says: a page of its own
 * over the list (kept, hidden, so its filters and page survive), a drawer
 * over it, or in place under the row clicked (at the top of the canvas when
 * no table shows it there). `onClose` closes it: the back link, Esc, or the
 * drawer's backdrop.
 */
export function Shell(props: {
  rail: ReactNode;
  wide?: boolean;
  detail?: ReactNode;
  layout?: DetailLayout;
  onClose?: () => void;
  evidence: ReactNode;
  children: ReactNode;
}) {
  const layout = props.layout ?? 'page';
  const open = props.detail != null;
  const [clicked, setClicked] = useState<{ table: string; key: string } | null>(null);
  const [claims, setClaims] = useState<Record<string, boolean>>({});
  const click = useCallback((table: string, key: string) => setClicked({ table, key }), []);
  const claim = useCallback(
    (table: string, on: boolean) =>
      setClaims((c) => (!!c[table] === on ? c : { ...c, [table]: on })),
    [],
  );
  const shownInPlace = Object.values(claims).some(Boolean);
  const detail = useMemo<DetailState>(
    () => ({ layout, node: props.detail, clicked, click, claim }),
    [layout, props.detail, clicked, click, claim],
  );
  const close = props.onClose;
  useEffect(() => {
    if (!open || !close) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement)) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  const back = close && (
    <p className={s.back}>
      <a href="#" onClick={(e) => { e.preventDefault(); close(); }}>← back</a>
    </p>
  );
  return (
    <DetailContext.Provider value={detail}>
      <div className={`${s.shell} ${props.wide ? s.wide : ''}`}>
        <nav className={s.rail} aria-label="Context">
          {props.rail}
        </nav>
        <main className={s.canvas}>
          {open && layout === 'page' && (
            <div className={s.canvasInner}>
              {back}
              <section className={s.page} aria-label="Detail">{props.detail}</section>
            </div>
          )}
          {/* kept, so its filters and page survive; `hidden` alone loses to its display: flex */}
          <div className={s.canvasInner} style={open && layout === 'page' ? { display: 'none' } : undefined}>
            {open && layout === 'inline' && !shownInPlace && (
              <section className={s.inplace} aria-label="Detail">
                {back}
                {props.detail}
              </section>
            )}
            {props.children}
          </div>
        </main>
        <footer className={s.evidence} aria-label="Evidence">
          {props.evidence}
        </footer>
        {open && layout === 'drawer' && (
          <>
            <div className={s.backdrop} onClick={close} aria-hidden="true" />
            <aside className={s.drawer} aria-label="Detail">
              {close && (
                <button type="button" className={s.drawerClose} onClick={close} aria-label="Close">
                  ✕
                </button>
              )}
              {props.detail}
            </aside>
          </>
        )}
      </div>
    </DetailContext.Provider>
  );
}

export function RailHeader(props: { app: string; sub?: string }) {
  return (
    <div>
      <div className={s.app}>{props.app}</div>
      {props.sub && <div className={s.appSub}>{props.sub}</div>}
    </div>
  );
}

export function RailNav(props: { items: { href: string; label: string; active?: boolean }[] }) {
  return (
    <div className={s.nav}>
      {props.items.map((it) => (
        <a
          key={it.href}
          href={it.href}
          className={`${s.navLink} ${it.active ? s.navActive : ''}`}
          aria-current={it.active ? 'page' : undefined}
        >
          {it.label}
        </a>
      ))}
    </div>
  );
}

export function RailPrincipal(props: { children: ReactNode }) {
  return <div className={s.principal}>{props.children}</div>;
}

/** Source, revision and freshness of what the canvas shows. */
export function Evidence(props: { items: { label: string; value: ReactNode }[] }) {
  return (
    <>
      {props.items.map((it) => (
        <span key={it.label}>
          {it.label} <b>{it.value}</b>
        </span>
      ))}
    </>
  );
}
