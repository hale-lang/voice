import test from 'node:test';
import assert from 'node:assert/strict';
import {
  backendLine,
  backendsOf,
  blankRecipe,
  envLinesAt,
  envOf,
  fieldOf,
  getIn,
  hasBackend,
  linesAt,
  linesOf,
  modelBy,
  moveBackend,
  newBackend,
  normalized,
  onForm,
  parsePath,
  parseRecipe,
  pathText,
  refusedAt,
  removeBackend,
  setIn,
  withHostInstall,
  withLoginKind,
  withModel,
} from './cli-recipe.ts';

const codex = {
  id: 'codex',
  name: 'OpenAI Codex CLI',
  version: '0.166.0',
  backends: [
    { kind: 'container', base: 'docker.io/library/node@sha256:' + 'a'.repeat(64), install: 'npm install --global @openai/codex@0.166.0' },
    { kind: 'host', detect: { command: ['codex', '--version'], version: 'codex-cli ([0-9][0-9.]*)' }, install: { command: ['npm', 'install', '--global', '--prefix', '$VOICE_CLI_PREFIX', '@openai/codex@0.166.0'] } },
  ],
  command: ['codex', 'exec', '--json', '-C', '/work', '-'],
  instruction: { via: 'stdin' },
  model: { flag: '-m' },
  login: { kind: 'home', env: 'CODEX_HOME', mount: '/home/voice/.codex', from: '', files: ['auth.json'], describe: 'A ChatGPT plan.' },
  env: {},
  reader: 'codex-jsonl',
  commits: false,
  preamble: 'You work in /work.',
  egress: ['api.openai.com'],
  idle_seconds: 1800,
  mcp: null,
};

test('a path as the api names a field, and back', () => {
  assert.deepEqual(parsePath('backends[1].detect.version'), ['backends', 1, 'detect', 'version']);
  assert.deepEqual(parsePath('login.env'), ['login', 'env']);
  assert.equal(pathText(['backends', 1, 'install', 'env', 'UV_TOOL_DIR']), 'backends[1].install.env.UV_TOOL_DIR');
  assert.equal(getIn(codex, parsePath('backends[1].detect.version')), 'codex-cli ([0-9][0-9.]*)');
});

test('a field set by path is a new recipe; the old one is as it was', () => {
  const edited = setIn(codex, ['backends', 1, 'detect', 'version'], 'codex ([0-9.]+)');
  assert.equal(getIn(edited, ['backends', 1, 'detect', 'version']), 'codex ([0-9.]+)');
  assert.equal(getIn(codex, ['backends', 1, 'detect', 'version']), 'codex-cli ([0-9][0-9.]*)');
  assert.equal(edited.mcp, null, 'a field the form does not show is kept');
  assert.equal(getIn(setIn(codex, ['login', 'describe'], undefined), ['login', 'describe']), undefined, 'undefined removes');
});

test('argv and variables edited as lines', () => {
  assert.equal(linesAt(codex, ['command']), 'codex\nexec\n--json\n-C\n/work\n-');
  assert.deepEqual(linesOf('npm\n\ninstall \n'), ['npm', 'install ']);
  assert.deepEqual(envOf('UV_TOOL_DIR=$VOICE_CLI_PREFIX/tools\nnot a variable\nA=b=c'), { UV_TOOL_DIR: '$VOICE_CLI_PREFIX/tools', A: 'b=c' });
  assert.equal(envLinesAt({ env: { A: '1', B: 'x=y' } }, ['env']), 'A=1\nB=x=y');
});

test("backends: the recipe's list, or the older image as one container", () => {
  assert.equal(backendLine(codex), 'container, host');
  assert.ok(hasBackend(codex, 'host') && hasBackend(codex, 'container'));
  const old = { id: 'fake', image: { base: 'x@sha256:' + 'b'.repeat(64), install: 'apk add git' } };
  assert.deepEqual(backendsOf(old), [{ kind: 'container', base: 'x@sha256:' + 'b'.repeat(64), install: 'apk add git' }]);
  const n = normalized(old);
  assert.equal(n.image, undefined, 'the form edits one list');
  assert.deepEqual(n.backends, backendsOf(old));
  assert.ok(!hasBackend(old, 'host'));
});

test('backends added, moved and removed in order', () => {
  const hostFirst = moveBackend(codex, 1, -1);
  assert.equal(backendLine(hostFirst), 'host, container');
  assert.equal(moveBackend(codex, 0, -1), codex, 'the first does not move up');
  assert.equal(backendLine(removeBackend(codex, 0)), 'host');
  assert.deepEqual(newBackend('host'), { kind: 'host', detect: { command: [], version: '' }, install: { command: [] } });
});

test('a host backend with no install argv detects alone', () => {
  const detectOnly = withHostInstall(codex, 1, '\n');
  assert.equal(getIn(detectOnly, ['backends', 1, 'install']), undefined);
  assert.deepEqual(getIn(withHostInstall(codex, 1, 'uv\ntool\ninstall'), ['backends', 1, 'install', 'command']), ['uv', 'tool', 'install']);
});

test("the api's refusal shown on its field", () => {
  assert.equal(fieldOf('recipe.backends[1].install.command'), 'backends[1].install.command');
  assert.equal(fieldOf('recipe'), '');
  assert.equal(fieldOf(null), '');
  assert.ok(refusedAt('backends[1].install.command', 'backends[1].install.command'));
  assert.ok(refusedAt('backends[1].install.env.PATH', 'backends[1].install'));
  assert.ok(refusedAt('login.env', 'login'));
  assert.ok(!refusedAt('backends[10].base', 'backends[1]'), 'not another backend');
  assert.ok(onForm('backends[0].detect.version') && onForm('model.flag'));
  assert.ok(!onForm('files[0].path'), 'a field only the raw recipe shows');
});

test('a model named by a flag or a variable, one of them', () => {
  assert.deepEqual(modelBy(codex), { by: 'flag', name: '-m' });
  assert.deepEqual(withModel(codex, 'env', 'VIBE_ACTIVE_MODEL').model, { env: 'VIBE_ACTIVE_MODEL' });
});

test("a login's kind: what it needs, and voice's address under voice's own key", () => {
  const env = withLoginKind(codex, 'env');
  assert.deepEqual(env.login, { kind: 'env', env: 'CODEX_HOME', describe: 'A ChatGPT plan.' });
  assert.equal(env.base_url_env, null);
  const voice = withLoginKind(codex, 'voice');
  assert.equal(voice.base_url_env, 'VOICE_BASE_URL');
  assert.equal(voice.protocol, 'openai-chat');
  assert.deepEqual(withLoginKind(env, 'home').login, { kind: 'home', env: 'CODEX_HOME', describe: 'A ChatGPT plan.', mount: '', from: '', files: [] });
});

test('the raw tab: a recipe, or why not', () => {
  assert.deepEqual(parseRecipe('{"id": "x"}'), { recipe: { id: 'x' } });
  assert.deepEqual(parseRecipe('[1]'), { problem: 'a recipe is a JSON object' });
  assert.ok('problem' in parseRecipe('{'));
});

test('a blank recipe has the shape the api asks for', () => {
  const b = blankRecipe();
  assert.equal(backendLine(b), 'container');
  assert.equal(b.reader, 'text');
  assert.deepEqual(b.instruction, { via: 'stdin' });
});
