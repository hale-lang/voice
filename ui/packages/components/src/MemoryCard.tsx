import { memo, type CSSProperties, type ReactNode } from 'react';
import { bytes } from './format';
import { hueOf as ownHue, layoutMemory, memoryTotals, type MemoryCell, type MemoryMark, type MemoryModel } from './memory-layout';
import s from './MemoryCard.module.css';

/** Where a pointer or a focused entry is, for a tip beside it. */
export type MemoryPoint = { x: number; y: number };

export type MemoryCardProps = {
  /** The machine's name, as text: the card's accessible name too. */
  name: string;
  /** What the head shows for it; `name` when left out. */
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Its state, at the head's end. */
  status?: ReactNode;
  model: MemoryModel;
  /** The bytes a cell stands for, the same on every card shown together (`memoryUnit`). */
  unit: number;
  /** The cells, when given (`planCells`); else `model` laid out. */
  cells?: MemoryCell[];
  /** Small cells and no legend: a card among many, or a header. */
  compact?: boolean;
  /** Each block listed under the grid, with its size; on unless compact. */
  legend?: boolean;
  /** The block shown with its cells lit, everything else receding. */
  highlight?: string | null;
  selected?: string | null;
  onHover?: (block: string | null, at?: MemoryPoint) => void;
  onSelect?: (block: string) => void;
  /** The card as a whole, chosen (it is then a button). */
  onOpen?: () => void;
  /** Whether a plan's additions glow and its freed cells fade, as it is shown. */
  animate?: boolean;
  /** Each block's hue, shared by the cards shown together (`huesFor`); else its own (`hueOf`). */
  hues?: Map<string, number>;
};

const MARK_SAID: Record<MemoryMark, string> = { kept: 'kept', added: 'added', removed: 'removed' };

/** One cell's class and colour. */
function cellLook(c: MemoryCell, highlight: string | null | undefined, selected: string | null | undefined, hueOf: (k: string) => number): { className: string; style?: CSSProperties } {
  const cls = [s.cell];
  let hue: number | undefined;
  if (c.kind === 'reserve') cls.push(s.reserve);
  else if (c.kind === 'block' && c.block) {
    cls.push(c.overhead ? s.overhead : s.block);
    if (c.mark === 'added') cls.push(s.added);
    hue = hueOf(c.block);
  } else {
    cls.push(s.free);
    if (c.was) {
      cls.push(s.freed);
      hue = hueOf(c.was);
    }
  }
  if (c.over) cls.push(s.over);
  const key = c.block ?? c.was;
  if (key && key === highlight) cls.push(s.hot);
  if (key && key === selected) cls.push(s.chosen);
  return { className: cls.join(' '), style: hue === undefined ? undefined : ({ '--h': hue } as CSSProperties) };
}

/** What a block's cell says, for a pointer that cannot see colour. */
function blockAt(target: EventTarget | null): string | null {
  const el = (target as HTMLElement | null)?.closest?.('[data-block]');
  return el ? el.getAttribute('data-block') : null;
}

/**
 * A machine's memory, drawn: its name and state, a grid of cells (each
 * `unit` bytes: what it holds back hatched, each block in a hue of its own,
 * contiguous, free cells as outlines), its totals, and each block listed.
 * The grid is sixteen cells wide on every card, so a larger machine is a
 * taller card. Hovering a block's cells or its entry lights it; its entry
 * is a button, so the same works from the keyboard.
 */
