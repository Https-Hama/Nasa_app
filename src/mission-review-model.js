import { sanitizeRecord, compareRecords } from './report-model.js';
export { sanitizeMissionReview } from './mission-review-schema.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const num = (value, min = 0, max = 1e9) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
const count = (value, max = 100000) => Number.isInteger(value) ? num(value, 0, max) : null;
const percent = (correct, attempts) => correct !== null && attempts > 0 && correct <= attempts ? correct / attempts * 100 : null;
const memoryProtocols = ['pattern-memory-3-4-5-v2', 'pattern-memory-3-4-5-random-v3'];
const focusProtocols = ['focus-go-no-go-v2', 'focus-go-no-go-random-v3'];
const faceFields = ['blinkRate', 'eyeClosurePct', 'longClosureCount', 'longestClosureSec', 'mouthOpenEvents', 'headRollMeanDeg', 'headRollRangeDeg'];
const bodyFields = ['leftHandTravel', 'rightHandTravel', 'kneeLifts', 'squats', 'shields', 'boosts', 'meanTorsoSway'];
const limits = {
  blinkRate: [0, 600], eyeClosurePct: [0, 100], longClosureCount: [0, 100000], longestClosureSec: [0, 7200],
  mouthOpenEvents: [0, 100000], headRollMeanDeg: [-180, 180], headRollRangeDeg: [0, 360],
  leftHandTravel: [0, 1e7], rightHandTravel: [0, 1e7], kneeLifts: [0, 100000], squats: [0, 100000],
  shields: [0, 100000], boosts: [0, 100000], meanTorsoSway: [0, 1000],
};
const comparisonDefinitions = {
  blinkRate: ['face', 'blinkRate', 'blinks/min'], eyeClosurePct: ['face', 'eyeClosurePct', 'percentage points'],
  longClosureCount: ['face', 'longClosureCount', 'events'], longestClosureSec: ['face', 'longestClosureSec', 'seconds'],
  mouthOpenEvents: ['face', 'mouthOpenEvents', 'events'], headRollMeanDeg: ['face', 'headRollMeanDeg', 'degrees'],
  headRollRangeDeg: ['face', 'headRollRangeDeg', 'degrees'],
  leftHandTravel: ['body', 'leftHandTravel', 'shoulder widths'], rightHandTravel: ['body', 'rightHandTravel', 'shoulder widths'],
  kneeLifts: ['body', 'kneeLifts', 'events'], squats: ['body', 'squats', 'events'], shields: ['body', 'shields', 'events'],
  boosts: ['body', 'boosts', 'events'], meanTorsoSway: ['body', 'meanTorsoSway', 'shoulder widths'],
  memoryAccuracy: ['memory', 'accuracy', 'percentage points'], attentionAccuracy: ['focus', 'accuracy', 'percentage points'],
  medianReactionMs: ['focus', 'medianReactionMs', 'milliseconds'], falseAlarms: ['focus', 'falseAlarms', 'events'], misses: ['focus', 'misses', 'events'],
};
const roundsCompleted = task => Array.isArray(task.rounds)
  ? task.rounds.filter(round => round.correct !== null && round.correct === round.length).length : task.rounds;

/** Produce a small anonymous summary. No identity, journal notes or raw camera data cross this boundary. */
export function buildMissionReviewPayload(raw, previous = null) {
  const record = sanitizeRecord(raw);
  if (!record || record.source !== 'measured' || record.conditions.sessionStage !== 'complete') return null;
  const values = compareRecords(record, null);
  const comparison = compareRecords(record, previous);
  const face = record.observations.face, body = record.observations.body;
  const memory = record.cognitive.memory, focus = record.cognitive.attention;
  const metrics = {};
  for (const [key, [area]] of Object.entries(comparisonDefinitions)) {
    const field = area === 'memory' || area === 'focus' ? comparison.cognitive.metrics[key] : comparison[area].metrics[key];
    if (field?.comparable) metrics[key] = { previous: field.previous };
  }
  return sanitizeMissionReviewPayload({
    version: 1,
    mission: { complete: true, inputMode: record.inputMode, mixedInput: record.conditions.inputModeChanged,
      durationSec: record.durationSec, game: record.game },
    memory: { protocol: memory.protocol, rounds: roundsCompleted(memory), correct: memory.correct, attempts: memory.attempts },
    focus: { protocol: focus.protocol, trials: focus.attempts, correct: focus.correct, falseAlarms: focus.falseAlarms,
      misses: focus.misses, medianReactionMs: focus.medianReactionMs },
    face: { baselineReady: face.baselineReady, validSeconds: face.validSeconds, coverage: face.coverage, meanFps: face.meanFps,
      metrics: Object.fromEntries(faceFields.map(key => [key, values.face.metrics[key]?.current ?? null])) },
    body: { validSeconds: body.validSeconds, coverage: body.coverage, fullBodyCoverage: body.fullBodyCoverage,
      metrics: Object.fromEntries(bodyFields.map(key => [key, values.body.metrics[key]?.current ?? null])) },
    comparison: { available: Object.keys(metrics).length > 0, metrics },
  });
}

