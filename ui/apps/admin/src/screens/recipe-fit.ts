import type { Schemas } from '../api/client';

/**
 * The Recipes screen's fit explorer, as data: every recipe variant a row,
 * judged on every node and pair by the api (`listRecipeFits`, the rules a
 * placement is judged by), sorted and filtered here. Pure: the screen
 * renders it, and the view (its sort and filters) lives in the URL's query
 * so it can be shared and bookmarked.
 */

export type RecipeFits = Schemas['RecipeFits'];
export type TargetFit = Schemas['TargetFit'];
export type FitNode = Schemas['FitNode'];
export type FitPair = Schemas['FitPair'];
export type FitSpeed = Schemas['FitSpeed'];
type RecipeSummary = Schemas['RecipeSummary'];
type VariantSummary = Schemas['RecipeVariantSummary'];

/** A cell's state: placed there; fits now; fits once what is placed there is freed; never on that hardware. */
export type FitStatus = 'placed' | 'fits' | 'freed' | 'never';
export const STATUSES: FitStatus[] = ['fits', 'freed', 'never', 'placed'];
export const STATUS_SAID: Record<FitStatus, string> = { fits: 'fits now', freed: 'fits if freed', never: 'never', placed: 'placed' };

export type Capability = 'tools' | 'reasoning' | 'decision';
export const CAPABILITIES: Capability[] = ['tools', 'reasoning', 'decision'];

/** A node or a pair, as a fit is judged on it: its nodes joined by `+`. */
export function targetKey(nodes: readonly string[]): string {
  return nodes.join('+');
}

/** What a target is called: a node's id, or a pair's two. */
export function targetSaid(key: string): string {
  return key.split('+').join(' + ');
}

export function statusOf(c: TargetFit): FitStatus {
  if (c.placed) return 'placed';
  if (c.fits) return 'fits';
  if (c.fits_empty) return 'freed';
  return 'never';
}

/** Why a cell is as it is, for its hover: now, and with nothing placed when that differs. */
export function whyOf(c: TargetFit): string {
  const s = statusOf(c);
  if (s === 'placed') return `placed as ${c.placed}; ${c.reason}`;
  if (s === 'freed') return `${c.reason}. With nothing placed there it fits.`;
  if (s === 'never') return c.empty_reason ?? c.reason;
  return c.reason;
}

/** What is left of the room after placing it there now; null when it does not fit now. */
export function headroomOf(c: TargetFit): number | null {
  return c.fits && c.held_bytes != null ? c.room_bytes - c.held_bytes : null;
}

// ---- speed: tokens a second, one request at a time ------------------------

/** A number of tokens a second as said: whole, `<1` below one. */
function tps(n: number): string {
  return n < 1 ? '<1' : String(Math.round(n));
}

/**
 * A cell's speed as it reads in the table: a measured one plainly (`42
 * tok/s`), an estimate as one, with its range (`≈35–45 tok/s`); none ('')
 * where there is neither.
 */
export function speedSaid(c: TargetFit | undefined): string {
  const s = c?.speed;
  if (!s) return '';
  if (s.kind === 'measured') return `${tps(s.tps)} tok/s`;
  return s.low === s.high ? `≈${tps(s.low)} tok/s` : `≈${tps(s.low)}–${tps(s.high)} tok/s`;
}

const GB = 1e9;

/** A date, as the hover says it. */
const day = (iso: string | undefined) => (iso ? iso.slice(0, 10) : '?');

