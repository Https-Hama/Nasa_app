import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { buildMissionReviewPayload, sanitizeMissionReviewPayload, sanitizeMissionReview } from '../src/mission-review-model.js';
import { createMissionReviewHandler, getGeminiMissionReview, MISSION_REVIEW_MAX_BYTES } from '../scripts/gemini-mission-review.mjs';
import { createVercelMissionReviewHandler } from '../api/mission-review.js';

const KEY = 'fictional-review-test-key';
const PRIVATE = 'PRIVATE-identity-note-camera-payload';
const review = () => ({ summary: 'You completed the mission and recalled all three memory rounds.',
  strengths: ['You completed 12 pattern answers.'], observations: ['Seven of eight focus responses were correct.'],
  nextSteps: ['Repeat the same task conditions next time.'], limitations: ['Camera observations are approximate and depend on framing.'] });
const response = output => ({ ok: true, status: 200, json: async () => ({ candidates: [{ finishReason: 'STOP',
  content: { parts: [{ text: JSON.stringify(output ?? review()) }] } }] }) });
function record(overrides = {}) {
  return { id: 'private-local-id', timestamp: 1700000000000, source: 'measured', protocol: 'orbital-observation-v2',
    inputMode: 'motion', durationSec: 120, conditions: { sessionStage: 'complete', faceCheckDurationSec: 30 },
    game: { score: 400, hull: 70, kills: 8, shots: 20, accuracy: 40 },
    cognitive: { memory: { protocol: 'pattern-memory-3-4-5-random-v3', rounds: 3, correct: 12, attempts: 12 },
      attention: { protocol: 'focus-go-no-go-random-v3', correct: 7, attempts: 8, falseAlarms: 1, misses: 0, medianReactionMs: 420 } },
    observations: { protocol: 'orbital-observation-v2', durationSec: 150,
      face: { baselineReady: true, validSeconds: 27, coverage: .9, meanFps: 18, blinkRate: 12, eyeClosurePct: 5,
        longClosureCount: 0, longestClosureSec: .3, mouthOpenEvents: 2, headRollMeanDeg: -1, headRollRangeDeg: 8 },
      body: { protocol: 'torso-anchor-v2', validSeconds: 100, coverage: .85, fullBodyCoverage: .8,
        leftHandTravel: 12, rightHandTravel: 10, kneeLifts: 3, squats: 2, shields: 4, boosts: 3, meanTorsoSway: .1 } },
    ...overrides };
}
const mission = () => buildMissionReviewPayload(record());
function endpoint(options = {}) {
  return createMissionReviewHandler({ key: KEY, model: 'gemini-test', fetcher: async () => response(),
    allowedOrigins: ['https://app.example'], ...options });
}
async function invoke(handler, options = {}) {
  const { body = { mission: mission() }, stream = false, headers = {}, host = 'app.example', origin = 'https://app.example',
    method = 'POST', url = '/api/mission-review' } = options;
  const request = stream ? Readable.from(typeof body === 'string' ? [body.slice(0, 40), body.slice(40)] : [JSON.stringify(body)]) : { body, resume() {} };
  Object.assign(request, { method, url, headers: { host, origin, 'content-type': 'application/json', 'x-human-mission-review': 'mission-v1', ...headers } });
  const result = {};
  result.handled = await handler(request, {
    writeHead(status, responseHeaders) { result.status = status; result.headers = responseHeaders; },
    end(text) { result.body = JSON.parse(text); },
  });
  return result;
}
const noFetch = () => assert.fail('Rejected request must not reach the provider');

