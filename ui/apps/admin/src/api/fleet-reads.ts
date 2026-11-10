import type { NodeSummary } from './client';

/**
 * The reads a change of the fleet makes stale beyond its own resource: the
 * saved arrangements, each of which says whether the fleet has changed
 * since it was last planned (`Arrangement.fleet_changed`, over the nodes
 * that can take a model, what is placed and the links checked).
 */
export const ARRANGEMENTS = '/admin/v1/arrangements';

/**
 * How every recipe fits the fleet (`listRecipeFits`): read again when a
 * recipe, a runtime, a placement or a node changes, and when a node's
 * report changes what it holds, its seats, its state or its hardware.
 */
export const FITS = '/admin/v1/recipe-fits';

/** The reads derived from the recipe set (`listNodeDownloads`, `suggestNodeModels`, `listRecipeFits`). */
export const RECIPE_READS = ['/admin/v1/nodes/{node}/downloads', '/admin/v1/nodes/{node}/suggestions', FITS];

/**
 * What a change of `target` (a change's resource path, `placements/x`)
 * makes stale: its top-level list; a recipe's, what each node holds and is
 * suggested and how every recipe fits, read against every recipe; a node's
 * or a placement's, the saved arrangements' `fleet_changed` and the fits;
 * a runtime's, the fits.
 */
export function changeReads(target: string): string[] {
  const top = target.split('/')[0];
  if (!top) return [];
  const out = [`/admin/v1/${top}`];
  if (top === 'recipes') out.push(...RECIPE_READS);
  if (top === 'nodes' || top === 'placements') out.push(ARRANGEMENTS, FITS);
  if (top === 'runtimes') out.push(FITS);
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

/**
 * Whether a node's report (`NodeObserved`) may change how a recipe fits:
 * a node new to the list, its state or seats changed (`fleetMoved`), what
 * its store holds (a download finished), or its hardware (the memory and
 * disk it has free). A heartbeat, a seat's load or a request in flight
 * does not.
 */
export function fitsMoved(before: NodeSummary | undefined, node: NodeSummary): boolean {
  if (fleetMoved(before, node)) return true;
  const stored = (n: NodeSummary) => (n.downloaded ? `${n.downloaded.files}/${n.downloaded.bytes}` : '');
  return stored(before!) !== stored(node) || JSON.stringify(before!.hardware ?? null) !== JSON.stringify(node.hardware ?? null);
}
