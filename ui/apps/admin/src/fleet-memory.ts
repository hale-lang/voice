import type { MemoryMark, MemoryModel } from '@hale/components';
import type { NodeSummary, Placement, Schemas } from './api/client';

type Plan = Schemas['ArrangementPlan'];
type LinkCheck = Schemas['LinkCheck'];

/**
 * The fleet's memory for models, as the node cards draw it: each node's
 * machine and budget (its hardware, as it measured it), and each placement
 * on it with what it holds there (the api's `held_bytes`); beside a plan,
 * what the plan keeps, removes and adds. Pure: the cards' cells are laid
 * out by `@hale/components`' memory layout.
 */

/** A node as its card heads it. */
export type FleetNode = {
  id: string;
  name?: string;
  status: NodeSummary['status'];
  /** Its accelerator, as it named it; several of one kind counted. */
  accelerator?: string;
  /** The memory its models are served from (`modelMemory`: the machine's, or a GPU's own), and what models may use of it; left out until it measured them. */
  memoryBytes?: number;
  budgetBytes?: number;
};

/** A placement, now or as a plan has it: what it holds on each of its nodes. */
export type FleetBlock = {
  /** The placement's id, or the id a plan would place it as. */
  key: string;
  model: string;
  recipe?: string;
  variant?: string;
  runtime?: string;
  /** Its nodes, its leader first. */
  nodes: string[];
  /** What it holds of each of its nodes' memory for models, as the api counts it; 0 when it did not say. */
  heldBytes: number;
  /** Of that, what is reserved for it (weights and cache); the rest is its server's own. */
  reservedBytes?: number;
  /** The wants it serves, as a plan names them. */
  serves: string[];
  /** The aliases a plan points at its model. */
  aliases: string[];
  /** Why the plan keeps, removes or adds it there. */
  why?: string;
  mark?: MemoryMark;
};

/** A model split across two nodes, and the link it runs over. */
export type FleetPair = { key: string; nodes: [string, string]; link?: LinkCheck };

/** A want a plan leaves unfilled, and the least it would hold on a node. */
export type FleetUnmet = { want: string; reason: string; needBytes?: number };

/**
 * An accelerator's name as a person reads it. A node names an AMD or Intel
 * card as it is sold (node/hardware.hl); one older than that may still
 * send `lspci`'s whole line (`03:00.0 VGA compatible controller: Advanced
 * Micro Devices, Inc. [AMD/ATI] Navi 48 [Radeon RX 9070/9070 XT/9070 GRE]
 * (rev c0)`), shortened here the same way: its last bracketed name not the
 * vendor's own, the first it lists, led by the vendor (`AMD Radeon RX
 * 9070`). Any other name is left as it is.
 */
export function acceleratorName(name: string): string {
  const raw = name.trim();
  if (!/^([0-9a-f]{4}:)?[0-9a-f]{2}:[0-9a-f]{2}\.[0-9a-f]\s/i.test(raw) && !/ controller: /.test(raw)) return name;
  const desc = raw.slice(raw.indexOf(': ') + 2).replace(/\s*\(rev [^)]*\)\s*$/, '');
  const brand = /^Advanced Micro Devices|^AMD\b/.test(desc) ? 'AMD' : /^Intel\b/.test(desc) ? 'Intel' : /^NVIDIA\b/.test(desc) ? 'NVIDIA' : '';
  const marked = [...desc.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]!.trim()).filter((x) => x && !/^(AMD\/ATI|AMD|ATI)$/.test(x));
  const sold = marked.length ? marked[marked.length - 1]!.split('/')[0]!.trim() : '';
  if (!sold) return brand ? `${brand} GPU` : desc;
  return brand && !sold.startsWith(`${brand} `) ? `${brand} ${sold}` : sold;
}

/**
 * The memory a node's models are served from, as placement judges it
 * (api/placements.hl `models_memory`): on a GPU with memory of its own
 * (not `unified`), the first the node lists, that GPU's, and what models
 * may use of it no more than what the node offers them; otherwise the
 * machine's, and what the node offers (`model_memory_bytes`). Voice serves
 * a model on a node's GPU before its processors, so a card draws that.
 */
export function modelMemory(hw: Schemas['Hardware']): { totalBytes: number; budgetBytes: number; gpu: boolean } {
  const card = hw.accelerators[0];
  if (card && !card.unified && card.memory_bytes > 0) {
    return { totalBytes: card.memory_bytes, budgetBytes: Math.min(hw.model_memory_bytes, card.memory_bytes), gpu: true };
  }
  return { totalBytes: hw.memory_bytes, budgetBytes: hw.model_memory_bytes, gpu: false };
}

