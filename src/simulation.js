const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const durations = { asteroids: 60, memory: 90, docking: 60, exercise: 120 };
const directions = ['left', 'up', 'right', 'down'];
// Distance from a point to a swept projectile segment, avoiding fast-shot tunnelling.
function segmentDistance(point, from, to) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const length = dx * dx + dy * dy + dz * dz;
  const t = length ? clamp(((point.x - from.x) * dx + (point.y - from.y) * dy + (point.z - from.z) * dz) / length, 0, 1) : 0;
  return Math.hypot(point.x - from.x - dx * t, point.y - from.y - dy * t, point.z - from.z - dz * t);
}

/** Deterministic mission rules, kept independent of graphics and camera hardware. */
export class OrbitSimulation {
  constructor({ random = Math.random, onEvent = () => {} } = {}) {
    this.random = random;
    this.onEvent = onEvent;
    this.preview('asteroids');
  }

  start(mission = 'asteroids', options = {}) {
    if (!Object.hasOwn(durations, mission)) throw new RangeError(`Unknown mission: ${mission}`);
    this.duration = Number.isFinite(options.duration) ? clamp(options.duration, 0.1, 3600) : durations[mission];
    this.exerciseTarget = Math.round(clamp(Number(options.exerciseTarget) || 12, 1, 200));
    this.ship = { x: 0, y: 0 };
    this.input = { x: 0, y: 0, shield: false, fire: false, relative: false };
    this.dockTarget = { x: 0, y: 1.1 };
    this.entities = [];
    this.combatEnabled = mission === 'asteroids' && options.enemies === true;
    this.enemies = [];
    this.projectiles = [];
    this.effects = [];
    this.fireCooldown = 0;
    this.boostCooldown = 0;
    this.duckCooldown = 0;
    this.waveAt = 8;
    this.wave = 0;
    this.entityId = 0;
    this.spawnAt = 1.4;
    this.elapsed = 0;
    this.invulnerable = 0;
    this.shieldPulse = 0;
    this.impact = 0;
    this.repPulse = 0;
    this.phaseTime = 0;
    this.lastAnswerAt = 0;
    this.completed = false;
    this.state = {
      mission, status: 'running', timeLeft: this.duration, score: 0, hull: 100,
      shield: 100, combo: 1, progress: 0, objective: '', detail: '', reps: 0,
      boostRemaining: 0, duckRemaining: 0,
      sequence: mission === 'memory' ? ['left', 'up', 'right'] : [],
      sequencePhase: mission === 'memory' ? 'showing' : 'idle', memoryIndex: 0,
      dockPrecision: 0,
      stats: {
        collisions: 0, dodged: 0, collected: 0, shieldBlocks: 0,
        correct: 0, attempts: 0, rounds: 0, reactionTimes: [], averageReaction: 0,
        accuracy: 0, success: false, reason: '', exerciseTarget: this.exerciseTarget,
        shieldActive: false, elapsed: 0, alignmentTime: 0,
        enemiesDestroyed: 0, shotsFired: 0, shotsHit: 0, boosts: 0, ducks: 0,
      },
    };
    if (mission === 'asteroids') {
      for (let i = 0; i < 12; i += 1) this.spawnEntity(-38 - i * 18, i % 4 === 3 ? 'pickup' : 'asteroid');
      if (this.combatEnabled) this.spawnWave();
    }
    this.describe();
    return this.snapshot();
  }

  preview(mission = 'asteroids') {
    this.start(mission);
    this.state.status = 'ready';
    return this.snapshot();
  }

  updateInput(input = {}) {
    this.input = {
      x: Number.isFinite(input.x) ? clamp(input.x, -1, 1) : 0,
      y: Number.isFinite(input.y) ? clamp(input.y, -1, 1) : 0,
      shield: Boolean(input.shield),
      fire: Boolean(input.fire),
      relative: typeof input.relative === 'boolean' ? input.relative : this.input.relative,
    };
  }

