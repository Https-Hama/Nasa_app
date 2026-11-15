import test from 'node:test';
import assert from 'node:assert/strict';

const module = await import('../src/flight-controls.js').catch(() => ({}));
const poseInput = { calibrated: true, tracked: true, fullBody: true, x: 0, y: 0 };
function standing() {
  const points = Array.from({ length: 33 }, () => ({ x: .5, y: .2, visibility: .98, presence: .98 }));
  for (const [i, x, y] of [[11,.4,.25],[12,.6,.25],[13,.35,.4],[14,.65,.4],[15,.34,.55],[16,.66,.55],[23,.43,.5],[24,.57,.5],[25,.43,.72],[26,.57,.72],[27,.43,.93],[28,.57,.93]]) Object.assign(points[i], {x,y});
  return points;
}
function recognizer() {
  assert.equal(typeof module.FlightGestureRecognizer, 'function', 'FlightGestureRecognizer must exist');
  const result = new module.FlightGestureRecognizer();
  result.update(standing(), 0, poseInput);
  return result;
}
function knee() { const p = standing(); p[25].y = .48; p[27].y = .68; return p; }
function squat() {
  const p = standing();
  for (const i of [11,12,13,14,15,16,23,24]) p[i].y += .12;
  Object.assign(p[25], {x:.3,y:.78}); Object.assign(p[26], {x:.7,y:.78});
  return p;
}

test('hands steer with mirrored x and torso-relative y after calibration', () => {
  const r = recognizer();
  assert.equal(r.update(standing(), 100, poseInput).x, 0);
  const hands = standing();
  hands[15].x -= .15; hands[16].x -= .15;
  hands[15].y -= .12; hands[16].y -= .12;
  const output = r.update(hands, 200, poseInput);
  assert.ok(output.x > .5, 'camera left maps to screen right');
  assert.ok(output.y > .4, 'raised hands steer up');
  assert.ok(output.x <= 1 && output.y <= 1);
});

test('extended right arm holds fire and both overhead hands override fire with shield', () => {
  const r = recognizer(), firing = standing();
  Object.assign(firing[14], {x:.75,y:.27}); Object.assign(firing[16], {x:.92,y:.26});
  assert.equal(r.update(firing, 100, poseInput).fire, true);
  assert.equal(r.update(firing, 400, poseInput).fire, true);
  const overhead = standing();
  overhead[13].y = overhead[14].y = .16;
  overhead[15].y = overhead[16].y = .05;
  const shield = r.update(overhead, 500, poseInput);
  assert.equal(shield.shield, true);
  assert.equal(shield.fire, false);
});

test('portrait-only players can aim, fire and shield without hip or leg landmarks', () => {
  const portrait = standing();
  for (let index = 23; index < 33; index++) Object.assign(portrait[index], { x: NaN, y: 1.3, visibility: .1 });
  const input = { ...poseInput, fullBody: false };
  const r = new module.FlightGestureRecognizer();
  assert.equal(r.update(portrait, 0, input).controlsReady, true);
  const aiming = structuredClone(portrait);
  aiming[15].x -= .12;
  aiming[15].y -= .1;
  Object.assign(aiming[14], { x: .75, y: .27 });
  Object.assign(aiming[16], { x: .92, y: .26 });
  const firing = r.update(aiming, 100, input);
  assert.equal(firing.controlsReady, true);
  assert.ok(firing.x > .5);
  assert.ok(firing.y > .4);
  assert.equal(firing.fire, true);
  assert.equal(firing.boost, false);
  assert.equal(firing.duck, false);
  aiming[13].y = aiming[14].y = .16;
  aiming[15].y = aiming[16].y = .05;
  const shielding = r.update(aiming, 200, input);
  assert.equal(shielding.shield, true);
  assert.equal(shielding.fire, false);
});

test('hip visibility changes cannot shift hand aim or complete a pending leg action', () => {
  const r = recognizer();
  const portrait = standing();
  for (let index = 23; index < 33; index++) Object.assign(portrait[index], { y: 1.2, visibility: 0 });
  r.update(knee(), 100, poseInput);
  r.update(knee(), 400, poseInput);
  const cropped = r.update(portrait, 500, { ...poseInput, fullBody: false });
  assert.equal(cropped.controlsReady, true);
  assert.equal(cropped.x, 0);
  assert.equal(cropped.y, 0);
  const returned = r.update(standing(), 600, poseInput);
  assert.equal(returned.boost, false);
  assert.equal(returned.duck, false);
  assert.equal(returned.y, 0);
});

test('relaxed arms never fire and extending the right arm does not move the left-hand aim',()=>{
 const r=recognizer();assert.equal(r.update(standing(),100,poseInput).fire,false);
 const firing=standing();Object.assign(firing[14],{x:.75,y:.27});Object.assign(firing[16],{x:.92,y:.26});
 const result=r.update(firing,200,poseInput);assert.equal(result.fire,true);assert.equal(result.x,0);assert.equal(result.y,0);
});

test('reacquiring tracking preserves the neutral aim and interrupts the previous gesture', () => {
  const r=recognizer();
  const moved=standing();
  moved[15].x-=.1;
  assert.ok(r.update(moved,100,poseInput).x>.4);
  r.interruptTracking();
  assert.ok(r.update(moved,300,poseInput).x>.4,'a displaced hand must not become the new center');
  assert.equal(r.update([],350,{...poseInput,tracked:false}).x,0);
});

test('knee boost needs a held complete up-down cycle with neutral rearm and cooldown', () => {
  const r = recognizer();
  assert.equal(r.update(knee(), 100, poseInput).boost, false);
  assert.equal(r.update(knee(), 450, poseInput).boost, false);
  const completed = r.update(standing(), 550, poseInput);
  assert.equal(completed.boost, true);
  assert.equal(completed.kneeLift, true);
  assert.equal(r.update(standing(), 600, poseInput).boost, false);
  r.update(knee(), 650, poseInput); r.update(knee(), 1000, poseInput);
  assert.equal(r.update(standing(), 1100, poseInput).boost, false);
  r.update(standing(), 4900, poseInput);
  r.update(knee(), 5000, poseInput); r.update(knee(), 5400, poseInput);
  assert.equal(r.update(standing(), 5500, poseInput).boost, true);
});

test('a completed squat ducks once and a camera gap discards pending cycles', () => {
  const r = recognizer();
  r.update(squat(), 100, poseInput); r.update(squat(), 500, poseInput);
  const completed = r.update(standing(), 600, poseInput);
  assert.equal(completed.duck, true);
  assert.equal(completed.squat, true);
  r.update(standing(), 3900, poseInput);
  r.update(squat(), 4000, poseInput);
  const lost = r.update([], 4400, { ...poseInput, tracked: false });
  assert.equal(lost.fire, false); assert.equal(lost.x, 0);
  assert.equal(r.update(standing(), 4500, poseInput).duck, false);
});

test('uncalibrated, low-confidence arms and missing legs cannot trigger unsafe actions', () => {
  const r = recognizer(), points = knee();
  points[16].visibility = .1;
  for (const input of [{ ...poseInput, calibrated: false }, poseInput, { ...poseInput, fullBody: false }]) {
    const output = r.update(points, 100, input);
    assert.equal(output.fire, false); assert.equal(output.shield, false);
    assert.equal(output.controlsReady,false);
    assert.equal(output.boost, false); assert.equal(output.duck, false);
  }
  r.update(knee(), 200, poseInput);
  r.reset();
  assert.equal(r.update(standing(), 600, poseInput).boost, false);
});
