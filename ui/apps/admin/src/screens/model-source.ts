/**
 * Where a catalog model comes from, read off what serves it: no field of
 * the api says it, so it is derived here from the seats that serve it and
 * the kind of engine each runs (its node's declared capabilities), and from
 * the placements of it.
 *
 * - a placement's seat (a managed engine): `local`, weights on voice's nodes;
 * - a `claude-cli` seat: `subscription`, a CLI under an account's login;
 * - an `openai-compatible` seat: `api`, a remote endpoint with a key;
 * - a `static` seat: `static`, voice's test engine.
 */
export type Source = 'local' | 'subscription' | 'api' | 'static';

/** The order sources are listed in, when several serve one model. */
const ORDER: Source[] = ['local', 'subscription', 'api', 'static'];

/** A seat as a node's summary carries it, as far as a model's source reads it. */
export type SeatInfo = {
  ref: string;
  node: string;
  id: string;
  engine: string;
  account: string;
  status?: string;
  in_flight?: number;
  placement?: string | null;
};

/** A placement, as far as a model's source reads it. */
export type PlacementInfo = { id: string; model: string; nodes: string[]; account: string };

/** The engine kind a node declares for an engine id; undefined until the node says. */
export type EngineKindOf = (node: string, engine: string) => string | undefined;

/** The source a seat gives a model, or undefined for an engine of a kind voice does not name here. */
export function seatSource(s: SeatInfo, kindOf: EngineKindOf): Source | undefined {
  if (s.placement) return 'local';
  const kind = kindOf(s.node, s.engine);
  if (kind === 'managed') return 'local';
  if (kind === 'claude-cli') return 'subscription';
  if (kind === 'openai-compatible') return 'api';
  if (kind === 'static') return 'static';
  return undefined;
}

/** Where a row opens: its placement (local), else its first seat. */
export type Target = { kind: 'placement'; id: string } | { kind: 'seat'; node: string; seat: string } | null;

/** One row of the Models screen, as far as it is derived. */
export type ModelSource = {
  /** Every source that serves it, in `ORDER`; empty when nothing does. */
  sources: Source[];
  /** The accounts its seats (or placements) spend. */
  accounts: string[];
  /** The nodes it is served on. */
  nodes: string[];
  /** Requests in flight on its seats, as their nodes last reported. */
  inFlight: number;
  /** Served on a subscription alone: flat-rate, whatever its price says. */
  flatRate: boolean;
  target: Target;
};

/**
 * A model's source, accounts, nodes and where it opens, from the seats
 * that serve it (`seatAt` each of its `seats`) and its placements. A model
 * placed but with no seat yet is local; one with a recipe and no
 * placement is local too, not served yet.
 */
export function modelSource(
  m: { id: string; seats: string[]; recipe?: string | null },
  seatAt: (ref: string) => SeatInfo | undefined,
  kindOf: EngineKindOf,
  placements: PlacementInfo[],
): ModelSource {
  const seats = m.seats.map(seatAt).filter((s): s is SeatInfo => !!s);
  const mine = placements.filter((p) => p.model === m.id);
  const found = new Set<Source>();
  for (const s of seats) {
    const src = seatSource(s, kindOf);
    if (src) found.add(src);
  }
  if (mine.length > 0 || (found.size === 0 && seats.length === 0 && m.recipe)) found.add('local');
  const sources = ORDER.filter((s) => found.has(s));
  const accounts = unique([...seats.map((s) => s.account), ...mine.map((p) => p.account)]);
  const nodes = unique([...seats.map((s) => s.node), ...mine.flatMap((p) => p.nodes)]);
  const first = seats[0];
  const target: Target = mine[0]
    ? { kind: 'placement', id: mine[0].id }
    : first
      ? { kind: 'seat', node: first.node, seat: first.id }
      : null;
  return {
    sources,
    accounts,
    nodes,
    inFlight: seats.reduce((n, s) => n + (s.in_flight ?? 0), 0),
    flatRate: sources.length === 1 && sources[0] === 'subscription',
    target,
  };
}

/** What a source is called on screen. */
export function sourceLabel(s: Source): string {
  return s === 'static' ? 'static (test)' : s;
}

function unique(xs: string[]): string[] {
  return [...new Set(xs.filter(Boolean))];
}
