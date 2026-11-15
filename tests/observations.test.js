import test from 'node:test';
import assert from 'node:assert/strict';
import { ObservationSession } from '../src/observation-metrics.js';
import { FaceObserver } from '../src/face-observer.js';

// Synthetic geometry verifies arithmetic and missing-evidence behavior. It does
// not establish real-person tracking accuracy or clinical validity.
function face({ ear = .3, mouth = .08, roll = 0, small = false } = {}) {
  const points = Array.from({ length: 478 }, () => ({ x: .5, y: .5, z: 0 }));
  points[234] = { x: small ? .47 : .25, y: .5 };
  points[454] = { x: small ? .53 : .75, y: .5 };
  for (const [indices, center] of [[[33, 160, 158, 133, 153, 144], .4], [[362, 385, 387, 263, 373, 380], .6]]) {
    const [a, b, c, d, e, f] = indices;
    points[a] = { x: center - .04, y: .4 };
    points[d] = { x: center + .04, y: .4 };
    points[b] = { x: center - .02, y: .4 - ear * .04 };
    points[c] = { x: center + .02, y: .4 - ear * .04 };
    points[e] = { x: center + .02, y: .4 + ear * .04 };
    points[f] = { x: center - .02, y: .4 + ear * .04 };
  }
  points[61] = { x: .44, y: .6 };
  points[291] = { x: .56, y: .6 };
  points[13] = { x: .5, y: .6 - mouth * .06 };
  points[14] = { x: .5, y: .6 + mouth * .06 };
  if (roll) {
    const theta = roll * Math.PI / 180;
    for (const point of points) {
      const x = point.x - .5, y = point.y - .5;
      point.x = .5 + x * Math.cos(theta) - y * Math.sin(theta);
      point.y = .5 + x * Math.sin(theta) + y * Math.cos(theta);
    }
  }
  // All points must lie inside the same small face for the width rejection.
  if (small) for (const point of points) point.x = .5 + (point.x - .5) * .1;
  return points;
}

function feedFace(session, start, end, options = {}, step = 100) {
  for (let now = start; now <= end; now += step) {
    session.recordFace({ landmarks: face(options), brightness: .5, width: 640, height: 640 }, now);
  }
}

function pose({ shift = 0, leftWristX = .2, fullBody = true } = {}) {
  const points = Array.from({ length: 33 }, () => ({ x: .5 + shift, y: .5, visibility: .95, presence: .95 }));
  Object.assign(points[11], { x: .4 + shift, y: .3 });
  Object.assign(points[12], { x: .6 + shift, y: .3 });
  Object.assign(points[23], { x: .43 + shift, y: .6 });
  Object.assign(points[24], { x: .57 + shift, y: .6 });
  Object.assign(points[15], { x: leftWristX + shift, y: .45 });
  Object.assign(points[16], { x: .8 + shift, y: .45 });
  if (!fullBody) points[27].visibility = 0;
  return points;
}

test('unobserved phases preserve missing metrics and use actual phase duration as coverage denominator', () => {
  const session = new ObservationSession({ startedAt: 0 });
  session.setPhase('face-check', 0);
  feedFace(session, 1000, 3000);
  const result = session.summary(10000);
  assert.equal(result.protocol, 'orbital-observation-v2');
  assert.equal(result.durationSec, 10);
  assert.equal(result.face.validSeconds, 2);
  assert.equal(result.face.coverage, .2);
  assert.equal(result.face.baselineReady, false);
  assert.equal(result.face.blinkRate, null);
  assert.equal(result.body.leftHandTravel, null);
  assert.equal(result.body.kneeLifts, null);
});

test('calibrated geometry counts completed blinks, long closures and mouth openings without diagnoses', () => {
  const session = new ObservationSession({ startedAt: 0 });
  session.setPhase('face-check', 0);
  feedFace(session, 0, 6000);
  feedFace(session, 6100, 6200, { ear: .05 });
  feedFace(session, 6300, 6900);
  feedFace(session, 7000, 7700, { ear: .05 });
  feedFace(session, 7800, 7900);
  feedFace(session, 8000, 8400, { mouth: .6 });
  feedFace(session, 8500, 20000);
  const result = session.summary(20000).face;
  assert.equal(result.baselineReady, true);
  assert.equal(result.blinkCount, 1);
  assert.equal(result.longClosureCount, 1);
  assert.equal(result.longestClosureSec, .8);
  assert.equal(result.mouthOpenEvents, 1);
  assert.ok(result.blinkRate > 3.9 && result.blinkRate < 4.1);
  assert.ok(result.eyeClosurePct > 6 && result.eyeClosurePct < 8);
  assert.equal(result.meanFps, 10);
});

