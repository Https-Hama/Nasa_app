import { sanitizeMissionReview } from './mission-review-schema.js';
// Only derived summaries belong in persisted reports. No camera payload is copied.
const TIME_ZONE = 'Asia/Baghdad';
const PROTOCOL = 'orbital-observation-v2';
const FACE_PROTOCOL = 'face-check-30s-v2';
const MEMORY_PROTOCOL = 'pattern-memory-3-4-5-v2';
const ATTENTION_PROTOCOL = 'focus-go-no-go-v2';
const DAY_MS = 86400000;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const number = (value, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
const count = value => Number.isInteger(value) ? number(value) : null;
const text = (value, limit = 120) => typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : null;
const reasons = value => Array.isArray(value) ? value.map(item => text(item, 160)).filter(Boolean).slice(0, 12) : [];
const percentage = (correct, attempts) => correct !== null && attempts > 0 && correct <= attempts ? correct / attempts * 100 : null;

function sanitizeTask(raw, kind, inheritedProtocol) {
  const task = isObject(raw) ? raw : {};
  const correct = count(task.correct);
  const attempts = count(task.attempts);
  const safe = {
    protocol: text(task.protocol) || inheritedProtocol || (kind === 'memory' ? MEMORY_PROTOCOL : ATTENTION_PROTOCOL),
    durationSec: number(task.durationSec, 0, 7200),
    correct, attempts,
  };
  if (kind === 'memory') {
    safe.rounds = Array.isArray(task.rounds)
      ? task.rounds.filter(isObject).slice(0, 100).map(round => ({
        length: count(round.length), correct: count(round.correct), attempts: count(round.attempts),
      })) : count(task.rounds);
    safe.accuracy = percentage(correct, attempts);
  } else {
    safe.falseAlarms = count(task.falseAlarms);
    safe.misses = count(task.misses);
    safe.medianReactionMs = number(task.medianReactionMs, 1, 60000);
  }
  return safe;
}

export function sanitizeRecord(raw) {
  try {
    if (!isObject(raw)) return null;
    const id = text(raw.id);
    const timestamp = number(raw.timestamp, 0, 8640000000000000);
    const protocol = text(raw.protocol);
    const durationSec = number(raw.durationSec, Number.EPSILON, 7200);
    if (!id || timestamp === null || !protocol || durationSec === null ||
      !['measured', 'demo'].includes(raw.source) || !['motion', 'keyboard'].includes(raw.inputMode)) return null;
    const observation = isObject(raw.observations) ? raw.observations : {};
    const face = isObject(observation.face) ? observation.face : {};
    const body = isObject(observation.body) ? observation.body : {};
    const cognitive = isObject(raw.cognitive) ? raw.cognitive : {};
    const game = isObject(raw.game) ? raw.game : {};
    const conditions = isObject(raw.conditions) ? raw.conditions : {};
    const taskProtocol = text(raw.taskProtocol) || text(cognitive.protocol);
    const safe = {
      id, timestamp, source: raw.source, protocol, inputMode: raw.inputMode, durationSec,
      conditions: {
        inputModeChanged: conditions.inputModeChanged === true,
        faceCheckProtocol: text(conditions.faceCheckProtocol) || FACE_PROTOCOL,
        faceCheckDurationSec: number(conditions.faceCheckDurationSec, 0, 7200),
        sessionStage: ['flight', 'mind'].includes(conditions.sessionStage) ? conditions.sessionStage : 'complete',
      },
      game: {
        score: number(game.score), hull: number(game.hull, 0, 100), kills: count(game.kills),
        shots: count(game.shots), accuracy: number(game.accuracy, 0, 100),
      },
      observations: {
        protocol: text(observation.protocol) || protocol,
        durationSec: number(observation.durationSec, 0, 86400),
        face: {
          validSeconds: number(face.validSeconds, 0, 86400), coverage: number(face.coverage, 0, 1),
          meanFps: number(face.meanFps, 0, 1000), blinkCount: count(face.blinkCount),
          blinkRate: number(face.blinkRate), eyeClosurePct: number(face.eyeClosurePct, 0, 100),
          longClosureCount: count(face.longClosureCount), longestClosureSec: number(face.longestClosureSec, 0, 86400),
          mouthOpenEvents: count(face.mouthOpenEvents), headRollMeanDeg: number(face.headRollMeanDeg, -180, 180),
          headRollRangeDeg: number(face.headRollRangeDeg, 0, 360), baselineReady: face.baselineReady === true,
          qualityReasons: reasons(face.qualityReasons),
        },
        body: {
          protocol: text(body.protocol) || 'torso-anchor-v2',
          validSeconds: number(body.validSeconds, 0, 86400), coverage: number(body.coverage, 0, 1),
          fullBodyCoverage: number(body.fullBodyCoverage, 0, 1),
          leftHandTravel: number(body.leftHandTravel), rightHandTravel: number(body.rightHandTravel),
          kneeLifts: count(body.kneeLifts), squats: count(body.squats), shields: count(body.shields),
          boosts: count(body.boosts), meanTorsoSway: number(body.meanTorsoSway), qualityReasons: reasons(body.qualityReasons),
        },
      },
      cognitive: {
        memory: sanitizeTask(cognitive.memory, 'memory', taskProtocol),
        attention: sanitizeTask(cognitive.attention, 'attention', taskProtocol),
      },
    };
    if (conditions.geminiReviewRequested === true) safe.conditions.geminiReviewRequested = true;
    if (safe.source === 'measured' && safe.conditions.sessionStage === 'complete') {
      const review = sanitizeMissionReview(raw.geminiReview);
      if (review) safe.geminiReview = review;
    }
    if (taskProtocol) safe.taskProtocol = taskProtocol;
    if (safe.source === 'demo') safe.demoLabel = 'DEMO · Synthetic example; not a measured session';
    return safe;
  } catch {
    // Malformed imported data must never break loading the history collection.
    return null;
  }
}

const faceDefinitions = [
  ['blinkRate', 'Blink rate', 'blinks/min'], ['eyeClosurePct', 'Eye closure', 'pp'],
  ['longClosureCount', 'Long closure events', 'events'], ['longestClosureSec', 'Longest closure', 's'],
  ['mouthOpenEvents', 'Mouth opening events', 'events'], ['headRollMeanDeg', 'Mean head roll', '°'],
  ['headRollRangeDeg', 'Head roll range', '°'],
];
const bodyDefinitions = [
  ['fullBodyCoverage', 'Full body coverage', 'pp'], ['leftHandTravel', 'Left hand travel', 'shoulder widths'],
  ['rightHandTravel', 'Right hand travel', 'shoulder widths'], ['kneeLifts', 'Completed knee lifts', 'events'],
  ['squats', 'Completed squats', 'events'], ['shields', 'Shield gestures', 'events'],
  ['boosts', 'Boost gestures', 'events'], ['meanTorsoSway', 'Mean torso sway', 'shoulder widths'],
];
const cognitiveDefinitions = [
  ['memoryAccuracy', 'Pattern memory accuracy', 'pp', 'memory'],
  ['attentionAccuracy', 'Attention accuracy', 'pp', 'attention'],
  ['medianReactionMs', 'Median reaction time', 'ms', 'attention'],
  ['falseAlarms', 'Attention false alarms', 'events', 'attention'], ['misses', 'Attention misses', 'events', 'attention'],
];

function faceQuality(record, key) {
  if (!record) return 'No valid session record is available.';
  const face = record.observations.face;
  if (face.baselineReady !== true) return 'Face calibration is incomplete. Repeat the optional close-up check with your face clearly visible; you can still play with your shoulders and hands in view.';
  if (face.validSeconds === null || face.validSeconds < 10) return 'Insufficient face evidence: at least 10 valid seconds are required.';
  if (face.coverage === null || face.coverage < 0.5) return 'Insufficient face coverage: at least 50% of the check must be observed.';
  if (key === 'blinkRate' && (face.meanFps === null || face.meanFps < 8)) return 'Blink comparison requires at least 8 sampled frames per second.';
  return null;
}

function bodyQuality(record, key) {
  if (!record) return 'No valid session record is available.';
  const body = record.observations.body;
  if (body.validSeconds === null || body.validSeconds < 15) return 'Insufficient body evidence: at least 15 valid seconds are required.';
  if (body.coverage === null || body.coverage < 0.6) return 'Insufficient body coverage: at least 60% of the flight must be observed.';
  if (['kneeLifts', 'squats', 'boosts'].includes(key) && (body.fullBodyCoverage === null || body.fullBodyCoverage < 0.6)) {
    return 'Completed lower body gestures require at least 60% full body coverage.';
  }
  return null;
}

function cognitiveQuality(record, key, kind) {
  if (!record) return 'No valid session record is available.';
  const task = record.cognitive[kind];
  if (!(task.attempts > 0) || task.correct === null || task.correct > task.attempts) return 'No completed, internally consistent task attempts are available.';
  if (key === 'medianReactionMs' && !(task.correct > 0)) return 'No correct responses are available for reaction time.';
  if (['falseAlarms', 'misses'].includes(key) && (task[key] === null || task[key] > task.attempts)) return 'A valid task event count is unavailable.';
  return null;
}

function taskCompletionReason(record, kind) {
  if (!record) return null;
  const task = record.cognitive[kind];
  if (kind === 'memory' && [MEMORY_PROTOCOL, 'pattern-memory-3-4-5-random-v3'].includes(task.protocol)) {
    const rounds = Array.isArray(task.rounds) ? task.rounds.filter(round => round.correct !== null && round.correct === round.length).length : task.rounds;
    if (!(rounds >= 3)) return 'Complete all three pattern memory rounds before comparing task results.';
  }
  if (kind === 'attention' && [ATTENTION_PROTOCOL, 'focus-go-no-go-random-v3'].includes(task.protocol) && !(task.attempts >= 8)) {
    return 'Complete all eight attention trials before comparing task results.';
  }
  return null;
}

function metricValue(record, area, key) {
  if (!record) return null;
  if (area === 'face') return record.observations.face[key];
  if (area === 'body') {
    const value = record.observations.body[key];
    return key === 'fullBodyCoverage' && value !== null ? value * 100 : value;
  }
  const { memory, attention } = record.cognitive;
  if (key === 'memoryAccuracy') return memory.accuracy;
  if (key === 'attentionAccuracy') return percentage(attention.correct, attention.attempts);
  return attention[key];
}

function metricQuality(record, area, key, kind) {
  return area === 'face' ? faceQuality(record, key) : area === 'body' ? bodyQuality(record, key) : cognitiveQuality(record, key, kind);
}

function localDate(timestamp) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(timestamp);
  const part = kind => parts.find(item => item.type === kind).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function previousLabel(current, previous) {
  if (!current || !previous || previous.timestamp >= current.timestamp) return 'No comparable earlier session';
  const currentDate = localDate(current.timestamp);
  const previousDate = localDate(previous.timestamp);
  if (currentDate === previousDate) return 'Earlier today';
  if (Date.parse(`${currentDate}T00:00:00Z`) - Date.parse(`${previousDate}T00:00:00Z`) === DAY_MS) return 'Yesterday';
  return new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric' }).format(previous.timestamp);
}

function compatibility(current, previous) {
  if (!current || !previous) return 'A valid earlier session is needed for comparison.';
  if (current.conditions.sessionStage !== 'complete' || previous.conditions.sessionStage !== 'complete') return 'Saved progress is available; finish the mission and mind check before comparing sessions.';
  if (current.source !== previous.source) return 'Demo examples and measured sessions are separate collections.';
  if (current.protocol !== previous.protocol) return 'Session protocols differ.';
  if (current.observations.protocol !== previous.observations.protocol) return 'Observation protocols differ.';
  if (current.conditions.inputModeChanged || previous.conditions.inputModeChanged) return 'Input mode changed during a session; repeat with one input mode.';
  if (current.inputMode !== previous.inputMode) return 'Motion and keyboard sessions use different input conditions.';
  if (Math.abs(current.durationSec - previous.durationSec) > 0.5) return 'Flight durations differ by more than half a second.';
  if (previous.timestamp >= current.timestamp) return 'The comparison session must be earlier than the current session.';
  return null;
}

function compareArea(area, definitions, current, previous, globalReason) {
  const metrics = {};
  for (const [key, label, unit, kind] of definitions) {
    const currentReason = metricQuality(current, area, key, kind);
    const previousReason = metricQuality(previous, area, key, kind);
    const currentValue = currentReason ? null : metricValue(current, area, key);
    const previousValue = previousReason ? null : metricValue(previous, area, key);
    let protocolReason = null;
    if (current && previous && area === 'body' && current.observations.body.protocol !== previous.observations.body.protocol) {
      protocolReason = 'Body measurement protocols differ.';
    }
    if (current && previous && area === 'face' && current.conditions.faceCheckProtocol !== previous.conditions.faceCheckProtocol) {
      protocolReason = 'Standardized face check protocols differ.';
    }
    if (current && previous && area === 'face') {
      const currentDuration = current.conditions.faceCheckDurationSec;
      const previousDuration = previous.conditions.faceCheckDurationSec;
      if ((currentDuration === null) !== (previousDuration === null) ||
        (currentDuration !== null && previousDuration !== null && Math.abs(currentDuration - previousDuration) > 0.5)) {
        protocolReason ||= 'Standardized face check durations differ or are unknown.';
      }
    }
    if (current && previous && area === 'cognitive') {
      const currentTask = current.cognitive[kind], previousTask = previous.cognitive[kind];
      if (currentTask.protocol !== previousTask.protocol) protocolReason = 'Task protocols differ.';
      else if (currentTask.durationSec !== previousTask.durationSec) protocolReason = 'Task durations differ.';
      else protocolReason = taskCompletionReason(current, kind) || taskCompletionReason(previous, kind);
    }
    const reason = globalReason || protocolReason || currentReason || previousReason ||
      (currentValue === null || previousValue === null ? 'This measurement is unavailable in one or both sessions.' : null);
    const comparable = reason === null;
    const delta = comparable ? currentValue - previousValue : null;
    metrics[key] = {
      key, label, unit, current: currentValue, previous: previousValue, delta,
      relativeChangePct: comparable && previousValue !== 0 ? delta / Math.abs(previousValue) * 100 : null,
      change: !comparable ? 'unavailable' : Math.abs(delta) < 1e-9 ? 'unchanged' : delta > 0 ? 'increased' : 'decreased',
      comparable, reason,
    };
  }
  const comparable = Object.values(metrics).some(metric => metric.comparable);
  return { comparable, reason: comparable ? null : Object.values(metrics)[0]?.reason || 'No comparable measurements are available.', metrics };
}

export function compareRecords(currentRaw, previousRaw) {
  const current = sanitizeRecord(currentRaw), previous = sanitizeRecord(previousRaw);
  const globalReason = compatibility(current, previous);
  const face = compareArea('face', faceDefinitions, current, previous, globalReason);
  const body = compareArea('body', bodyDefinitions, current, previous, globalReason);
  const cognitive = compareArea('cognitive', cognitiveDefinitions, current, previous, globalReason);
  const comparable = !globalReason && (face.comparable || body.comparable || cognitive.comparable);
  return {
    comparable, reason: globalReason || (comparable ? null : 'No measurements have enough comparable evidence.'),
    currentId: current?.id || null, previousId: previous?.id || null,
    previousLabel: previousLabel(current, previous), timeZone: TIME_ZONE, face, body, cognitive,
  };
}

export function createDemoRecords(now = Date.now()) {
  const timestamp = number(now, DAY_MS, 8640000000000000) ?? Date.now();
  return [0, 1].map(day => sanitizeRecord({
    id: `demo-orbital-${timestamp}-${day}`, timestamp: timestamp - day * DAY_MS,
    source: 'demo', protocol: PROTOCOL, inputMode: 'motion', durationSec: 120,
    conditions: { inputModeChanged: false, faceCheckProtocol: FACE_PROTOCOL, faceCheckDurationSec: 30 },
    game: { score: day ? 940 : 1180, hull: day ? 65 : 78, kills: day ? 12 : 15, shots: day ? 38 : 42, accuracy: day ? 58 : 64 },
    observations: {
      protocol: PROTOCOL, durationSec: 150,
      face: {
        validSeconds: day ? 25.2 : 27.4, coverage: day ? 0.84 : 0.9133, meanFps: day ? 18.2 : 20.1,
        blinkCount: day ? 4 : 5, blinkRate: day ? 11.9 : 13.4,
        eyeClosurePct: day ? 5.8 : 7.4, longClosureCount: day ? 0 : 1,
        longestClosureSec: day ? 0.28 : 1.21, mouthOpenEvents: day ? 2 : 3,
        headRollMeanDeg: day ? -0.8 : 1.2, headRollRangeDeg: day ? 9.6 : 11.4,
        baselineReady: true, qualityReasons: [],
      },
      body: {
        validSeconds: day ? 104 : 111, coverage: day ? 0.867 : 0.925,
        fullBodyCoverage: day ? 0.81 : 0.89, leftHandTravel: day ? 22.4 : 26.8,
        rightHandTravel: day ? 25.9 : 29.2, kneeLifts: day ? 4 : 6,
        squats: day ? 3 : 4, shields: day ? 5 : 7, boosts: day ? 4 : 6,
        meanTorsoSway: day ? 0.14 : 0.12, qualityReasons: [],
      },
    },
    cognitive: {
      memory: { protocol: MEMORY_PROTOCOL, correct: 12, attempts: day ? 15 : 13, rounds: 3 },
      attention: { protocol: ATTENTION_PROTOCOL, correct: day ? 6 : 7, attempts: 8,
        falseAlarms: 1, misses: day ? 1 : 0, medianReactionMs: day ? 465 : 428 },
    },
  }));
}

const formatted = (value, digits = 1) => Number(value.toFixed(digits)).toLocaleString('en-GB');
function trendText(comparison, area, key) {
  const metric = comparison?.[area]?.metrics?.[key];
  if (!metric?.comparable || metric.delta === null || !Number.isFinite(metric.delta)) return '';
  const unit = metric.unit === 'pp' ? 'percentage points' : metric.unit;
  if (metric.change === 'unchanged') return ` Unchanged from ${comparison.previousLabel?.toLowerCase() || 'the earlier session'}.`;
  return ` ${formatted(Math.abs(metric.delta))} ${unit} ${metric.delta > 0 ? 'higher' : 'lower'} than ${comparison.previousLabel?.toLowerCase() || 'the earlier session'}.`;
}

export function buildObservationNarrative(raw, comparison) {
  const record = sanitizeRecord(raw);
  if (!record) return {
    headline: 'Observation report unavailable',
    observations: [{ title: 'Session data', detail: 'No valid derived session summary is available.' }],
    nextSteps: ['Complete a session to create a report.'],
    limitations: ['Only derived measurements from a valid session can be reported.'],
  };
  if (comparison?.currentId !== record.id) comparison = null;
  const face = record.observations.face, body = record.observations.body;
  const memory = record.cognitive.memory, attention = record.cognitive.attention;
  const faceReason = faceQuality(record), bodyReason = bodyQuality(record);
  const observations = [];
  if (faceReason) observations.push({ title: 'Face check unavailable', detail: faceReason });
  else {
    const descriptions = [`${formatted(face.validSeconds)} valid seconds; ${formatted(face.coverage * 100)}% check coverage.`];
    if (face.eyeClosurePct !== null) descriptions.push(`Eyes geometrically closed in ${formatted(face.eyeClosurePct)}% of observed time.${trendText(comparison, 'face', 'eyeClosurePct')}`);
    if (!faceQuality(record, 'blinkRate') && face.blinkRate !== null) descriptions.push(`${formatted(face.blinkRate)} blinks/min.${trendText(comparison, 'face', 'blinkRate')}`);
    else descriptions.push('Blink rate unavailable because sampling or event evidence was insufficient.');
    if (face.headRollRangeDeg !== null) descriptions.push(`${formatted(face.headRollRangeDeg)}° observed head roll range.`);
    observations.push({ title: 'Face check measurements', detail: descriptions.join(' ') });
  }
  if (bodyReason) observations.push({ title: 'Body movement unavailable', detail: bodyReason });
  else {
    const descriptions = [`${formatted(body.validSeconds)} valid seconds; ${formatted(body.coverage * 100)}% flight coverage.`];
    if (body.fullBodyCoverage !== null) descriptions.push(`${formatted(body.fullBodyCoverage * 100)}% full body coverage.${trendText(comparison, 'body', 'fullBodyCoverage')}`);
    if (!bodyQuality(record, 'kneeLifts') && body.kneeLifts !== null) descriptions.push(`${body.kneeLifts} completed knee lifts.`);
    if (!bodyQuality(record, 'squats') && body.squats !== null) descriptions.push(`${body.squats} completed squats.`);
    if (body.leftHandTravel !== null && body.rightHandTravel !== null) descriptions.push(`Hand travel: ${formatted(body.leftHandTravel)} left and ${formatted(body.rightHandTravel)} right in shoulder widths.`);
    observations.push({ title: 'Body movement measurements', detail: descriptions.join(' ') });
  }
  observations.push({ title: 'Pattern memory task', detail: cognitiveQuality(record, 'memoryAccuracy', 'memory') ||
    `${memory.correct} of ${memory.attempts} pattern signals correct (${formatted(memory.accuracy)}%).${trendText(comparison, 'cognitive', 'memoryAccuracy')}${taskCompletionReason(record, 'memory') ? ` ${taskCompletionReason(record, 'memory')}` : ''}` });
  const attentionReason = cognitiveQuality(record, 'attentionAccuracy', 'attention');
  const attentionDescriptions = attentionReason ? [attentionReason] : [
    `${attention.correct} of ${attention.attempts} responses correct (${formatted(percentage(attention.correct, attention.attempts))}%).${trendText(comparison, 'cognitive', 'attentionAccuracy')}`,
  ];
  if (!attentionReason && !cognitiveQuality(record, 'medianReactionMs', 'attention') && attention.medianReactionMs !== null) {
    attentionDescriptions.push(`Median response ${formatted(attention.medianReactionMs, 0)} ms.${trendText(comparison, 'cognitive', 'medianReactionMs')}`);
  }
  if (!attentionReason && attention.falseAlarms !== null && attention.misses !== null) attentionDescriptions.push(`${attention.falseAlarms} false alarms and ${attention.misses} misses.`);
  if (!attentionReason && taskCompletionReason(record, 'attention')) attentionDescriptions.push(taskCompletionReason(record, 'attention'));
  observations.push({ title: 'Attention task', detail: attentionDescriptions.join(' ') });
  const nextSteps = ['Repeat the same tasks with the same input mode and duration under similar conditions to make comparisons useful.'];
  if (faceReason || bodyReason || faceQuality(record, 'blinkRate')) nextSteps.push('Adjust camera framing and steady lighting, keep the required face or body landmarks visible, then repeat the check.');
  nextSteps.push('Take a comfortable break whenever you need one.');
  nextSteps.push('If you have persistent concerns about your day-to-day functioning, discuss them with a qualified clinician.');
  const limitations = [
    'Camera sampling checks describe evidence quality; they are engineering gates, not clinical thresholds.',
    'These camera geometry and task measurements do not establish a clinical condition or infer emotion, identity, or vital signs.',
    'Task results depend on familiarity, input mode, interruptions, and the session conditions; a single session does not establish a lasting pattern.',
  ];
  if (record.source === 'demo') limitations.unshift('DEMO: every value in this preview is synthetic and is kept separate from measured history.');
  if (faceReason) limitations.push(faceReason);
  if (bodyReason) limitations.push(bodyReason);
  if (record.conditions.inputModeChanged) limitations.push('The input mode changed during this session, so longitudinal comparison is unavailable.');
  if (comparison && !comparison.comparable && comparison.reason) limitations.push(comparison.reason);
  return { headline: record.source === 'demo' ? 'Demo observation preview · Synthetic values' : 'Your session observations', observations, nextSteps, limitations };
}

export function groupDaily(rawRecords) {
  const records = Array.isArray(rawRecords) ? rawRecords.map(sanitizeRecord).filter(Boolean) : [];
  const groups = new Map();
  const areas = [['face', faceDefinitions], ['body', bodyDefinitions], ['cognitive', cognitiveDefinitions]];
  for (const record of records) {
    const date = localDate(record.timestamp);
    const key = JSON.stringify([date, record.source, record.protocol, record.observations.protocol, record.inputMode,
      record.durationSec, record.conditions.inputModeChanged, record.conditions.faceCheckProtocol,
      record.conditions.faceCheckDurationSec, record.conditions.sessionStage, record.observations.body.protocol,
      record.cognitive.memory.protocol, record.cognitive.attention.protocol,
      record.cognitive.memory.durationSec, record.cognitive.attention.durationSec]);
    if (!groups.has(key)) groups.set(key, {
      date, source: record.source, protocol: record.protocol, inputMode: record.inputMode,
      durationSec: record.durationSec, sessionCount: 0, recordIds: [], metrics: {}, metricCounts: {},
    });
    const group = groups.get(key);
    group.sessionCount++;
    group.recordIds.push(record.id);
    for (const [area, definitions] of areas) for (const [metricKey, , , kind] of definitions) {
      if (!(metricKey in group.metrics)) { group.metrics[metricKey] = null; group.metricCounts[metricKey] = 0; }
      const value = metricValue(record, area, metricKey);
      if (record.conditions.sessionStage !== 'complete' || record.conditions.inputModeChanged || metricQuality(record, area, metricKey, kind) || value === null ||
        (area === 'cognitive' && taskCompletionReason(record, kind))) continue;
      const count = group.metricCounts[metricKey];
      group.metrics[metricKey] = ((group.metrics[metricKey] ?? 0) * count + value) / (count + 1);
      group.metricCounts[metricKey]++;
    }
  }
  return [...groups.values()].sort((a, b) => a.date.localeCompare(b.date) || a.source.localeCompare(b.source));
}
