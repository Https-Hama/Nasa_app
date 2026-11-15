// Recognition consumes MediaPipe's normalized coordinates. No frames or raw poses
// are persisted. Thresholds are game controls, not an assessment of exercise form.
const SHOULDERS = [11, 12];
const LEGS = [23, 24, 25, 26, 27, 28];
const ARMS = [11, 12, 13, 14, 15, 16];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;

function confidence(point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return 0;
  return Math.min(point.visibility ?? 0, point.presence ?? point.visibility ?? 0);
}

function visible(point) {
  return confidence(point) >= .55 && point.x >= .015 && point.x <= .985 && point.y >= .015 && point.y <= .985;
}

export function assessPose(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length < 33) return { tracked: false, fullBody: false, confidence: 0 };
  // A portrait with shoulders and hands is enough to play. Hips and legs are
  // optional evidence for leg actions, never a prerequisite for hand controls.
  const tracked = SHOULDERS.every(index => visible(landmarks[index]));
  return {
    tracked,
    fullBody: tracked && LEGS.every(index => visible(landmarks[index])),
    confidence: mean(SHOULDERS.map(index => confidence(landmarks[index]))),
  };
}

function geometry(points) {
  const shoulderY = (points[11].y + points[12].y) / 2;
  const shoulderWidth = Math.hypot(points[11].x - points[12].x, points[11].y - points[12].y);
  const hipsVisible = [23, 24].every(index => visible(points[index]));
  const hipY = hipsVisible ? (points[23].y + points[24].y) / 2 : shoulderY + shoulderWidth * 1.25;
  return {
    x: mean(SHOULDERS.map(index => points[index].x)),
    y: shoulderY,
    hipY,
    shoulderY,
    torso: Math.max(.08, hipY - shoulderY),
    shoulderWidth,
  };
}

function angle(a, b, c) {
  const ux = a.x - b.x, uy = a.y - b.y;
  const vx = c.x - b.x, vy = c.y - b.y;
  const length = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  return length > .00001 ? Math.acos(clamp((ux * vx + uy * vy) / length, -1, 1)) * 180 / Math.PI : 180;
}

function deadzone(value) {
  if (Math.abs(value) < .12) return 0;
  return Math.sign(value) * clamp((Math.abs(value) - .12) / .88, 0, 1);
}

export class PoseRecognizer {
  constructor() {
    this.calibrated = false;
    this.reps = { squat: 0, knee: 0, reach: 0 };
    this.exercise = 'squat';
    this.neutral = null;
    this.samples = [];
    this.calibrationStart = null;
    this.calibrationRequested = false;
    this.smoothed = { x: 0, y: 0 };
    this.pending = null;
    this.lastRep = -Infinity;
    this.lastKnee = null;
    this.neutralSeen = false;
  }

  calibrate() {
    this.calibrated = false;
    this.calibrationRequested = true;
    this.calibrationStart = null;
    this.samples = [];
    this.neutral = null;
    this.smoothed = { x: 0, y: 0 };
    this.pending = null;
    this.neutralSeen = false;
  }

  setExercise(type) {
    if (!['squat', 'knee', 'reach'].includes(type)) return;
    if (type === this.exercise) return;
    this.exercise = type;
    this.pending = null;
    this.lastKnee = null;
    this.neutralSeen = false;
  }

