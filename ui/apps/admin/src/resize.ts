/**
 * The event log's height: how tall its body is when open, and how a drag or
 * a key changes it. Folded, the log is its title bar alone; open, its body
 * is between MIN and the room the viewport leaves for it.
 */

/** The shortest open body: two lines and a little. */
export const MIN = 48;

/** The body when nothing has been chosen. */
export const DEFAULT = 148;

/** A key's step, and with Shift held. */
export const STEP = 16;
export const BIG_STEP = 64;

/** How much of the page above the log stays in view, however tall the log. */
export const KEEP = 120;

/** The tallest open body in a viewport `viewport` px tall: three quarters of it. */
export function maxHeight(viewport: number): number {
  return Math.max(MIN, Math.round(viewport * 0.75) - 24);
}

/**
 * The tallest open body as the screen is laid out: the body and the page
 * above it share the room the screen leaves them (a rail stacked above, on a
 * phone, takes its share first), and the page keeps KEEP of it; never more
 * than maxHeight. `body` is the body's height now (0 folded), `page` the
 * page's.
 */
export function room(viewport: number, body: number, page: number): number {
  return Math.max(MIN, Math.min(maxHeight(viewport), Math.round(body + page - KEEP)));
}

/** `h` held to MIN..max. */
export function clamp(h: number, max: number): number {
  return Math.min(max, Math.max(MIN, Math.round(h)));
}

/** The log as a height: open with its body that tall, or folded. */
export type Size = { open: boolean; height: number };

/**
 * Where a drag that began at `start` leaves the log, `dy` px upward of
 * where it began. Pulled below half of MIN, it folds, keeping the height it
 * opens to again.
 */
export function dragged(start: Size, dy: number, max: number): Size {
  const from = start.open ? start.height : 0;
  const next = from + dy;
  if (next < MIN / 2) return { open: false, height: start.height };
  return { open: true, height: clamp(next, max) };
}

/**
 * What a key on the handle does: arrows step (Shift for bigger steps; down
 * past MIN folds it), Home folds, End opens it to the most; null for any
 * other key.
 */
export function keyed(key: string, shift: boolean, now: Size, max: number): Size | null {
  const step = shift ? BIG_STEP : STEP;
  const from = now.open ? now.height : 0;
  switch (key) {
    case 'ArrowUp':
      // folded, it opens to the height it had
      return { open: true, height: clamp(now.open ? now.height + step : now.height, max) };
    case 'ArrowDown':
      if (!now.open) return now;
      return from - step < MIN ? { open: false, height: now.height } : { open: true, height: clamp(from - step, max) };
    case 'Home':
      return { open: false, height: now.height };
    case 'End':
      return { open: true, height: max };
    default:
      return null;
  }
}
