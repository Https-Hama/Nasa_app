import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createVercelSuggestionHandler } from '../api/health-suggestions.js';
import { readHostedOrigins, readHostedGeminiConfig } from '../scripts/hosted-gemini-config.mjs';
import { createSuggestionHandler } from '../scripts/gemini-suggestions.mjs';

// Only fictional fixture values and mocked provider responses are used.
const TEST_KEY = 'fictional-hosted-test-key';
const selections = {
  sleep: ['sleep', 'context'], task: ['environment', 'followup'],
  readings: ['technique', 'timing'], general: ['context', 'followup'],
};
const success = async () => ({ ok: true, status: 200, json: async () => ({
  candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(selections) }] } }],
}) });

async function invoke(handler, { host = 'app.example', origin = 'https://app.example', method = 'POST', headers = {}, url = '/api/health-suggestions' } = {}) {
  const result = {};
  result.handled = await handler({
    url, method, resume() {},
    headers: { host, origin, 'x-human-suggestions': 'generic-v1', 'content-length': '0', ...headers },
  }, {
    writeHead(status, responseHeaders) { result.status = status; result.headers = responseHeaders; },
    end(body) { result.body = JSON.parse(body); },
  });
  return result;
}

const rejectingFetcher = () => assert.fail('Rejected request must not call Gemini');

function handler(options = {}) {
  return createSuggestionHandler({ key: TEST_KEY, model: 'gemini-test',
    allowedOrigins: ['https://app.example', 'https://other.example'], fetcher: success, ...options });
}

test('hosted origin configuration accepts exact HTTPS app and platform origins and deduplicates them', () => {
  const actual = readHostedOrigins({
    APP_ORIGIN: ' https://app.example/, https://other.example, https://app.example ',
    VERCEL_URL: 'preview.vercel.app', VERCEL_BRANCH_URL: 'branch.vercel.app',
    VERCEL_PROJECT_PRODUCTION_URL: 'production.vercel.app', URL: 'https://human.netlify.app/',
  });
  assert.deepEqual(new Set(actual), new Set([
    'https://app.example', 'https://other.example', 'https://preview.vercel.app',
    'https://branch.vercel.app', 'https://production.vercel.app', 'https://human.netlify.app',
  ]));
  assert.equal(actual.length, new Set(actual).size);
});

test('malformed, non-HTTPS and non-origin configuration values cannot become trusted origins', () => {
  const invalid = ['http://insecure.example', '*', 'null', 'not a URL',
    'https://user:password@credentials.example', 'https://path.example/extra',
    'https://query.example?name=value', 'https://fragment.example#hash'];
  for (const APP_ORIGIN of invalid) assert.deepEqual(readHostedOrigins({ APP_ORIGIN }), [], APP_ORIGIN);
  assert.deepEqual(readHostedOrigins({
    VERCEL_URL: 'invalid.example/extra', VERCEL_BRANCH_URL: 'invalid.example?name=value',
    VERCEL_PROJECT_PRODUCTION_URL: '*', URL: 'http://insecure.netlify.app',
  }), []);
});

test('hosted Gemini configuration uses explicit runtime credentials and supports the Google alias', () => {
  const primary = readHostedGeminiConfig({ GEMINI_API_KEY: TEST_KEY, GOOGLE_API_KEY: 'fictional-alias',
    GEMINI_MODEL: 'gemini-test', APP_ORIGIN: 'https://app.example',
  });
  assert.equal(primary.key, TEST_KEY);
  assert.equal(primary.model, 'gemini-test');
  assert.deepEqual(primary.allowedOrigins, ['https://app.example']);
  assert.equal(readHostedGeminiConfig({ GOOGLE_API_KEY: 'fictional-alias' }).key, 'fictional-alias');
});

