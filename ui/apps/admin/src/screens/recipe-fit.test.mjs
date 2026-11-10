import test from 'node:test';
import assert from 'node:assert/strict';
import { bestIn, rowsOf, targetsOf, statusOf, whyOf, headroomOf, bestOf, filterRows, sortRows, viewOf, queryOf, toggled, choicesOf, downloadedOn, DEFAULT_VIEW } from './recipe-fit.ts';

const GB = 1e9;

/** A judgment on `nodes`: fits now (`now`), with nothing placed (`empty`). */
const cell = (nodes, over = {}) => ({
  nodes,
  fits: false,
  fits_empty: false,
  gpu: false,
  need_bytes: 6 * GB,
  room_bytes: 10 * GB,
  room_empty_bytes: 20 * GB,
  disk_bytes: 5 * GB,
  disk_free_bytes: 500 * GB,
  downloaded: false,
  tools: false,
  reasoning: false,
  reason: 'why',
  runtime: 'llama-server-b11913-rocm',
  ...over,
});

const variant = (id, format, memory, total, quantization = 'q4_k_m') => ({ id, format, quantization, file_count: 1, total_bytes: total, memory_bytes: memory });

// lin1: a card of 17 GB; spark and flare: GB10s, a linked pair
const FITS = {
  nodes: [
    { node: 'flare', os: 'linux', arch: 'arm64', accelerators: ',cuda,', accelerator: 'NVIDIA GB10', gpu: false, memory_bytes: 130 * GB, model_memory_bytes: 122 * GB, held_bytes: 0, free_bytes: 122 * GB, disk_free_bytes: 3500 * GB },
    { node: 'lin1', os: 'linux', arch: 'x86_64', accelerators: ',rocm,vulkan,', accelerator: 'AMD Radeon RX 9070', gpu: true, memory_bytes: 17 * GB, model_memory_bytes: 17 * GB, held_bytes: 14 * GB, free_bytes: 3 * GB, disk_free_bytes: 500 * GB },
    { node: 'spark', os: 'linux', arch: 'arm64', accelerators: ',cuda,', accelerator: 'NVIDIA GB10', gpu: false, memory_bytes: 130 * GB, model_memory_bytes: 122 * GB, held_bytes: 0, free_bytes: 122 * GB, disk_free_bytes: 3500 * GB },
    { node: 'static', os: '', arch: '', accelerators: '', gpu: false, memory_bytes: 0, model_memory_bytes: 0, held_bytes: 0, free_bytes: 0, disk_free_bytes: 0, problem: 'node static offers no managed engine' },
  ],
  pairs: [{ nodes: ['flare', 'spark'] }],
  data: [
    {
      recipe: { id: 'qwen3-0.6b', license: { name: 'apache-2.0', url: '' }, contract: 'generative', origin: 'shipped', context_length: 40960, variants: [variant('gguf-q8_0', 'gguf', 1 * GB, 0.8 * GB, 'q8_0'), variant('safetensors-bf16', 'safetensors', 3 * GB, 1.5 * GB, 'bf16')] },
      variants: [
        {
          variant: 'gguf-q8_0',
          on: [
            cell(['flare'], { fits: true, fits_empty: true, room_bytes: 122 * GB, held_bytes: 4 * GB, runtime: 'llama-server-b11913-cuda', tools: true, reasoning: true }),
            cell(['lin1'], { fits: true, fits_empty: true, room_bytes: 3 * GB, held_bytes: 3 * GB, gpu: true, tools: true, reasoning: true }),
            cell(['spark'], { fits: true, fits_empty: true, room_bytes: 122 * GB, held_bytes: 4 * GB, downloaded: true, runtime: 'llama-server-b11913-cuda', tools: true, reasoning: true }),
            cell(['flare', 'spark'], { runtime: undefined, reason: 'no runtime that spans nodes reads gguf', empty_reason: 'no runtime that spans nodes reads gguf' }),
          ],
        },
        {
          variant: 'safetensors-bf16',
          on: [
            cell(['flare'], { fits: true, fits_empty: true, room_bytes: 122 * GB, held_bytes: 20 * GB, runtime: 'vllm-26.09', tools: true }),
            cell(['lin1'], { runtime: undefined, reason: 'no runtime reads safetensors on linux/x86_64 with rocm and vulkan', empty_reason: 'no runtime reads safetensors on linux/x86_64 with rocm and vulkan' }),
            cell(['spark'], { fits: true, fits_empty: true, room_bytes: 122 * GB, held_bytes: 20 * GB, runtime: 'vllm-26.09', tools: true }),
            cell(['flare', 'spark'], { fits: true, fits_empty: true, room_bytes: 122 * GB, held_bytes: 10 * GB, runtime: 'vllm-26.09', tools: true }),
          ],
        },
      ],
    },
    {
      recipe: { id: 'jev-style-2b-decision-v3', license: { name: 'apache-2.0', url: '' }, contract: 'decision', origin: 'shipped', variants: [variant('gguf-f16', 'gguf', 4.8 * GB, 4.9 * GB, 'f16')] },
      variants: [
        {
          variant: 'gguf-f16',
          on: [
            cell(['flare'], { fits: true, fits_empty: true, room_bytes: 122 * GB, held_bytes: 7 * GB, runtime: 'decision-0.1.2-cuda' }),
            cell(['lin1'], { fits_empty: true, room_bytes: 3 * GB, gpu: true, runtime: 'decision-0.1.2-rocm', reason: 'needs 7.0 GB of 2.9 GB free of its GPU\'s 17.1 GB' }),
            cell(['spark'], { fits: true, fits_empty: true, room_bytes: 122 * GB, held_bytes: 7 * GB, runtime: 'decision-0.1.2-cuda' }),
            cell(['flare', 'spark'], { runtime: undefined, reason: 'no runtime that spans nodes', empty_reason: 'no runtime that spans nodes' }),
          ],
        },
      ],
    },
    {
      recipe: { id: 'deepseek-v4-flash-0731', license: { name: 'mit', url: '' }, contract: 'generative', origin: 'shipped', context_length: 1048576, variants: [variant('safetensors-fp8', 'safetensors', 175 * GB, 160 * GB, 'fp8')] },
      variants: [
        {
          variant: 'safetensors-fp8',
          on: [
            cell(['flare'], { runtime: 'vllm-26.09', room_bytes: 122 * GB, room_empty_bytes: 122 * GB, reason: 'needs 177 GB of 122 GB', empty_reason: 'needs 177 GB of 122 GB' }),
            cell(['lin1'], { runtime: undefined, reason: 'no runtime', empty_reason: 'no runtime' }),
            cell(['spark'], { runtime: 'vllm-26.09', room_bytes: 122 * GB, room_empty_bytes: 122 * GB, reason: 'needs 177 GB of 122 GB', empty_reason: 'needs 177 GB of 122 GB' }),
            cell(['flare', 'spark'], { fits: false, fits_empty: true, placed: 'ds', room_bytes: 30 * GB, room_empty_bytes: 122 * GB, need_bytes: 92 * GB, runtime: 'vllm-26.09', tools: true, reasoning: true }),
          ],
        },
      ],
    },
  ],
};

