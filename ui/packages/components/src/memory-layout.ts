/**
 * A machine's memory as a grid of a hundred cells, each a hundredth of it: what
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

const GIB = 1024 ** 3;

/** Totals of a machine's memory, in bytes. */
export type MemoryTotals = { total: number; reserve: number; used: number; free: number };

/**
 * The cells every machine is drawn in, whatever its size: ten by ten, so
 * a cell is a hundredth of the machine and every card is the same grid.
 * Cards compare by how full they are; each says what its cell stands for.
 */
export const CELLS = 100;

/**
 * What a cell of `m` stands for: a hundredth of the machine, or of what it
 * holds back and holds when that is more (its blocks overfill it), so its
 * cells still number `CELLS`.
 */
export function memoryUnit(m: MemoryModel): number {
  return Math.max(1, m.totalBytes, reserveOf(m) + usedOf(m)) / CELLS;
}

const reserveOf = (m: MemoryModel) => Math.max(0, m.totalBytes - m.budgetBytes);
const usedOf = (m: MemoryModel) => m.blocks.filter((b) => b.mark !== 'removed').reduce((n, b) => n + Math.max(0, b.bytes), 0);

/**
 * `cells` shared among `quotas` (each in cells, not whole) by the largest
 * remainder: each its whole part, at least one when it is anything at all
 * (unless `least` says it may round to none), then the cells left over to the largest remainders, or, when the ones
 * given at the least overshoot, taken back from the most overgiven that
 * keep one. Sums to `cells`, unless there are more quotas than cells: then
 * the smallest go without.
 */
export function apportion(quotas: number[], cells: number, least?: boolean[]): number[] {
  const n = quotas.map((q, i) => (q > 0 ? Math.max(least?.[i] === false ? 0 : 1, Math.floor(q)) : 0));
  let left = cells - n.reduce((a, b) => a + b, 0);
  const by = (cmp: (a: number, b: number) => number) => quotas.map((_, i) => i).sort((a, b) => cmp(a, b) || a - b);
  // the largest remainders first, each one more, round after round while cells are left
  while (left > 0 && quotas.some((q) => q > 0)) {
    for (const i of by((a, b) => (quotas[b]! - n[b]!) - (quotas[a]! - n[a]!))) {
      if (left <= 0) break;
      if (quotas[i]! <= 0) continue;
      n[i]! += 1;
      left -= 1;
    }
  }
  // overshot by the cells small ones were given: take back from the most overgiven that keep one
  while (left < 0) {
    let pick = -1;
    for (let i = 0; i < n.length; i++) {
      if (n[i]! <= (least?.[i] === false ? 0 : 1)) continue;
      if (pick < 0 || n[i]! - quotas[i]! > n[pick]! - quotas[pick]!) pick = i;
    }
    if (pick < 0) {
      // more quotas than cells: the smallest go without
      for (const i of by((a, b) => quotas[a]! - quotas[b]!)) if (n[i]! > 0 && left < 0) { n[i] = 0; left += 1; }
      break;
    }
    n[pick]! -= 1;
    left += 1;
  }
  return n;
}

/**
 * The cells of `m`, `CELLS` of them, each `memoryUnit(m)` bytes: what
 * the machine holds back first, then each block in order, contiguous,
 * then the free cells. Each share is apportioned by the largest
 * remainder, so they sum to `CELLS` and anything held or held back at all
 * is a cell at the least; a block's overhead is its last cells, likewise. The
 * cells the bytes past its budget come to, at least one, are marked `over`
 * at the end. A removed block is not drawn. `fixed` gives some shares
 * their cells outright (the reserve as `''`, a block by its key): the
 * cells a plan keeps, so they stay put.
 */