  action(action) {
    const state = this.state;
    if (state.status !== 'running') return;
    if (action === 'shield') {
      if (state.shield > 8) this.shieldPulse = 0.85;
      return;
    }
    if (this.combatEnabled && ['fire', 'boost', 'duck'].includes(action)) {
      if (action === 'fire') this.fire();
      if (action === 'boost' && this.boostCooldown <= 0) {
        state.boostRemaining = 1.3;
        this.boostCooldown = 4;
        state.stats.boosts += 1;
        this.onEvent({ type: 'toast', message: 'BOOST · ENGINES SURGING' });
        this.onEvent({ type: 'audio', cue: 'boost' });
      }
      if (action === 'duck' && this.duckCooldown <= 0) {
        state.duckRemaining = .95;
        this.duckCooldown = 2.2;
        state.stats.ducks += 1;
        this.onEvent({ type: 'toast', message: 'DUCK · LOWER FLIGHT PROFILE' });
        this.onEvent({ type: 'audio', cue: 'duck' });
      }
      return;
    }
    if (state.mission === 'exercise' && action === 'rep') {
      state.reps += 1;
      state.score += 150;
      state.combo = Math.min(8, 1 + Math.floor(state.reps / 3));
      state.progress = state.reps / this.exerciseTarget;
      this.repPulse = 1;
      this.onEvent({ type: 'toast', message: `REP ${state.reps} / ${this.exerciseTarget} · ENERGY RESTORED` });
      if (state.reps >= this.exerciseTarget) this.finish(true, 'goal');
      this.describe();
      return;
    }
    if (state.mission !== 'memory' || state.sequencePhase !== 'input' || !directions.includes(action)) return;
    const stats = state.stats;
    stats.attempts += 1;
    const correct = action === state.sequence[state.memoryIndex];
    if (correct) stats.correct += 1;
    stats.accuracy = Math.round(stats.correct / stats.attempts * 100);
    if (correct) {
      stats.reactionTimes.push(Math.round((this.elapsed - this.lastAnswerAt) * 1000));
      stats.averageReaction = Math.round(stats.reactionTimes.reduce((sum, time) => sum + time, 0) / stats.reactionTimes.length);
      state.memoryIndex += 1;
      state.combo = Math.min(8, state.combo + 1);
      state.score += 80 + 20 * state.combo;
      this.lastAnswerAt = this.elapsed;
      if (state.memoryIndex === state.sequence.length) {
        stats.rounds += 1;
        state.progress = stats.rounds / 3;
        if (stats.rounds === 3) this.finish(true, 'goal');
        else {
          state.sequence = [...state.sequence, stats.rounds === 1 ? 'down' : 'left'];
          state.sequencePhase = 'showing';
          state.memoryIndex = 0;
          this.phaseTime = -0.6;
          this.onEvent({ type: 'toast', message: `SEQUENCE VERIFIED · ROUND ${stats.rounds + 1}` });
        }
      }
    } else {
      state.hull = Math.max(0, state.hull - 18);
      state.combo = 1;
      state.memoryIndex = 0;
      state.sequencePhase = 'showing';
      this.phaseTime = -0.5;
      this.impact = 1;
      this.onEvent({ type: 'toast', message: 'SIGNAL MISMATCH · WATCH THE SEQUENCE AGAIN' });
      if (state.hull <= 0) this.finish(false, 'hull');
    }
    this.describe();
  }

  tick(seconds) {
    if (this.state.status !== 'running' || !Number.isFinite(seconds) || seconds <= 0) return;
    // Small physical steps prevent a slow frame from tunnelling through an asteroid.
    let remaining = Math.min(seconds, 3600);
    while (remaining > 0.000001 && this.state.status === 'running') {
      const dt = Math.min(remaining, 0.05, this.state.timeLeft);
      this.step(dt);
      remaining -= dt;
      if (this.state.timeLeft <= 0.000001) {
        this.state.timeLeft = 0;
        this.finish(this.state.mission === 'asteroids' && this.state.hull > 0, 'time');
      }
    }
    this.describe();
  }

