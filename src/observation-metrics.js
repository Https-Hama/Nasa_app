// These are camera sampling and game-observation rules, not clinical thresholds.
// The session retains derived scalars only: no camera pixels or raw landmarks.
const MAX_SAMPLE_GAP_MS = 250;
const BASELINE_MS = 5000;
const EYE_RATE_MS = 10000;
const MIN_EYE_FPS = 8;
const MIN_FACE_COVERAGE = .6;
const PHASES = ['face-check', 'flight', 'paused', 'off'];
const SHOULDERS = [11, 12];
const LEGS = [23, 24, 25, 26, 27, 28];
const clamp = value => Math.max(0, Math.min(1, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const seconds = milliseconds => Math.round(milliseconds) / 1000;
const ratio = (part, whole) => whole > 0 ? clamp(part / whole) : 0;
const finitePoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.y);

function visible(point) {
  return finitePoint(point) && (point.visibility ?? 0) >= .55 && (point.presence ?? point.visibility ?? 0) >= .55
    && point.x >= .015 && point.x <= .985 && point.y >= .015 && point.y <= .985;
}

function faceGeometry({ landmarks, brightness, width, height } = {}) {
  if (!Number.isFinite(brightness) || brightness < .065) return { reason: 'low-light' };
  if (!(width > 0 && height > 0)) return { reason: 'invalid-frame-size' };
  const indices = [33, 160, 158, 133, 153, 144, 362, 385, 387, 263, 373, 380, 13, 14, 61, 291];
  if (!Array.isArray(landmarks) || landmarks.length < 468 || !indices.every(index => finitePoint(landmarks[index]))) return { reason: 'no-face' };
  const valid = landmarks.filter(finitePoint);
  const faceWidth = (Math.max(...valid.map(point => point.x)) - Math.min(...valid.map(point => point.x))) * width;
  if (faceWidth < 80) return { reason: 'face-too-small' };
  const point = index => ({ x: landmarks[index].x * width, y: landmarks[index].y * height });
  const eye = ([a, b, c, d, e, f]) => {
    const horizontal = distance(point(a), point(d));
    return horizontal > 1 ? (distance(point(b), point(f)) + distance(point(c), point(e))) / (2 * horizontal) : NaN;
  };
  const ear = (eye([33, 160, 158, 133, 153, 144]) + eye([362, 385, 387, 263, 373, 380])) / 2;
  const mouthWidth = distance(point(61), point(291));
  if (!Number.isFinite(ear) || ear < 0 || ear > 1 || mouthWidth < 1) return { reason: 'unstable-face-geometry' };
  const a = point(33), b = point(263);
  let roll = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  if (roll > 90) roll -= 180;
  if (roll < -90) roll += 180;
  return { ear, mouth: distance(point(13), point(14)) / mouthWidth, roll };
}

function bodyGeometry(landmarks, input = {}) {
  if (!Array.isArray(landmarks) || landmarks.length < 33 || !SHOULDERS.every(index => visible(landmarks[index])) || input.tracked === false) return { reason: 'body-not-tracked' };
  if (input.calibrated === false) return { reason: 'body-not-calibrated' };
  const shoulders = midpoint(landmarks[11], landmarks[12]);
  // Use one consistent upper-body anchor across portrait/full-body framing.
  const center = shoulders;
  const scale = distance(landmarks[11], landmarks[12]);
  if (scale < .05) return { reason: 'body-too-small' };
  const wrist = index => visible(landmarks[index])
    ? { x: (landmarks[index].x - shoulders.x) / scale, y: (landmarks[index].y - shoulders.y) / scale }
    : null;
  return { center, scale, left: wrist(15), right: wrist(16), fullBody: input.fullBody !== false && LEGS.every(index => visible(landmarks[index])) };
}

export class ObservationSession {
  constructor({ startedAt = 0 } = {}) {
    this.startedAt = Number.isFinite(startedAt) ? startedAt : 0;
    this.phase = 'off';
    this.phaseStartedAt = this.startedAt;
    this.latestNow = this.startedAt;
    this.phaseMs = { 'face-check': 0, flight: 0, paused: 0, off: 0 };
    this.face = {
      validMs: 0, intervals: 0, previous: null, baseline: null, baselineMs: 0, baselineSamples: [],
      eyeMs: 0, closedMs: 0, eyeArmed: false, closureStartedAt: null,
      blinks: 0, longClosures: 0, longestClosureMs: 0,
      mouthArmed: false, mouthStartedAt: null, mouthEvents: 0,
      rollSum: 0, minRoll: Infinity, maxRoll: -Infinity, reasons: new Set(),
      currentQualityReason: null,
    };
    this.body = {
      validMs: 0, fullMs: 0, previous: null, origin: null, swaySum: 0,
      leftTravel: 0, rightTravel: 0, leftMs: 0, rightMs: 0,
      kneeLifts: 0, squats: 0, shields: 0, boosts: 0, reasons: new Set(),
    };
  }

  setPhase(phase, now = this.latestNow) {
    if (!PHASES.includes(phase)) throw new RangeError(`Unknown observation phase: ${phase}`);
    if (!Number.isFinite(now) || now < this.latestNow) return this;
    this.latestNow = now;
    if (phase === this.phase) return this;
    this.phaseMs[this.phase] += now - this.phaseStartedAt;
    this.phaseStartedAt = now;
    this.phase = phase;
    this.discardPendingFace();
    this.body.previous = null;
    return this;
  }

  discardPendingFace() {
    this.face.previous = null;
    this.face.eyeArmed = false;
    this.face.closureStartedAt = null;
    this.face.mouthArmed = false;
    this.face.mouthStartedAt = null;
  }

  recordFace(sample, now = this.latestNow) {
    if (!Number.isFinite(now) || now < this.phaseStartedAt) return;
    this.latestNow = Math.max(this.latestNow, now);
    // Distant flight framing must never contaminate the close-up check.
    if (this.phase !== 'face-check') return;
    const state = this.face;
    if (state.previous && now <= state.previous.now) return;
    const geometry = faceGeometry(sample);
    state.currentQualityReason = geometry.reason || null;
    if (geometry.reason) {
      state.reasons.add(geometry.reason);
      this.discardPendingFace();
      return;
    }
    let previous = state.previous;
    const dt = previous ? now - previous.now : 0;
    if (dt > MAX_SAMPLE_GAP_MS) {
      state.reasons.add('face-sampling-gap');
      this.discardPendingFace();
      previous = null;
    }
    const validDt = previous ? dt : 0;
    if (validDt) {
      state.validMs += validDt;
      state.intervals++;
      state.rollSum += geometry.roll * validDt;
      state.minRoll = Math.min(state.minRoll, geometry.roll, previous.roll);
      state.maxRoll = Math.max(state.maxRoll, geometry.roll, previous.roll);
      if (state.baseline === null && geometry.ear >= .12 && previous.ear >= .12) {
        state.baselineMs += validDt;
        state.baselineSamples.push(geometry.ear);
        if (state.baselineSamples.length > 300) state.baselineSamples.shift();
        if (state.baselineMs >= BASELINE_MS) {
          const sorted = [...state.baselineSamples].sort((a, b) => a - b);
          state.baseline = sorted[Math.floor((sorted.length - 1) * .75)];
        }
      }
    }
    let closed = false;
    if (state.baseline !== null) {
      closed = geometry.ear < state.baseline * (previous?.closed ? .78 : .62);
      if (validDt && previous.eyeReady) {
        state.eyeMs += validDt;
        if (previous.closed) state.closedMs += validDt;
      }
      if (!closed) {
        if (state.closureStartedAt !== null) {
          const length = now - state.closureStartedAt;
          if (length >= 60) {
            state.longestClosureMs = Math.max(state.longestClosureMs, length);
            if (length >= 600) state.longClosures++;
            else state.blinks++;
          }
        }
        state.closureStartedAt = null;
        state.eyeArmed = true;
      } else if (state.eyeArmed && state.closureStartedAt === null) {
        state.closureStartedAt = now;
        state.eyeArmed = false;
      }
    }
    if (geometry.mouth <= .22) {
      if (state.mouthStartedAt !== null && now - state.mouthStartedAt >= 150) state.mouthEvents++;
      state.mouthStartedAt = null;
      state.mouthArmed = true;
    } else if (geometry.mouth >= .32 && state.mouthArmed && state.mouthStartedAt === null) {
      state.mouthStartedAt = now;
      state.mouthArmed = false;
    }
    state.previous = { now, ...geometry, closed, eyeReady: state.baseline !== null };
  }

  recordBody({ landmarks, input = {} } = {}, now = this.latestNow) {
    if (!Number.isFinite(now) || now < this.phaseStartedAt) return;
    this.latestNow = Math.max(this.latestNow, now);
    if (this.phase !== 'flight') return;
    const state = this.body;
    if (state.previous && now <= state.previous.now) return;
    const geometry = bodyGeometry(landmarks, input);
    if (geometry.reason) {
      state.reasons.add(geometry.reason);
      state.previous = null;
      return;
    }
    if (!geometry.fullBody) state.reasons.add('partial-body');
    if (!geometry.left || !geometry.right) state.reasons.add('wrists-not-visible');
    const actions = {
      kneeLifts: geometry.fullBody && Boolean(input.kneeLift || input.rep === 'knee'),
      squats: geometry.fullBody && Boolean(input.squat || input.rep === 'squat'),
      shields: Boolean(input.shield),
      boosts: geometry.fullBody && Boolean(input.boost),
    };
    const previous = state.previous;
    const dt = previous ? now - previous.now : 0;
    if (!state.origin) state.origin = { ...geometry.center, scale: geometry.scale };
    if (previous && dt > 0 && dt <= MAX_SAMPLE_GAP_MS) {
      state.validMs += dt;
      if (previous.fullBody && geometry.fullBody) state.fullMs += dt;
      for (const side of ['left', 'right']) {
        if (geometry[side] && previous[side]) {
          state[`${side}Travel`] += distance(geometry[side], previous[side]);
          state[`${side}Ms`] += dt;
        }
      }
      state.swaySum += distance(geometry.center, state.origin) / state.origin.scale * dt;
      for (const action of Object.keys(actions)) if (actions[action] && !previous.actions[action]) state[action]++;
    } else if (previous) state.reasons.add('body-sampling-gap');
    state.previous = { ...geometry, actions, now };
  }

  summary(now = this.latestNow) {
    const at = Number.isFinite(now) ? Math.max(now, this.latestNow) : this.latestNow;
    const durations = { ...this.phaseMs };
    durations[this.phase] += at - this.phaseStartedAt;
    const face = this.face, body = this.body;
    const faceCoverage = ratio(face.validMs, durations['face-check']);
    const fps = face.validMs > 0 ? face.intervals * 1000 / face.validMs : null;
    const eyeAvailable = face.baseline !== null && face.eyeMs > 0 && fps >= MIN_EYE_FPS;
    const rateAvailable = eyeAvailable && face.eyeMs >= EYE_RATE_MS && faceCoverage >= MIN_FACE_COVERAGE;
    const faceReasons = new Set(face.reasons), bodyReasons = new Set(body.reasons);
    if (!face.validMs) faceReasons.add('no-valid-face-samples');
    if (face.baseline === null) faceReasons.add('open-eye-baseline-incomplete');
    if (fps !== null && fps < MIN_EYE_FPS) faceReasons.add('low-face-fps');
    if (face.eyeMs < EYE_RATE_MS) faceReasons.add('insufficient-eye-observation');
    if (faceCoverage < MIN_FACE_COVERAGE) faceReasons.add('low-face-coverage');
    if (!body.validMs) bodyReasons.add('no-valid-body-samples');
    if (ratio(body.validMs, durations.flight) < .6) bodyReasons.add('low-body-coverage');
    return {
      protocol: 'orbital-observation-v2',
      durationSec: seconds(durations['face-check'] + durations.flight),
      face: {
        validSeconds: seconds(face.validMs), coverage: faceCoverage, meanFps: fps,
        blinkCount: eyeAvailable ? face.blinks : null,
        blinkRate: rateAvailable ? face.blinks * 60000 / face.eyeMs : null,
        eyeClosurePct: eyeAvailable ? 100 * face.closedMs / face.eyeMs : null,
        longClosureCount: eyeAvailable ? face.longClosures : null,
        longestClosureSec: eyeAvailable ? seconds(face.longestClosureMs) : null,
        mouthOpenEvents: face.validMs > 0 ? face.mouthEvents : null,
        headRollMeanDeg: face.validMs > 0 ? face.rollSum / face.validMs : null,
        headRollRangeDeg: face.validMs > 0 ? face.maxRoll - face.minRoll : null,
        baselineReady: face.baseline !== null,
        baselineProgress: Math.min(1, face.baselineMs / BASELINE_MS),
        currentQualityReason: face.currentQualityReason,
        qualityReasons: [...faceReasons],
      },
      body: {
        protocol: 'shoulder-anchor-v3',
        validSeconds: seconds(body.validMs), coverage: ratio(body.validMs, durations.flight),
        fullBodyCoverage: ratio(body.fullMs, durations.flight),
        leftHandTravel: body.leftMs > 0 ? body.leftTravel : null,
        rightHandTravel: body.rightMs > 0 ? body.rightTravel : null,
        kneeLifts: body.fullMs > 0 ? body.kneeLifts : null,
        squats: body.fullMs > 0 ? body.squats : null,
        shields: body.validMs > 0 ? body.shields : null,
        boosts: body.fullMs > 0 ? body.boosts : null,
        meanTorsoSway: body.validMs > 0 ? body.swaySum / body.validMs : null,
        qualityReasons: [...bodyReasons],
      },
    };
  }
}
