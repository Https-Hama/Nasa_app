import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { readGeminiConfig } from '../scripts/gemini-config.mjs';
import { getGeminiSuggestions, createSuggestionHandler, GeminiSuggestionError } from '../scripts/gemini-suggestions.mjs';

// These credentials are deliberately fictional. Never read the developer's real environment.
const TEST_KEY = 'fictional-test-key-never-return';
const RAW_DETAIL = 'untrusted-upstream-detail-never-return';
const selections = {
  sleep: ['sleep', 'context'], task: ['environment', 'followup'],
  readings: ['technique', 'timing'], general: ['context', 'followup'],
};
const success = () => ({ ok: true, status: 200, json: async () => ({
  candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(selections) }] } }],
}) });

async function fixture(t, files = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'human-gemini-test-'));
  t.after(async () => {
    // Check the absolute cleanup target is one dedicated fixture beneath the OS temp directory.
    const target = resolve(directory);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.match(basename(target), /^human-gemini-test-/);
    await rm(target, { recursive: true, force: true });
  });
  for (const [filename, text] of Object.entries(files)) await writeFile(join(directory, filename), text);
  return directory;
}

function assertSafeError(error, code, status) {
  assert.ok(error instanceof GeminiSuggestionError);
  assert.equal(error.code, code);
  assert.equal(error.status, status);
  assert.ok(error.message.length > 12, 'Return an explanatory message');
  const exposed = error.message + JSON.stringify(error);
  assert.equal(exposed.includes(TEST_KEY), false);
  assert.equal(exposed.includes(RAW_DETAIL), false);
  return true;
}

async function invoke(handler, overrides = {}) {
  const request = {
    url: '/api/health-suggestions', method: 'POST', resume() {},
    headers: { host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173',
      'x-human-suggestions': 'generic-v1', 'content-length': '0' },
    ...overrides,
  };
  const result = {};
  result.handled = await handler(request, {
    writeHead(status, headers) { result.status = status; result.headers = headers; },
    end(body) { result.body = JSON.parse(body); },
  });
  return result;
}

test('Gemini config resolves project-root dotenv files from a different working directory in the documented order', async t => {
  const root = await fixture(t, {
    '.env': 'GEMINI_API_KEY=fixture-base\nGEMINI_MODEL=gemini-base\n',
    '.env.local': 'GEMINI_API_KEY=fixture-local\nGEMINI_MODEL=gemini-local\n',
    '.env.test': 'GEMINI_API_KEY=fixture-mode\nGEMINI_MODEL=gemini-mode\n',
    '.env.test.local': 'GEMINI_API_KEY="fixture-mode-local"\nGEMINI_MODEL=gemini-mode-local\n',
  });
  assert.notEqual(resolve(root), resolve(process.cwd()));
  assert.deepEqual(await readGeminiConfig({ root, mode: 'test', env: {} }), {
    key: 'fixture-mode-local', model: 'gemini-mode-local',
  });
  assert.deepEqual(await readGeminiConfig({ root, mode: 'other', env: {} }), {
    key: 'fixture-local', model: 'gemini-local',
  });
  assert.deepEqual(await readGeminiConfig({ root, mode: 'test', env: {
    GEMINI_API_KEY: 'fixture-process', GEMINI_MODEL: 'gemini-process',
  } }), { key: 'fixture-process', model: 'gemini-process' });
});

test('an explicit process API-key alias overrides every file alias without loading an ambient secret', async t => {
  const root = await fixture(t, { '.env.local': 'GEMINI_API_KEY=fixture-file\nGEMINI_MODEL=gemini-file\n' });
  const google = await readGeminiConfig({ root, env: { GOOGLE_API_KEY: 'fixture-google-process' } });
  assert.equal(google.key, 'fixture-google-process');
  const primary = await readGeminiConfig({ root, env: {
    GEMINI_API_KEY: 'fixture-primary-process', GOOGLE_API_KEY: 'fixture-google-process',
  } });
  assert.equal(primary.key, 'fixture-primary-process');
  const aliasRoot = await fixture(t, { '.env': 'GOOGLE_API_KEY=fixture-google-file\n' });
  assert.equal((await readGeminiConfig({ root: aliasRoot, env: {} })).key, 'fixture-google-file');
});

test('missing dotenv files keep configuration unavailable and select the supported default model', async t => {
  const root = await fixture(t);
  const config = await readGeminiConfig({ root, env: {} });
  assert.ok(!config.key);
  assert.equal(config.model, 'gemini-3.5-flash-lite');
  await assert.rejects(getGeminiSuggestions({ key: '', model: config.model,
    fetcher: () => assert.fail('Missing configuration must not call Gemini'),
  }), error => assertSafeError(error, 'not_configured', 503));
});

test('Gemini requests contain only the generic question bank, with the key in its request header', async () => {
  const result = await getGeminiSuggestions({ key: TEST_KEY, model: 'gemini-test', fetcher: async (url, options) => {
    assert.equal(new URL(url).hostname, 'generativelanguage.googleapis.com');
    assert.equal(url.includes(TEST_KEY), false);
    assert.equal(options.headers['x-goog-api-key'], TEST_KEY);
    assert.equal(options.body.includes(TEST_KEY), false);
    assert.match(options.body, /no patient information/);
    assert.match(options.body, /generic question bank/);
    const envelope = await success().json();
    envelope.candidates[0].content.parts.unshift({ thought: true, text: 'This thought is not JSON' });
    return { ok: true, status: 200, json: async () => envelope };
  } });
  assert.deepEqual(result, selections);
});

