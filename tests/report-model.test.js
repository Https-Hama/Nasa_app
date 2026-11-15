import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../src/report-model.js';

const TODAY = Date.parse('2026-11-14T09:00:00Z');

function record(overrides = {}) {
  return {
    id: 'measured-today', timestamp: TODAY, source: 'measured',
    protocol: 'orbital-observation-v2', inputMode: 'motion', durationSec: 120,
    game: { score: 480, hull: 76, kills: 8, shots: 20, accuracy: 40 },
    observations: {
      protocol: 'orbital-observation-v2', durationSec: 150,
      face: { validSeconds: 27, coverage: 0.9, meanFps: 20, blinkCount: 5,
        blinkRate: 12, eyeClosurePct: 8, longClosureCount: 1, longestClosureSec: 0.6,
        mouthOpenEvents: 2, headRollMeanDeg: -1, headRollRangeDeg: 9,
        baselineReady: true, qualityReasons: [] },
      body: { validSeconds: 100, coverage: 0.85, fullBodyCoverage: 0.8,
        leftHandTravel: 24, rightHandTravel: 28, kneeLifts: 5, squats: 3,
        shields: 4, boosts: 5, meanTorsoSway: 0.12, qualityReasons: [] },
    },
    cognitive: { memory: { correct: 2, attempts: 3, rounds: 3, accuracy: 66.6666666667 },
      attention: { correct: 8, attempts: 10, falseAlarms: 1, misses: 1, medianReactionMs: 420 } },
    ...overrides,
  };
}

function earlier(overrides = {}) {
  return record({ id: 'measured-yesterday', timestamp: TODAY - 86400000, ...overrides });
}

test('sanitizer strips camera payloads and all unknown nested fields', () => {
  assert.equal(typeof model.sanitizeRecord, 'function');
  const raw = record();
  raw.video = 'secret'; raw.landmarks = [[1, 2, 3]]; raw.healthScore = 99;
  raw.observations.face.landmarks = [{ x: 0.5 }];
  raw.observations.face.pixels = [255]; raw.cognitive.memory.diagnosis = 'fiction';
  const safe = model.sanitizeRecord(raw);
  assert.equal(safe.id, 'measured-today');
  assert.equal(safe.observations.face.headRollMeanDeg, -1);
  const json = JSON.stringify(safe);
  for (const field of ['video', 'landmarks', 'healthScore', 'pixels', 'diagnosis']) {
    assert.equal(json.includes(field), false);
  }
  assert.notEqual(safe.observations.face, raw.observations.face);
  assert.deepEqual(raw.observations.face.landmarks, [{ x: 0.5 }]);
});

test('sanitizer rejects invalid identity and preserves missing numeric evidence as null', () => {
  for (const invalid of [null, [], {}, record({ source: 'unknown' }), record({ timestamp: NaN }), record({ durationSec: 0 })]) {
    assert.equal(model.sanitizeRecord(invalid), null);
  }
  const raw = record();
  raw.observations.face.blinkRate = null;
  raw.observations.body.kneeLifts = undefined;
  raw.cognitive.attention.medianReactionMs = Infinity;
  raw.observations.face.coverage = '0.9';
  const safe = model.sanitizeRecord(raw);
  assert.equal(safe.observations.face.blinkRate, null);
  assert.equal(safe.observations.body.kneeLifts, null);
  assert.equal(safe.cognitive.attention.medianReactionMs, null);
  assert.equal(safe.observations.face.coverage, null);
});

test('saved partial mission progress is retained but excluded from completed comparisons and trends', () => {
  const partial = record({conditions: {sessionStage: 'mind'}});
  const safe = model.sanitizeRecord(partial);
  assert.equal(safe.conditions.sessionStage, 'mind');
  const comparison = model.compareRecords(safe, earlier());
  assert.equal(comparison.comparable, false);
  assert.match(comparison.reason, /finish the mission/i);
  assert.equal(model.groupDaily([safe])[0].metricCounts.memoryAccuracy, 0);
});