const rows = rowsOf(FITS);
const keys = (rs) => rs.map((r) => r.key);
const view = (over = {}) => ({ ...DEFAULT_VIEW, ...over });

test('a row a variant, judged on each node and pair, keyed by its nodes', () => {
  assert.deepEqual(keys(rows), ['qwen3-0.6b/gguf-q8_0', 'qwen3-0.6b/safetensors-bf16', 'jev-style-2b-decision-v3/gguf-f16', 'deepseek-v4-flash-0731/safetensors-fp8']);
  assert.deepEqual(targetsOf(FITS), ['flare', 'lin1', 'spark', 'flare+spark'], 'a node with a problem is not a target');
  assert.deepEqual([...rows[0].cells.keys()], ['flare', 'lin1', 'spark', 'flare+spark']);
});

test('fits now, fits once freed, never, placed: each with why', () => {
  const decider = rows[2];
  assert.equal(statusOf(decider.cells.get('flare')), 'fits');
  assert.equal(statusOf(decider.cells.get('lin1')), 'freed');
  assert.match(whyOf(decider.cells.get('lin1')), /needs 7\.0 GB.*With nothing placed there it fits/);
  assert.equal(statusOf(rows[3].cells.get('spark')), 'never');
  assert.equal(whyOf(rows[3].cells.get('spark')), 'needs 177 GB of 122 GB');
  assert.equal(statusOf(rows[3].cells.get('flare+spark')), 'placed');
});

