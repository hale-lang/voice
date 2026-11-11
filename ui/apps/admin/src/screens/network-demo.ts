import type { NodeSummary, Placement, SeatSummary } from '../api/client';
import type { Fleet, FleetRequest } from './network-model';

// Repository is caller metadata on demo requests, not a field on Voice's Project.
const PROJECTS = [
  ['research', 'hale-lang/hale'], ['product', 'hale-lang/voice'], ['automation', 'homelab'],
  ['compiler', 'hale-lang/hale'], ['admin', 'hale-lang/voice'], ['infrastructure', 'homelab'],
  ['evals', 'hale-lang/hale'],
] as const;
// Names two projects give models: their requests for those models ask by the name.
const ALIASES: Record<string, { name: string; model: string }[]> = {
  product: [{ name: 'coding', model: 'qwen-coder-32b' }],
  research: [{ name: 'reasoning', model: 'deepseek-r1-q4' }],
  infrastructure: [{ name: 'big', model: 'deepseek-v4' }],
};
export const DEMO_TICK_MS = 1800;
// each project's path colour: the theme's vivid tokens, so the paths follow the theme
const PROJECT_COLORS = ['lime', 'cyan', 'magenta', 'orange', 'violet', 'mint', 'pink'].map((c) => `var(--color-vivid-${c})`);
export const demoProjectColor = (project: string) => PROJECT_COLORS[Math.max(0, PROJECTS.findIndex(([id]) => id === project))]!;