test('new shoulder-based observations do not compare body values to the earlier torso anchor', () => {
  const current = record();
  current.observations.body.protocol = 'shoulder-anchor-v3';
  const comparison = model.compareRecords(current, earlier());
  assert.equal(comparison.body.comparable, false);
  assert.match(comparison.body.reason, /protocols differ/i);
  assert.equal(comparison.face.comparable, true);
  assert.equal(comparison.cognitive.comparable, true);
});

test('compatible comparisons distinguish percentage points from relative change', () => {
  const prev = earlier();
  prev.observations.face.eyeClosurePct = 4;
  prev.observations.face.blinkRate = 10;
  prev.observations.body.fullBodyCoverage = 0.6;
  prev.cognitive.memory.correct = 1;
  const result = model.compareRecords(record(), prev);
  assert.equal(result.comparable, true);
  assert.equal(result.previousLabel, 'Yesterday');
  assert.equal(result.face.metrics.eyeClosurePct.delta, 4);
  assert.equal(result.face.metrics.eyeClosurePct.unit, 'pp');
  assert.equal(result.face.metrics.eyeClosurePct.relativeChangePct, 100);
  assert.equal(result.face.metrics.blinkRate.delta, 2);
  assert.equal(result.face.metrics.blinkRate.relativeChangePct, 20);
  assert.equal(result.face.metrics.blinkRate.change, 'increased');
  assert.ok(Math.abs(result.body.metrics.fullBodyCoverage.delta - 20) < 1e-8);
  assert.ok(Math.abs(result.cognitive.metrics.memoryAccuracy.delta - 100 / 3) < 1e-8);
});

test('quality gates prevent missing or low quality camera metrics from becoming reassuring zeroes', () => {
  const low = record();
  low.observations.face.validSeconds = 9.9;
  low.observations.body.coverage = 0.59;
  const result = model.compareRecords(low, earlier());
  assert.equal(result.face.comparable, false);
  assert.equal(result.face.metrics.eyeClosurePct.comparable, false);
  assert.equal(result.face.metrics.eyeClosurePct.delta, null);
  assert.match(result.face.reason, /10|evidence|seconds/i);
  assert.equal(result.body.comparable, false);
  assert.equal(result.cognitive.comparable, true);
  const missing = record();
  missing.observations.face.blinkRate = null;
  const absent = model.compareRecords(missing, earlier()).face.metrics.blinkRate;
  assert.equal(absent.current, null);
  assert.equal(absent.delta, null);
  assert.equal(absent.change, 'unavailable');
});

test('face baseline, face coverage and blink sampling speed are independent evidence gates', () => {
  const slow = record();
  slow.observations.face.meanFps = 7.9;
  let result = model.compareRecords(slow, earlier());
  assert.equal(result.face.metrics.blinkRate.comparable, false);
  assert.equal(result.face.metrics.eyeClosurePct.comparable, true);
  const noBaseline = record();
  noBaseline.observations.face.baselineReady = false;
  assert.equal(model.compareRecords(noBaseline, earlier()).face.comparable, false);
  const sparse = record();
  sparse.observations.face.coverage = 0.49;
  assert.equal(model.compareRecords(sparse, earlier()).face.comparable, false);
  const shortBody = record();
  shortBody.observations.body.validSeconds = 14.9;
  assert.equal(model.compareRecords(shortBody, earlier()).body.comparable, false);
});

test('comparisons reject mixed sources, input modes, session protocols and duration', () => {
  for (const overrides of [{ source: 'demo' }, { inputMode: 'keyboard' }, { protocol: 'other-protocol' }, { durationSec: 90 }]) {
    const comparison = model.compareRecords(record(), earlier(overrides));
    assert.equal(comparison.comparable, false);
    assert.ok(comparison.reason);
    assert.equal(comparison.face.metrics.blinkRate.delta, null);
    assert.equal(comparison.body.metrics.kneeLifts.delta, null);
    assert.equal(comparison.cognitive.metrics.memoryAccuracy.delta, null);
  }
});