/** The nodes models are placed on: those not revoked, in the order of their ids. */
export function fleetNodes(nodes: NodeSummary[]): FleetNode[] {
  return nodes
    .filter((n) => n.status !== 'revoked')
    .map((n) => {
      const hw = n.hardware;
      const acc = hw?.accelerators ?? [];
      const names = [...new Set(acc.filter((a) => a.kind !== 'vulkan' || acc.length === 1).map((a) => acceleratorName(a.name)))];
      const accelerator = names.length === 0 ? undefined : names.map((x) => {
        const k = acc.filter((a) => acceleratorName(a.name) === x && (a.kind !== 'vulkan' || acc.length === 1)).length;
        return k > 1 ? `${k}× ${x}` : x;
      }).join(' + ');
      const m = hw ? modelMemory(hw) : undefined;
      return { id: n.id, name: n.name ?? undefined, status: n.status, accelerator, memoryBytes: m?.totalBytes, budgetBytes: m?.budgetBytes };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * A node's name as its card says it beside its id: without the parts of it
 * that only repeat the id (`Spark 2 · flare` on `flare` is `Spark 2`), and
 * nothing when it is the id.
 */
export function nameBeside(n: { id: string; name?: string }): string {
  return (n.name ?? '').split(' · ').map((x) => x.trim()).filter((x) => x && x !== n.id).join(' · ');
}

/** What is placed now, a block a placement. */
export function placedBlocks(placements: Placement[]): FleetBlock[] {
  return placements.map((p) => ({
    key: p.id,
    model: p.model,
    recipe: p.recipe,
    variant: p.variant,
    runtime: p.runtime,
    nodes: p.nodes,
    heldBytes: p.held_bytes ?? 0,
    reservedBytes: p.reserved_bytes,
    serves: [],
    aliases: [],
  }));
}

/**
 * What `plan` places: the placements it keeps and removes (`placements`
 * tells their variant and what is reserved for them), and those it adds;
 * each with the wants it serves, the aliases its roles point at it, and
 * why it is there.
 */
export function plannedBlocks(plan: Plan, placements: Placement[]): FleetBlock[] {
  const aliases = (model: string) => plan.aliases.filter((a) => a.model === model).map((a) => a.alias);
  const placed = (id: string) => placements.find((p) => p.id === id);
  return [
    ...plan.keep.map((k): FleetBlock => {
      const p = placed(k.placement);
      return { key: k.placement, model: k.model, recipe: k.recipe, variant: p?.variant, runtime: p?.runtime, nodes: k.nodes, heldBytes: k.held_bytes, reservedBytes: p?.reserved_bytes, serves: k.serves, aliases: aliases(k.model), why: k.reason, mark: 'kept' };
    }),
    ...plan.remove.map((r): FleetBlock => {
      const p = placed(r.placement);
      return { key: r.placement, model: r.model, recipe: r.recipe, variant: p?.variant, runtime: p?.runtime, nodes: r.nodes, heldBytes: r.held_bytes, reservedBytes: p?.reserved_bytes, serves: [], aliases: [], why: r.reason, mark: 'removed' };
    }),
    ...plan.add.map((a): FleetBlock => ({
      key: a.placement, model: a.model, recipe: a.recipe, variant: a.variant, runtime: a.runtime, nodes: a.nodes, heldBytes: a.held_bytes, reservedBytes: a.reserved_bytes, serves: a.serves, aliases: aliases(a.model), why: a.reason, mark: 'added',
    })),
  ];
}

/** What a plan leaves unfilled, with the least each would hold. */
export function unmetOf(plan: Plan): FleetUnmet[] {
  return plan.unmet.map((u) => ({ want: u.want, reason: u.reason, needBytes: u.need_bytes }));
}

/**
 * Node `node`'s memory as a card draws it from `blocks`, or nothing when
 * the node has not measured its machine. Beside a plan (`kept` given),
 * the blocks the plan keeps come first, so they hold the same cells now and
 * in the plan; the rest follow, the larger first.
 */
export function memoryOf(node: FleetNode, blocks: FleetBlock[], kept?: Set<string>): MemoryModel | null {
  if (node.memoryBytes == null || node.budgetBytes == null) return null;
  const here = blocks.filter((b) => b.nodes.includes(node.id));
  const rank = (b: FleetBlock) => (kept ? (kept.has(b.key) ? 0 : 1) : 0);
  const ordered = [...here].sort((a, b) => rank(a) - rank(b) || b.heldBytes - a.heldBytes || a.key.localeCompare(b.key));
  return {
    totalBytes: node.memoryBytes,
    budgetBytes: node.budgetBytes,
    blocks: ordered.map((b) => ({ key: b.key, label: b.model, bytes: b.heldBytes, coreBytes: b.reservedBytes, mark: b.mark })),
  };
}

/** The placements across two nodes among `blocks`, each with its link's latest check from `links`. */
export function pairsOf(blocks: FleetBlock[], links: (a: string, b: string) => LinkCheck | undefined = () => undefined): FleetPair[] {
  return blocks
    .filter((b) => b.nodes.length === 2 && b.mark !== 'removed')
    .map((b) => ({ key: b.key, nodes: [b.nodes[0]!, b.nodes[1]!] as [string, string], link: links(b.nodes[0]!, b.nodes[1]!) }));
}

/**
 * The nodes in the order their cards are laid out: each by its id, and a
 * node a pair joins to another beside it, so the pair's bracket spans
 * them. Pairs of either state count, so a card stays put as the view
 * turns from now to the plan.
 */
export function cardGroups(nodes: FleetNode[], pairs: FleetPair[]): string[][] {
  const partner = new Map<string, Set<string>>();
  for (const p of pairs) {
    const [a, b] = p.nodes;
    if (!nodes.some((n) => n.id === a) || !nodes.some((n) => n.id === b)) continue;
    partner.set(a, (partner.get(a) ?? new Set()).add(b));
    partner.set(b, (partner.get(b) ?? new Set()).add(a));
  }
  const placed = new Set<string>();
  const out: string[][] = [];
  for (const n of nodes) {
    if (placed.has(n.id)) continue;
    const group: string[] = [];
    const walk = [n.id];
    while (walk.length) {
      const id = walk.shift()!;
      if (placed.has(id)) continue;
      placed.add(id);
      group.push(id);
      for (const p of [...(partner.get(id) ?? [])].sort()) walk.push(p);
    }
    out.push(group);
  }
  return out;
}

/** A link's speed as a pair's bracket says it. */
export function linkSaid(c: LinkCheck | undefined): string {
  if (!c) return 'link not checked';
  if (c.status !== 'passed') return `link check ${c.status}`;
  const gb = c.bus_bytes_per_second != null ? `${(c.bus_bytes_per_second / 1e9).toFixed(1)} GB/s` : 'passed';
  return `${gb} checked${c.degraded ? ', degraded' : ''}`;
}
