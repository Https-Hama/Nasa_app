import test from 'node:test';
import assert from 'node:assert/strict';
import { requestMissionReview } from '../src/mission-review-client.js';
import { buildMissionReviewPayload, sanitizeMissionReview } from '../src/mission-review-model.js';

const timestamp = Date.parse('2026-11-15T09:00:00Z');
const record = (overrides = {}) => ({
  id: 'mission-current', timestamp, source: 'measured', protocol: 'orbital-observation-v2', inputMode: 'keyboard', durationSec: 120,
  conditions: { sessionStage: 'complete', faceCheckDurationSec: 30 },
  game: { score: 500, hull: 78, kills: 8, shots: 22, accuracy: 40 },
  cognitive: {
    memory: { protocol: 'pattern-memory-3-4-5-random-v3', rounds: 3, correct: 12, attempts: 12 },
    attention: { protocol: 'focus-go-no-go-random-v3', correct: 7, attempts: 8, falseAlarms: 1, misses: 0, medianReactionMs: 420 },
  },
  ...overrides,
});
const validReview = () => ({
  summary: 'You completed the flight and recorded all three memory rounds and eight focus cues.',
  strengths: ['All three memory patterns were completed.'],
  observations: ['One focus cue received an incorrect response.'],
  nextSteps: ['Repeat the same task in a comfortable setting.'],
  limitations: ['Camera measurements were unavailable in this keyboard session.'],
  provider: 'Gemini', generatedAt: timestamp,
});
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
const requestWith = (response, options = {}) => requestMissionReview(record(), null, { fetcher: async () => response, ...options });

test('a mission review sends only the shared anonymous payload through the dedicated JSON endpoint', async () => {
  const current = record({ name: 'PRIVATE_NAME', diagnosis: 'PRIVATE_NOTE', checkins: { note: 'PRIVATE_CHECKIN' }, video: 'PRIVATE_VIDEO', landmarks: ['PRIVATE_LANDMARKS'] });
  const previous = record({ id: 'earlier', timestamp: timestamp - 86400000 });
  const actual = await requestMissionReview(current, previous, { fetcher: async (url, options) => {
    assert.equal(url, '/api/mission-review');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.equal(options.headers['X-Human-Mission-Review'], 'mission-v1');
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.signal.aborted, false);
    assert.deepEqual(JSON.parse(options.body), { mission: buildMissionReviewPayload(current, previous) });
    assert.doesNotMatch(options.body, /PRIVATE_NAME|PRIVATE_NOTE|PRIVATE_CHECKIN|PRIVATE_VIDEO|PRIVATE_LANDMARKS/);
    return json({ review: { ...validReview(), injected: 'ignored' } });
  } });
  assert.deepEqual(actual, sanitizeMissionReview(validReview()));
  assert.equal('injected' in actual, false);
});

for (const raw of [record({ source: 'demo' }), record({ conditions: { sessionStage: 'flight' } }), record({ conditions: { sessionStage: 'mind' } }), null]) {
  test(`an ineligible ${raw?.source === 'demo' ? 'fictional' : raw?.conditions?.sessionStage || 'invalid'} report never sends a request`, async () => {
    let calls = 0;
    await assert.rejects(requestMissionReview(raw, null, { fetcher: async () => { calls++; return json({ review: validReview() }); } }), /measured missions|Finish the flight and mind check/);
    assert.equal(calls, 0);
  });
}

test('a finalized mission with skipped mind tasks can still receive a limited review', async () => {
  const skipped = record({ cognitive: { memory: { rounds: 0, attempts: 0, correct: 0 }, attention: { attempts: 0, correct: 0 } } });
  await requestMissionReview(skipped, null, { fetcher: async (url, options) => {
    const sent = JSON.parse(options.body).mission;
    assert.equal(sent.memory.complete, false);
    assert.equal(sent.focus.complete, false);
    return json({ review: validReview() });
  } });
});

for (const [status, message] of [[503, 'Gemini is not configured for this deployment.'], [429, 'Gemini request limit reached. Try again later.']]) {
  test(`JSON ${status} preserves the service explanation`, async () => {
    await assert.rejects(requestWith(json({ error: message }, status)), { message });
  });
}

test('a non-string service error receives a readable fallback', async () => {
  await assert.rejects(requestWith(json({ error: {} }, 502)), /Gemini could not review this mission/);
});

for (const status of [200, 404]) {
  test(`hosted HTML ${status} identifies a missing deployed API function`, async () => {
    const response = new Response('<html>App shell</html>', { status, headers: { 'Content-Type': 'text/html' } });
    await assert.rejects(requestWith(response, { hostname: 'nasa-app-ashy.vercel.app' }), error => {
      assert.match(error.message, /deployment.*mission-review API function.*GEMINI_API_KEY.*Production/);
      assert.doesNotMatch(error.message, /npm run dev|START_HUMAN_EXE|localhost link/);
      return true;
    });
  });
}

test('a missing localhost route retains actionable desktop launcher instructions', async () => {
  const response = new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
  await assert.rejects(requestWith(response, { hostname: '127.0.0.1' }), /START_HUMAN_EXE\.cmd or npm run dev/);
});

test('malformed JSON is explained without exposing parser errors', async () => {
  const response = new Response('{"review":', { headers: { 'Content-Type': 'application/json' } });
  await assert.rejects(requestWith(response), /unreadable response.*Restart or redeploy/);
});

for (const review of [null, {}, { ...validReview(), summary: '' }, { ...validReview(), nextSteps: 'not a list' }, { ...validReview(), observations: ['You have a disease.'] }]) {
  test(`an invalid generated review (${review === null ? 'null' : typeof review.summary === 'string' && review.summary ? 'invalid content' : 'missing summary'}) is not accepted`, async () => {
    await assert.rejects(requestWith(json({ review })), /incomplete mission review/);
  });
}

test('a failed connection keeps the measured report available and offers retry', async () => {
  await assert.rejects(requestMissionReview(record(), null, { fetcher: async () => { throw new TypeError('Failed to fetch'); } }), /service could not be reached.*report remains available.*try again/i);
});

for (const name of ['TimeoutError', 'AbortError']) {
  test(`${name} is a readable mission-review timeout`, async () => {
    await assert.rejects(requestMissionReview(record(), null, { fetcher: async () => { throw new DOMException('Request ended', name); } }), /took too long.*report remains available.*try again/i);
  });
}

test('a timeout while reading the response body is also reported as a timeout', async () => {
  const response = { ok: true, headers: new Headers({ 'Content-Type': 'application/json' }), json: async () => { throw new DOMException('Request ended', 'AbortError'); } };
  await assert.rejects(requestWith(response), /took too long/);
});
