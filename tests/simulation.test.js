import test from 'node:test';
import assert from 'node:assert/strict';

const module = await import('../src/simulation.js').catch(() => ({}));
const simulation = (options = {}) => {
  assert.equal(typeof module.OrbitSimulation, 'function', 'OrbitSimulation must implement the mission engine');
  return new module.OrbitSimulation({ random: () => 0.5, ...options });
};
const advance = (game, seconds, beforeTick = () => {}) => {
  for (let left = seconds; left > 0.00001; left -= 0.05) {
    beforeTick();
    game.tick(Math.min(0.05, left));
  }
};

test('mission start resets state and publishes every documented snapshot field', () => {
  const game = simulation();
  game.start('exercise', { duration: 20, exerciseTarget: 2 });
  game.action('rep');
  game.start('asteroids', { duration: 30 });
  const state = game.snapshot();
  assert.equal(state.status, 'running');
  assert.equal(state.timeLeft, 30);
  assert.equal(state.reps, 0);
  assert.equal(state.hull, 100);
  for (const key of ['mission', 'status', 'timeLeft', 'score', 'hull', 'shield', 'combo', 'progress', 'objective', 'detail', 'reps', 'sequence', 'sequencePhase', 'memoryIndex', 'dockPrecision', 'stats']) {
    assert.ok(Object.hasOwn(state, key), `${key} is present`);
  }
});

test('mission preview remains ready without advancing or emitting a completion', () => {
  const events = [];
  const game = simulation({ onEvent: event => events.push(event) });
  game.start('exercise', { exerciseTarget: 1 });
  game.action('rep');
  events.length = 0;
  game.preview('memory');
  advance(game, 20);
  game.action('left');
  assert.equal(game.snapshot().mission, 'memory');
  assert.equal(game.snapshot().status, 'ready');
  assert.equal(game.snapshot().timeLeft, 90);
  assert.equal(game.snapshot().memoryIndex, 0);
  assert.equal(events.length, 0);
});

test('pause freezes timer, physical movement, and rep actions until resumed', () => {
  const game = simulation();
  game.start('exercise', { duration: 20, exerciseTarget: 2 });
  game.updateInput({ x: 1, y: 1, shield: true });
  game.pause();
  const before = game.snapshot();
  const position = { ...game.ship };
  advance(game, 5);
  game.action('rep');
  assert.deepEqual(game.snapshot(), before);
  assert.deepEqual(game.ship, position);
  game.resume();
  advance(game, 1);
  assert.ok(game.snapshot().timeLeft < 20);
  game.action('rep');
  assert.equal(game.snapshot().reps, 1);
});

test('real flight-path collision damages hull and shield blocks that collision', () => {
  const exposed = simulation();
  exposed.start('asteroids', { duration: 30 });
  advance(exposed, 4);
  assert.ok(exposed.snapshot().hull < 100, 'the center asteroid reaches the centered ship');
  assert.ok(exposed.snapshot().stats.collisions > 0);

  const protectedShip = simulation();
  protectedShip.start('asteroids', { duration: 30 });
  protectedShip.updateInput({ x: 0, y: 0, shield: true });
  advance(protectedShip, 4);
  assert.equal(protectedShip.snapshot().hull, 100);
  assert.ok(protectedShip.snapshot().shield < 100);
  assert.ok(protectedShip.snapshot().stats.shieldBlocks > 0);
});

test('steering away from the asteroid avoids damage and counts an evasion', () => {
  const game = simulation();
  game.start('asteroids', { duration: 30 });
  game.updateInput({ x: 1, y: 1 });
  advance(game, 5);
  assert.equal(game.snapshot().hull, 100);
  assert.ok(game.ship.x > 4);
  assert.ok(game.ship.y > 2);
  assert.ok(game.snapshot().stats.dodged >= 1);
});

test('memory ignores early inputs, penalizes a wrong direction, then progresses 3, 4, 5', () => {
  const game = simulation();
  game.start('memory', { duration: 90 });
  game.action('left');
  assert.equal(game.snapshot().memoryIndex, 0);
  advance(game, 4);
  assert.equal(game.snapshot().sequencePhase, 'input');
  game.action('down');
  assert.ok(game.snapshot().hull < 100);
  assert.equal(game.snapshot().stats.attempts, 1);
  for (const length of [3, 4, 5]) {
    advance(game, 6);
    const state = game.snapshot();
    assert.equal(state.sequence.length, length);
    assert.equal(state.sequencePhase, 'input');
    state.sequence.forEach(direction => game.action(direction));
  }
  assert.equal(game.snapshot().status, 'complete');
  assert.equal(game.snapshot().stats.rounds, 3);
  assert.equal(game.snapshot().stats.correct, 12);
  assert.equal(game.snapshot().stats.success, true);
});