test('a hosted runtime without a key ignores dotenv files even when they exist in its working directory', async t => {
  const root = await mkdtemp(join(tmpdir(), 'human-hosted-gemini-test-'));
  t.after(async () => {
    const target = resolve(root);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.match(basename(target), /^human-hosted-gemini-test-/);
    await rm(target, { recursive: true, force: true });
  });
  await writeFile(join(root, '.env'), 'GEMINI_API_KEY=fictional-file-key\nGEMINI_MODEL=gemini-file\n');
  await writeFile(join(root, '.env.local'), 'GEMINI_API_KEY=fictional-local-file-key\nAPP_ORIGIN=https://file.example\n');
  const moduleUrl = new URL('../scripts/hosted-gemini-config.mjs', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e',
    'const { readHostedGeminiConfig } = await import(process.argv[1]); process.stdout.write(JSON.stringify(readHostedGeminiConfig({})));', moduleUrl,
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  const config = JSON.parse(child.stdout);
  assert.ok(!config.key);
  assert.equal(config.model, 'gemini-3.5-flash-lite');
  assert.deepEqual(config.allowedOrigins, []);
  const result = await invoke(handler({ ...config, key: config.key || '', fetcher: rejectingFetcher }), {
    host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173',
  });
  assert.equal(result.status, 503);
  assert.equal(result.body.code, 'not_configured');
});

test('the suggestions handler accepts a configured same-origin hosted HTTPS request', async () => {
  const result = await invoke(handler());
  assert.equal(result.handled, true);
  assert.equal(result.status, 200);
  assert.match(result.headers['Content-Type'], /application\/json/);
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.deepEqual(result.body, { selections });
  assert.equal(JSON.stringify(result.body).includes(TEST_KEY), false);
});

test('an unconfigured public hostname cannot use the desktop suggestions endpoint', async () => {
  const result = await invoke(handler({ allowedOrigins: [], fetcher: rejectingFetcher }));
  assert.equal(result.status, 403);
  assert.equal(result.body.code, 'forbidden');
});

test('a trusted origin must match the actual request host and cannot rely on forwarded host headers', async () => {
  const endpoint = handler({ fetcher: rejectingFetcher });
  for (const request of [
    { host: 'other.example', origin: 'https://app.example' },
    { host: 'untrusted.example', origin: 'https://app.example' },
    { host: 'untrusted.example', origin: 'https://app.example', headers: {
      'x-forwarded-host': 'app.example', 'x-forwarded-proto': 'https',
    } },
  ]) assert.equal((await invoke(endpoint, request)).status, 403);
});

test('missing, malformed and opaque origins cannot trigger hosted requests', async () => {
  const endpoint = handler({ fetcher: rejectingFetcher });
  for (const origin of ['', 'null', 'https://app.example/', 'https://app.example/path',
    'https://app.example.evil.test', 'not a URL']) {
    assert.equal((await invoke(endpoint, { origin })).status, 403, origin);
  }
  assert.equal((await invoke(endpoint, { headers: { origin: undefined } })).status, 403);
});

test('public HTTP remains rejected even if a caller attempts to configure it as allowed', async () => {
  const result = await invoke(handler({ allowedOrigins: ['http://app.example'], fetcher: rejectingFetcher }), {
    origin: 'http://app.example',
  });
  assert.equal(result.status, 403);
});

test('hosted endpoint rejects GET, missing app headers, bodies and transfer-encoded input', async () => {
  const endpoint = handler({ fetcher: rejectingFetcher });
  for (const request of [
    { method: 'GET' },
    { headers: { 'x-human-suggestions': undefined } },
    { headers: { 'content-length': '5' } },
    { headers: { 'content-length': 'invalid' } },
    { headers: { 'transfer-encoding': 'chunked' } },
  ]) assert.equal((await invoke(endpoint, request)).status, 403);
});

test('localhost HTTP controls remain available with no hosted-origin configuration', async () => {
  for (const host of ['127.0.0.1:5173', 'localhost:4173', '[::1]:4173']) {
    const result = await invoke(handler({ allowedOrigins: [] }), { host, origin: `http://${host}` });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { selections });
  }
});

test('the Vercel API function serves the known production site without requiring a separate origin variable', async () => {
  const endpoint = createVercelSuggestionHandler({ env: { GEMINI_API_KEY: TEST_KEY, GEMINI_MODEL: 'gemini-test' },
    fetcher: async (url, options) => {
      assert.match(url, /\/models\/gemini-test:generateContent$/);
      assert.equal(options.headers['x-goog-api-key'], TEST_KEY);
      assert.equal(options.body.includes(TEST_KEY), false);
      assert.match(options.body, /no patient information/);
      return success();
    },
  });
  const result = await invoke(endpoint, { host: 'nasa-app-ashy.vercel.app', origin: 'https://nasa-app-ashy.vercel.app' });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { selections });
});

test('the Vercel API accepts configured preview origins only when the request host matches', async () => {
  const endpoint = createVercelSuggestionHandler({ env: { GEMINI_API_KEY: TEST_KEY, VERCEL_URL: 'nasa-preview.vercel.app' }, fetcher: success });
  assert.equal((await invoke(endpoint, { host: 'nasa-preview.vercel.app', origin: 'https://nasa-preview.vercel.app' })).status, 200);
  assert.equal((await invoke(endpoint, { host: 'nasa-app-ashy.vercel.app', origin: 'https://nasa-preview.vercel.app' })).status, 403);
  assert.equal((await invoke(endpoint, { host: 'unknown.vercel.app', origin: 'https://unknown.vercel.app' })).status, 403);
});

test('the Vercel API reports a missing runtime key as JSON rather than reading local dotenv credentials', async () => {
  const endpoint = createVercelSuggestionHandler({ env: {}, fetcher: rejectingFetcher });
  const result = await invoke(endpoint, { host: 'nasa-app-ashy.vercel.app', origin: 'https://nasa-app-ashy.vercel.app' });
  assert.equal(result.status, 503);
  assert.match(result.headers['Content-Type'], /application\/json/);
  assert.equal(result.body.code, 'not_configured');
  assert.match(result.body.error, /hosting|environment|server/i);
});

test('the Vercel API returns a JSON 404 for a different route', async () => {
  const endpoint = createVercelSuggestionHandler({ env: {}, fetcher: rejectingFetcher });
  const result = await invoke(endpoint, { url: '/different-route', host: 'nasa-app-ashy.vercel.app', origin: 'https://nasa-app-ashy.vercel.app' });
  assert.equal(result.status, 404);
  assert.match(result.headers['Content-Type'], /application\/json/);
  assert.equal(result.body.code, 'not_found');
});

test('the Vercel API rejects user payloads and method changes before any provider request', async () => {
  const endpoint = createVercelSuggestionHandler({ env: { GEMINI_API_KEY: TEST_KEY }, fetcher: rejectingFetcher });
  const production = { host: 'nasa-app-ashy.vercel.app', origin: 'https://nasa-app-ashy.vercel.app' };
  for (const change of [{ method: 'GET' }, { headers: { 'content-length': '25' } }, { headers: { 'transfer-encoding': 'chunked' } }]) {
    assert.equal((await invoke(endpoint, { ...production, ...change })).status, 403);
  }
});
