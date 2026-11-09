import type { NodeSummary, Placement, Schemas } from './api/client';

type Plan = Schemas['ArrangementPlan'];
type LinkCheck = Schemas['LinkCheck'];

/**
 * A labeled, synthetic fleet for the node cards with no fleet behind them:
 * three DGX Sparks, `spark` and `flare` cabled to each other, and
 * `spark3`, and a 24 GiB Mac, `mac`, a fifth their size, drawn in the same
 * grid. Now gpt-oss-120b runs on spark, the coder, granite and a small
 * model on spark3, and phi-4-mini-reasoning on the Mac; the plan puts DeepSeek-V4.1-Flash across spark and
 * flare on TensorFold in gpt-oss's place, keeps the coder and the small
 * model and the Mac's, and gives part of granite's room to the decider. Sizes follow voice's shipped recipes; nothing here
 * is read from, or sent to, any host.
 */

const GIB = 1024 ** 3;
const gib = (n: number) => Math.round(n * GIB);
/** A DGX Spark: 128 GB, less a sixteenth its system keeps. */
const SPARK = 130661072896;
const SPARK_MODELS = SPARK - SPARK / 16;
/** A seat's server's own, beside what its placement reserves. */
const SERVER = 2 * GIB;
const AT = '2026-11-08T09:00:00Z';

function spark(id: string, name: string): NodeSummary {
  return {
    id,
    name,
    status: 'up',
    version: 'demo',
    hardware: {
      os: 'linux',
      arch: 'arm64',
      memory_bytes: SPARK,
      model_memory_bytes: SPARK_MODELS,
      accelerators: [{ kind: 'cuda', name: 'NVIDIA GB10', memory_bytes: SPARK, unified: true }],
      disk_free_bytes: 3.5e12,
    },
    local: null,
    max_in_flight: 4,
    effective_max_in_flight: 4,
    in_flight: 0,
    seats: [],
    created_at: AT,
  } as NodeSummary;
}

/** A 24 GiB Mac: less the 4 GiB a machine keeps at the least. */
const MAC = 24 * GIB;
const MAC_MODELS = MAC - 4 * GIB;

function mac(id: string, name: string): NodeSummary {
  return {
    ...spark(id, name),
    hardware: {
      os: 'darwin',
      arch: 'arm64',
      memory_bytes: MAC,
      model_memory_bytes: MAC_MODELS,
      accelerators: [{ kind: 'metal', name: 'Apple M4 Pro', memory_bytes: MAC, unified: true }],
      disk_free_bytes: 0.4e12,
    },
    max_in_flight: 2,
    effective_max_in_flight: 2,
  } as NodeSummary;
}

export const DEMO_NODES: NodeSummary[] = [spark('flare', 'Spark 2 · flare'), mac('mac', 'MacBook Pro'), spark('spark', 'Spark 1'), spark('spark3', 'Spark 3')];

function placed(id: string, model: string, recipe: string, nodes: string[], variant: string, runtime: string, reserved: number): Placement {
  return {
    id, model, account: 'local', nodes, recipe, variant, runtime, chosen_by: 'coordinator', leader: nodes[0]!, seat: `${nodes[0]}/${id}`, fit: [],
    reserved_bytes: gib(reserved), held_bytes: gib(reserved) + SERVER, created_at: AT,
  } as Placement;
}

export const DEMO_PLACEMENTS: Placement[] = [
  placed('oss', 'gpt-oss-120b', 'gpt-oss-120b', ['spark'], 'gguf-mxfp4', 'llama-server-b11913-cuda', 66.0),
  placed('coder', 'qwen3-coder-next', 'qwen3-coder-next', ['spark3'], 'gguf-q8_0', 'llama-server-b11913-cuda', 86.0),
  placed('granite', 'granite-4.0-h-small', 'granite-4.0-h-small', ['spark3'], 'gguf-q4_k_m', 'llama-server-b11913-cuda', 16.2),
  placed('tiny', 'qwen3-0.6b', 'qwen3-0.6b', ['spark3'], 'safetensors-bf16', 'vllm-0.11-cuda', 5.6),
  placed('mini', 'phi-4-mini-reasoning', 'phi-4-mini-reasoning', ['mac'], 'gguf-q8_0', 'llama-server-b11913-metal', 4.6),
];