test('closed eyes cannot establish an open-eye baseline and low frame rates withhold blink rates', () => {
  const closed = new ObservationSession({ startedAt: 0 });
  closed.setPhase('face-check', 0);
  feedFace(closed, 0, 12000, { ear: .04 });
  assert.equal(closed.summary(12000).face.baselineReady, false);
  assert.equal(closed.summary(12000).face.blinkCount, null);
  const slow = new ObservationSession({ startedAt: 0 });
  slow.setPhase('face-check', 0);
  feedFace(slow, 0, 20000, {}, 250);
  const result = slow.summary(20000).face;
  assert.equal(result.meanFps, 4);
  assert.equal(result.blinkRate, null);
  assert.ok(result.qualityReasons.includes('low-face-fps'));
});

test('face-check statistics reject darkness, distant faces and flight samples', () => {
  const session = new ObservationSession({ startedAt: 0 });
  session.setPhase('face-check', 0);
  feedFace(session, 0, 1000, { roll: 10 });
  session.recordFace({ landmarks: face(), brightness: .01, width: 640, height: 640 }, 1100);
  session.recordFace({ landmarks: face({ small: true }), brightness: .5, width: 640, height: 640 }, 1200);
  session.recordFace({ landmarks: [], brightness: .5, width: 640, height: 640 }, 1300);
  session.setPhase('flight', 2000);
  feedFace(session, 2000, 10000, { roll: -30 });
  const result = session.summary(10000).face;
  assert.equal(result.validSeconds, 1);
  assert.equal(result.coverage, .5);
  assert.ok(Math.abs(result.headRollMeanDeg - 10) < .001);
  assert.ok(result.headRollRangeDeg < .001);
  assert.ok(result.qualityReasons.includes('low-light'));
  assert.ok(result.qualityReasons.includes('face-too-small'));
  assert.ok(result.qualityReasons.includes('no-face'));
});

test('large sample gaps and phase transitions discard pending eye events and paused time', () => {
  const session = new ObservationSession({ startedAt: 0 });
  session.setPhase('face-check', 0);
  feedFace(session, 0, 6000);
  feedFace(session, 6100, 6200, { ear: .05 });
  feedFace(session, 10000, 11000);
  feedFace(session, 11100, 11200, { ear: .05 });
  session.setPhase('paused', 11200);
  session.setPhase('face-check', 21200);
  feedFace(session, 21200, 24000);
  const result = session.summary(24000);
  assert.equal(result.durationSec, 14);
  assert.equal(result.face.validSeconds, 10.2);
  assert.equal(result.face.blinkCount, 0);
  assert.equal(result.face.longClosureCount, 0);
  assert.ok(result.face.qualityReasons.includes('face-sampling-gap'));
});

test('body travel is normalized and action counts use completed input edges during flight', () => {
  const session = new ObservationSession({ startedAt: 0 });
  const input = { tracked: true, calibrated: true, fullBody: true };
  session.setPhase('face-check', 0);
  session.recordBody({ landmarks: pose(), input: { ...input, boost: true } }, 0);
  session.setPhase('flight', 1000);
  session.recordBody({ landmarks: pose(), input }, 1000);
  session.recordBody({ landmarks: pose({ shift: .02, leftWristX: .3 }), input: { ...input, kneeLift: true, boost: true, shield: true } }, 1100);
  session.recordBody({ landmarks: pose({ shift: .02, leftWristX: .3 }), input: { ...input, kneeLift: true, boost: true, shield: true } }, 1200);
  session.recordBody({ landmarks: pose({ shift: .02, leftWristX: .3, fullBody: false }), input: { ...input, fullBody: false, squat: true } }, 1300);
  const result = session.summary(2000).body;
  assert.equal(result.validSeconds, .3);
  assert.equal(result.coverage, .3);
  assert.equal(result.fullBodyCoverage, .2);
  assert.ok(Math.abs(result.leftHandTravel - .5) < 1e-10);
  assert.ok(result.rightHandTravel < 1e-10);
  assert.equal(result.kneeLifts, 1);
  assert.equal(result.boosts, 1);
  assert.equal(result.shields, 1);
  assert.equal(result.squats, 0, 'leg actions require full-body evidence');
  assert.ok(Math.abs(result.meanTorsoSway - .1) < 1e-10);
});