test('docking requires sustained alignment and loses progress when off target', () => {
  const game = simulation();
  game.start('docking', { duration: 60 });
  const align = () => game.updateInput({ x: game.dockTarget.x / 5.2, y: game.dockTarget.y / 3.4 });
  advance(game, 3, align);
  const aligned = game.snapshot();
  assert.ok(aligned.dockPrecision > 85);
  assert.ok(aligned.progress > 0.15);
  game.updateInput({ x: -1, y: -1 });
  advance(game, 2);
  assert.ok(game.snapshot().progress < aligned.progress);
  advance(game, 15, align);
  assert.equal(game.snapshot().status, 'complete');
  assert.equal(game.snapshot().stats.success, true);
});

test('keyboard steering holds its position after release and camera steering remains absolute', () => {
  const game = simulation();
  game.start('docking');
  game.updateInput({ x: 1, y: 0, relative: true });
  advance(game, 0.5);
  const reached = game.ship.x;
  assert.ok(reached > 1 && reached < 3);
  game.updateInput({ x: 0, y: 0 });
  advance(game, 1);
  assert.equal(game.ship.x, reached);
  game.updateInput({ x: 0, y: 0, relative: false });
  advance(game, 1);
  assert.ok(game.ship.x < 0.01);
});

test('exercise finishes only at the rep target and completion fires exactly once', () => {
  const events = [];
  const game = simulation({ onEvent: event => events.push(event) });
  game.start('exercise', { duration: 120, exerciseTarget: 3 });
  game.action('left');
  assert.equal(game.snapshot().reps, 0);
  game.action('rep');
  game.action('rep');
  assert.equal(game.snapshot().status, 'running');
  assert.ok(game.snapshot().progress > 0.6);
  game.action('rep');
  game.action('rep');
  game.tick(100);
  game.end();
  assert.equal(game.snapshot().reps, 3);
  assert.equal(game.snapshot().stats.success, true);
  assert.equal(events.filter(event => event.type === 'complete').length, 1);
  assert.equal(events.find(event => event.type === 'complete').result.reps, 3);
});

test('timer completion distinguishes survival from an unfinished exercise goal', () => {
  const survival = simulation();
  survival.start('asteroids', { duration: 1 });
  survival.tick(1.5);
  assert.equal(survival.snapshot().status, 'complete');
  assert.equal(survival.snapshot().timeLeft, 0);
  assert.equal(survival.snapshot().stats.success, true);
  const exercise = simulation();
  exercise.start('exercise', { duration: 1, exerciseTarget: 3 });
  exercise.tick(1.5);
  assert.equal(exercise.snapshot().status, 'complete');
  assert.equal(exercise.snapshot().stats.success, false);
  assert.equal(exercise.snapshot().stats.reason, 'time');
});

test('collecting a real energy core increases the combo and repeated impacts exhaust the hull', () => {
  const collector = simulation();
  collector.start('asteroids', { duration: 30 });
  collector.updateInput({ x: 0, y: 0, shield: true });
  advance(collector, 5.2);
  assert.ok(collector.snapshot().stats.collected > 0);
  assert.ok(collector.snapshot().combo > 1);
  assert.ok(collector.snapshot().score > 150);

  const exposed = simulation();
  exposed.start('asteroids', { duration: 30 });
  advance(exposed, 20);
  assert.equal(exposed.snapshot().hull, 0);
  assert.equal(exposed.snapshot().status, 'complete');
  assert.equal(exposed.snapshot().stats.success, false);
  assert.equal(exposed.snapshot().stats.reason, 'hull');
});

test('final memory completion event includes the final answer in accuracy statistics', () => {
  let result;
  const game = simulation({ onEvent: event => { if (event.type === 'complete') result = event.result; } });
  game.start('memory');
  advance(game, 4);
  game.action('down');
  advance(game, 4);
  game.action('down');
  for (let round = 0; round < 3; round += 1) {
    advance(game, 6);
    game.snapshot().sequence.forEach(direction => game.action(direction));
  }
  assert.equal(result.stats.correct, 12);
  assert.equal(result.stats.attempts, 14);
  assert.equal(result.stats.accuracy, 86);
});

test('combat is opt-in and sustained fire damages and destroys an aligned drone', () => {
  const game = simulation();
  game.start('asteroids');
  game.updateInput({ fire: true });
  game.tick(.5);
  assert.equal(game.snapshot().stats.shotsFired, 0);
  game.start('asteroids', { duration: 120, enemies: true });
  game.entities = [];
  game.enemies = [];
  game.spawnEnemy(-22, { x: 0, y: 0, health: 2, stationary: true });
  game.updateInput({ fire: true });
  game.tick(1);
  const state = game.snapshot();
  assert.equal(state.stats.enemiesDestroyed, 1);
  assert.equal(state.stats.shotsHit, 2);
  assert.ok(state.stats.shotsFired >= 3 && state.stats.shotsFired <= 4);
  assert.ok(state.score >= 250);
  assert.equal(game.enemies.length, 0);
  assert.ok(game.effects.length > 0);
});

