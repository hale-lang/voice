/**
 * A machine's memory as a grid of cells, each a fixed amount of it: what
 * the machine keeps back for itself, what each occupant holds, and what is
 * free. Pure: no React, no application's nouns. `MemoryCard` draws it.
 */

/** How an occupant changes under a proposed state, against the current one. */
export type MemoryMark = 'kept' | 'added' | 'removed';

/** One occupant of a machine's memory. */
export type MemoryBlock = {
  /** Its id, the same on every machine it spans; its colour follows from it. */
  key: string;
  label: string;
  /** What it holds of the machine's memory. */
  bytes: number;
  /** Of `bytes`, its own; the rest is drawn as its overhead. Left out when not told apart. */
  coreBytes?: number;
  mark?: MemoryMark;
};

/** A machine's memory, as a card draws it. */
export type MemoryModel = {
  /** The machine's memory. */
  totalBytes: number;
  /** What occupants may use of it; the rest is held back. */
  budgetBytes: number;
  /** In the order they are laid out. */
  blocks: MemoryBlock[];
};

/**
 * One cell. `reserve`: held back by the machine. `block`: an occupant's
 * (`overhead` for the part that is not its own). `free`: nobody's; with
 * `was`, freed by an occupant the proposed state removes. `over`: marks a
 * cell past the machine's memory, which its occupants overfill.
 */
export type MemoryCell = {
  kind: 'reserve' | 'block' | 'free';
  block?: string;
  overhead?: boolean;
  mark?: MemoryMark;
  /** On a free cell: the occupant whose removal freed it. */
  was?: string;
  over?: boolean;
};

/** Totals of a machine's memory, in bytes. */
export type MemoryTotals = { total: number; reserve: number; used: number; free: number };

const GIB = 1024 ** 3;

/** The units a cell may be, smallest first. */
const UNITS = [1, 2, 4, 8, 16, 32].map((g) => g * GIB);

/** The most cells the largest machine is drawn in before the unit grows. */
export const CELLS_MAX = 512;

/**
 * The amount of memory a cell stands for, one for every machine shown so
 * their sizes compare: a gibibyte, or the least power of two of them that
 * draws the largest machine in at most `CELLS_MAX` cells.
 */
export function memoryUnit(largestBytes: number): number {
  for (const u of UNITS) if (largestBytes / u <= CELLS_MAX) return u;
  return UNITS[UNITS.length - 1]!;
}

/** Bytes to cells, to the nearest. */
const cellsOf = (bytes: number, unit: number) => Math.round(Math.max(0, bytes) / unit);

/**
 * The cells of `m`, `unit` bytes each: what the machine holds back first,
 * then each block in order, contiguous, then free cells to its total. A
 * block holds the cells its running end rounds to, at least one, so small
 * ones show and rounding never drifts across a machine; its overhead is
 * its last cells. Blocks run past the machine's total when they overfill
 * it, or when the cells small blocks are given at the least add up past
 * it; only the cells the bytes past its budget round to are marked
 * `over`. A removed block is not drawn.
 */
export function layoutMemory(m: MemoryModel, unit: number): MemoryCell[] {
  const total = Math.max(1, cellsOf(m.totalBytes, unit));
  const reserveBytes = Math.max(0, m.totalBytes - m.budgetBytes);
  const out: MemoryCell[] = [];
  let bytesAt = 0;
  const run = (bytes: number, make: (i: number, n: number) => MemoryCell) => {
    if (bytes <= 0) return;
    bytesAt += bytes;
    const n = Math.max(1, cellsOf(bytesAt, unit) - out.length);
    for (let i = 0; i < n; i++) out.push(make(i, n));
  };
  run(reserveBytes, () => ({ kind: 'reserve' }));
  for (const b of m.blocks) {
    if (b.mark === 'removed') continue;
    const overheadBytes = b.coreBytes != null ? Math.max(0, b.bytes - b.coreBytes) : 0;
    run(b.bytes, (i, n) => {
      const overhead = overheadBytes > 0 && n > 1 ? Math.min(n - 1, Math.max(1, cellsOf(overheadBytes, unit))) : 0;
      return { kind: 'block', block: b.key, overhead: i >= n - overhead ? true : undefined, mark: b.mark };
    });
  }
  while (out.length < total) out.push({ kind: 'free' });
  // overfilled by the bytes, not by the cell each small block is given:
  // the last cells, as many as the bytes past the budget round to
  const overBytes = bytesAt - m.totalBytes;
  const over = overBytes > 0 ? Math.min(out.length, Math.max(1, cellsOf(overBytes, unit))) : 0;
  for (let i = out.length - over; i < out.length; i++) out[i] = { ...out[i]!, over: true };
  return out;
}