test('body gaps do not create wrist travel and unavailable wrists remain missing', () => {
  const session = new ObservationSession({ startedAt: 0 });
  session.setPhase('flight', 0);
  const input = { tracked: true, calibrated: true, fullBody: true };
  const hiddenWrists = pose();
  hiddenWrists[15].visibility = 0;
  hiddenWrists[16].visibility = 0;
  session.recordBody({ landmarks: hiddenWrists, input }, 0);
  session.recordBody({ landmarks: hiddenWrists, input }, 100);
  assert.equal(session.summary(100).body.leftHandTravel, null);
  session.recordBody({ landmarks: pose(), input }, 1000);
  session.recordBody({ landmarks: pose({ leftWristX: .8 }), input }, 2000);
  assert.equal(session.summary(2000).body.leftHandTravel, null);
  assert.equal(session.summary(2000).body.validSeconds, .1);
});

test('portrait framing retains real hand observations while leg measurements remain unavailable', () => {
  const session = new ObservationSession({ startedAt: 0 });
  session.setPhase('flight', 0);
  const input = { tracked: true, calibrated: true, fullBody: false };
  for (let now = 0; now <= 1000; now += 100) {
    const points = pose({ leftWristX: .2 + now / 10000 });
    for (let index = 23; index < 33; index++) Object.assign(points[index], { y: 1.2, visibility: 0 });
    session.recordBody({ landmarks: points, input }, now);
  }
  const result = session.summary(1000).body;
  assert.equal(result.validSeconds, 1);
  assert.equal(result.coverage, 1);
  assert.equal(result.fullBodyCoverage, 0);
  assert.ok(Math.abs(result.leftHandTravel - .5) < 1e-10);
  assert.equal(result.kneeLifts, null);
  assert.equal(result.squats, null);
  assert.equal(result.boosts, null);
});

test('live face feedback reports the current problem and calibration progress, preserving a completed close-up check', () => {
  const session = new ObservationSession({ startedAt: 0 });
  session.setPhase('face-check', 0);
  feedFace(session, 0, 100, { small: true });
  assert.equal(session.summary(100).face.currentQualityReason, 'face-too-small');
  feedFace(session, 200, 2700);
  const calibrating = session.summary(2700).face;
  assert.equal(calibrating.currentQualityReason, null);
  assert.equal(calibrating.baselineReady, false);
  assert.equal(calibrating.baselineProgress, .5);
  feedFace(session, 2800, 20000);
  const calibrated = session.summary(20000).face;
  assert.equal(calibrated.baselineReady, true);
  session.setPhase('flight', 20000);
  feedFace(session, 20100, 22000, { small: true });
  const afterFlight = session.summary(22000).face;
  assert.equal(afterFlight.baselineReady, true);
  assert.equal(afterFlight.baselineProgress, 1);
  assert.equal(afterFlight.validSeconds, calibrated.validSeconds);
});

function visionWith(createFromOptions) {
  return async () => ({ FilesetResolver: { forVisionTasks: async () => ({}) }, FaceLandmarker: { createFromOptions } });
}

test('face observer defaults to CPU, falls back to GPU and returns actual landmarks without acquiring a camera', async () => {
  const delegates = [];
  let closed = false;
  const landmarks = face();
  const observer = new FaceObserver({ loadVision: visionWith(async (_files, options) => {
    delegates.push(options.baseOptions.delegate);
    assert.equal(options.baseOptions.modelAssetPath, '/models/face_landmarker.task');
    if (options.baseOptions.delegate === 'CPU') throw new Error('CPU unavailable');
    return { detectForVideo: () => ({ faceLandmarks: [landmarks] }), close: () => { closed = true; } };
  }) });
  assert.equal(await observer.start(), true);
  assert.deepEqual(delegates, ['CPU', 'GPU']);
  assert.equal(observer.detect({ width: 640, height: 480 }, 100), landmarks);
  observer.stop();
  assert.equal(closed, true);
  assert.deepEqual(observer.detect({ width: 640, height: 480 }, 200), []);
});