for (const [status, code, outgoing, apiStatus] of [
  [400, 'authentication', 502, 'API_KEY_INVALID'],
  [401, 'authentication', 502, 'UNAUTHENTICATED'],
  [403, 'authentication', 502, 'PERMISSION_DENIED'],
  [404, 'model_unavailable', 502, 'NOT_FOUND'],
  [429, 'rate_limited', 503, 'RESOURCE_EXHAUSTED'],
  [503, 'upstream_unavailable', 502, 'UNAVAILABLE'],
]) {
  test(`upstream HTTP ${status} maps to safe ${code} error`, async () => {
    await assert.rejects(getGeminiSuggestions({ key: TEST_KEY, model: 'gemini-test', fetcher: async () => ({
      ok: false, status, json: async () => ({ error: {
        code: status, status: apiStatus, message: `${RAW_DETAIL} ${TEST_KEY}`,
        details: [{ reason: apiStatus }],
      } }),
    }) }), error => assertSafeError(error, code, outgoing));
  });
}

test('network and timeout failures return safe actionable errors without exposing thrown request details', async () => {
  await assert.rejects(getGeminiSuggestions({ key: TEST_KEY, model: 'gemini-test',
    fetcher: async () => { throw new TypeError(`${RAW_DETAIL} ${TEST_KEY}`); },
  }), error => assertSafeError(error, 'network_error', 502));
  await assert.rejects(getGeminiSuggestions({ key: TEST_KEY, model: 'gemini-test',
    fetcher: async () => { throw new DOMException(`${RAW_DETAIL} ${TEST_KEY}`, 'TimeoutError'); },
  }), error => assertSafeError(error, 'timeout', 504));
});

test('malformed, incomplete, and unapproved model outputs remain safe invalid-response errors', async () => {
  const responses = [
    { ok: true, status: 200, json: async () => { throw new SyntaxError(`${RAW_DETAIL} ${TEST_KEY}`); } },
    { ok: true, status: 200, json: async () => ({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{}' }] } }] }) },
    { ok: true, status: 200, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: `${RAW_DETAIL} ${TEST_KEY}` }] } }] }) },
    { ok: true, status: 200, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ ...selections, sleep: ['unapproved', 'unapproved'] }) }] } }] }) },
  ];
  for (const response of responses) await assert.rejects(getGeminiSuggestions({ key: TEST_KEY,
    model: 'gemini-test', fetcher: async () => response,
  }), error => assertSafeError(error, 'invalid_response', 502));
});

test('the local handler returns JSON configuration errors and never sends requests without a key', async () => {
  const result = await invoke(createSuggestionHandler({ key: '', model: 'gemini-test',
    fetcher: () => assert.fail('Missing key must not send requests'),
  }));
  assert.equal(result.handled, true);
  assert.equal(result.status, 503);
  assert.match(result.headers['Content-Type'], /application\/json/);
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.equal(result.body.code, 'not_configured');
  assert.match(result.body.error, /configur/i);
});

test('the local handler preserves safe upstream status and error codes instead of exposing raw details', async () => {
  const handler = createSuggestionHandler({ key: TEST_KEY, model: 'gemini-test', fetcher: async () => ({
    ok: false, status: 429, json: async () => ({ error: { message: `${RAW_DETAIL} ${TEST_KEY}` } }),
  }) });
  const result = await invoke(handler);
  assert.equal(result.status, 503);
  assert.equal(result.body.code, 'rate_limited');
  assert.equal(JSON.stringify(result.body).includes(TEST_KEY), false);
  assert.equal(JSON.stringify(result.body).includes(RAW_DETAIL), false);
});

test('concurrent local requests share one Gemini call and later requests use the cached selection', async () => {
  let calls = 0, release;
  const gate = new Promise(resolveGate => { release = resolveGate; });
  const handler = createSuggestionHandler({ key: TEST_KEY, model: 'gemini-test', fetcher: async () => {
    calls++;
    await gate;
    return success();
  } });
  const first = invoke(handler), second = invoke(handler);
  assert.equal(calls, 1);
  release();
  for (const result of await Promise.all([first, second, invoke(handler)])) {
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { selections });
  }
  assert.equal(calls, 1);
  assert.deepEqual((await invoke(handler)).body, { selections });
  assert.equal(calls, 1);
});

test('the local handler rejects nonlocal origins or input bodies before calling Gemini', async () => {
  const handler = createSuggestionHandler({ key: TEST_KEY, model: 'gemini-test',
    fetcher: () => assert.fail('Untrusted input must not call Gemini'),
  });
  for (const headers of [
    { host: '127.0.0.1:5173', origin: 'https://untrusted.example', 'x-human-suggestions': 'generic-v1' },
    { host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173', 'x-human-suggestions': 'generic-v1', 'content-length': '42' },
  ]) assert.equal((await invoke(handler, { headers })).status, 403);
  assert.equal((await invoke(handler, { url: '/not-the-suggestions-api' })).handled, false);
});
