import type { NodeSummary, Placement, SeatSummary } from '../api/client';
import type { Fleet, FleetRequest } from './network-model';

// Repository is caller metadata on demo requests, not a field on Voice's Project.
const PROJECTS = [
  ['research', 'hale-lang/hale'], ['product', 'hale-lang/voice'], ['automation', 'example/infra'],
  ['compiler', 'hale-lang/hale'], ['admin', 'hale-lang/voice'], ['infrastructure', 'example/infra'],
  ['evals', 'hale-lang/hale'],
] as const;
// Names two projects give models: their requests for those models ask by the name.
const ALIASES: Record<string, { name: string; model: string }[]> = {
  product: [{ name: 'coding', model: 'qwen3-coder-30b-a3b-instruct' }],
  research: [{ name: 'reasoning', model: 'gpt-oss-120b' }],
  infrastructure: [{ name: 'big', model: 'deepseek-v4.1-flash-1017' }],
};
export const DEMO_TICK_MS = 1800;
// each project's path colour: the theme's vivid tokens, so the paths follow the theme
const PROJECT_COLORS = ['lime', 'cyan', 'magenta', 'orange', 'violet', 'mint', 'pink'].map((c) => `var(--color-vivid-${c})`);
export const demoProjectColor = (project: string) => PROJECT_COLORS[Math.max(0, PROJECTS.findIndex(([id]) => id === project))]!;