  step(dt) {
    const state = this.state;
    this.elapsed += dt;
    state.timeLeft = Math.max(0, this.duration - this.elapsed);
    state.stats.elapsed = this.elapsed;
    const steeringSpeed = state.boostRemaining > 0 ? 1.65 : 1;
    if (this.input.relative) {
      this.ship.x = clamp(this.ship.x + this.input.x * 3.5 * steeringSpeed * dt, -5.2, 5.2);
      this.ship.y = clamp(this.ship.y + this.input.y * 2.7 * steeringSpeed * dt, -3.4, 3.4);
    } else {
      this.ship.x += (this.input.x * 5.2 - this.ship.x) * (1 - Math.exp(-7 * dt));
      this.ship.y += (this.input.y * 3.4 - this.ship.y) * (1 - Math.exp(-7 * dt));
    }
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.shieldPulse = Math.max(0, this.shieldPulse - dt);
    this.impact = Math.max(0, this.impact - dt * 2.5);
    this.repPulse = Math.max(0, this.repPulse - dt * 1.5);
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    this.boostCooldown = Math.max(0, this.boostCooldown - dt);
    this.duckCooldown = Math.max(0, this.duckCooldown - dt);
    state.boostRemaining = Math.max(0, state.boostRemaining - dt);
    state.duckRemaining = Math.max(0, state.duckRemaining - dt);
    const shieldRequested = (this.input.shield || this.shieldPulse > 0) && state.shield > 0;
    state.stats.shieldActive = shieldRequested;
    state.shield = clamp(state.shield + (shieldRequested ? -13 : 8) * dt, 0, 100);

    if (state.mission === 'asteroids') this.stepFlight(dt);
    if (state.mission === 'memory') {
      this.phaseTime += dt;
      if (state.sequencePhase === 'showing' && this.phaseTime >= state.sequence.length * 0.9 + 0.5) {
        state.sequencePhase = 'input';
        this.lastAnswerAt = this.elapsed;
      }
    }
    if (state.mission === 'docking') {
      this.dockTarget.x = Math.sin(this.elapsed * 0.32) * 2;
      this.dockTarget.y = Math.cos(this.elapsed * 0.27) * 1.1;
      const distance = Math.hypot(this.ship.x - this.dockTarget.x, this.ship.y - this.dockTarget.y);
      state.dockPrecision = clamp(100 - distance * 28, 0, 100);
      const aligned = state.dockPrecision >= 85;
      state.progress = clamp(state.progress + (aligned ? dt / 10 : -dt / 7), 0, 1);
      if (aligned) {
        state.stats.alignmentTime += dt;
        state.score += dt * state.dockPrecision;
      }
      if (state.progress >= 0.999999) {
        state.progress = 1;
        this.finish(true, 'goal');
      }
    }
  }

  spawnEntity(z, type = 'asteroid') {
    if (this.entities.length >= 45) return;
    this.entities.push({
      id: ++this.entityId, type, z,
      x: (this.random() - 0.5) * 10.5,
      y: (this.random() - 0.5) * 6.5,
      radius: type === 'asteroid' ? 0.85 + this.random() * 0.8 : 0.65,
      rotation: this.random() * Math.PI * 2,
      checked: false, removed: false,
    });
  }