test('mixed input sessions and incompatible face check protocols are explicitly excluded', () => {
  const mixed = record({ conditions: { inputModeChanged: true, faceCheckProtocol: 'face-check-30s-v2' } });
  const safe = model.sanitizeRecord(mixed);
  assert.equal(safe.conditions.inputModeChanged, true);
  assert.equal(model.compareRecords(mixed, earlier()).comparable, false);
  const changedFace = record({ conditions: { inputModeChanged: false, faceCheckProtocol: 'face-check-60s-v3' } });
  const comparison = model.compareRecords(changedFace, earlier());
  assert.equal(comparison.face.comparable, false);
  assert.equal(comparison.body.comparable, true);
});

test('face check durations are whitelisted and checked independently of flight duration', () => {
  const full = record({ conditions: { faceCheckDurationSec: 30 } });
  const partial = earlier({ conditions: { faceCheckDurationSec: 16 } });
  assert.equal(model.sanitizeRecord(full).conditions.faceCheckDurationSec, 30);
  const comparison = model.compareRecords(full, partial);
  assert.equal(comparison.face.comparable, false);
  assert.match(comparison.face.reason, /duration/i);
  assert.equal(comparison.body.comparable, true);
  assert.equal(comparison.cognitive.comparable, true);
  assert.equal(model.compareRecords(full, earlier()).face.comparable, false, 'unknown check duration cannot match a known duration');
});

test('cognitive task protocols and actual attempts gate each task separately', () => {
  const prev = earlier();
  prev.cognitive.memory.protocol = 'different-pattern-task';
  let comparison = model.compareRecords(record(), prev);
  assert.equal(comparison.cognitive.metrics.memoryAccuracy.comparable, false);
  assert.equal(comparison.cognitive.metrics.medianReactionMs.comparable, true);
  const empty = record();
  empty.cognitive.memory.attempts = 0;
  empty.cognitive.memory.correct = 0;
  empty.cognitive.attention.attempts = 0;
  empty.cognitive.attention.correct = 0;
  comparison = model.compareRecords(empty, earlier());
  assert.equal(comparison.cognitive.comparable, false);
  assert.equal(comparison.cognitive.metrics.memoryAccuracy.current, null);
  assert.equal(comparison.cognitive.metrics.memoryAccuracy.delta, null);
  assert.equal(comparison.cognitive.metrics.medianReactionMs.delta, null);
});

test('legacy task records retain their protocols and do not compare with randomized tasks', () => {
  const legacy = earlier();
  const savedLegacy = model.sanitizeRecord(legacy);
  assert.equal(savedLegacy.cognitive.memory.protocol, 'pattern-memory-3-4-5-v2');
  assert.equal(savedLegacy.cognitive.attention.protocol, 'focus-go-no-go-v2');
  assert.equal(model.sanitizeRecord(savedLegacy).cognitive.memory.protocol, 'pattern-memory-3-4-5-v2');

  const current = record();
  current.cognitive.memory.protocol = 'pattern-memory-3-4-5-random-v3';
  current.cognitive.attention.protocol = 'focus-go-no-go-random-v3';
  const safe = model.sanitizeRecord(current);
  assert.equal(safe.cognitive.memory.protocol, current.cognitive.memory.protocol);
  assert.equal(safe.cognitive.attention.protocol, current.cognitive.attention.protocol);
  const comparison = model.compareRecords(safe, savedLegacy);
  assert.equal(comparison.face.comparable, true);
  assert.equal(comparison.body.comparable, true);
  assert.equal(comparison.cognitive.comparable, false);
  for (const key of ['memoryAccuracy', 'attentionAccuracy', 'medianReactionMs']) {
    assert.equal(comparison.cognitive.metrics[key].delta, null);
    assert.match(comparison.cognitive.metrics[key].reason, /protocol/i);
  }

  const previousRandom = earlier({ cognitive: structuredClone(current.cognitive) });
  assert.equal(model.compareRecords(current, previousRandom).cognitive.comparable, true);
});

