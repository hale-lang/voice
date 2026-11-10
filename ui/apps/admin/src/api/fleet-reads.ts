import type { NodeSummary } from './client';

/**
 * The reads a change of the fleet makes stale beyond its own resource: the
 * saved arrangements, each of which says whether the fleet has changed
 * since it was last planned (`Arrangement.fleet_changed`, over the nodes
 * that can take a model, what is placed and the links checked).
 */
export const ARRANGEMENTS = '/admin/v1/arrangements';

/**
 * A node's capacity: the sum of its seats' concurrency (a placement's
 * seat's, what its runtime is started with, as the api says it). A node
 * has no in-flight cap of its own.
 */
export function capacityOf(node: { seats: { concurrency?: number }[] }): number {
  return node.seats.reduce((sum, s) => sum + (s.concurrency ?? 1), 0);
}

/** The node reads derived from the recipe set (`listNodeDownloads`, `suggestNodeModels`). */
export const RECIPE_READS = ['/admin/v1/nodes/{node}/downloads', '/admin/v1/nodes/{node}/suggestions'];

/**
 * What a change of `target` (a change's resource path, `placements/x`)
 * makes stale: its top-level list; a recipe's, what each node holds and is
 * suggested, read against every recipe; a node's or a placement's, the
 * saved arrangements' `fleet_changed`.
 */
export function changeReads(target: string): string[] {
  const top = target.split('/')[0];
  if (!top) return [];
  const out = [`/admin/v1/${top}`];
  if (top === 'recipes') out.push(...RECIPE_READS);
  if (top === 'nodes' || top === 'placements') out.push(ARRANGEMENTS);
  return out;
}

/**
 * Whether a node's report (`NodeObserved`) may change the fleet a saved
 * arrangement was planned against: a node new to the list, one whose state
 * or seats changed. A heartbeat, a seat's load or a request in flight does
 * not (#173: no read again on a heartbeat-only report).
 */
export function fleetMoved(before: NodeSummary | undefined, node: NodeSummary): boolean {
  if (!before) return true;
  if (before.status !== node.status) return true;
  const seats = (n: NodeSummary) => n.seats.map((s) => s.id).join(',');
  return seats(before) !== seats(node);
}