  stepFlight(dt) {
    const state = this.state;
    state.score += dt * 8;
    state.progress = clamp(this.elapsed / this.duration, 0, 1);
    this.spawnAt -= dt;
    if (this.spawnAt <= 0) {
      this.spawnEntity(-170, this.random() > 0.76 ? 'pickup' : 'asteroid');
      this.spawnAt = Math.max(0.65, 1.4 - this.elapsed / 180);
    }
    const speed = (19 + this.elapsed * 0.055) * (state.boostRemaining > 0 ? 1.7 : 1);
    const player = this.flightPosition();
    for (const entity of this.entities) {
      if (state.status !== 'running') break;
      entity.z += dt * speed;
      entity.rotation += dt * 0.25;
      if (!entity.checked && entity.z >= 2.5 - entity.radius && entity.z <= 5 + entity.radius) {
        const distance = Math.hypot(entity.x - player.x, entity.y - player.y);
        if (distance < entity.radius + player.radius) {
          entity.checked = true;
          entity.removed = true;
          if (entity.type === 'pickup') {
            state.stats.collected += 1;
            state.score += 120 * state.combo;
            state.combo = Math.min(8, state.combo + 1);
            state.shield = Math.min(100, state.shield + 15);
            this.repPulse = 0.7;
            this.onEvent({ type: 'toast', message: `ENERGY CAPTURED · ×${state.combo} COMBO` });
            this.onEvent({ type: 'audio', cue: 'pickup' });
          } else if (this.invulnerable <= 0) {
            state.stats.collisions += 1;
            this.invulnerable = 0.85;
            if (state.stats.shieldActive && state.shield >= 12) {
              state.shield -= 12;
              state.stats.shieldBlocks += 1;
              state.score += 25;
              this.onEvent({ type: 'toast', message: 'SHIELD ABSORBED IMPACT' });
              this.onEvent({ type: 'audio', cue: 'shield' });
            } else {
              state.hull = Math.max(0, state.hull - 28);
              state.combo = 1;
              this.impact = 1;
              this.onEvent({ type: 'toast', message: 'HULL IMPACT · STEER CLEAR OF THE ROCKS' });
              this.onEvent({ type: 'audio', cue: 'impact' });
              if (state.hull <= 0) this.finish(false, 'hull');
            }
          }
        }
      }
      if (entity.z > 6 + entity.radius && !entity.checked) {
        entity.checked = true;
        if (entity.type === 'asteroid') {
          state.stats.dodged += 1;
          state.score += 20;
        }
      }
    }
    this.entities = this.entities.filter(entity => !entity.removed && entity.z < 24);
    if (this.combatEnabled && state.status === 'running') this.stepCombat(dt);
  }

  flightPosition() {
    const ducking = this.state.duckRemaining > 0;
    return { x: this.ship.x, y: this.ship.y - (ducking ? .9 : 0), z: 4, radius: ducking ? .36 : .7 };
  }

  spawnEnemy(z = -65, { x = (this.random() - .5) * 8, y = (this.random() - .5) * 4, health = 2, stationary = false } = {}) {
    if (!this.combatEnabled || this.enemies.length >= 10) return;
    this.enemies.push({ id: ++this.entityId, type: 'enemy', x, y, z, originX: x, originY: y,
      health, maxHealth: health, radius: .9, age: 0, fireAt: .8 + this.random() * .7, stationary, removed: false });
  }

  spawnWave() {
    this.wave += 1;
    for (let i = 0; i < 3; i += 1) this.spawnEnemy(-62 - i * 7, { x: (i - 1) * 2.8, y: i % 2 ? 1.1 : -.5 });
    this.onEvent({ type: 'toast', message: `DRONE WAVE ${this.wave} · EXTEND RIGHT ARM OR HOLD J TO FIRE` });
  }

  fire() {
    if (!this.combatEnabled || this.state.status !== 'running' || this.fireCooldown > .000001
      || ((this.input.shield || this.shieldPulse > 0) && this.state.shield > 0) || this.projectiles.length >= 90) return;
    const player = this.flightPosition();
    this.projectiles.push({ id: ++this.entityId, owner: 'player', x: player.x, y: player.y,
      z: 2.2, vx: 0, vy: 0, vz: -110, life: 2.2, removed: false });
    this.fireCooldown = .28;
    this.state.stats.shotsFired += 1;
    this.onEvent({ type: 'audio', cue: 'fire' });
    this.state.stats.accuracy = Math.round(this.state.stats.shotsHit / this.state.stats.shotsFired * 100);
  }

  burst(x, y, z, color = 'orange', size = 1) {
    this.effects.push({ id: ++this.entityId, x, y, z, color, size, life: .7, duration: .7 });
    if (this.effects.length > 24) this.effects.shift();
  }