test('randomized tasks still require three memory rounds and eight attention trials for comparison', () => {
  const current = record();
  current.cognitive.memory.protocol = 'pattern-memory-3-4-5-random-v3';
  current.cognitive.attention.protocol = 'focus-go-no-go-random-v3';
  const previous = earlier({ cognitive: structuredClone(current.cognitive) });
  current.cognitive.memory.rounds = 1;
  current.cognitive.attention.correct = 3;
  current.cognitive.attention.attempts = 4;
  const comparison = model.compareRecords(current, previous);
  assert.equal(comparison.cognitive.comparable, false);
  assert.equal(comparison.cognitive.metrics.memoryAccuracy.delta, null);
  assert.match(comparison.cognitive.metrics.memoryAccuracy.reason, /complete|round/i);
  assert.equal(comparison.cognitive.metrics.attentionAccuracy.current, 75);
  assert.equal(comparison.cognitive.metrics.attentionAccuracy.delta, null);
  assert.match(comparison.cognitive.metrics.attentionAccuracy.reason, /complete|trial/i);
  assert.equal(comparison.cognitive.metrics.medianReactionMs.delta, null);
  assert.equal(model.groupDaily([current])[0].metrics.memoryAccuracy, null);
});

test('skipped cognitive tasks retain observed partial values but cannot produce longitudinal changes', () => {
  const partial = record();
  partial.cognitive.memory.rounds = 1;
  partial.cognitive.attention.correct = 3;
  partial.cognitive.attention.attempts = 4;
  const comparison = model.compareRecords(partial, earlier());
  assert.ok(Math.abs(comparison.cognitive.metrics.memoryAccuracy.current - 200 / 3) < 1e-8);
  assert.equal(comparison.cognitive.metrics.memoryAccuracy.comparable, false);
  assert.equal(comparison.cognitive.metrics.memoryAccuracy.delta, null);
  assert.match(comparison.cognitive.metrics.memoryAccuracy.reason, /complete|round/i);
  assert.equal(comparison.cognitive.metrics.attentionAccuracy.current, 75);
  assert.equal(comparison.cognitive.metrics.attentionAccuracy.comparable, false);
  assert.equal(comparison.cognitive.metrics.medianReactionMs.current, 420);
  assert.equal(comparison.cognitive.metrics.medianReactionMs.delta, null);
  assert.match(comparison.cognitive.metrics.medianReactionMs.reason, /complete|trial/i);
  assert.equal(model.compareRecords(record(), earlier({ cognitive: partial.cognitive })).cognitive.comparable, false);
  assert.equal(model.groupDaily([partial])[0].metrics.memoryAccuracy, null);
  assert.match(JSON.stringify(model.buildObservationNarrative(partial, comparison)), /complete|round|trial/i);
});

test('keyboard reports with disabled observations and empty tasks remain valid without invented measurements', () => {
  const raw = record({ inputMode: 'keyboard', observations: null,
    cognitive: { memory: { correct: 0, attempts: 0, rounds: 0 },
      attention: { correct: 0, attempts: 0, falseAlarms: 0, misses: 0, medianReactionMs: null } } });
  const safe = model.sanitizeRecord(raw);
  assert.equal(safe.inputMode, 'keyboard');
  assert.equal(safe.observations.body.kneeLifts, null);
  assert.equal(safe.observations.face.blinkRate, null);
  const comparison = model.compareRecords(safe, earlier({ inputMode: 'keyboard' }));
  assert.equal(comparison.face.metrics.eyeClosurePct.current, null);
  assert.equal(comparison.body.metrics.kneeLifts.current, null);
  assert.equal(comparison.cognitive.metrics.memoryAccuracy.current, null);
  assert.equal(comparison.cognitive.metrics.medianReactionMs.current, null);
});

test('percentage change from a zero baseline stays null while absolute change is retained', () => {
  const prev = earlier();
  prev.observations.body.squats = 0;
  const metric = model.compareRecords(record(), prev).body.metrics.squats;
  assert.equal(metric.delta, 3);
  assert.equal(metric.relativeChangePct, null);
});

