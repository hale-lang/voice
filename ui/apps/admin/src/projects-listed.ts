/**
 * The projects a list or a picker offers. Voice's retired system project
 * (`internal`, archived: where voice once made its own requests) is no
 * caller's, so it is left out unless asked for. A store keeps it only where
 * something was recorded under it, so where it is listed it has history:
 * the Projects screen shows it on asking, and a choice already made of it
 * (a selected row, a filter in force) stays.
 */
type Listed = { id: string; status: string; internal?: boolean };

/** Voice's retired system project: internal and archived. */
export const isRetiredSystem = (p: Listed): boolean => p.internal === true && p.status === 'archived';

export function listedProjects<P extends Listed>(all: P[], opts: { showRetired?: boolean; chosen?: string } = {}): P[] {
  return all.filter((p) => !isRetiredSystem(p) || opts.showRetired || (opts.chosen !== undefined && opts.chosen !== '' && p.id === opts.chosen));
}
