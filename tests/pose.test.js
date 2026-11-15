import test from 'node:test';
import assert from 'node:assert/strict';
import { assessPose, PoseRecognizer } from '../src/pose.js';
import { BodyController } from '../src/body-controller.js';

// Synthetic, hand-positioned landmarks. They test movement logic, not model accuracy.
function standing() {
  const points = Array.from({ length: 33 }, () => ({ x: .5, y: .25, z: 0, visibility: .98, presence: .98 }));
  for (const [index, x, y] of [
    [11,.4,.25],[12,.6,.25],[13,.35,.40],[14,.65,.40],[15,.34,.55],[16,.66,.55],
    [23,.43,.5],[24,.57,.5],[25,.43,.72],[26,.57,.72],[27,.43,.93],[28,.57,.93],
    [29,.43,.95],[30,.57,.95],[31,.40,.96],[32,.60,.96],
  ]) Object.assign(points[index], { x, y });
  return points;
}
function translated(dx = 0, dy = 0) {
  return standing().map(p => ({ ...p, x: p.x + dx, y: p.y + dy }));
}
function squatting() {
  const points = standing();
  for (const i of [11,12,13,14,15,16,23,24]) points[i].y += .12;
  Object.assign(points[25], { x: .30, y: .78 });
  Object.assign(points[26], { x: .70, y: .78 });
  return points;
}
function knee(side) {
  const points = standing();
  points[side === 'left' ? 25 : 26].y = .49;
  points[side === 'left' ? 27 : 28].y = .68;
  return points;
}
function reaching() {
  const points = standing();
  for (const i of [13,14]) points[i].y = .16;
  for (const i of [15,16]) points[i].y = .05;
  return points;
}
function calibrated(exercise = 'squat') {
  const recognizer = new PoseRecognizer();
  recognizer.setExercise(exercise);
  recognizer.calibrate(0);
  for (let time = 0; time <= 2100; time += 100) recognizer.update(standing(), time);
  return recognizer;
}

test('occluded or offscreen legs disable full-body recognition while seated steering remains available', () => {
  const points = standing();
  assert.equal(assessPose(points).fullBody, true);
  points[27].visibility = .1;
  assert.equal(assessPose(points).tracked, true);
  assert.equal(assessPose(points).fullBody, false);
  points[27].visibility = .98;
  points[28].y = 1.04;
  assert.equal(assessPose(points).fullBody, false);
  points[11].presence = .1;
  assert.equal(assessPose(points).tracked, false);
});

test('missing, malformed and low-confidence torso poses never move the ship', () => {
  const recognizer = calibrated();
  for (const landmarks of [null, [], standing().map(p => ({ ...p, visibility: .2 })), standing().map(p => ({ ...p, x: NaN }))]) {
    const input = recognizer.update(landmarks, 2500);
    assert.equal(input.tracked, false);
    assert.equal(input.x, 0);
    assert.equal(input.y, 0);
    assert.equal(input.rep, undefined);
  }
});

test('portrait calibration and steering need no visible hips, knees or ankles', () => {
  const portrait = standing();
  for (let index = 23; index < 33; index++) Object.assign(portrait[index], { y: 1.2, visibility: .1, presence: .1 });
  assert.equal(assessPose(portrait).tracked, true);
  assert.equal(assessPose(portrait).fullBody, false);
  const recognizer = new PoseRecognizer();
  recognizer.calibrate();
  for (let now = 0; now <= 2100; now += 100) recognizer.update(portrait, now);
  assert.equal(recognizer.calibrated, true);
  const moved = portrait.map(point => ({ ...point, x: point.x - .1 }));
  const output = recognizer.update(moved, 2200);
  assert.equal(output.tracked, true);
  assert.ok(output.x > .1);
  assert.equal(output.rep, undefined, 'offscreen legs cannot produce exercise counts');
});