test('calendar labels use Baghdad local dates and reject a later comparison session', () => {
  const current = record({ timestamp: Date.parse('2026-11-14T00:30:00Z') });
  const sameBaghdadDay = earlier({ timestamp: Date.parse('2026-11-13T22:00:00Z') });
  assert.equal(model.compareRecords(current, sameBaghdadDay).previousLabel, 'Earlier today');
  const previousBaghdadDay = earlier({ timestamp: Date.parse('2026-11-13T20:00:00Z') });
  assert.equal(model.compareRecords(current, previousBaghdadDay).previousLabel, 'Yesterday');
  const future = earlier({ timestamp: current.timestamp + 1 });
  assert.equal(model.compareRecords(current, future).comparable, false);
});

test('demo preview contains exactly two clearly synthetic separate daily records', () => {
  const demos = model.createDemoRecords(TODAY);
  assert.equal(demos.length, 2);
  for (const demo of demos) {
    assert.equal(demo.source, 'demo');
    assert.match(demo.demoLabel, /demo|synthetic/i);
    assert.ok(demo.observations.face.validSeconds >= 10);
    assert.ok(demo.observations.body.validSeconds >= 15);
    assert.ok(demo.cognitive.memory.attempts > 0);
    assert.ok(demo.cognitive.attention.attempts > 0);
    assert.ok(demo.cognitive.memory.attempts >= 12, 'three memory rounds contain 3 + 4 + 5 signals');
    assert.equal(demo.cognitive.attention.attempts, 8, 'the standard attention protocol contains eight trials');
  }
  assert.equal(model.compareRecords(demos[0], demos[1]).previousLabel, 'Yesterday');
  assert.equal(model.compareRecords(record(), demos[1]).comparable, false);
});

test('narrative reports supported measurements, quality limits and practical non-clinical next steps', () => {
  const raw = record();
  const prev = earlier();
  prev.observations.face.eyeClosurePct = 4;
  const narrative = model.buildObservationNarrative(raw, model.compareRecords(raw, prev));
  assert.equal(typeof narrative.headline, 'string');
  assert.ok(narrative.observations.length >= 3);
  assert.ok(narrative.observations.every(item => typeof item.title === 'string' && typeof item.detail === 'string'));
  assert.ok(narrative.nextSteps.length > 0);
  assert.ok(narrative.limitations.length > 0);
  assert.match(JSON.stringify(narrative), /percentage points/);
  assert.doesNotMatch(JSON.stringify(narrative), /fatigue|depression|anxiety|diagnosed|health score|disease risk|therapy|medication/i);
  const missing = record();
  missing.observations.face.validSeconds = 0;
  missing.observations.face.blinkRate = null;
  const limited = model.buildObservationNarrative(missing);
  assert.match(JSON.stringify(limited), /insufficient|unavailable/i);
  assert.match(limited.nextSteps.join(' '), /camera|light|framing/i);
  assert.doesNotMatch(JSON.stringify(limited), /0 blinks|normal|healthy/i);
});

test('narrative does not attribute a comparison from another session to this record', () => {
  const comparison = model.compareRecords(record({ id: 'other-current' }), earlier());
  comparison.face.metrics.eyeClosurePct.delta = 88;
  comparison.face.metrics.eyeClosurePct.change = 'increased';
  const narrative = model.buildObservationNarrative(record(), comparison);
  assert.doesNotMatch(JSON.stringify(narrative), /88 percentage points/);
});

test('daily trends keep demo and measured sources separate and null evidence unavailable', () => {
  const low = record({ id: 'low', timestamp: TODAY + 1000 });
  low.observations.face.validSeconds = 0;
  const groups = model.groupDaily([record(), low, earlier(), ...model.createDemoRecords(TODAY)]);
  assert.equal(groups.length, 4);
  const today = groups.find(group => group.source === 'measured' && group.date === '2026-11-14');
  assert.equal(today.sessionCount, 2);
  assert.equal(today.metrics.blinkRate, 12);
  assert.equal(today.metricCounts.blinkRate, 1);
});