test('a real aimed enemy projectile damages hull and overhead shielding blocks it', () => {
  const run = shield => {
    const game = simulation();
    game.start('asteroids', { enemies: true });
    game.entities = [];
    game.enemies = [];
    game.spawnEnemy(-10, { x: 0, y: 0, stationary: true });
    game.updateInput({ shield });
    game.tick(1.8);
    return game.snapshot();
  };
  assert.ok(run(false).hull < 100);
  const protectedState = run(true);
  assert.equal(protectedState.hull, 100);
  assert.ok(protectedState.stats.shieldBlocks >= 1);
});

test('shield wins over held fire and fire cooldown prevents action spam', () => {
  const game = simulation();
  game.start('asteroids', { enemies: true });
  game.entities = [];
  game.updateInput({ fire: true, shield: true });
  game.tick(.5);
  game.action('fire');
  assert.equal(game.snapshot().stats.shotsFired, 0);
  game.updateInput({ fire: true });
  for (let i = 0; i < 100; i++) game.action('fire');
  assert.equal(game.snapshot().stats.shotsFired, 1);
  game.pause();
  const projectiles = structuredClone(game.projectiles);
  game.tick(5);
  game.action('fire');
  assert.deepEqual(game.projectiles, projectiles);
});

test('boost and duck are discrete cooldown actions and duck changes the physical hit area', () => {
  const game = simulation();
  game.start('asteroids', { enemies: true });
  game.entities = [];
  game.enemies = [];
  game.action('boost');
  game.action('boost');
  game.action('duck');
  game.action('duck');
  let state = game.snapshot();
  assert.equal(state.stats.boosts, 1);
  assert.equal(state.stats.ducks, 1);
  assert.ok(state.boostRemaining > 0 && state.duckRemaining > 0);
  assert.ok(game.flightPosition().y < game.ship.y);
  assert.ok(game.flightPosition().radius < .7);
  game.pause();
  game.tick(3);
  assert.equal(game.snapshot().duckRemaining, state.duckRemaining);
  game.resume();
  game.tick(4.1);
  game.action('boost');
  game.action('duck');
  state = game.snapshot();
  assert.equal(state.stats.boosts, 2);
  assert.equal(state.stats.ducks, 2);
});

test('waves and projectiles remain bounded and a new mission clears all combat state', () => {
  const game = simulation();
  const events = [];
  game.onEvent = event => events.push(event);
  game.start('asteroids', { duration: 120, enemies: true });
  game.updateInput({ fire: true, x: 1, y: 1, shield: true });
  advance(game, 40, () => { game.state.hull = 100; game.state.shield = 100; });
  assert.ok(events.some(event => event.type === 'toast' && /WAVE/.test(event.message)));
  assert.ok(game.enemies.length <= 10);
  assert.ok(game.projectiles.length <= 90);
  assert.ok(game.effects.length <= 24);
  game.start('memory');
  assert.equal(game.enemies.length, 0);
  assert.equal(game.projectiles.length, 0);
  assert.equal(game.snapshot().stats.enemiesDestroyed, 0);
});

test('ducking after a drone aims makes its incoming shot miss the lowered craft', () => {
  const run = duck => {
    const game = simulation();
    game.start('asteroids', { enemies: true });
    game.entities = [];
    game.enemies = [];
    game.spawnEnemy(-10, { x: 0, y: 0, stationary: true });
    game.tick(1.2);
    assert.ok(game.projectiles.some(projectile => projectile.owner === 'enemy'));
    if (duck) game.action('duck');
    game.tick(.7);
    return game.snapshot().hull;
  };
  assert.ok(run(false) < 100);
  assert.equal(run(true), 100);
});

test('final combat event freezes the exact score and accuracy at hull loss', () => {
  let result;
  const game = simulation({ onEvent: event => { if (event.type === 'complete') result = event.result; } });
  game.start('asteroids', { enemies: true });
  game.entities = [];
  game.enemies = [];
  game.spawnEnemy(-10, { x: 0, y: 0, stationary: true });
  game.state.hull = 16;
  game.tick(1.2);
  Object.assign(game.projectiles.find(projectile => projectile.owner === 'enemy'), { x: 0, y: 0, z: 3.4 });
  game.spawnEnemy(0, { x: 0, y: 0, health: 1, stationary: true });
  // The enemy bullet is processed before this shot, so it must end combat first.
  game.projectiles.push({id:999,owner:'player',x:0,y:0,z:2.2,vx:0,vy:0,vz:-110,life:2});
  game.state.stats.shotsFired = 1;
  game.tick(.4);
  assert.equal(result.status, 'complete');
  assert.equal(game.snapshot().score, result.score);
  assert.equal(game.snapshot().stats.enemiesDestroyed, result.stats.enemiesDestroyed);
  assert.equal(game.snapshot().stats.accuracy, result.stats.accuracy);
});