/** Explicitly synthetic, local-only fixture. Model names are illustrative catalog aliases. */
export function demoFleet(tick: number, now: number): Fleet {
  // Placement follows the homelab profile. Catalog entries are alternatives,
  // not a claim that all weights are loaded at once; q4 names denote demo quantizations.
  const definitions = [
    ['studio1', [['mlx', 'local', ['qwen-235b-q4', 'llama-70b']]]],
    ['h2', [['claude-cli', 'claude-personal', ['sonnet', 'haiku', 'opus', 'sonnet-thinking']], ['agy', 'agy', ['gemini-pro', 'gemini-flash', 'gemini-flash-lite', 'gemini-thinking']], ['vibe', 'vibe', ['devstral', 'codestral', 'mistral-large', 'mistral-small']], ['llama-cpp', 'local', ['llama-8b', 'qwen-7b']]]],
    ['m1', [['mlx', 'local', ['qwen-32b', 'qwen-coder-32b']]]],
    ['h1', [['claude-cli', 'claude-work', ['sonnet', 'haiku', 'opus', 'sonnet-thinking']], ['codex-cli', 'openai', ['gpt-codex', 'gpt-mini', 'gpt-reasoning', 'gpt-fast']], ['llama-cpp', 'local', ['llama-3b', 'qwen-7b']]]],
    ['studio2', [['mlx', 'local', ['deepseek-r1-q4', 'qwen-235b-q4']], ['mlx', 'local', ['llama-70b']]]],
    ['studio3', [['mlx', 'local', ['llama-70b', 'qwen-coder-32b']]]],
  ] as const;
  const names = { studio1: 'Studio 1 · 256 GB profile', studio2: 'Studio 2 · 512 GB profile', studio3: 'Studio 3 · 128 GB profile', m1: 'M1 Max · 64 GB profile', h1: 'H1 · small local models and CLIs', h2: 'H2 · small local models and CLIs' };
  const nodes: NodeSummary[] = definitions.map(([id, slots], index) => {
    const seats: SeatSummary[] = slots.map(([engine, account, models], j) => ({ id: `seat-${j + 1}`, ref: `${id}/seat-${j + 1}`, node: id, engine, account, data_classes: ['internal'], serves: models.map(model => ({ model })), status: index === 4 && j === 1 ? 'paused' : 'up', in_flight: 0, concurrency: 3, enabled: true, problems: [], reason: index === 4 && j === 1 ? 'Paused by the machine operator.' : null }));
    return { id, name: names[id], status: 'up', seats, in_flight: 0, assignment_version: 7, applied_version: 7, last_heartbeat_at: new Date(now - 2000).toISOString(), created_at: new Date(now - 86400000).toISOString() };
  });
  // two GPU hosts cabled together: one model placed across both (its
  // leader's seat takes the requests, its follower's computes half of each),
  // and a model of its own beside it on the first
  const placements = pairPlacements(now);
  const seatOf = (p: Placement, node: string, ref: string): SeatSummary => ({ id: p.id, ref, node, engine: 'managed', account: p.account, data_classes: ['internal'], serves: [{ model: p.model }], status: 'up', in_flight: 0, concurrency: 4, enabled: true, problems: [], reason: null, placement: p.id, runtime: p.runtime, variant: p.variant });
  const [pair, alone] = placements as [Placement, Placement];
  for (const [id, name] of [['gpu-a', 'GPU A · 128 GB unified, cabled to GPU B'], ['gpu-b', 'GPU B · 128 GB unified, cabled to GPU A']] as const) {
    const seats = id === 'gpu-a' ? [seatOf(pair, id, pair.seat), seatOf(alone, id, alone.seat)] : [seatOf(pair, id, pair.follower_seat!)];
    nodes.push({ id, name, status: 'up', seats, in_flight: 0, assignment_version: 7, applied_version: 7, last_heartbeat_at: new Date(now - 2000).toISOString(), created_at: new Date(now - 86400000).toISOString() });
  }
  const projects = PROJECTS.map(([id]) => ({ id, name: id, status: 'active' as const, owners: [], data_classes: ['internal' as const], created_at: new Date(now - 86400000).toISOString(), aliases: ALIASES[id] ?? [], resolved_aliases: (ALIASES[id] ?? []).map(a => ({ ...a, from: id })) }));
  const accounts = ['claude-personal', 'claude-work', 'openai', 'agy', 'vibe', 'local'].map((id, index) => ({ id, name: id, provider: id.startsWith('claude-') ? 'anthropic' : id === 'openai' ? 'openai' : null, billing: id === 'local' ? 'none' as const : 'subscription' as const, status: 'active' as const, seats: nodes.flatMap((n) => n.seats.filter((s) => s.account === id).map((s) => s.ref)), windows: id === 'local' ? [] : [{ name: 'five_hour', used_percent: [34, 62, 29, 47, 18][index]!, observed_at: new Date(now).toISOString() }], created_at: new Date(now - 86400000).toISOString() }));
  const fleet: Fleet = { nodes, accounts, projects, placements, usage: [] };
  fleet.usage = Array.from({ length: 77 }, (_, i) => ({ ...demoRequest(fleet, i, now - (77 - i) * 1000), id: `demo-seed-${i}` }));
  for (const { record } of demoInFlight(fleet, tick, now)) {
    const node = nodes.find(n => n.id === record.served!.node)!;
    const seat = node.seats.find(s => s.ref === record.served!.seat)!;
    node.in_flight!++; seat.in_flight++;
  }
  return fleet;
}

/** The demo's placements on its cabled pair of GPU hosts: one across both, one on the first alone. */
function pairPlacements(now: number): Placement[] {
  const at = new Date(now - 3600000).toISOString();
  return [
    { id: 'deepseek-v4', model: 'deepseek-v4', nodes: ['gpu-a', 'gpu-b'], account: 'local', recipe: 'deepseek-v4', variant: 'fp8', runtime: 'tensorfold-0.7', chosen_by: 'coordinator', leader: 'gpu-a', seat: 'gpu-a/deepseek-v4', follower_seat: 'gpu-b/deepseek-v4', fit: [], created_at: at },
    { id: 'gpt-oss-20b', model: 'gpt-oss-20b', nodes: ['gpu-a'], account: 'local', recipe: 'gpt-oss-20b', variant: 'mxfp4', runtime: 'vllm-26.09', chosen_by: 'coordinator', leader: 'gpu-a', seat: 'gpu-a/gpt-oss-20b', fit: [], created_at: at },
  ];
}