  update(landmarks, now) {
    const assessment = assessPose(landmarks);
    const output = { ...assessment, x: 0, y: 0, shield: false, gesture: 'Stand in view', calibrated: this.calibrated, calibrationProgress: 0 };
    if (!assessment.tracked) {
      this.pending = null;
      this.neutralSeen = false;
      this.smoothed = { x: 0, y: 0 };
      if (!this.calibrated) {
        this.samples = [];
        this.calibrationStart = null;
      }
      return output;
    }

    const body = geometry(landmarks);
    if (!this.calibrated) {
      if (!this.calibrationRequested) return { ...output, tracked: false, gesture: 'Calibrate a neutral pose' };
      if (this.calibrationStart === null) this.calibrationStart = now;
      this.samples.push(body);
      output.calibrationProgress = clamp((now - this.calibrationStart) / 2000, 0, 1);
      output.gesture = 'Hold a comfortable neutral pose';
      if (now - this.calibrationStart >= 2000 && this.samples.length >= 12) {
        this.neutral = Object.fromEntries(Object.keys(body).map(key => [key, mean(this.samples.map(sample => sample[key]))]));
        this.calibrated = true;
        this.calibrationRequested = false;
        this.samples = [];
        this.neutralSeen = true;
        output.calibrated = true;
      } else return { ...output, tracked: false };
    }

    const horizontalRange = clamp(this.neutral.shoulderWidth * .9, .12, .30);
    const verticalRange = clamp(this.neutral.torso * .44, .09, .20);
    const target = {
      x: deadzone(-(body.x - this.neutral.x) / horizontalRange),
      y: deadzone(-(body.y - this.neutral.y) / verticalRange),
    };
    for (const axis of ['x', 'y']) {
      this.smoothed[axis] = target[axis] === 0 ? 0 : this.smoothed[axis] + (target[axis] - this.smoothed[axis]) * .38;
      output[axis] = clamp(this.smoothed[axis], -1, 1);
    }

    const armsVisible = ARMS.every(index => visible(landmarks[index]));
    const armsUp = armsVisible && [15, 16].every(index => landmarks[index].y < body.shoulderY - body.torso * .45)
      && [13, 14].every(index => landmarks[index].y < body.shoulderY + body.torso * .1);
    output.shield = armsUp;
    output.gesture = 'Neutral';
    let rep;

    if (this.exercise === 'reach') {
      if (!armsVisible) {
        this.pending = null;
        this.neutralSeen = false;
        output.gesture = 'Keep both hands in view';
      } else {
        const lowered = [15, 16].every(index => landmarks[index].y > body.shoulderY + body.torso * .1);
        if (lowered && !this.pending) this.neutralSeen = true;
        if (armsUp && !this.pending && this.neutralSeen) this.pending = { start: now };
        if (this.pending) {
          output.gesture = 'Reach: lower both arms';
          if (lowered) rep = this.complete('reach', now, 250, 700);
        } else output.gesture = 'Reach overhead';
      }
    } else if (!assessment.fullBody) {
      this.pending = null;
      this.neutralSeen = false;
      output.gesture = 'Upper-body controls ready · legs optional';
    } else if (this.exercise === 'squat') {
      const kneeAngle = mean([angle(landmarks[23], landmarks[25], landmarks[27]), angle(landmarks[24], landmarks[26], landmarks[28])]);
      const drop = (body.hipY - this.neutral.hipY) / this.neutral.torso;
      const upright = kneeAngle > 160 && drop < .20;
      const down = kneeAngle < 145 && drop > .12;
      if (upright && !this.pending) this.neutralSeen = true;
      if (down && !this.pending && this.neutralSeen) this.pending = { start: now };
      if (this.pending) {
        output.gesture = 'Squat: stand tall';
        if (upright) rep = this.complete('squat', now, 300, 900);
      } else output.gesture = 'Squat at your own pace';
    } else if (this.exercise === 'knee') {
      const left = landmarks[25].y - landmarks[23].y;
      const right = landmarks[26].y - landmarks[24].y;
      const lowered = left > body.torso * .45 && right > body.torso * .45;
      const side = left < body.torso * .32 && right > body.torso * .45 ? 'left'
        : right < body.torso * .32 && left > body.torso * .45 ? 'right' : null;
      if (lowered && !this.pending) this.neutralSeen = true;
      if (side && side !== this.lastKnee && !this.pending && this.neutralSeen) this.pending = { start: now, side };
      if (this.pending) {
        output.gesture = 'Knee lift: lower your foot';
        if (lowered) {
          const completedSide = this.pending.side;
          rep = this.complete('knee', now, 180, 500);
          if (rep) this.lastKnee = completedSide;
        }
      } else output.gesture = this.lastKnee ? 'Raise the opposite knee' : 'Raise either knee';
    }
    if (rep) output.rep = rep;
    return output;
  }

  complete(type, now, minimumDuration, cooldown) {
    const valid = now - this.pending.start >= minimumDuration && now - this.lastRep >= cooldown;
    this.pending = null;
    this.neutralSeen = true;
    if (!valid) return undefined;
    this.lastRep = now;
    this.reps[type]++;
    return type;
  }
}