test('camera controller reaches tracking status from an upper-body-only camera feed', () => {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const previousRaf = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { hidden: false } });
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: () => 1 });
  try {
    const portrait = standing();
    for (let index = 23; index < 33; index++) Object.assign(portrait[index], { y: 1.3, visibility: 0 });
    const statuses = [], inputs = [], metrics = [];
    const video = { readyState: 2, currentTime: 0 };
    const controller = new BodyController({ video, overlay: null,
      onStatus: status => {
        if (status.state === 'tracking') {
          assert.equal(metrics.at(-1).calibrated, true, 'tracking callbacks must observe current calibration');
          assert.equal(metrics.at(-1).controlsReady, true);
        }
        statuses.push(status);
      }, onInput: input => inputs.push(input), onMetrics: metric => metrics.push(metric) });
    controller.active = true;
    controller.stream = { getVideoTracks: () => [] };
    controller.landmarker = { detectForVideo: () => ({ landmarks: [portrait] }) };
    controller.frameCanvas = controller.processingCanvas = { width: 640, height: 480 };
    controller.frameContext = { drawImage() {} };
    controller.preprocess = () => { controller.brightness = .5; };
    controller.calibrate();
    for (let now = 100; now <= 2300; now += 100) {
      video.currentTime = now / 1000;
      controller.tick(now);
    }
    assert.equal(statuses.at(-1).state, 'tracking');
    assert.equal(inputs.at(-1).controlsReady, true);
    assert.equal(inputs.at(-1).tracked, true);
    assert.equal(inputs.at(-1).fullBody, false);
    assert.equal(statuses.some(status => status.state === 'lost'), false);
    controller.signalLost(2400, 'A hand left the camera frame', true);
    assert.equal(metrics.at(-1).controlsReady, false);
    assert.equal(metrics.at(-1).tracked, false);
    assert.equal(metrics.at(-1).calibrated, true, 'brief loss preserves neutral calibration');
    video.currentTime = 2.5;
    controller.tick(2500);
    assert.equal(metrics.at(-1).controlsReady, true);
    assert.equal(statuses.at(-1).state, 'tracking');
  } finally {
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else delete globalThis.document;
    if (previousRaf) Object.defineProperty(globalThis, 'requestAnimationFrame', previousRaf); else delete globalThis.requestAnimationFrame;
  }
});

test('neutral calibration averages two seconds of samples before enabling movement', () => {
  const recognizer = new PoseRecognizer();
  recognizer.calibrate(0);
  for (let time = 0; time < 2000; time += 100) recognizer.update(translated(time % 200 === 0 ? .01 : -.01), time);
  assert.equal(recognizer.calibrated, false);
  recognizer.update(standing(), 2000);
  assert.equal(recognizer.calibrated, true);
  assert.ok(Math.abs(recognizer.update(standing(), 2100).x) < .01);
});

test('steering has a neutral deadzone, follows the mirrored image and clamps comfortable range', () => {
  const recognizer = calibrated();
  assert.equal(recognizer.update(translated(.008, -.006), 2200).x, 0);
  assert.equal(recognizer.update(translated(.008, -.006), 2250).y, 0);
  let output;
  for (let n = 0; n < 20; n++) output = recognizer.update(translated(-.24, -.11), 2300 + n * 60);
  assert.ok(output.x > .95, 'camera left becomes mirrored screen right');
  assert.ok(output.y > .95, 'raising torso steers upward');
  assert.ok(output.x <= 1 && output.y <= 1);
  const dropout = recognizer.update([], 3600);
  assert.equal(dropout.x, 0, 'dropout stops stale steering immediately');
});

test('squats require a full down-up cycle, hold time and cooldown', () => {
  const recognizer = calibrated();
  assert.equal(recognizer.update(squatting(), 2300).rep, undefined);
  assert.equal(recognizer.update(squatting(), 2800).rep, undefined);
  assert.equal(recognizer.update(standing(), 2900).rep, 'squat');
  assert.equal(recognizer.update(standing(), 3100).rep, undefined);
  recognizer.update(squatting(), 3150);
  assert.equal(recognizer.update(standing(), 3500).rep, undefined, 'complete cycles inside cooldown are rejected');
  recognizer.update(squatting(), 3700);
  assert.equal(recognizer.update(standing(), 3750).rep, undefined, 'very rapid dip is rejected');
  recognizer.update(squatting(), 4000);
  assert.equal(recognizer.update(standing(), 4500).rep, 'squat');
  assert.equal(recognizer.reps.squat, 2);
});