  damagePlayer(damage, shieldCost, message) {
    if (this.invulnerable > 0 || this.state.status !== 'running') return;
    const state = this.state;
    this.invulnerable = .45;
    const player = this.flightPosition();
    if (state.stats.shieldActive && state.shield >= shieldCost) {
      state.shield -= shieldCost;
      state.stats.shieldBlocks += 1;
      state.score += 15;
      this.burst(player.x, player.y, 3, 'cyan', .8);
      this.onEvent({ type: 'audio', cue: 'shield' });
    } else {
      state.hull = Math.max(0, state.hull - damage);
      state.combo = 1;
      this.impact = 1;
      this.burst(player.x, player.y, 3, 'orange', .8);
      this.onEvent({ type: 'toast', message });
      this.onEvent({ type: 'audio', cue: 'impact' });
      if (state.hull <= 0) this.finish(false, 'hull');
    }
  }

  stepCombat(dt) {
    const state = this.state;
    for (const effect of this.effects) effect.life -= dt;
    this.effects = this.effects.filter(effect => effect.life > 0);
    this.waveAt -= dt;
    if (this.waveAt <= 0) {
      this.spawnWave();
      this.waveAt = Math.max(6, 9 - this.elapsed / 90);
    }
    if (this.input.fire) this.fire();
    const player = this.flightPosition();
    for (const enemy of this.enemies) {
      enemy.age += dt;
      if (!enemy.stationary) {
        enemy.z = enemy.age < 17 ? Math.min(-22, enemy.z + dt * 8) : enemy.z + dt * 24;
        enemy.x = enemy.originX + Math.sin(enemy.age * .7 + enemy.id) * .75;
        enemy.y = enemy.originY + Math.sin(enemy.age * .5 + enemy.id) * .35;
      }
      enemy.fireAt -= dt;
      if (enemy.fireAt <= 0 && enemy.z < 1 && this.projectiles.length < 90) {
        const dx = player.x - enemy.x, dy = player.y - enemy.y, dz = 4 - enemy.z;
        const length = Math.hypot(dx, dy, dz);
        this.projectiles.push({ id: ++this.entityId, owner: 'enemy', x: enemy.x, y: enemy.y, z: enemy.z + .8,
          vx: dx / length * 36, vy: dy / length * 36, vz: dz / length * 36, life: 5, removed: false });
        enemy.fireAt = 2.4 + this.random() * 1.1;
      }
      if (enemy.z > 2.5 && enemy.z < 5.5 && Math.hypot(enemy.x - player.x, enemy.y - player.y) < enemy.radius + player.radius) {
        enemy.removed = true;
        this.damagePlayer(22, 12, 'DRONE IMPACT · REPOSITION');
      }
    }
    for (const projectile of this.projectiles) {
      if (state.status !== 'running') break;
      const previous = { x: projectile.x, y: projectile.y, z: projectile.z };
      projectile.x += projectile.vx * dt;
      projectile.y += projectile.vy * dt;
      projectile.z += projectile.vz * dt;
      projectile.life -= dt;
      if (projectile.owner === 'player') {
        // Resolve the nearest intersecting target along this step.
        const hit = this.enemies.filter(enemy => !enemy.removed
          && segmentDistance(enemy, previous, projectile) < enemy.radius + .12)
          .sort((a, b) => b.z - a.z)[0];
        if (hit) {
          projectile.removed = true;
          hit.health -= 1;
          state.stats.shotsHit += 1;
          state.stats.accuracy = Math.round(state.stats.shotsHit / state.stats.shotsFired * 100);
          this.burst(hit.x, hit.y, hit.z, hit.health <= 0 ? 'orange' : 'cyan', hit.health <= 0 ? 1.6 : .55);
          if (hit.health <= 0) {
            hit.removed = true;
            state.stats.enemiesDestroyed += 1;
            this.onEvent({ type: 'audio', cue: 'destroy' });
            state.score += 250 * state.combo;
            state.combo = Math.min(8, state.combo + 1);
          }
        }
      } else if (segmentDistance(player, previous, projectile) < player.radius + .15) {
        projectile.removed = true;
        this.damagePlayer(16, 8, 'ENEMY LASER · SHIELD OR EVADE');
      }
    }
    this.enemies = this.enemies.filter(enemy => !enemy.removed && enemy.z < 16);
    this.projectiles = this.projectiles.filter(projectile => !projectile.removed && projectile.life > 0
      && projectile.z > -220 && projectile.z < 20 && Math.abs(projectile.x) < 30 && Math.abs(projectile.y) < 25);
    state.stats.accuracy = state.stats.shotsFired ? Math.round(state.stats.shotsHit / state.stats.shotsFired * 100) : 0;
  }

