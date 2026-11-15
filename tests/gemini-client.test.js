import test from 'node:test';
import assert from 'node:assert/strict';
import { requestGeminiSuggestions } from '../src/gemini-client.js';

const validSelections = () => ({
  sleep: ['sleep', 'timing'],
  task: ['environment', 'context'],
  readings: ['technique', 'followup'],
  general: ['context', 'timing'],
});
const jsonResponse = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
});
const requestWith = (response, hostname) => requestGeminiSuggestions({ fetcher: async () => response, hostname });

for (const status of [200, 404]) {
  test(`HTML ${status} explains the missing local Gemini route and how to start it`, async () => {
    const response = new Response('<!doctype html><html><body>App shell or missing route</body></html>', {
      status, headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
    await assert.rejects(requestWith(response), error => {
      assert.match(error.message, /service is not running at this address/i);
      assert.match(error.message, /START_HUMAN_EXE\.cmd/);
      assert.match(error.message, /npm run dev/);
      assert.match(error.message, /localhost link/i);
      assert.doesNotMatch(error.message, /unexpected token|JSON/i);
      return true;
    });
  });
}

for (const status of [200, 404]) {
  test(`hosted HTML ${status} explains how to repair the deployment instead of starting a desktop server`, async () => {
    const response = new Response('<!doctype html><html><body>Hosted app shell or missing API</body></html>', {
      status, headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
    await assert.rejects(requestWith(response, 'nasa-app-ashy.vercel.app'), error => {
      assert.match(error.message, /missing from this deployment/i);
      assert.match(error.message, /redeploy/i);
      assert.match(error.message, /API function/i);
      assert.match(error.message, /GEMINI_API_KEY/);
      assert.match(error.message, /Production environment/i);
      assert.doesNotMatch(error.message, /START_HUMAN_EXE|npm run dev|localhost link|unexpected token/i);
      return true;
    });
  });
}

for (const hostname of ['127.0.0.1', '[::1]', '::1']) {
  test(`loopback ${hostname} retains actionable local launcher instructions`, async () => {
    const response = new Response('<html>Missing local route</html>', { status: 404, headers: { 'Content-Type': 'text/html' } });
    await assert.rejects(requestWith(response, hostname), error => {
      assert.match(error.message, /START_HUMAN_EXE\.cmd/);
      assert.match(error.message, /npm run dev/);
      assert.doesNotMatch(error.message, /Production environment|redeploy/i);
      return true;
    });
  });
}
test('a response without a JSON content type reports the missing local service', async () => {
  await assert.rejects(requestWith(new Response('Not found', { status: 404 })), /service is not running at this address/i);
});

for (const [status, message] of [
  [503, 'Gemini is not configured. Set GEMINI_API_KEY on the local server.'],
  [429, 'Gemini is busy or rate limited. Try again shortly.'],
]) {
  test(`JSON ${status} preserves the service error for actionable feedback`, async () => {
    await assert.rejects(requestWith(jsonResponse({ error: message }, status)), { message });
  });
}

test('an unsuccessful JSON response without a usable error gets a readable fallback', async () => {
  await assert.rejects(requestWith(jsonResponse({ error: { upstream: 'unusable error object' } }, 502)), /Gemini could not provide suggestions/);
});

test('malformed JSON explains that the response is unreadable', async () => {
  const response = new Response('{"selections":', { headers: { 'Content-Type': 'application/json' } });
  await assert.rejects(requestWith(response), /unreadable response.*Restart or redeploy the app server/i);
});

const invalidCandidates = [
  ['null result', () => null],
  ['missing selections', () => ({})],
  ['null selections', () => ({ selections: null })],
  ['missing topic', () => { const selections = validSelections(); delete selections.general; return { selections }; }],
  ['empty topic list', () => ({ selections: { ...validSelections(), sleep: [] } })],
  ['single candidate', () => ({ selections: { ...validSelections(), task: ['environment'] } })],
  ['duplicate-only candidates', () => ({ selections: { ...validSelections(), readings: ['timing', 'timing'] } })],
  ['unapproved candidate', () => ({ selections: { ...validSelections(), sleep: ['sleep', 'unreviewed-advice'] } })],
  ['wrong candidate type', () => ({ selections: { ...validSelections(), readings: ['technique', 123] } })],
  ['non-array topic', () => ({ selections: { ...validSelections(), general: 'context,followup' } })],
];
for (const [name, value] of invalidCandidates) {
  test(`successful JSON with ${name} cannot be presented as valid suggestions`, async () => {
    await assert.rejects(requestWith(jsonResponse(value())), /incomplete suggestion list/i);
  });
}

test('a failed connection produces a retryable service message', async () => {
  await assert.rejects(requestGeminiSuggestions({ fetcher: async () => { throw new TypeError('Failed to fetch'); } }), /service could not be reached.*connection.*try again/i);
});

for (const name of ['TimeoutError', 'AbortError']) {
  test(`${name} produces a timeout message without exposing the low-level error`, async () => {
    await assert.rejects(requestGeminiSuggestions({ fetcher: async () => { throw new DOMException('Synthetic request interruption', name); } }), {
      message: 'Gemini took too long to respond. Please try again.',
    });
  });
}

test('valid approved selections are returned through the generic local endpoint without player data', async () => {
  const selections = validSelections();
  let calls = 0;
  const actual = await requestGeminiSuggestions({ fetcher: async (url, options) => {
    calls++;
    assert.equal(url, '/api/health-suggestions');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['X-Human-Suggestions'], 'generic-v1');
    assert.equal(options.body, undefined, 'Player readings, reports and names are not sent');
    assert.ok(options.signal instanceof AbortSignal, 'The request can time out');
    assert.equal(options.signal.aborted, false);
    return jsonResponse({ selections });
  } });
  assert.equal(calls, 1);
  assert.deepEqual(actual, selections);
});