/** Its basis, for the hover: how it was measured or what it was estimated from; or why there is none. */
export function speedWhy(c: TargetFit | undefined): string {
  if (!c) return '';
  const s = c.speed;
  if (!s) return c.speed_unknown ? `No speed: ${c.speed_unknown}.` : '';
  const one = 'One request at a time, generating: not the prompt’s reading, nor what a seat serves to many at once.';
  if (s.kind === 'measured') {
    const n = s.requests ?? 0;
    return `Measured: the median of ${n} request${n === 1 ? '' : 's'} its seat here served whole, ${day(s.first_at)} to ${day(s.last_at)}; the middle half ${tps(s.low)}–${tps(s.high)} tok/s. Output tokens over generation time, past the first token. ${one}`;
  }
  const bw = s.bandwidth_low_gbps === s.bandwidth_high_gbps ? `${s.bandwidth_low_gbps}` : `${s.bandwidth_low_gbps}–${s.bandwidth_high_gbps}`;
  const pair = c.nodes.length > 1 ? ' Across two nodes it is rougher: the link costs each token, calibrated on one model.' : '';
  return `Estimated: ${bw} GB/s of memory bandwidth (${s.accelerator}) × ${s.efficiency_low}–${s.efficiency_high}% (the runtime's efficiency) ÷ ${((s.bytes_per_token ?? 0) / GB).toFixed(2)} GB of weights read a token.${pair} ${one}`;
}

/** The fastest of `cells` (all, or those of `scope`): a measured speed's median, an estimate's middle; null when none has one. */
export function fastestOf(cells: Map<string, TargetFit>, scope?: Set<string>): number | null {
  let best: number | null = null;
  for (const [key, cell] of cells) {
    if (scope && scope.size && !scope.has(key)) continue;
    if (cell.speed && (best == null || cell.speed.tps > best)) best = cell.speed.tps;
  }
  return best;
}

/** One recipe variant, judged on every target. */
export type FitRow = {
  key: string;
  recipe: RecipeSummary;
  variant: VariantSummary;
  /** Its judgment on each target, by `targetKey`. */
  cells: Map<string, TargetFit>;
  /** Where it fits best now: the most room left after it; else, where it would fit once freed, the most room then. */
  best?: { key: string; cell: TargetFit; status: FitStatus };
};

/** The best of `cells` (all, or those of `scope`): fits now with the most headroom, else fits once freed with the most room. */
export function bestOf(cells: Map<string, TargetFit>, scope?: Set<string>): FitRow['best'] {
  let best: FitRow['best'];
  let score = -Infinity;
  for (const [key, cell] of cells) {
    if (scope && scope.size && !scope.has(key)) continue;
    const st = statusOf(cell);
    // fits now, then placed, then once freed; within one, the most room left
    const rank = st === 'fits' ? 3 : st === 'placed' ? 2 : st === 'freed' ? 1 : 0;
    const room = st === 'fits' ? headroomOf(cell) ?? 0 : cell.room_empty_bytes - cell.need_bytes;
    const s = rank * 1e18 + room;
    if (rank > 0 && s > score) {
      score = s;
      best = { key, cell, status: st };
    }
  }
  return best;
}

/** The rows of `fits`, a recipe's variants together, in the order the api listed them. */
export function rowsOf(fits: RecipeFits): FitRow[] {
  const out: FitRow[] = [];
  for (const r of fits.data) {
    for (const v of r.variants) {
      const variant = r.recipe.variants.find((x) => x.id === v.variant);
      if (!variant) continue;
      const cells = new Map(v.on.map((c) => [targetKey(c.nodes), c] as const));
      out.push({ key: `${r.recipe.id}/${v.variant}`, recipe: r.recipe, variant, cells, best: bestOf(cells) });
    }
  }
  return out;
}

/** The targets a row is judged on: each node a model can be placed on, then each pair that can take one. */
export function targetsOf(fits: RecipeFits): string[] {
  return [
    ...fits.nodes.filter((n) => !n.problem).map((n) => n.node),
    ...fits.pairs.filter((p) => !p.problem).map((p) => targetKey(p.nodes)),
  ];
}

// ---- the view: sort and filters, kept in the URL --------------------------

