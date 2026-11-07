import type { Placement, SeatSummary, Schemas } from '../api/client';

type Download = Schemas['NodeDownload'];

/**
 * A model on a node, as its page leads with it: one a seat serves here
 * (`seat`), with the placement it is (when it is one) and what the disk
 * holds of it; or a variant the disk holds that no seat here serves.
 */
export type NodeModel = {
  key: string;
  model: string;
  seat?: SeatSummary;
  placement?: Placement;
  /** Across two nodes: this node leads (`leader`), or runs the other half. */
  part?: 'leader' | 'follower';
  download?: Download;
};

/**
 * What node `node` runs and holds, model by model: each seat, the models
 * it serves (a placement's when it serves none by name); then each variant
 * on the disk that no seat here serves, as `listNodeDownloads` lists them.
 */
export function nodeModels(node: string, seats: SeatSummary[], placements: Placement[], downloads: Download[]): NodeModel[] {
  const here = placements.filter((p) => p.nodes.includes(node));
  const out: NodeModel[] = [];
  for (const s of seats) {
    const p = here.find((x) => x.id === s.id);
    const named = s.serves.map((m) => (m.as ? `${m.model} as ${m.as}` : m.model));
    out.push({
      key: `seat ${s.id}`,
      model: named.length ? named.join(', ') : p?.model ?? s.id,
      seat: s,
      placement: p,
      part: p && p.nodes.length > 1 ? (p.leader === node ? 'leader' : 'follower') : undefined,
      download: p ? downloads.find((v) => v.placed === p.id || (v.recipe === p.recipe && v.variant === p.variant)) : undefined,
    });
  }
  const served = new Set(out.map((r) => r.download).filter(Boolean));
  for (const v of downloads) {
    if (served.has(v)) continue;
    out.push({ key: `held ${v.recipe} ${v.variant}`, model: v.recipe, placement: v.placed ? here.find((p) => p.id === v.placed) : undefined, download: v });
  }
  return out;
}

/** What the disk holds of a model's variant: its size, or how far along. */
export function heldSaid(v: Download | undefined): string {
  if (!v) return '';
  if (v.complete) return 'whole';
  return `${Math.floor((100 * v.bytes_held) / Math.max(1, v.bytes))}%`;
}