test('mission payload includes derived game/task evidence and strips every identity, note and raw camera field', () => {
  const raw = record();
  Object.assign(raw, { name: PRIVATE, player: PRIVATE, diagnosis: PRIVATE, video: PRIVATE });
  raw.id = PRIVATE; raw.observations.face.landmarks = [PRIVATE]; raw.observations.face.qualityReasons = [PRIVATE];
  const payload = buildMissionReviewPayload(raw);
  assert.equal(payload.mission.game.kills, 8); assert.equal(payload.memory.complete, true); assert.equal(payload.focus.complete, true);
  assert.equal(payload.face.available, true); assert.equal(payload.body.available, true);
  const text = JSON.stringify(payload);
  assert.equal(text.includes(PRIVATE), false);
  for (const field of ['timestamp', 'diagnosis', 'landmarks', 'video', 'name', 'player']) assert.equal(text.includes('"' + field + '"'), false);
});

test('demo and in-progress missions cannot create Gemini review requests', () => {
  assert.equal(buildMissionReviewPayload(record({ source: 'demo' })), null);
  for (const sessionStage of ['flight', 'mind']) assert.equal(buildMissionReviewPayload(record({ conditions: { sessionStage } })), null);
  assert.equal(buildMissionReviewPayload(record({ durationSec: 0 })), null);
});

test('poor camera evidence stays unavailable and partial tasks are explicit rather than completed or reassuring zeroes', () => {
  const raw = record();
  Object.assign(raw.observations.face, { baselineReady: false, validSeconds: 3, coverage: .1 });
  Object.assign(raw.observations.body, { validSeconds: 8, coverage: .4 });
  Object.assign(raw.cognitive.memory, { rounds: 1, correct: 1, attempts: 2 });
  Object.assign(raw.cognitive.attention, { correct: 0, attempts: 0 });
  const payload = buildMissionReviewPayload(raw);
  assert.equal(payload.face.available, false); assert.ok(Object.values(payload.face.metrics).every(value => value === null));
  assert.equal(payload.body.available, false); assert.ok(Object.values(payload.body.metrics).every(value => value === null));
  assert.equal(payload.memory.complete, false); assert.equal(payload.memory.accuracy, 50);
  assert.equal(payload.focus.complete, false); assert.equal(payload.focus.accuracy, null); assert.equal(payload.focus.falseAlarms, null);
  assert.equal(payload.focus.medianReactionMs, null);
});

test('portrait upper-body observations remain useful while unobserved leg metrics and slow blink sampling are withheld', () => {
  const raw = record(); raw.observations.body.fullBodyCoverage = .2; raw.observations.face.meanFps = 7;
  const payload = buildMissionReviewPayload(raw);
  assert.equal(payload.body.available, true); assert.equal(payload.body.metrics.leftHandTravel, 12);
  for (const key of ['kneeLifts', 'squats', 'boosts']) assert.equal(payload.body.metrics[key], null);
  assert.equal(payload.face.metrics.blinkRate, null); assert.equal(payload.face.metrics.eyeClosurePct, 5);
});

test('previous comparisons use actual report compatibility and never include IDs or dates', () => {
  const previous = record({ id: PRIVATE, timestamp: 1699900000000 }); previous.cognitive.memory.correct = 9;
  const payload = buildMissionReviewPayload(record(), previous);
  assert.equal(payload.comparison.available, true); assert.equal(payload.comparison.metrics.memoryAccuracy.delta, 25);
  assert.equal(JSON.stringify(payload).includes(PRIVATE), false);
  const oldProtocol = structuredClone(previous); oldProtocol.cognitive.memory.protocol = 'pattern-memory-3-4-5-v2';
  assert.equal(buildMissionReviewPayload(record(), oldProtocol).comparison.metrics.memoryAccuracy, undefined);
  assert.equal(buildMissionReviewPayload(record({ durationSec: 90 }), previous).comparison.available, false);
  assert.equal(buildMissionReviewPayload(record({ conditions: { sessionStage: 'complete', inputModeChanged: true } }), previous).comparison.available, false);
  assert.equal(buildMissionReviewPayload(record(), record({ source: 'demo', timestamp: 1699900000000 })).comparison.available, false);
});

