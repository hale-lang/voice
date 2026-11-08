import { bytes } from '@hale/components/src/format.ts';

/** A seat as its node reports it, as far as a placement's state reads it. */
export type SeatReport = {
  ref: string;
  node: string;
  status: string;
  reason?: string | null;
  progress?: { done_bytes: number; total_bytes: number } | null;
};

/** What a placement's state is read from: its leader's seat, and across two nodes its follower's. */
export type PlacementSeats = { seat: string; follower_seat?: string | null };

/**
 * A placement's state, as one line: `up`, its leader serving; `starting`,
 * every seat up or on its way (pending, fetching, loading the model), and
 * how far; `stopped`, nothing coming up (a seat missing, down, refused,
 * paused, disabled, or its node offline), with why.
 */
export type PlacementState = { state: 'up' | 'starting' | 'stopped'; label: string; detail: string };

/** What a model no seat serves is called: always said with why. */
export const NO_SEAT = 'no seat serves this';

/** Statuses on the way to `up`. */
const COMING = new Set(['pending', 'fetching', 'starting']);

/**
 * The state of a placement's seats, from its nodes' reports. Nodes report
 * no time a seat entered its state, so a start says how far it is, not
 * for how long.
 */
export function placementState(p: PlacementSeats, seatAt: (ref: string) => SeatReport | undefined): PlacementState {
  const refs = [p.seat, ...(p.follower_seat ? [p.follower_seat] : [])];
  const seats = refs.map((ref) => ({ ref, s: seatAt(ref) }));
  const up = seats.filter((x) => x.s?.status === 'up').length;
  if (up === seats.length) {
    return { state: 'up', label: 'up', detail: seats.length > 1 ? `${up} of ${seats.length} seats up` : '' };
  }
  // the leader is the seat that serves: up, it serves, whatever its follower reports
  if (seats[0]!.s?.status === 'up') {
    const f = seats[1]!;
    return { state: 'up', label: 'up', detail: `follower ${f.s && COMING.has(f.s.status) ? comingUp(f.s) : whyStopped(f.ref, f.s)}` };
  }
  const stopped = seats.filter((x) => !x.s || (!COMING.has(x.s.status) && x.s.status !== 'up'));
  if (stopped.length > 0) {
    return { state: 'stopped', label: NO_SEAT, detail: stopped.map((x) => whyStopped(x.ref, x.s)).join('; ') };
  }
  const coming = seats.filter((x) => x.s!.status !== 'up').map((x) => comingUp(x.s!));
  const ups = seats.length > 1 ? `${up} of ${seats.length} seats up · ` : '';
  return { state: 'starting', label: 'starting', detail: `${ups}${coming.join(', ')}` };
}

/** A seat on its way up, in words: "spark fetching 42 of 167 GiB", "spark loading the model". */
function comingUp(s: SeatReport): string {
  if (s.status === 'fetching') {
    const p = s.progress;
    return p && p.total_bytes > 0 ? `${s.node} fetching ${fetched(p.done_bytes, p.total_bytes)}` : `${s.node} fetching`;
  }
  if (s.status === 'starting') return `${s.node} loading the model`;
  return `${s.node} yet to take it up`;
}

/** "42 of 167 GiB", or "512 MiB of 167 GiB" when their units differ. */
function fetched(done: number, total: number): string {
  const d = bytes(done);
  const t = bytes(total);
  const [dn, du] = d.split(' ');
  return du === t.split(' ')[1] ? `${dn} of ${t}` : `${d} of ${t}`;
}

/** Why a seat serves nothing and is not coming up. */
function whyStopped(ref: string, s: SeatReport | undefined): string {
  if (!s) return `${ref} is not on its node`;
  if (s.status === 'offline') return `${s.node} is offline`;
  if (s.status === 'up') return `${ref} up, but takes no requests: its node draining or its account archived`;
  return `${s.ref} ${s.status}${s.reason ? `: ${s.reason}` : ''}`;
}

/**
 * Why a catalog model is not available, or that it is on its way: a
 * placement of it, or a seat assigned it, starting says how far; else no
 * seat serves it, and why (none assigned, or what its seats report). Null
 * when it is available.
 */
export function modelState(
  m: { id: string; available: boolean; seats: string[] },
  placements: (PlacementSeats & { model: string })[],
  seatAt: (ref: string) => SeatReport | undefined,
): PlacementState | null {
  if (m.available) return null;
  const mine = placements.filter((p) => p.model === m.id);
  const states = mine.map((p) => placementState(p, seatAt));
  const starting = states.find((s) => s.state === 'starting');
  if (starting) return starting;
  // a seat assigned it by hand, not by a placement
  const placedRefs = new Set(mine.flatMap((p) => [p.seat, ...(p.follower_seat ? [p.follower_seat] : [])]));
  const others = m.seats.filter((ref) => !placedRefs.has(ref)).map((ref) => ({ ref, s: seatAt(ref) }));
  const coming = others.filter((x) => x.s && COMING.has(x.s.status));
  if (coming.length > 0) return { state: 'starting', label: 'starting', detail: coming.map((x) => comingUp(x.s!)).join(', ') };
  if (mine.length === 0 && others.length === 0) return { state: 'stopped', label: NO_SEAT, detail: 'none is assigned: place it on a node' };
  const why = [
    ...states.map((s) => (s.state === 'stopped' ? s.detail : 'its placement is up, but takes no requests: its node draining or its account archived')),
    ...others.map((x) => whyStopped(x.ref, x.s)),
  ];
  return { state: 'stopped', label: NO_SEAT, detail: why.join('; ') };
}