export function layoutMemory(m: MemoryModel, fixed?: Map<string, number>): MemoryCell[] {
  const unit = memoryUnit(m);
  const blocks = m.blocks.filter((b) => b.mark !== 'removed' && b.bytes > 0);
  const reserveBytes = reserveOf(m);
  const usedBytes = usedOf(m);
  const freeBytes = Math.max(0, m.budgetBytes - usedBytes);
  const shares = [
    { key: '', bytes: reserveBytes },
    ...blocks.map((b) => ({ key: b.key, bytes: b.bytes })),
    { key: ' free', bytes: freeBytes },
  ];
  const quotas = shares.map((x) => x.bytes / Math.max(1, unit));
  const pinned = shares.map((x) => fixed?.get(x.key));
  const pinnedCells = pinned.reduce<number>((a, b) => a + (b ?? 0), 0);
  // the free cells alone may round to none: a machine full but for a sliver is drawn full
  const least = shares.map((x) => x.key !== ' free');
  // the cells left once some are pinned, shared among the rest in proportion:
  // pinned counts are whole, so the rest's quotas are scaled to what is left
  const target = Math.max(0, CELLS - pinnedCells);
  const loose = quotas.map((q, i) => (pinned[i] === undefined ? q : 0));
  const looseSum = loose.reduce((a, b) => a + b, 0);
  const rest = apportion(looseSum > 0 ? loose.map((q) => (q * target) / looseSum) : loose, target, least);
  const counts = shares.map((_, i) => pinned[i] ?? rest[i]!);
  const out: MemoryCell[] = [];
  for (let i = 0; i < counts[0]!; i++) out.push({ kind: 'reserve' });
  blocks.forEach((b, bi) => {
    const k = counts[bi + 1]!;
    const overheadBytes = b.coreBytes != null ? Math.max(0, b.bytes - b.coreBytes) : 0;
    const overhead = overheadBytes > 0 && k > 1 ? Math.min(k - 1, apportion([b.bytes - overheadBytes, overheadBytes].map((x) => (x / b.bytes) * k), k)[1]!) : 0;
    for (let i = 0; i < k; i++) out.push({ kind: 'block', block: b.key, overhead: i >= k - overhead ? true : undefined, mark: b.mark });
  });
  for (let i = 0; i < counts[counts.length - 1]!; i++) out.push({ kind: 'free' });
  // overfilled by the bytes: the last cells, as many as the bytes past the budget come to
  const overBytes = usedBytes - m.budgetBytes;
  const over = overBytes > 0 ? Math.min(out.length, Math.max(1, Math.round(overBytes / unit))) : 0;
  for (let i = out.length - over; i < out.length; i++) out[i] = { ...out[i]!, over: true };
  return out;
}

/**
 * The cells of a proposed state `plan` beside the current one `now`, as
 * the plan is drawn: what the machine holds back and each block the plan
 * keeps as it is hold the cells they hold now, the rest of the plan apportioned around them, and a free cell that
 * `now` gave a block the plan removes is marked `was` it, so what a
 * removal frees shows where it was. For a block to keep its cells, `now`
 * lays out the blocks the plan keeps first, in the plan's order, and
 * `plan` lays them out first too (`orderForPlan`). When the two are drawn
 * to different scales (one overfills the machine), nothing is held in place.
 */
export function planCells(now: MemoryModel, plan: MemoryModel): MemoryCell[] {
  const before = layoutMemory({ ...now, blocks: now.blocks.map((b) => ({ ...b, mark: undefined })) });
  const fixed = new Map<string, number>();
  if (memoryUnit(now) === memoryUnit(plan) && now.totalBytes === plan.totalBytes && now.budgetBytes === plan.budgetBytes) {
    fixed.set('', before.filter((c) => c.kind === 'reserve').length);
    // only a run of blocks kept as they are, from the first, keeps its cells
    for (const b of plan.blocks) {
      if (b.mark === 'removed' || b.bytes <= 0) continue;
      const was = now.blocks.find((x) => x.key === b.key);
      if (b.mark !== 'kept' || !was || was.bytes !== b.bytes) break;
      fixed.set(b.key, before.filter((c) => c.block === b.key).length);
    }
  }
  const removed = new Set(plan.blocks.filter((b) => b.mark === 'removed').map((b) => b.key));
  return layoutMemory(plan, fixed).map((c, i) => {
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
  return { total: m.totalBytes, reserve: reserveOf(m), used, free: m.budgetBytes - used };
}

/** What a cell stands for, as a card's footer says it: "1.22 GiB". */
export function unitSaid(unit: number): string {
  const g = unit / GIB;
  return g >= 10 ? `${g.toFixed(1)} GiB` : g >= 0.01 ? `${g.toFixed(2)} GiB` : `${(g * 1024).toFixed(1)} MiB`;
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