test('server payload normalization drops arbitrary text, recomputes task percentages and reapplies evidence gates', () => {
  const raw = mission(); raw.name = PRIVATE; raw.memory.accuracy = 1; raw.memory.notes = PRIVATE;
  raw.face.available = true; raw.face.coverage = .1; raw.face.metrics.comment = PRIVATE;
  const safe = sanitizeMissionReviewPayload(raw);
  assert.equal(safe.memory.accuracy, 100); assert.equal(safe.face.available, false);
  assert.equal(JSON.stringify(safe).includes(PRIVATE), false);
  assert.equal(sanitizeMissionReviewPayload({ ...raw, mission: { ...raw.mission, durationSec: Infinity } }), null);
});

test('review output is bounded, whitelisted, and accepts ordinary disclaimers while rejecting clinical claims', () => {
  const safe = sanitizeMissionReview({ ...review(), arbitrary: PRIVATE, provider: PRIVATE, generatedAt: 123 });
  assert.equal(safe.arbitrary, undefined); assert.equal(safe.provider, 'Gemini'); assert.equal(safe.generatedAt, 123);
  assert.equal(sanitizeMissionReview({ ...review(), summary: 'You have depression and need treatment.' }), null);
  assert.equal(sanitizeMissionReview({ ...review(), nextSteps: ['Start medication before your next game.'] }), null);
  assert.ok(sanitizeMissionReview({ ...review(), limitations: ['This is not a medical diagnosis.', 'These results cannot establish fatigue.'] }));
  assert.equal(sanitizeMissionReview({ ...review(), summary: 'x'.repeat(701) }), null);
  assert.equal(sanitizeMissionReview({ ...review(), strengths: ['one', 'two', 'three', 'four'] }), null);
  assert.equal(sanitizeMissionReview({ ...review(), limitations: [PRIVATE.repeat(50)] }), null);
});

test('Gemini receives only the canonical anonymous mission, a structured schema, and a server-held key header', async () => {
  const payload = mission(); payload.identity = PRIVATE;
  const result = await getGeminiMissionReview({ mission: payload, key: KEY, model: 'gemini-test', fetcher: async (url, options) => {
    assert.equal(url.includes(KEY), false); assert.equal(options.headers['x-goog-api-key'], KEY);
    const sent = JSON.parse(options.body);
    assert.equal(options.body.includes(PRIVATE), false); assert.equal(options.body.includes(KEY), false);
    assert.equal(JSON.parse(sent.contents[0].parts[0].text).mission.game.kills, 8);
    assert.equal(sent.generationConfig.maxOutputTokens, 1600); assert.equal(sent.generationConfig.responseMimeType, 'application/json');
    assert.match(sent.systemInstruction.parts[0].text, /Null means unavailable/);
    assert.match(sent.systemInstruction.parts[0].text, /do not infer identity/i);
    return response();
  } });
  assert.equal(result.provider, 'Gemini'); assert.ok(result.generatedAt > 0); assert.equal(result.summary, review().summary);
});

test('incomplete, malformed and clinical model replies fail safely without raw response detail', async () => {
  const outputs = [
    { ok: true, json: async () => ({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [] } }] }) },
    { ok: true, json: async () => { throw new SyntaxError(PRIVATE + KEY); } },
    response({ summary: PRIVATE }), response({ ...review(), observations: ['You have a disease.'] }),
  ];
  for (const output of outputs) await assert.rejects(getGeminiMissionReview({ mission: mission(), key: KEY,
    fetcher: async () => output,
  }), error => error.code === 'invalid_response' && !error.message.includes(PRIVATE) && !error.message.includes(KEY));
});

test('provider authentication, quota, network and timeout failures have stable safe error codes', async () => {
  for (const [status, code] of [[403, 'authentication'], [429, 'rate_limited'], [404, 'model_unavailable']]) {
    await assert.rejects(getGeminiMissionReview({ mission: mission(), key: KEY, fetcher: async () => ({
      ok: false, status, json: async () => ({ error: { message: PRIVATE + KEY } }),
    }) }), error => error.code === code && !error.message.includes(KEY));
  }
  for (const [failure, code] of [[new TypeError(PRIVATE + KEY), 'network_error'], [new DOMException(PRIVATE + KEY, 'TimeoutError'), 'timeout']]) {
    await assert.rejects(getGeminiMissionReview({ mission: mission(), key: KEY, fetcher: async () => { throw failure; } }), error => error.code === code && !error.message.includes(PRIVATE));
  }
});