  pause() {
    if (this.state.status === 'running') this.state.status = 'paused';
    return this.snapshot();
  }

  resume() {
    if (this.state.status === 'paused') this.state.status = 'running';
    return this.snapshot();
  }

  end() {
    if (this.state.status === 'running' || this.state.status === 'paused') this.finish(false, 'ended');
    return this.snapshot();
  }

  finish(success, reason) {
    if (this.completed) return;
    this.completed = true;
    this.state.status = 'complete';
    this.state.stats.success = success;
    this.state.stats.reason = reason;
    this.state.stats.shieldActive = false;
    if (success) {
      this.state.score += Math.round(this.state.hull * 5);
      this.state.progress = 1;
    }
    this.describe();
    this.onEvent({ type: 'complete', result: this.snapshot() });
  }

  describe() {
    const state = this.state;
    if (state.mission === 'asteroids') {
      state.objective = this.combatEnabled ? 'Orbital defense · survive the drone waves' : 'Navigate the asteroid field';
      state.detail = this.combatEnabled ? 'Hands steer · right arm fires · overhead shield · knee boost · squat duck' : 'Steer around rocks · collect cyan energy · raise your shield';
    } else if (state.mission === 'memory') {
      state.objective = `Signal sequence · ${Math.min(3, state.stats.rounds + 1)} / 3`;
      state.detail = state.sequencePhase === 'showing' ? 'Watch the illuminated directions, then repeat them' : `Repeat the pattern · ${state.memoryIndex} / ${state.sequence.length} received`;
    } else if (state.mission === 'docking') {
      state.objective = 'Align with the orbital station';
      state.detail = state.dockPrecision >= 85 ? `${Math.round(state.dockPrecision)}% precision · alignment locked, hold steady` : `${Math.round(state.dockPrecision)}% precision · align the orange cursor with the cyan beacon, above 85%`;
    } else {
      state.objective = `Training circuit · ${state.reps} / ${this.exerciseTarget} reps`;
      const group = Math.min(2, Math.floor(state.reps / Math.max(1, this.exerciseTarget / 3)));
      state.detail = ['Squats · lower, then return to standing', 'Knee lifts · lift one knee, then lower it', 'Overhead reaches · raise both arms, then lower'][group];
    }
    if (state.status === 'complete') state.detail = state.stats.success ? 'Objective complete · return to mission control for your debrief' : state.stats.reason === 'ended' ? 'Session ended · your completed activity is in the debrief' : 'Session complete · review your flight and try again';
  }

  snapshot() {
    const state = this.state;
    const showIndex = state.sequencePhase === 'showing' && this.phaseTime >= 0 && this.phaseTime % 0.9 < 0.65 ? Math.floor(this.phaseTime / 0.9) : -1;
    return {
      ...state, score: Math.round(state.score), hull: Math.round(state.hull), shield: Math.round(state.shield),
      dockPrecision: Math.round(state.dockPrecision), sequence: [...state.sequence],
      showIndex: showIndex < state.sequence.length ? showIndex : -1,
      dockTarget: { ...this.dockTarget },
      stats: { ...state.stats, reactionTimes: [...state.stats.reactionTimes] },
    };
  }
}