test('the best fit is where most room is left after it; else where it fits once freed', () => {
  assert.equal(rows[0].best.key, 'flare', 'flare and spark tie at 118 GB left; the first');
  assert.equal(headroomOf(rows[0].best.cell), 118 * GB);
  assert.equal(headroomOf(rows[2].cells.get('lin1')), null, 'no headroom where it does not fit now');
  assert.equal(rows[3].best.status, 'placed');
  assert.equal(bestOf(rows[2].cells, new Set(['lin1'])).status, 'freed', 'scoped to lin1: once freed');
  assert.equal(bestOf(rows[3].cells, new Set(['spark'])), undefined, 'never on spark alone');
});

test('filters: on a node or a pair, by fit, format, runtime, what it carries, downloaded, and text', () => {
  assert.deepEqual(keys(filterRows(rows, view({ on: ['lin1'], fit: ['fits'] }))), ['qwen3-0.6b/gguf-q8_0'], 'only what fits on lin1 now');
  assert.deepEqual(keys(filterRows(rows, view({ on: ['lin1'], fit: ['freed'] }))), ['jev-style-2b-decision-v3/gguf-f16'], 'what fits lin1 once freed');
  assert.deepEqual(keys(filterRows(rows, view({ on: ['flare+spark'], fit: ['fits'] }))), ['qwen3-0.6b/safetensors-bf16'], 'only what fits on the Spark pair');
  assert.deepEqual(keys(filterRows(rows, view({ fit: ['never'] }))), [], 'everything fits somewhere, or is placed');
  assert.deepEqual(keys(filterRows(rows, view({ on: ['spark'], fit: ['never'] }))), ['deepseek-v4-flash-0731/safetensors-fp8']);
  assert.deepEqual(keys(filterRows(rows, view({ format: ['safetensors'] }))), ['qwen3-0.6b/safetensors-bf16', 'deepseek-v4-flash-0731/safetensors-fp8']);
  assert.deepEqual(keys(filterRows(rows, view({ runtime: ['decision-0.1.2-rocm'] }))), ['jev-style-2b-decision-v3/gguf-f16']);
  assert.deepEqual(keys(filterRows(rows, view({ cap: ['decision'] }))), ['jev-style-2b-decision-v3/gguf-f16']);
  assert.deepEqual(keys(filterRows(rows, view({ cap: ['reasoning'] }))), ['qwen3-0.6b/gguf-q8_0', 'deepseek-v4-flash-0731/safetensors-fp8']);
  assert.deepEqual(keys(filterRows(rows, view({ cap: ['tools'], on: ['lin1'] }))), ['qwen3-0.6b/gguf-q8_0'], 'carried under a runtime there');
  assert.deepEqual(keys(filterRows(rows, view({ downloaded: true }))), ['qwen3-0.6b/gguf-q8_0']);
  assert.deepEqual(keys(filterRows(rows, view({ downloaded: true, on: ['flare'] }))), [], 'downloaded on spark, not flare');
  assert.deepEqual(keys(filterRows(rows, view({ q: 'qwen bf16' }))), ['qwen3-0.6b/safetensors-bf16'], 'every word matches');
  assert.deepEqual(keys(filterRows(rows, view({ on: ['gone'] }))), [], 'a target no longer in the fleet keeps nothing');
});