export type SortKey = 'fit' | 'memory' | 'headroom' | 'speed' | 'size' | 'name';
export const SORTS: { value: SortKey; label: string }[] = [
  { value: 'fit', label: 'fits now first' },
  { value: 'headroom', label: 'headroom on the best' },
  { value: 'speed', label: 'speed, fastest first' },
  { value: 'memory', label: 'memory needed' },
  { value: 'size', label: 'size' },
  { value: 'name', label: 'name' },
];

export type FitView = {
  q: string;
  /** Targets in scope: only their cells count for the status, runtime, capability and downloaded filters. */
  on: string[];
  fit: FitStatus[];
  format: string[];
  runtime: string[];
  cap: Capability[];
  downloaded: boolean;
  sort: SortKey;
  desc: boolean;
};

export const DEFAULT_VIEW: FitView = { q: '', on: [], fit: [], format: [], runtime: [], cap: [], downloaded: false, sort: 'fit', desc: false };

const list = (v: string | null) => (v ? v.split(',').filter(Boolean) : []);
const sortKeys = new Set<string>(SORTS.map((s) => s.value));

/** The view a URL's query says; what it leaves out is the default. */
export function viewOf(query: URLSearchParams): FitView {
  const sort = query.get('sort') ?? '';
  return {
    q: query.get('q') ?? '',
    on: list(query.get('on')),
    fit: list(query.get('fit')).filter((s): s is FitStatus => (STATUSES as string[]).includes(s)),
    format: list(query.get('format')),
    runtime: list(query.get('runtime')),
    cap: list(query.get('cap')).filter((c): c is Capability => (CAPABILITIES as string[]).includes(c)),
    downloaded: query.get('downloaded') === '1',
    sort: sortKeys.has(sort) ? (sort as SortKey) : 'fit',
    desc: query.get('dir') === 'desc',
  };
}

/** The query that says `v`: only what differs from the default, so a plain view has a plain URL. */
export function queryOf(v: FitView): string {
  const q = new URLSearchParams();
  if (v.q) q.set('q', v.q);
  if (v.on.length) q.set('on', v.on.join(','));
  if (v.fit.length) q.set('fit', v.fit.join(','));
  if (v.format.length) q.set('format', v.format.join(','));
  if (v.runtime.length) q.set('runtime', v.runtime.join(','));
  if (v.cap.length) q.set('cap', v.cap.join(','));
  if (v.downloaded) q.set('downloaded', '1');
  if (v.sort !== 'fit') q.set('sort', v.sort);
  if (v.desc) q.set('dir', 'desc');
  // commas read plainly; a pair's `+` stays escaped, since a query reads a bare one as a space
  return q.toString().replace(/%2C/g, ',');
}

/** `xs` with `x` added, or taken out when it is there. */
export function toggled<T>(xs: T[], x: T): T[] {
  return xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x];
}

/** The cells of `row` in scope: those on the view's targets, or all. */
function scoped(row: FitRow, on: string[]): TargetFit[] {
  if (!on.length) return [...row.cells.values()];
  return on.map((k) => row.cells.get(k)).filter((c): c is TargetFit => !!c);
}

/** A row's best status among `cells`: fits now, placed, once freed, never. */
function bestStatus(cells: TargetFit[]): FitStatus {
  const order: FitStatus[] = ['fits', 'placed', 'freed', 'never'];
  let best = 3;
  for (const c of cells) best = Math.min(best, order.indexOf(statusOf(c)));
  return order[best]!;
}

/** Whether the variant's seat carries `cap` on any cell of `cells` that has a runtime (decision: its recipe's contract). */
function carries(row: FitRow, cells: TargetFit[], cap: Capability): boolean {
  if (cap === 'decision') return row.recipe.contract === 'decision';
  return cells.some((c) => !!c.runtime && c[cap]);
}