/**
 * The cells of a proposed state `plan` beside the current one `now`, as
 * the plan is drawn: each of its cells as `layoutMemory` lays it out, and
 * a free cell that `now` gave a block the plan removes marked `was` it, so
 * what a removal frees shows where it was. For a block to keep its cells
 * across the two, `now` lays out the blocks the plan keeps first, in the
 * plan's order, and `plan` lays them out first too (`orderForPlan`).
 */
export function planCells(now: MemoryModel, plan: MemoryModel, unit: number): MemoryCell[] {
  const before = layoutMemory({ ...now, blocks: now.blocks.map((b) => ({ ...b, mark: undefined })) }, unit);
  const removed = new Set(plan.blocks.filter((b) => b.mark === 'removed').map((b) => b.key));
  return layoutMemory(plan, unit).map((c, i) => {
    const was = before[i];
    if (c.kind === 'free' && was?.kind === 'block' && was.block && removed.has(was.block)) return { ...c, was: was.block };
    return c;
  });
}

/**
 * Blocks in the order a plan beside the current state lays them out: those
 * kept, in `now`'s order, then the rest as given (the removed in `now`,
 * the added in the plan), so a kept block holds the same cells in both.
 */
export function orderForPlan(blocks: MemoryBlock[], kept: (key: string) => boolean): MemoryBlock[] {
  return [...blocks.filter((b) => kept(b.key)), ...blocks.filter((b) => !kept(b.key))];
}

/** What `m` holds back, holds and leaves, in bytes; `free` is negative when its blocks overfill it. */
export function memoryTotals(m: MemoryModel): MemoryTotals {
  const used = m.blocks.filter((b) => b.mark !== 'removed').reduce((n, b) => n + b.bytes, 0);
  return { total: m.totalBytes, reserve: Math.max(0, m.totalBytes - m.budgetBytes), used, free: m.budgetBytes - used };
}

/** FNV-1a, so keys that differ by a character land far apart. */
function hash(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * A hue of its own for `key`, the same every time and on every machine it
 * spans; clear of the reds failure is drawn in.
 */
export function hueOf(key: string): number {
  return 25 + (hash(key) % 310);
}

/** The hues blocks shown together are told apart by: 30° apart, clear of red. */
export const HUE_SLOTS = Array.from({ length: 11 }, (_, i) => 25 + i * 30);

/**
 * A hue for each of `keys`, shown together, so no two of them look alike:
 * each takes the slot of `HUE_SLOTS` its key hashes to, or the next one no
 * other has taken, the keys in sorted order; past eleven, they share. The
 * same keys get the same hues every time.
 */
export function huesFor(keys: Iterable<string>): Map<string, number> {
  const out = new Map<string, number>();
  const taken = new Set<number>();
  for (const k of [...new Set(keys)].sort()) {
    let slot = hash(k) % HUE_SLOTS.length;
    if (taken.size < HUE_SLOTS.length) while (taken.has(slot)) slot = (slot + 1) % HUE_SLOTS.length;
    taken.add(slot);
    out.set(k, HUE_SLOTS[slot]!);
  }
  return out;
}
