// Game-control thresholds only. Landmarks remain in memory and are never stored.
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const ARMS = [11, 12, 13, 14, 15, 16];
const LEGS = [23, 24, 25, 26, 27, 28];
const valid = p => p && Number.isFinite(p.x) && Number.isFinite(p.y)
  && Math.min(p.visibility ?? 0, p.presence ?? p.visibility ?? 0) >= .55
  && p.x >= .015 && p.x <= .985 && p.y >= .015 && p.y <= .985;
function angle(a, b, c, aspect) {
  const ux = (a.x - b.x)*aspect, uy = a.y - b.y, vx = (c.x - b.x)*aspect, vy = c.y - b.y;
  const length = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  return length > .00001 ? Math.acos(clamp((ux * vx + uy * vy) / length, -1, 1)) * 180 / Math.PI : 0;
}
const axis = n => Math.abs(n) < .1 ? 0 : Math.sign(n) * clamp((Math.abs(n) - .1) / .9, 0, 1);

export class FlightGestureRecognizer {
  constructor() { this.reset(); }

  reset() {
    this.neutral = null;
    this.legNeutral = null;
    this.lastBoost = -Infinity;
    this.lastDuck = -Infinity;
    this.calibrationSamples = [];
    this.interruptTracking();
  }

  interruptTracking() {
    this.pending = null;
    this.neutralSeen = false;
    this.lastNow = null;
    this.aim = {x:0,y:0};
    this.shielding = false;
    this.firing = false;
    this.legNeutral = null;
    if (!this.neutral) this.calibrationSamples = [];
  }

  update(landmarks, now, poseInput = {}, aspectRatio = 1) {
    const output = { x: 0, y: 0, shield: false, fire: false, boost: false, duck: false, controlsReady:false, gesture: 'Stand in view' };
    const usable = poseInput.calibrated && poseInput.tracked && Number.isFinite(now)
      && Array.isArray(landmarks) && ARMS.every(i => valid(landmarks[i]));
    if (!usable) {
      this.pending = null;
      this.neutralSeen = false;
      this.lastNow = null;
      this.aim = {x:0,y:0};
      this.shielding = this.firing = false;
      this.legNeutral = null;
      if (!poseInput.calibrated) {
        this.neutral = null;
        if (poseInput.tracked && Array.isArray(landmarks) && ARMS.every(i => valid(landmarks[i]))) {
          const sample = steeringGeometry(landmarks);
          this.calibrationSamples.push(sample);
          if (this.calibrationSamples.length > 40) this.calibrationSamples.shift();
        } else this.calibrationSamples = [];
      }
      output.gesture = poseInput.calibrated ? 'Keep shoulders and hands in view' : 'Calibrate a neutral pose';
      return output;
    }
    if (this.lastNow !== null && (now <= this.lastNow || now - this.lastNow > 700)) {
      this.interruptTracking();
    }
    const dt = this.lastNow === null ? 55 : clamp(now-this.lastNow,12,125);
    this.lastNow = now;
    output.controlsReady=true;
    const p = landmarks;
    const geometry = steeringGeometry(p);
    const { shoulderY, torso, width, handX, handY } = geometry;
    const aspect = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
    // Left hand aims independently so extending the right arm cannot push the
    // aiming position away from the target while it fires.
    if (!this.neutral) {
      const samples = [...this.calibrationSamples,geometry];
      this.neutral = Object.fromEntries(['handX','handY'].map(key =>
        [key,samples.reduce((sum,sample)=>sum+sample[key],0)/samples.length]));
      this.calibrationSamples = [];
    }
    const shieldHeight = this.shielding ? .30 : .45;
    const elbowRoom = this.shielding ? torso*.10 : 0;
    output.shield = this.shielding = p[15].y < shoulderY - torso * shieldHeight && p[16].y < shoulderY - torso * shieldHeight
      && p[13].y < shoulderY+elbowRoom && p[14].y < shoulderY+elbowRoom;
    const dx=-(handX-this.neutral.handX), dy=-(handY-this.neutral.handY);
    if (!output.shield) {
      for (const [key,target] of [['x',axis(dx/.64)],['y',axis(dy/(dy<0?.52:.76))]]) {
        const response = 1-Math.exp(-dt/(Math.abs(target-this.aim[key])>.25?36:78));
        this.aim[key] += (target-this.aim[key])*response;
        if (target===0 && Math.abs(this.aim[key])<.025) this.aim[key]=0;
      }
    }
    output.x=this.aim.x; output.y=this.aim.y;
    output.fire = this.firing = !output.shield && p[16].y < shoulderY + torso * (this.firing?.50:.43)
      && angle(p[12], p[14], p[16], aspect) > (this.firing?135:147)
      && Math.hypot((p[16].x - p[12].x)*aspect, p[16].y - p[12].y) > width * aspect * (this.firing?.86:1.0);
    output.gesture = output.shield ? 'Shield active' : output.fire ? 'Firing' : 'Hands steer · extend right arm to fire';

    if (!poseInput.fullBody || !LEGS.every(i => valid(p[i]))) {
      this.pending = null;
      this.neutralSeen = false;
      this.legNeutral = null;
      return output;
    }
    const hipY = (p[23].y + p[24].y) / 2;
    const legTorso = Math.max(.08, hipY - shoulderY);
    if (!this.legNeutral) this.legNeutral = { hipY, torso: legTorso };
    const hipDrop = (hipY - this.legNeutral.hipY) / this.legNeutral.torso;
    const bent = angle(p[23], p[25], p[27], aspect) < 160 && angle(p[24], p[26], p[28], aspect) < 160;
    const squatting = hipDrop > .25 && bent;
    const lifted = !squatting && Math.min(p[25].y, p[26].y) < hipY + legTorso * .22;
    const neutral = hipDrop < .17 && p[25].y > hipY + legTorso * .55 && p[26].y > hipY + legTorso * .55;
    if (neutral) {
      const pending = this.pending;
      if (pending?.ready && now - pending.at <= 3500) {
        if (pending.type === 'knee' && now - this.lastBoost >= 4000) {
          output.boost = true;
          output.kneeLift = true;
          output.gesture = 'Knee cycle complete · boost';
          this.lastBoost = now;
        }
        if (pending.type === 'squat' && now - this.lastDuck >= 2200) {
          output.duck = true;
          output.squat = true;
          output.gesture = 'Squat cycle complete · duck';
          this.lastDuck = now;
        }
      }
      this.pending = null;
      this.neutralSeen = true;
    } else {
      const type = squatting ? 'squat' : lifted ? 'knee' : null;
      if (type && this.neutralSeen) {
        if (!this.pending) this.pending = { type, at: now, ready: false };
        else if (this.pending.type !== type) {
          this.pending = null;
          this.neutralSeen = false;
        } else if (now - this.pending.at >= 250) this.pending.ready = true;
      } else if (!type) {
        this.pending = null;
      }
    }
    return output;
  }
}

function steeringGeometry(points) {
  const shoulderX = (points[11].x + points[12].x)/2;
  const shoulderY = (points[11].y + points[12].y)/2;
  const width = Math.max(.1,Math.hypot(points[11].x-points[12].x,points[11].y-points[12].y));
  // Shoulder scale stays measurable in portrait framing and cannot jump when
  // uncertain, offscreen hip landmarks appear or disappear between frames.
  const torso = Math.max(.08, width * 1.25);
  return { shoulderY,torso,width,handX:(points[15].x-shoulderX)/width,handY:(points[15].y-shoulderY)/torso };
}