test('parsed Vercel bodies and bounded Node streams both produce JSON reviews', async () => {
  for (const stream of [false, true]) {
    const result = await invoke(endpoint(), { stream });
    assert.equal(result.status, 200); assert.equal(result.body.review.provider, 'Gemini');
    assert.match(result.headers['Content-Type'], /application\/json/); assert.equal(result.headers['Cache-Control'], 'no-store');
  }
});

test('origin, method, app header, content type and advertised size are checked before provider calls', async () => {
  const handler = endpoint({ fetcher: noFetch });
  for (const [options, status] of [
    [{ origin: 'https://other.example' }, 403], [{ host: 'other.example' }, 403], [{ origin: undefined, headers: { origin: undefined } }, 403],
    [{ method: 'GET' }, 403], [{ headers: { 'x-human-mission-review': 'wrong' } }, 403],
    [{ headers: { 'content-type': 'text/plain' } }, 415], [{ headers: { 'content-length': String(MISSION_REVIEW_MAX_BYTES + 1) } }, 413],
  ]) assert.equal((await invoke(handler, options)).status, status);
});

test('oversized parsed and streamed bodies are bounded by UTF-8 bytes, and invalid JSON never reaches Gemini', async () => {
  const handler = endpoint({ fetcher: noFetch });
  const tooLarge = JSON.stringify({ mission: mission(), extra: '界'.repeat(17000) });
  for (const stream of [false, true]) assert.equal((await invoke(handler, { body: tooLarge, stream })).status, 413);
  assert.equal((await invoke(handler, { body: '{invalid' })).body.code, 'invalid_json');
  assert.equal((await invoke(handler, { body: { mission: { version: 1 } } })).body.code, 'invalid_mission');
});

test('canonical payloads coalesce concurrent reviews and reuse cached output without storing identities', async () => {
  let calls = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const handler = endpoint({ fetcher: async () => { calls++; await gate; return response(); } });
  const first = invoke(handler), second = invoke(handler, { body: { mission: { ...mission(), identity: PRIVATE } } });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 1); release();
  const results = await Promise.all([first, second]); assert.deepEqual(results[0].body.review, results[1].body.review);
  assert.equal((await invoke(handler)).status, 200); assert.equal(calls, 1);
});

test('review cache is capped and evicts older fingerprints', async () => {
  let calls = 0;
  const handler = endpoint({ fetcher: async () => { calls++; return response(); } });
  for (let score = 0; score < 33; score++) {
    const payload = mission(); payload.mission.game.score = score;
    assert.equal((await invoke(handler, { body: { mission: payload } })).status, 200);
  }
  const original = mission(); original.mission.game.score = 0;
  assert.equal((await invoke(handler, { body: { mission: original } })).status, 200); assert.equal(calls, 34);
});

test('desktop localhost and the Vercel production wrapper accept only intended JSON requests', async () => {
  assert.equal((await invoke(endpoint(), { host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173' })).status, 200);
  const production = { host: 'nasa-app-ashy.vercel.app', origin: 'https://nasa-app-ashy.vercel.app' };
  const wrapper = createVercelMissionReviewHandler({ env: { GEMINI_API_KEY: KEY }, fetcher: async () => response() });
  assert.equal((await invoke(wrapper, production)).status, 200);
  assert.equal((await invoke(wrapper, { ...production, url: '/unknown' })).status, 404);
  const missing = createVercelMissionReviewHandler({ env: {}, fetcher: noFetch });
  const result = await invoke(missing, production); assert.equal(result.status, 503); assert.equal(result.body.code, 'not_configured');
});