test('sorts keep a recipe\'s variants together, each recipe placed by its first', () => {
  const by = (sort, desc = false, on = []) => keys(sortRows(rows, { sort, desc, on }));
  assert.deepEqual(by('name'), ['deepseek-v4-flash-0731/safetensors-fp8', 'jev-style-2b-decision-v3/gguf-f16', 'qwen3-0.6b/gguf-q8_0', 'qwen3-0.6b/safetensors-bf16']);
  assert.deepEqual(by('name', true), ['qwen3-0.6b/safetensors-bf16', 'qwen3-0.6b/gguf-q8_0', 'jev-style-2b-decision-v3/gguf-f16', 'deepseek-v4-flash-0731/safetensors-fp8']);
  assert.deepEqual(by('memory'), ['qwen3-0.6b/gguf-q8_0', 'qwen3-0.6b/safetensors-bf16', 'jev-style-2b-decision-v3/gguf-f16', 'deepseek-v4-flash-0731/safetensors-fp8']);
  assert.deepEqual(by('memory', true), ['deepseek-v4-flash-0731/safetensors-fp8', 'jev-style-2b-decision-v3/gguf-f16', 'qwen3-0.6b/safetensors-bf16', 'qwen3-0.6b/gguf-q8_0']);
  assert.deepEqual(by('size'), ['qwen3-0.6b/gguf-q8_0', 'qwen3-0.6b/safetensors-bf16', 'jev-style-2b-decision-v3/gguf-f16', 'deepseek-v4-flash-0731/safetensors-fp8']);
  // the most headroom on the best node first; what fits nowhere now last
  assert.deepEqual(by('headroom'), ['qwen3-0.6b/gguf-q8_0', 'qwen3-0.6b/safetensors-bf16', 'jev-style-2b-decision-v3/gguf-f16', 'deepseek-v4-flash-0731/safetensors-fp8']);
  assert.deepEqual(by('headroom', false, ['lin1']), ['qwen3-0.6b/gguf-q8_0', 'qwen3-0.6b/safetensors-bf16', 'deepseek-v4-flash-0731/safetensors-fp8', 'jev-style-2b-decision-v3/gguf-f16'], 'on lin1 only qwen fits; the rest by name');
  // fits now first, then placed, then once freed, then never
  assert.deepEqual(by('fit', false, ['lin1']), ['qwen3-0.6b/gguf-q8_0', 'qwen3-0.6b/safetensors-bf16', 'jev-style-2b-decision-v3/gguf-f16', 'deepseek-v4-flash-0731/safetensors-fp8']);
  assert.deepEqual(by('fit', false, ['flare+spark']), ['qwen3-0.6b/safetensors-bf16', 'qwen3-0.6b/gguf-q8_0', 'deepseek-v4-flash-0731/safetensors-fp8', 'jev-style-2b-decision-v3/gguf-f16'], 'the bf16 fits the pair, its GGUF kept beside it');
});

test('the view lives in the URL: what differs from the default, read back the same', () => {
  assert.equal(queryOf(DEFAULT_VIEW), '', 'a plain view has a plain URL');
  assert.deepEqual(viewOf(new URLSearchParams('')), DEFAULT_VIEW);
  const v = view({ q: 'qwen', on: ['lin1', 'flare+spark'], fit: ['fits', 'freed'], format: ['gguf'], runtime: ['vllm-26.09'], cap: ['tools', 'reasoning'], downloaded: true, sort: 'headroom', desc: true });
  const q = queryOf(v);
  assert.equal(q, 'q=qwen&on=lin1,flare%2Bspark&fit=fits,freed&format=gguf&runtime=vllm-26.09&cap=tools,reasoning&downloaded=1&sort=headroom&dir=desc');
  assert.deepEqual(viewOf(new URLSearchParams(q)), v, 'read back as it was written');
  const odd = viewOf(new URLSearchParams('fit=fits,maybe&cap=vision,tools&sort=speed&dir=up'));
  assert.deepEqual([odd.fit, odd.cap, odd.sort, odd.desc], [['fits'], ['tools'], 'fit', false], 'what the view does not know is dropped');
});

test('choices, toggles and where it is downloaded', () => {
  assert.deepEqual(choicesOf(rows), { formats: ['gguf', 'safetensors'], runtimes: ['decision-0.1.2-cuda', 'decision-0.1.2-rocm', 'llama-server-b11913-cuda', 'llama-server-b11913-rocm', 'vllm-26.09'] });
  assert.deepEqual(toggled(['a'], 'b'), ['a', 'b']);
  assert.deepEqual(toggled(['a', 'b'], 'a'), ['b']);
  assert.deepEqual(downloadedOn(rows[0]), ['spark']);
});

test('scoped to a node or pair, a row\'s best fit is there: what fits on lin1 is placed on lin1', () => {
  const [qwen, , decider] = bestIn(rows, ['lin1']);
  assert.equal(rows[0].best.key, 'flare', 'unscoped, the most room');
  assert.equal(qwen.best.key, 'lin1');
  assert.equal(headroomOf(qwen.best.cell), 0);
  assert.equal(decider.best.status, 'freed');
  assert.equal(bestIn(rows, [])[0], rows[0], 'no scope, the rows as they are');
});