/** The rows `v` keeps. */
export function filterRows(rows: FitRow[], v: FitView): FitRow[] {
  const q = v.q.trim().toLowerCase();
  return rows.filter((row) => {
    const cells = scoped(row, v.on);
    if (v.on.length && !cells.length) return false;
    if (v.fit.length && !v.fit.includes(bestStatus(cells))) return false;
    if (v.format.length && !v.format.includes(row.variant.format)) return false;
    if (v.runtime.length && !cells.some((c) => c.runtime && v.runtime.includes(c.runtime))) return false;
    if (v.cap.some((c) => !carries(row, cells, c))) return false;
    if (v.downloaded && !cells.some((c) => c.downloaded)) return false;
    if (q) {
      const text = `${row.recipe.id} ${row.variant.id} ${row.variant.format} ${row.variant.quantization}`.toLowerCase();
      if (!q.split(/\s+/).every((w) => text.includes(w))) return false;
    }
    return true;
  });
}

/** A row's place in `sort`, ascending; ties go by name. */
function sortValue(row: FitRow, sort: SortKey, on: string[]): number {
  switch (sort) {
    case 'memory':
      return row.variant.memory_bytes;
    case 'size':
      return row.variant.total_bytes;
    case 'headroom': {
      const b = bestOf(row.cells, new Set(on));
      // the most headroom first when ascending: none (does not fit now) last
      const h = b && b.status === 'fits' ? headroomOf(b.cell) : null;
      return h == null ? Infinity : -h;
    }
    case 'speed': {
      // the fastest first when ascending: none (no speed there) last
      const f = fastestOf(row.cells, new Set(on));
      return f == null ? Infinity : -f;
    }
    case 'fit': {
      const order: FitStatus[] = ['fits', 'placed', 'freed', 'never'];
      return order.indexOf(bestStatus(scoped(row, on)));
    }
    default:
      return 0;
  }
}

const byName = (a: FitRow, b: FitRow) => a.recipe.id.localeCompare(b.recipe.id) || a.variant.id.localeCompare(b.variant.id);

/**
 * The rows in the view's order, a recipe's variants kept together: each
 * recipe placed by its first variant in that order, its variants in that
 * order beneath it. Descending turns the order over, names still A to Z
 * within a tie.
 */
export function sortRows(rows: FitRow[], v: Pick<FitView, 'sort' | 'desc' | 'on'>): FitRow[] {
  const sign = v.desc ? -1 : 1;
  const cmp = (a: FitRow, b: FitRow) => {
    if (v.sort === 'name') return sign * byName(a, b);
    const d = sortValue(a, v.sort, v.on) - sortValue(b, v.sort, v.on);
    return (Number.isNaN(d) ? 0 : sign * Math.sign(d)) || byName(a, b);
  };
  const ordered = [...rows].sort(cmp);
  const groups = new Map<string, FitRow[]>();
  for (const r of ordered) groups.set(r.recipe.id, [...(groups.get(r.recipe.id) ?? []), r]);
  return [...groups.values()].flat();
}

/** `rows` with each best fit among the view's targets only: what fits on gpu-box is placed on gpu-box. */
export function bestIn(rows: FitRow[], on: string[]): FitRow[] {
  if (!on.length) return rows;
  const scope = new Set(on);
  return rows.map((r) => ({ ...r, best: bestOf(r.cells, scope) }));
}

/** The formats and runtimes `rows` have, for the filters' choices. */
export function choicesOf(rows: FitRow[]): { formats: string[]; runtimes: string[] } {
  const formats = new Set<string>();
  const runtimes = new Set<string>();
  for (const r of rows) {
    formats.add(r.variant.format);
    for (const c of r.cells.values()) if (c.runtime) runtimes.add(c.runtime);
  }
  return { formats: [...formats].sort(), runtimes: [...runtimes].sort() };
}

/** The nodes that hold a row's files whole already. */
export function downloadedOn(row: FitRow): string[] {
  return [...row.cells.entries()].filter(([k, c]) => !k.includes('+') && c.downloaded).map(([k]) => k);
}