/** Revalidate the anonymous request on the server; unknown fields and arbitrary text are dropped. */
export function sanitizeMissionReviewPayload(raw) {
  if (!object(raw) || raw.version !== 1 || !object(raw.mission) || raw.mission.complete !== true
    || !['motion', 'keyboard'].includes(raw.mission.inputMode)) return null;
  const durationSec = num(raw.mission.durationSec, Number.EPSILON, 7200);
  if (durationSec === null) return null;
  const game = object(raw.mission.game) ? raw.mission.game : {};
  const memory = object(raw.memory) ? raw.memory : {}, focus = object(raw.focus) ? raw.focus : {};
  const face = object(raw.face) ? raw.face : {}, body = object(raw.body) ? raw.body : {};
  const memoryCorrect = count(memory.correct), memoryAttempts = count(memory.attempts), rounds = count(memory.rounds, 3);
  const focusCorrect = count(focus.correct), trials = count(focus.trials);
  const safe = {
    version: 1,
    mission: { complete: true, inputMode: raw.mission.inputMode, mixedInput: raw.mission.mixedInput === true, durationSec,
      game: { score: num(game.score), hull: num(game.hull, 0, 100), kills: count(game.kills), shots: count(game.shots), accuracy: num(game.accuracy, 0, 100) } },
    memory: { protocol: memoryProtocols.includes(memory.protocol) ? memory.protocol : null,
      complete: memoryProtocols.includes(memory.protocol) && rounds === 3 && memoryAttempts >= 12 && memoryCorrect !== null && memoryCorrect <= memoryAttempts,
      rounds, correct: memoryCorrect, attempts: memoryAttempts, accuracy: percent(memoryCorrect, memoryAttempts) },
    focus: { protocol: focusProtocols.includes(focus.protocol) ? focus.protocol : null,
      complete: focusProtocols.includes(focus.protocol) && trials >= 8 && focusCorrect !== null && focusCorrect <= trials,
      trials, correct: focusCorrect, accuracy: percent(focusCorrect, trials), falseAlarms: trials > 0 ? count(focus.falseAlarms, trials) : null, misses: trials > 0 ? count(focus.misses, trials) : null,
      medianReactionMs: focusCorrect > 0 ? num(focus.medianReactionMs, 1, 60000) : null },
    face: { available: false, baselineReady: face.baselineReady === true, validSeconds: num(face.validSeconds, 0, 7200),
      coverage: num(face.coverage, 0, 1), meanFps: num(face.meanFps, 0, 1000), metrics: {} },
    body: { available: false, validSeconds: num(body.validSeconds, 0, 7200), coverage: num(body.coverage, 0, 1),
      fullBodyCoverage: num(body.fullBodyCoverage, 0, 1), metrics: {} },
    comparison: { available: false, metrics: {} },
  };
  const faceUsable = safe.face.baselineReady && safe.face.validSeconds >= 10 && safe.face.coverage >= .5;
  const bodyUsable = safe.body.validSeconds >= 15 && safe.body.coverage >= .6;
  for (const key of faceFields) safe.face.metrics[key] = faceUsable && (key !== 'blinkRate' || safe.face.meanFps >= 8)
    ? num(face.metrics?.[key], ...limits[key]) : null;
  for (const key of bodyFields) safe.body.metrics[key] = bodyUsable && (!['kneeLifts', 'squats', 'boosts'].includes(key) || safe.body.fullBodyCoverage >= .6)
    ? num(body.metrics?.[key], ...limits[key]) : null;
  safe.face.available = Object.values(safe.face.metrics).some(value => value !== null);
  safe.body.available = Object.values(safe.body.metrics).some(value => value !== null);
  if (!safe.mission.mixedInput && raw.comparison?.available === true && object(raw.comparison.metrics)) {
    for (const [key, [area, field, unit]] of Object.entries(comparisonDefinitions)) {
      if ((area === 'memory' || area === 'focus') && !safe[area].complete) continue;
      const current = area === 'face' || area === 'body' ? safe[area].metrics[field] : safe[area][field];
      const previous = num(raw.comparison.metrics[key]?.previous, ...(limits[field] || (field === 'medianReactionMs' ? [1, 60000] : [0, field === 'accuracy' ? 100 : 100000])));
      if (current !== null && previous !== null) safe.comparison.metrics[key] = { current, previous, delta: current - previous, unit };
    }
    safe.comparison.available = Object.keys(safe.comparison.metrics).length > 0;
  }
  return safe;
}