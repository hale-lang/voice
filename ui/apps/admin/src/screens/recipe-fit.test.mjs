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

// gpu-box: a card of 17 GB; node-a and node-b: GB10s, a linked pair
const FITS = {
  nodes: [
    { node: 'node-b', os: 'linux', arch: 'arm64', accelerators: ',cuda,', accelerator: 'NVIDIA GB10', gpu: false, memory_bytes: 130 * GB, model_memory_bytes: 122 * GB, held_bytes: 0, free_bytes: 122 * GB, disk_free_bytes: 3500 * GB },
    { node: 'gpu-box', os: 'linux', arch: 'x86_64', accelerators: ',rocm,vulkan,', accelerator: 'AMD Radeon RX 9070', gpu: true, memory_bytes: 17 * GB, model_memory_bytes: 17 * GB, held_bytes: 14 * GB, free_bytes: 3 * GB, disk_free_bytes: 500 * GB },
    { node: 'node-a', os: 'linux', arch: 'arm64', accelerators: ',cuda,', accelerator: 'NVIDIA GB10', gpu: false, memory_bytes: 130 * GB, model_memory_bytes: 122 * GB, held_bytes: 0, free_bytes: 122 * GB, disk_free_bytes: 3500 * GB },
    { node: 'static', os: '', arch: '', accelerators: '', gpu: false, memory_bytes: 0, model_memory_bytes: 0, held_bytes: 0, free_bytes: 0, disk_free_bytes: 0, problem: 'node static offers no managed engine' },
  ],
  pairs: [{ nodes: ['node-b', 'node-a'] }],
  data: [
    {
      recipe: { id: 'qwen3-0.6b', license: { name: 'apache-2.0', url: '' }, contract: 'generative', origin: 'shipped', context_length: 40960, variants: [variant('gguf-q8_0', 'gguf', 1 * GB, 0.8 * GB, 'q8_0'), variant('safetensors-bf16', 'safetensors', 3 * GB, 1.5 * GB, 'bf16')] },
      variants: [
        {
          variant: 'gguf-q8_0',
          on: [
            cell(['node-b'], { fits: true, fits_empty: true, room_bytes: 122 * GB, held_bytes: 4 * GB, runtime: 'llama-server-b11913-cuda', tools: true, reasoning: true }),
            cell(['gpu-box'], { fits: true, fits_empty: true, room_bytes: 3 * GB, held_bytes: 3 * GB, gpu: true, tools: true, reasoning: true }),
            cell(['node-a'], { fits: true, fits_empty: true, room_bytes: 122 * GB, held_bytes: 4 * GB, downloaded: true, runtime: 'llama-server-b11913-cuda', tools: true, reasoning: true }),
            cell(['node-b', 'node-a'], { runtime: undefined, reason: 'no runtime that spans nodes reads gguf', empty_reason: 'no runtime that spans nodes reads gguf' }),
          ],
        },
        {
          variant: 'safetensors-bf16',
          on: [
            cell(['node-b'], { fits: true, fits_empty: true, room_bytes: 122 * GB, held_bytes: 20 * GB, runtime: 'vllm-26.09', tools: true }),
            cell(['gpu-box'], { runtime: undefined, reason: 'no runtime reads safetensors on linux/x86_64 with rocm and vulkan', empty_reason: 'no runtime reads safetensors on linux/x86_64 with rocm and vulkan' }),
            cell(['node-a'], { fits: true, fits_empty: true, room_bytes: 122 * GB, held_bytes: 20 * GB, runtime: 'vllm-26.09', tools: true }),
            cell(['node-b', 'node-a'], { fits: true, fits_empty: true, room_bytes: 122 * GB, held_bytes: 10 * GB, runtime: 'vllm-26.09', tools: true }),
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
            cell(['node-b'], { fits: true, fits_empty: true, room_bytes: 122 * GB, held_bytes: 7 * GB, runtime: 'decision-0.1.2-cuda' }),
            cell(['gpu-box'], { fits_empty: true, room_bytes: 3 * GB, gpu: true, runtime: 'decision-0.1.2-rocm', reason: 'needs 7.0 GB of 2.9 GB free of its GPU\'s 17.1 GB' }),
            cell(['node-a'], { fits: true, fits_empty: true, room_bytes: 122 * GB, held_bytes: 7 * GB, runtime: 'decision-0.1.2-cuda' }),
            cell(['node-b', 'node-a'], { runtime: undefined, reason: 'no runtime that spans nodes', empty_reason: 'no runtime that spans nodes' }),
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
            cell(['node-b'], { runtime: 'vllm-26.09', room_bytes: 122 * GB, room_empty_bytes: 122 * GB, reason: 'needs 177 GB of 122 GB', empty_reason: 'needs 177 GB of 122 GB' }),
            cell(['gpu-box'], { runtime: undefined, reason: 'no runtime', empty_reason: 'no runtime' }),
            cell(['node-a'], { runtime: 'vllm-26.09', room_bytes: 122 * GB, room_empty_bytes: 122 * GB, reason: 'needs 177 GB of 122 GB', empty_reason: 'needs 177 GB of 122 GB' }),
            cell(['node-b', 'node-a'], { fits: false, fits_empty: true, placed: 'ds', room_bytes: 30 * GB, room_empty_bytes: 122 * GB, need_bytes: 92 * GB, runtime: 'vllm-26.09', tools: true, reasoning: true }),
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
  assert.deepEqual(targetsOf(FITS), ['node-b', 'gpu-box', 'node-a', 'node-b+node-a'], 'a node with a problem is not a target');
  assert.deepEqual([...rows[0].cells.keys()], ['node-b', 'gpu-box', 'node-a', 'node-b+node-a']);
});

test('fits now, fits once freed, never, placed: each with why', () => {
  const decider = rows[2];
  assert.equal(statusOf(decider.cells.get('node-b')), 'fits');
  assert.equal(statusOf(decider.cells.get('gpu-box')), 'freed');
  assert.match(whyOf(decider.cells.get('gpu-box')), /needs 7\.0 GB.*With nothing placed there it fits/);
  assert.equal(statusOf(rows[3].cells.get('node-a')), 'never');
  assert.equal(whyOf(rows[3].cells.get('node-a')), 'needs 177 GB of 122 GB');
  assert.equal(statusOf(rows[3].cells.get('node-b+node-a')), 'placed');
});

test('the best fit is where most room is left after it; else where it fits once freed', () => {
  assert.equal(rows[0].best.key, 'node-b', 'node-b and node-a tie at 118 GB left; the first');
  assert.equal(headroomOf(rows[0].best.cell), 118 * GB);
  assert.equal(headroomOf(rows[2].cells.get('gpu-box')), null, 'no headroom where it does not fit now');
  assert.equal(rows[3].best.status, 'placed');
  assert.equal(bestOf(rows[2].cells, new Set(['gpu-box'])).status, 'freed', 'scoped to gpu-box: once freed');
  assert.equal(bestOf(rows[3].cells, new Set(['node-a'])), undefined, 'never on node-a alone');
});

test('filters: on a node or a pair, by fit, format, runtime, what it carries, downloaded, and text', () => {
  assert.deepEqual(keys(filterRows(rows, view({ on: ['gpu-box'], fit: ['fits'] }))), ['qwen3-0.6b/gguf-q8_0'], 'only what fits on gpu-box now');
  assert.deepEqual(keys(filterRows(rows, view({ on: ['gpu-box'], fit: ['freed'] }))), ['jev-style-2b-decision-v3/gguf-f16'], 'what fits gpu-box once freed');
  assert.deepEqual(keys(filterRows(rows, view({ on: ['node-b+node-a'], fit: ['fits'] }))), ['qwen3-0.6b/safetensors-bf16'], 'only what fits on the Spark pair');
  assert.deepEqual(keys(filterRows(rows, view({ fit: ['never'] }))), [], 'everything fits somewhere, or is placed');
  assert.deepEqual(keys(filterRows(rows, view({ on: ['node-a'], fit: ['never'] }))), ['deepseek-v4-flash-0731/safetensors-fp8']);
  assert.deepEqual(keys(filterRows(rows, view({ format: ['safetensors'] }))), ['qwen3-0.6b/safetensors-bf16', 'deepseek-v4-flash-0731/safetensors-fp8']);
  assert.deepEqual(keys(filterRows(rows, view({ runtime: ['decision-0.1.2-rocm'] }))), ['jev-style-2b-decision-v3/gguf-f16']);
  assert.deepEqual(keys(filterRows(rows, view({ cap: ['decision'] }))), ['jev-style-2b-decision-v3/gguf-f16']);
  assert.deepEqual(keys(filterRows(rows, view({ cap: ['reasoning'] }))), ['qwen3-0.6b/gguf-q8_0', 'deepseek-v4-flash-0731/safetensors-fp8']);
  assert.deepEqual(keys(filterRows(rows, view({ cap: ['tools'], on: ['gpu-box'] }))), ['qwen3-0.6b/gguf-q8_0'], 'carried under a runtime there');
  assert.deepEqual(keys(filterRows(rows, view({ downloaded: true }))), ['qwen3-0.6b/gguf-q8_0']);
  assert.deepEqual(keys(filterRows(rows, view({ downloaded: true, on: ['node-b'] }))), [], 'downloaded on node-a, not node-b');
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
  assert.deepEqual(by('headroom', false, ['gpu-box']), ['qwen3-0.6b/gguf-q8_0', 'qwen3-0.6b/safetensors-bf16', 'deepseek-v4-flash-0731/safetensors-fp8', 'jev-style-2b-decision-v3/gguf-f16'], 'on gpu-box only qwen fits; the rest by name');
  // fits now first, then placed, then once freed, then never
  assert.deepEqual(by('fit', false, ['gpu-box']), ['qwen3-0.6b/gguf-q8_0', 'qwen3-0.6b/safetensors-bf16', 'jev-style-2b-decision-v3/gguf-f16', 'deepseek-v4-flash-0731/safetensors-fp8']);
  assert.deepEqual(by('fit', false, ['node-b+node-a']), ['qwen3-0.6b/safetensors-bf16', 'qwen3-0.6b/gguf-q8_0', 'deepseek-v4-flash-0731/safetensors-fp8', 'jev-style-2b-decision-v3/gguf-f16'], 'the bf16 fits the pair, its GGUF kept beside it');
});

test('the view lives in the URL: what differs from the default, read back the same', () => {
  assert.equal(queryOf(DEFAULT_VIEW), '', 'a plain view has a plain URL');
  assert.deepEqual(viewOf(new URLSearchParams('')), DEFAULT_VIEW);
  const v = view({ q: 'qwen', on: ['gpu-box', 'node-b+node-a'], fit: ['fits', 'freed'], format: ['gguf'], runtime: ['vllm-26.09'], cap: ['tools', 'reasoning'], downloaded: true, sort: 'headroom', desc: true });
  const q = queryOf(v);
  assert.equal(q, 'q=qwen&on=gpu-box,node-b%2Bnode-a&fit=fits,freed&format=gguf&runtime=vllm-26.09&cap=tools,reasoning&downloaded=1&sort=headroom&dir=desc');
  assert.deepEqual(viewOf(new URLSearchParams(q)), v, 'read back as it was written');
  const odd = viewOf(new URLSearchParams('fit=fits,maybe&cap=vision,tools&sort=speed&dir=up'));
  assert.deepEqual([odd.fit, odd.cap, odd.sort, odd.desc], [['fits'], ['tools'], 'fit', false], 'what the view does not know is dropped');
});

test('choices, toggles and where it is downloaded', () => {
  assert.deepEqual(choicesOf(rows), { formats: ['gguf', 'safetensors'], runtimes: ['decision-0.1.2-cuda', 'decision-0.1.2-rocm', 'llama-server-b11913-cuda', 'llama-server-b11913-rocm', 'vllm-26.09'] });
  assert.deepEqual(toggled(['a'], 'b'), ['a', 'b']);
  assert.deepEqual(toggled(['a', 'b'], 'a'), ['b']);
  assert.deepEqual(downloadedOn(rows[0]), ['node-a']);
});

test('scoped to a node or pair, a row\'s best fit is there: what fits on gpu-box is placed on gpu-box', () => {
  const [qwen, , decider] = bestIn(rows, ['gpu-box']);
  assert.equal(rows[0].best.key, 'node-b', 'unscoped, the most room');
  assert.equal(qwen.best.key, 'gpu-box');
  assert.equal(headroomOf(qwen.best.cell), 0);
  assert.equal(decider.best.status, 'freed');
  assert.equal(bestIn(rows, [])[0], rows[0], 'no scope, the rows as they are');
});