/** Explicitly synthetic, local-only fixture. Hosted model names are illustrative; local ones are voice's recipes. */
export function demoFleet(tick: number, now: number): Fleet {
  // Demo fleet: four Mac-like hosts of 64 to 512 GB running voice's recipes
  // under llama-server and the decision engine, two hosts with hosted
  // OpenAI-compatible accounts and a small local model each, and a cabled
  // pair of GPU hosts (below). Every local model is a placement: voice
  // fetches its pinned weights and runs it on the host's GPU.
  const at = new Date(now - 3600000).toISOString();
  const nodeOf = (id: string, name: string, seats: SeatSummary[]): NodeSummary => ({ id, name, status: 'up', seats, in_flight: 0, assignment_version: 7, applied_version: 7, last_heartbeat_at: new Date(now - 2000).toISOString(), created_at: new Date(now - 86400000).toISOString() });
  const hosted = (node: string, account: string, models: readonly string[]): SeatSummary => ({ id: account, ref: `${node}/${account}`, node, engine: 'openai-compatible', account, data_classes: ['internal'], serves: models.map(model => ({ model })), status: 'up', in_flight: 0, concurrency: 3, enabled: true, problems: [], reason: null });
  const placed = (model: string, nodes: string[], variant: string, runtime: string, follower = false): Placement => ({ id: model, model, nodes, account: 'local', recipe: model, variant, runtime, chosen_by: 'coordinator', leader: nodes[0]!, seat: `${nodes[0]}/${model}`, ...(follower ? { follower_seat: `${nodes[1]}/${model}` } : {}), fit: [], created_at: at });
  const seatOf = (p: Placement, ref: string, paused = false): SeatSummary => ({ id: p.id, ref, node: ref.split('/')[0]!, engine: 'managed', account: p.account, data_classes: ['internal'], serves: [{ model: p.model }], status: paused ? 'paused' : 'up', in_flight: 0, concurrency: 4, enabled: true, problems: [], reason: paused ? 'Paused by the machine operator.' : null, placement: p.id, runtime: p.runtime, variant: p.variant });
  const metal = 'llama-server-b11913-metal';
  // each host's hosted accounts, then the models placed on it alone
  const definitions: [string, string, [string, readonly string[]][], [string, string, string][]][] = [
    ['host-1', 'Host 1 · 128 GB unified memory', [], [['gpt-oss-120b', 'gguf-mxfp4', metal], ['jev-style-2b-decision-v3', 'mlx-8bit', 'decision-0.3.0-mlx']]],
    ['host-2', 'Host 2 · hosted APIs and a small local model', [['hosted-a', ['glm-4.7', 'kimi-k2', 'qwen3-coder-480b']]], [['qwen2.5-1.5b-instruct', 'gguf-q8_0', metal]]],
    ['host-3', 'Host 3 · 64 GB unified memory', [], [['qwen3-coder-30b-a3b-instruct', 'gguf-q8_0', metal], ['granite-4.0-h-tiny', 'gguf-q8_0', metal]]],
    ['host-4', 'Host 4 · hosted APIs and a small local model', [['openai', ['gpt-codex', 'gpt-mini', 'gpt-reasoning', 'gpt-fast']], ['hosted-b', ['deepseek-v4', 'qwen3-max', 'minimax-m2']]], [['granite-4.0-350m', 'gguf-q8_0', metal]]],
    ['host-5', 'Host 5 · 512 GB unified memory', [], [['qwen3-235b-a22b', 'gguf-q8_0', metal], ['glm-4.7-flash', 'gguf-q8_0', metal]]],
    ['host-6', 'Host 6 · 128 GB unified memory', [], [['qwen3-coder-next', 'gguf-q8_0', metal]]],
  ];
  const placements: Placement[] = [];
  const nodes = definitions.map(([id, name, accounts, local]) => {
    const own = local.map(([model, variant, runtime]) => placed(model, [id], variant, runtime));
    placements.push(...own);
    // host-5's second model is paused by its machine's operator
    return nodeOf(id, name, [...accounts.map(([account, models]) => hosted(id, account, models)), ...own.map((p, j) => seatOf(p, p.seat, id === 'host-5' && j === 1))]);
  });
  // two GPU hosts cabled together: one model placed across both (its
  // leader's seat takes the requests, its follower's computes half of each),
  // and a model of its own beside it on the first
  const pair = placed('deepseek-v4.1-flash-1017', ['gpu-a', 'gpu-b'], 'exl3-2.5bpw', 'tensorfold-0.7.5', true);
  const alone = placed('gpt-oss-20b', ['gpu-a'], 'safetensors-mxfp4', 'vllm-26.09');
  placements.push(pair, alone);
  nodes.push(nodeOf('gpu-a', 'GPU A · 128 GB unified, cabled to GPU B', [seatOf(pair, pair.seat), seatOf(alone, alone.seat)]));
  nodes.push(nodeOf('gpu-b', 'GPU B · 128 GB unified, cabled to GPU A', [seatOf(pair, pair.follower_seat!)]));
  const projects = PROJECTS.map(([id]) => ({ id, name: id, status: 'active' as const, owners: [], data_classes: ['internal' as const], created_at: new Date(now - 86400000).toISOString(), aliases: ALIASES[id] ?? [], resolved_aliases: (ALIASES[id] ?? []).map(a => ({ ...a, from: id })) }));
  // hosted accounts pay per token (metered) and report no windows; local pays nothing
  const accounts = ['openai', 'hosted-a', 'hosted-b', 'local'].map((id) => ({ id, name: id, provider: id === 'local' ? null : id, billing: id === 'local' ? 'none' as const : 'metered' as const, status: 'active' as const, seats: nodes.flatMap((n) => n.seats.filter((s) => s.account === id).map((s) => s.ref)), windows: [], created_at: new Date(now - 86400000).toISOString() }));
  const fleet: Fleet = { nodes, accounts, projects, placements, usage: [] };
  fleet.usage = Array.from({ length: 77 }, (_, i) => ({ ...demoRequest(fleet, i, now - (77 - i) * 1000), id: `demo-seed-${i}` }));
  for (const { record } of demoInFlight(fleet, tick, now)) {
    const node = nodes.find(n => n.id === record.served!.node)!;
    const seat = node.seats.find(s => s.ref === record.served!.seat)!;
    node.in_flight!++; seat.in_flight++;
  }
  return fleet;
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

/** The demo's api instances: two beating, and one retired by an earlier redeploy, which its oldest records name (demoContext). */
export function demoInstances(now: number): NonNullable<Fleet['instances']> {
  return [{ id: 'api-0', at: new Date(now - 2400000).toISOString(), up: false }, ...['api-1', 'api-2'].map(id => ({ id, at: new Date(now - 2000).toISOString(), up: true }))];
}

/** Only used for the synthetic fleet; never interpreted as backend telemetry. */
export function demoContext(record: FleetRequest) {
  const sequence = Number(record.id.replace(/^demo-(?:seed-|live-)?/, ''));
  // the oldest seeded records were admitted by an instance since retired
  if (record.id.startsWith('demo-seed-') && sequence < 12) return { apiInstance: 'api-0' };
  return { apiInstance: sequence % 2 ? 'api-1' : 'api-2' };
}