test('an explicitly preferred GPU delegate falls back to CPU on initialization errors', async () => {
  const delegates = [];
  const observer = new FaceObserver({ delegate: 'GPU', loadVision: visionWith(async (_files, options) => {
    delegates.push(options.baseOptions.delegate);
    if (options.baseOptions.delegate === 'GPU') throw new Error('GPU unavailable');
    return { detectForVideo: () => ({ faceLandmarks: [] }), close() {} };
  }) });
  assert.equal(await observer.start(), true);
  assert.deepEqual(delegates, ['GPU', 'CPU']);
  observer.stop();
});

test('OpenCV global thenable cannot contaminate face initialization and its cv runtime remains available', async () => {
  const previousModule = globalThis.Module, previousCv = globalThis.cv;
  const cv = { Mat: class {}, imread() {}, then() { return this; } };
  globalThis.Module = globalThis.cv = cv;
  const observer = new FaceObserver({ loadVision: visionWith(async () => {
    if (typeof globalThis.Module?.then === 'function') throw new Error('Foreign thenable would stall MediaPipe initialization');
    return { detectForVideo: () => ({ faceLandmarks: [] }), close() {} };
  }) });
  try {
    assert.equal(await observer.start(), true);
    assert.equal(globalThis.Module, undefined);
    assert.equal(globalThis.cv, cv);
    assert.ok(new globalThis.cv.Mat() instanceof cv.Mat);
  } finally {
    observer.stop();
    if (previousModule === undefined) delete globalThis.Module; else globalThis.Module = previousModule;
    if (previousCv === undefined) delete globalThis.cv; else globalThis.cv = previousCv;
  }
});

test('stopping an initializing face observer closes late resources and repeated timestamps are skipped', async () => {
  let resolveModel, closed = 0;
  const observer = new FaceObserver({ loadVision: visionWith(() => new Promise(resolve => { resolveModel = resolve; })) });
  const starting = observer.start();
  await new Promise(resolve => setImmediate(resolve));
  observer.stop();
  resolveModel({ detectForVideo: () => ({ faceLandmarks: [] }), close: () => { closed++; } });
  assert.equal(await starting, false);
  assert.equal(closed, 1);
  let detections = 0;
  const ready = new FaceObserver({ loadVision: visionWith(async () => ({ detectForVideo: () => { detections++; return { faceLandmarks: [] }; }, close() {} })) });
  await ready.start();
  assert.deepEqual(ready.detect({ width: 640, height: 480 }, 10), []);
  ready.detect({ width: 640, height: 480 }, 10);
  ready.detect({ width: 640, height: 480 }, 9);
  assert.equal(detections, 1);
  ready.stop();
});

test('face observer timeout closes late inference resources and permits a clean retry', async () => {
  let resolveModel, closed = 0;
  const observer = new FaceObserver({ timeoutMs: 10, loadVision: visionWith(() => new Promise(resolve => { resolveModel = resolve; })) });
  assert.equal(await observer.start(), false);
  assert.equal(observer.state, 'error');
  resolveModel({ detectForVideo: () => ({ faceLandmarks: [] }), close: () => { closed++; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closed, 1);
  observer.loadVision = visionWith(async () => ({ detectForVideo: () => ({ faceLandmarks: [] }), close() {} }));
  assert.equal(await observer.start(), true);
  observer.stop();
});

test('aspect-correct face geometry produces the same EAR calibration and head roll on rectangular frames', () => {
  const session = new ObservationSession({ startedAt: 0 });
  session.setPhase('face-check', 0);
  for (let now = 0; now <= 20000; now += 100) {
    const points = face({ ear: now === 7000 || now === 7100 ? .05 : .3, roll: 20 });
    // A 640x480 frame needs scaled normalized y to preserve pixel geometry.
    for (const point of points) point.y = .5 + (point.y - .5) * 640 / 480;
    session.recordFace({ landmarks: points, brightness: .5, width: 640, height: 480 }, now);
  }
  const result = session.summary(20000).face;
  assert.equal(result.blinkCount, 1);
  assert.ok(Math.abs(result.headRollMeanDeg - 20) < 1e-9);
});