export const MemoryCard = memo(function MemoryCard(p: MemoryCardProps) {
  const cells = p.cells ?? layoutMemory(p.model, p.unit);
  const hueOf = (k: string) => p.hues?.get(k) ?? ownHue(k);
  const totals = memoryTotals(p.model);
  const legend = p.legend ?? !p.compact;
  const lit = p.highlight && cells.some((c) => c.block === p.highlight || c.was === p.highlight) ? p.highlight : null;
  const shown = p.model.blocks;
  const said = [
    `${p.name}: ${bytes(totals.total)}`,
    totals.reserve > 0 ? `${bytes(totals.reserve)} held back` : '',
    ...shown.map((b) => `${b.label} ${bytes(b.bytes)}${b.mark ? `, ${MARK_SAID[b.mark]}` : ''}`),
    totals.free >= 0 ? `${bytes(totals.free)} free` : `overfilled by ${bytes(-totals.free)}`,
  ].filter(Boolean).join('; ');
  const head = (
    <div className={s.head}>
      <span className={s.title}>{p.title ?? p.name}</span>
      {p.status}
    </div>
  );
  return (
    <section className={`${s.card} ${p.compact ? s.compact : ''} ${p.animate ? s.animate : ''}`} aria-label={`${p.name} memory`}>
      <div className={s.inner}>
        {p.onOpen ? (
          <button type="button" className={s.open} onClick={p.onOpen} aria-label={`open ${p.name}`}>{head}</button>
        ) : head}
        {p.subtitle && <div className={s.sub}>{p.subtitle}</div>}
        <div
          className={`${s.grid} ${lit ? s.dim : ''}`}
          role="img"
          aria-label={said}
          onMouseMove={p.onHover ? (e) => { const b = blockAt(e.target); p.onHover!(b, b ? { x: e.clientX, y: e.clientY } : undefined); } : undefined}
          onMouseLeave={p.onHover ? () => p.onHover!(null) : undefined}
          onClick={p.onSelect ? (e) => { const b = blockAt(e.target); if (b) p.onSelect!(b); } : undefined}
        >
          {cells.map((c, i) => {
            const look = cellLook(c, lit, p.selected, hueOf);
            return <span key={i} className={look.className} style={look.style} data-block={c.block ?? c.was ?? undefined} />;
          })}
        </div>
        <div className={s.totals}>
          <span>used <b>{bytes(totals.used)}</b></span>
          <span>held back <b>{bytes(totals.reserve)}</b></span>
          {totals.free >= 0 ? <span>free <b>{bytes(totals.free)}</b></span> : <span className="c-fail">over by <b>{bytes(-totals.free)}</b></span>}
        </div>
        {legend && shown.length > 0 && (
          <ul className={s.legend}>
            {shown.map((b) => (
              <li key={b.key}>
                <button
                  type="button"
                  className={`${s.entry} ${b.key === lit ? s.entryLit : ''} ${b.key === p.selected ? s.entryChosen : ''} ${b.mark === 'removed' ? s.entryGone : ''}`}
                  style={{ '--h': hueOf(b.key) } as CSSProperties}
                  onMouseEnter={p.onHover ? (e) => p.onHover!(b.key, { x: e.clientX, y: e.clientY }) : undefined}
                  onMouseLeave={p.onHover ? () => p.onHover!(null) : undefined}
                  onFocus={p.onHover ? (e) => { const r = e.currentTarget.getBoundingClientRect(); p.onHover!(b.key, { x: r.right, y: r.top }); } : undefined}
                  onBlur={p.onHover ? () => p.onHover!(null) : undefined}
                  onClick={p.onSelect ? () => p.onSelect!(b.key) : undefined}
                  aria-pressed={p.onSelect ? b.key === p.selected : undefined}
                >
                  <span className={`${s.swatch} ${b.mark === 'removed' ? s.swatchGone : b.mark === 'added' ? s.swatchAdded : ''}`} aria-hidden="true" />
                  <span className={s.entryName}>{b.label}</span>
                  <span className={s.entrySize}>{bytes(b.bytes)}{b.mark && b.mark !== 'kept' ? ` · ${MARK_SAID[b.mark]}` : ''}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
});

/**
 * The key to every card shown together: what a cell stands for, and how
 * each kind of cell is drawn, in words beside each.
 */
export function MemoryKey({ unit, plan, overhead }: { unit: number; plan?: boolean; overhead?: string }) {
  const items: [string, string][] = [
    [`${s.reserve}`, 'held back by the machine'],
    [`${s.block}`, 'a model, its own hue'],
    ...(overhead ? [[`${s.overhead}`, overhead] as [string, string]] : []),
    [`${s.free}`, 'free'],
    ...(plan ? ([[`${s.block} ${s.added}`, 'added by the plan'], [`${s.free} ${s.freed}`, 'freed by a removal']] as [string, string][]) : []),
  ];
  return (
    <ul className={s.key} aria-label="memory key">
      <li className={s.unit}>1 cell = {bytes(unit)}</li>
      {items.map(([cls, what]) => (
        <li key={what}>
          <span className={`${s.cell} ${cls}`} style={{ '--h': 205 } as CSSProperties} aria-hidden="true" />
          {what}
        </li>
      ))}
    </ul>
  );
}

/** A run of `n` cells standing for something that does not fit, as a tray shows it. */
export function MemoryNeed({ cells, label }: { cells: number; label: string }) {
  return (
    <span className={s.need} role="img" aria-label={label}>
      {Array.from({ length: cells }, (_, i) => <span key={i} className={`${s.cell} ${s.wanting}`} />)}
    </span>
  );
}

/** A tip beside a point: what a lit block is, in full. */
export function MemoryTip({ at, children }: { at: MemoryPoint; children: ReactNode }) {
  const w = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const h = typeof window !== 'undefined' ? window.innerHeight : 800;
  const left = Math.max(8, Math.min(at.x + 14, w - 336));
  // below the point, or above it near the window's foot
  const place: CSSProperties = at.y > h - 220 ? { left, bottom: h - at.y + 10 } : { left, top: at.y + 14 };
  return (
    <div className={s.tip} role="tooltip" style={place}>
      {children}
    </div>
  );
}