const add = (placement: string, model: string, nodes: string[], variant: string, runtime: string, reserved: number, serves: string[], reason: string, download: number) => ({
  placement, model, in_catalog: true, recipe: model, nodes, variant, runtime,
  reserved_bytes: gib(reserved), held_bytes: gib(reserved) + SERVER, download_bytes: gib(download), serves, reason,
});

const keep = (placement: string, model: string, nodes: string[], reserved: number, serves: string[]) => ({
  placement, model, recipe: model, nodes, held_bytes: gib(reserved) + SERVER, serves, reason: `serves ${serves.join(', ')} as it is placed: nothing moves`,
});

const remove = (placement: string, model: string, nodes: string[], reserved: number, reason: string) => ({
  placement, model, recipe: model, nodes, held_bytes: gib(reserved) + SERVER, reason,
});

export const DEMO_PLAN: Plan = {
  keep: [keep('coder', 'qwen3-coder-next', ['spark3'], 86.0, ['coder']), keep('tiny', 'qwen3-0.6b', ['spark3'], 5.6, ['small']), keep('mini', 'phi-4-mini-reasoning', ['mac'], 4.6, ['thinker'])],
  remove: [
    remove('oss', 'gpt-oss-120b', ['spark'], 66.0, "serves none of the arrangement's wants; its room on spark goes to pin deepseek-v4.1-flash-1017"),
    remove('granite', 'granite-4.0-h-small', ['spark3'], 16.2, "serves none of the arrangement's wants; its room on spark3 goes to decider"),
  ],
  add: [
    add('deepseek-v4-1-flash-1017-flare', 'deepseek-v4.1-flash-1017', ['flare', 'spark'], 'exl3-2.5bpw', 'tensorfold-0.7.5', 104.6, ['pin deepseek-v4.1-flash-1017'], 'fits: tensorfold-0.7.5 runs exl3 across two GB10s; 106.6 GB of 114.1 GB for models on each; fetches 217.0 GB; needs the flare–spark link, which is checked', 202.1),
    add('jev-style-2b-decision-v3-spark3', 'jev-style-2b-decision-v3', ['spark3'], 'gguf-q8_0', 'llama-server-b11913-cuda', 4.1, ['decider'], 'fits: llama-server-b11913-cuda runs gguf on cuda; 6.1 GB of 18.5 GB left once granite goes; fetches 3.1 GB', 2.9),
  ],
  aliases: [
    { role: 'coder', alias: 'coding', model: 'qwen3-coder-next' },
    { role: 'decider', alias: 'decide', model: 'jev-style-2b-decision-v3' },
    { role: 'small', alias: 'small', model: 'qwen3-0.6b' },
  ],
  downloads: [{ node: 'flare', bytes: gib(101.1) }, { node: 'spark', bytes: gib(101.1) }, { node: 'spark3', bytes: gib(2.9) }],
  down: ['gpt-oss-120b', 'granite-4.0-h-small'],
  unmet: [{ want: 'reasoner', reason: 'no node has room for a reasoner after the wants before it (qwen3-235b-a22b, the strongest: spark3: needs 252.3 GB, 12.4 GB free)', need_bytes: gib(250.3) + SERVER }],
};

/** The demo's one link, spark to flare, checked over its QSFP cable. */
export function demoLink(a: string, b: string): LinkCheck | undefined {
  if ([a, b].sort().join(' ') !== 'flare spark') return undefined;
  return { id: 'demo-check', nodes: ['spark', 'flare'], status: 'passed', bus_bytes_per_second: 23_600_000_000, degraded: false, started_at: AT, finished_at: AT };
}