test('a partial pose or tracking dropout cannot finish a squat', () => {
  const recognizer = calibrated();
  const hiddenLeg = squatting();
  hiddenLeg[28].visibility = .1;
  recognizer.update(hiddenLeg, 2300);
  assert.equal(recognizer.update(standing(), 2900).rep, undefined);
  recognizer.update(squatting(), 3200);
  recognizer.update([], 3500);
  assert.equal(recognizer.update(standing(), 3900).rep, undefined);
});

test('squat hysteresis rejects small shifts and cannot count a held position repeatedly', () => {
  const recognizer = calibrated();
  for (let n = 0; n < 30; n++) {
    assert.equal(recognizer.update(translated(0, n % 2 ? .015 : -.015), 2300 + n * 80).rep, undefined);
  }
  for (let n = 0; n < 30; n++) assert.equal(recognizer.update(squatting(), 5000 + n * 80).rep, undefined);
  assert.equal(recognizer.update(standing(), 7600).rep, 'squat');
  assert.equal(recognizer.reps.squat, 1);
});

test('knee lifts count complete cycles and require alternating sides', () => {
  const recognizer = calibrated('knee');
  recognizer.update(knee('left'), 2300);
  assert.equal(recognizer.update(standing(), 2700).rep, 'knee');
  recognizer.update(knee('left'), 3400);
  assert.equal(recognizer.update(standing(), 3800).rep, undefined);
  recognizer.update(knee('right'), 4300);
  assert.equal(recognizer.update(standing(), 4700).rep, 'knee');
  assert.equal(recognizer.reps.knee, 2);
});

test('overhead reaches require both visible arms then a return and never repeat while held', () => {
  const recognizer = calibrated('reach');
  const hidden = reaching();
  hidden[15].visibility = .1;
  assert.equal(recognizer.update(hidden, 2300).shield, false);
  assert.equal(recognizer.update(standing(), 2800).rep, undefined);
  assert.equal(recognizer.update(reaching(), 3100).shield, true);
  assert.equal(recognizer.update(reaching(), 3600).rep, undefined);
  assert.equal(recognizer.update(reaching(), 4000).rep, undefined);
  assert.equal(recognizer.update(standing(), 4200).rep, 'reach');
  assert.equal(recognizer.update(standing(), 4500).rep, undefined);
  assert.equal(recognizer.reps.reach, 1);
});

test('switching exercises discards a pending movement', () => {
  const recognizer = calibrated('squat');
  recognizer.update(squatting(), 2300);
  recognizer.setExercise('reach');
  assert.equal(recognizer.update(standing(), 2900).rep, undefined);
  assert.equal(recognizer.reps.squat, 0);
});

test('camera denial reports an actionable error and emits stopped controls', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const statuses = [], inputs = [];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    mediaDevices: { getUserMedia: async () => { throw new DOMException('Permission denied', 'NotAllowedError'); } },
  } });
  try {
    const controller = new BodyController({ video: {}, overlay: {}, onStatus: status => statuses.push(status), onInput: input => inputs.push(input) });
    assert.equal(await controller.start(), false);
    assert.equal(statuses.at(-1)?.state, 'error');
    assert.match(statuses.at(-1).message, /denied|permission/i);
    assert.equal(inputs.at(-1).tracked, false);
    assert.equal(inputs.at(-1).x, 0);
    controller.stop();
    assert.equal(statuses.at(-1).state, 'off');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous);
    else delete globalThis.navigator;
  }
});

test('missing camera support leaves controls centered without throwing', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let status;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  try {
    const controller = new BodyController({ video: {}, overlay: {}, onStatus: value => { status = value; } });
    assert.equal(await controller.start(), false);
    assert.equal(status?.state, 'error');
    assert.match(status.message, /camera|localhost|secure/i);
    controller.stop();
  } finally {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous);
    else delete globalThis.navigator;
  }
});

test('a camera signal interruption discards a pending exercise immediately', () => {
  const controller = new BodyController({ video: {}, overlay: {} });
  controller.recognizer = calibrated();
  controller.recognizer.update(squatting(), 2300);
  controller.signalLost(2500, 'Signal interrupted', true);
  assert.equal(controller.recognizer.update(standing(), 2900).rep, undefined);
});