export function demoRequest(fleet: Fleet, sequence: number, now: number): FleetRequest {
  // a follower's seat takes no request of its own
  const followers = new Set((fleet.placements ?? []).flatMap(p => p.follower_seat ? [p.follower_seat] : []));
  const seats = fleet.nodes.flatMap(n => n.seats).filter(s => s.status === 'up' && !followers.has(s.ref));
  // every fourth request is the pair's, so its coordination is seen often
  const leader = (fleet.placements ?? []).find(p => p.follower_seat)?.seat;
  const seat = (sequence % 4 === 3 && seats.find(s => s.ref === leader)) || seats[(sequence * 7) % seats.length]!;
  const model = seat.serves[Math.floor(sequence / seats.length) % seat.serves.length]!.model;
  const project = fleet.projects[sequence % fleet.projects.length]!.id;
  const repository = PROJECTS.find(([id]) => id === project)?.[1];
  const failed = sequence > 0 && sequence % 13 === 0;
  const alias = ALIASES[project]?.find(a => a.model === model);
  const unserved = sequence > 0 && sequence % 17 === 0;
  return { id: `demo-${sequence}`, created_at: new Date(now).toISOString(), project, key: 'demo-key', requested_model: alias?.name ?? model, resolved_model: model, endpoint: 'responses', status: unserved ? 'no_capacity' : failed ? 'failed' : 'served', served: unserved ? null : { model, node: seat.node, seat: seat.ref, account: seat.account, engine: seat.engine }, input_tokens: unserved ? 0 : 420 + sequence % 17 * 100, output_tokens: unserved || failed ? 0 : 60 + sequence % 11 * 24, price_micros: unserved || seat.account === 'local' ? 0 : 3400, currency: 'USD', timing: { wall_ms: 920 + sequence % 9 * 140, queue_ms: sequence % 3 * 80, load_ms: 0 }, metadata: repository ? { repository } : {} };
}

// Three staggered workers, each with a gap between requests. No project occupies two workers.
function jobsAt(tick: number) {
  return [0, 1, 2].flatMap(lane => {
    const phase = tick - lane * 2;
    if (phase < 0) return [];
    const sequence = Math.floor(phase / 8) * 3 + lane;
    return [{ sequence, elapsed: phase % 8, duration: 5 + sequence % 2 }];
  });
}
export function demoInFlight(fleet: Fleet, tick: number, now: number) {
  return jobsAt(tick).filter(job => job.elapsed < job.duration).flatMap(job => {
    const record = demoRequest(fleet, job.sequence, now - job.elapsed * DEMO_TICK_MS);
    if (!record.served) return [];
    // This is a graph participant snapshot, never a completed usage row.
    return [{ ...job, record: { ...record, id: `demo-live-${job.sequence}`, status: 'served' as const, input_tokens: 0, output_tokens: 0, price_micros: 0 }, color: demoProjectColor(record.project) }];
  });
}
export function demoCompletions(fleet: Fleet, tick: number, now: number): FleetRequest[] {
  return jobsAt(tick).filter(job => job.elapsed === job.duration).map(job => {
    const record = demoRequest(fleet, job.sequence, now);
    return { ...record, id: `demo-live-${job.sequence}`, timing: { ...record.timing, wall_ms: job.duration * DEMO_TICK_MS } };
  });
}

/** Only used for the synthetic fleet; never interpreted as backend telemetry. */
export function demoContext(record: FleetRequest) {
  const sequence = Number(record.id.replace(/^demo-(?:seed-|live-)?/, ''));
  return { apiInstance: sequence % 2 ? 'api-h1' : 'api-studio3' };
}
