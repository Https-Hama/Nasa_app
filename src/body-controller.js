import { assessPose, PoseRecognizer } from './pose.js';
import { FlightGestureRecognizer } from './flight-controls.js';
import { ObservationSession } from './observation-metrics.js';
import { FaceObserver } from './face-observer.js';
import { clearForeignOpenCvModule } from './vision-runtime.js';

const CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8],[9,10],
  [11,12],[11,13],[13,15],[15,17],[15,19],[15,21],[17,19],
  [12,14],[14,16],[16,18],[16,20],[16,22],[18,20],
  [11,23],[12,24],[23,24],[23,25],[24,26],[25,27],[26,28],
  [27,29],[28,30],[29,31],[30,32],[27,31],[28,32],
];
const EMPTY_INPUT = { x: 0, y: 0, shield: false, fire: false, boost: false, duck: false, tracked: false, fullBody: false, controlsReady: false, calibrated: false };
let openCvPromise;

function timeout(promise, milliseconds, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); }),
  ]).finally(() => clearTimeout(timer));
}

function loadOpenCv() {
  if (openCvPromise) return openCvPromise;
  openCvPromise = new Promise((resolve, reject) => {
    let script, poll, resolvedRuntime;
    let finished = false, awaitingPromise = false;
    const timer = setTimeout(() => finish(new Error('OpenCV took too long to initialize. Run the asset setup and try again.')), 30000);
    const finish = (error, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(poll);
      if (error) {
        script?.remove();
        reject(error);
      } else resolve(value);
    };
    const check = () => {
      if (finished) return;
      try {
        const cv = resolvedRuntime || globalThis.cv;
        // Older OpenCV builds expose a self-returning Emscripten .then().
        // Awaiting/resolving that object recurses forever, so wrap the runtime.
        if (cv?.Mat && cv?.imread) { clearForeignOpenCvModule();return finish(null, { runtime: cv }); }
        if (cv instanceof Promise && !awaitingPromise) {
          awaitingPromise = true;
          cv.then(runtime => { resolvedRuntime = runtime; check(); }, error => finish(error));
        }
        poll = setTimeout(check, 80);
      } catch (error) { finish(error); }
    };
    if (!globalThis.cv) {
      script = document.createElement('script');
      script.src = '/vendor/opencv.js';
      script.async = true;
      script.onerror = () => finish(new Error('OpenCV assets are missing. Run the local asset setup and reload.'));
      document.head.append(script);
    }
    check();
  }).catch(error => {
    openCvPromise = undefined;
    throw error;
  });
  return openCvPromise;
}

async function loadLandmarker() {
  const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
  const vision = await FilesetResolver.forVisionTasks('/vendor/mediapipe');
  const options = {
    baseOptions: { modelAssetPath: '/models/pose_landmarker_lite.task', delegate: 'GPU' },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: .6,
    minPosePresenceConfidence: .6,
    minTrackingConfidence: .6,
    outputSegmentationMasks: false,
  };
  try {
    return await PoseLandmarker.createFromOptions(vision, options);
  } catch {
    // Software inference keeps camera play available without WebGL acceleration.
    return PoseLandmarker.createFromOptions(vision, { ...options, baseOptions: { ...options.baseOptions, delegate: 'CPU' } });
  }
}

function errorMessage(error) {
  if (['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(error?.name)) return 'Camera permission was denied. Allow camera access in browser settings or use keyboard controls.';
  if (['NotFoundError', 'DevicesNotFoundError'].includes(error?.name)) return 'No camera was found. Connect a webcam or use keyboard controls.';
  if (['NotReadableError', 'TrackStartError'].includes(error?.name)) return 'The camera is unavailable or in use by another app. Close that app and retry, or use keyboard controls.';
  return error?.message || 'Motion tracking could not start. Retry the camera or use keyboard controls.';
}

function stopStream(stream) {
  for (const track of stream?.getTracks?.() || []) track.stop();
}

export class BodyController {
  constructor({ video, overlay, onInput = () => {}, onStatus = () => {}, onMetrics = () => {}, onObservation = () => {} }) {
    this.video = video;
    this.overlay = overlay;
    this.onInput = onInput;
    this.onStatus = onStatus;
    this.onMetrics = onMetrics;
    this.onObservation = onObservation;
    this.flightControls = new FlightGestureRecognizer();
    this.observations = new ObservationSession({startedAt:0});
    this.observationEnabled = false;
    this.observationGeneration = 0;
    this.observationPhase = 'off';
    this.faceReady = false;
    this.loadingFace = false;
    this.faceObserver = new FaceObserver();
    this.lastFaceAt = 0;
    this.lastObservationAt = 0;
    this.recognizer = new PoseRecognizer();
    this.state = 'off';
    this.message = '';
    this.active = false;
    this.token = 0;
    this.raf = null;
    this.trackListeners = [];
    this.lastInference = 0;
    this.lastVideoTime = -1;
    this.lastFrameAt = 0;
    this.lastMetricsAt = 0;
    this.lastMetricsCalibrated = false;
    this.lastMetricsControlsReady = false;
    this.lostSince = null;
    this.fps = 0;
    this.brightness = 0;
    this.visibilityHandler = () => {
      if (this.active && document.hidden) {
        this.recognizer.update([], performance.now());
        this.signalLost(performance.now(), 'Camera paused while this tab is hidden.', true);
      }
    };
  }

  async start() {
    if (this.active) return Boolean(this.landmarker);
    const token = ++this.token;
    this.active = true;
    this.setStatus('starting', 'Requesting camera access…');
    this.onInput({ ...EMPTY_INPUT });
    try {
      if (!globalThis.navigator?.mediaDevices?.getUserMedia) throw new Error('Camera access needs a supported browser on localhost or a secure HTTPS page. Keyboard controls are available.');
      const streamPromise = navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      });
      // A permission dialog can outlive stop() or our timeout. Close late streams.
      streamPromise.then(stream => { if (token !== this.token || !this.active) stopStream(stream); }, () => {});
      const stream = await timeout(streamPromise, 45000, 'Camera permission timed out. Choose Allow when prompted, then try again.');
      if (token !== this.token || !this.active) { stopStream(stream); return false; }
      this.stream = stream;
      this.video.srcObject = stream;
      this.video.muted = true;
      this.video.playsInline = true;
      this.trackListeners = stream.getVideoTracks().map(track => {
        const ended = () => { if (this.active && token === this.token) this.fail(new Error('The camera disconnected. Reconnect it and enable the camera again.')); };
        const muted = () => { if (this.active && token === this.token) this.signalLost(performance.now(), 'Camera signal interrupted.', true); };
        track.addEventListener('ended', ended);
        track.addEventListener('mute', muted);
        return { track, ended, muted };
      });
      this.setStatus('starting', 'Loading local OpenCV and pose model…');
      // Finish OpenCV first: its legacy global Module must not race the
      // MediaPipe WASM factory's own configuration during initialization.
      const [openCv] = await Promise.all([
        loadOpenCv(),
        timeout(Promise.resolve(this.video.play()), 15000, 'The camera did not produce video. Reconnect it and try again.'),
      ]);
      if (token !== this.token || !this.active) return false;
      clearForeignOpenCvModule();
      const landmarkerPromise = loadLandmarker().then(landmarker => {
        if (token !== this.token || !this.active) landmarker.close();
        else this.landmarker = landmarker;
        return landmarker;
      });
      await timeout(landmarkerPromise, 40000, 'The local pose model took too long to load. Check the asset setup, then retry.');
      if (token !== this.token || !this.active) return false;
      this.cv = openCv.runtime;
      this.frameCanvas = document.createElement('canvas');
      this.processingCanvas = document.createElement('canvas');
      this.frameCanvas.width = Math.min(640, this.video.videoWidth || 640);
      this.frameCanvas.height = Math.round(this.frameCanvas.width * (this.video.videoHeight || 480) / (this.video.videoWidth || 640));
      this.processingCanvas.width = this.frameCanvas.width;
      this.processingCanvas.height = this.frameCanvas.height;
      this.frameContext = this.frameCanvas.getContext('2d', { willReadFrequently: true });
      if (!this.frameContext) throw new Error('This browser could not prepare camera frames. Try another browser or keyboard controls.');
      if (this.overlay) {
        this.overlay.width = this.frameCanvas.width;
        this.overlay.height = this.frameCanvas.height;
        this.overlayContext = this.overlay.getContext?.('2d');
      }
      document.addEventListener('visibilitychange', this.visibilityHandler);
      this.lastVideoTime = -1;
      this.lastInference = 0;
      this.lastFrameAt = performance.now();
      this.lastMetricsAt = 0;
      this.lostSince = null;
      this.setStatus('ready', 'Camera ready. Show your shoulders, arms and hands. Hips and legs are optional.');
      this.calibrate();
      this.raf = requestAnimationFrame(now => this.tick(now));
      return true;
    } catch (error) {
      if (token !== this.token || !this.active) return false;
      this.fail(error);
      return false;
    }
  }

  calibrate() {
    if (!this.active || !this.landmarker) return false;
    this.recognizer.calibrate();
    this.flightControls.reset();
    this.onInput({ ...EMPTY_INPUT });
    this.lostSince = null;
    this.emitMetrics({ ...EMPTY_INPUT, gesture: 'Hold a comfortable neutral pose' }, performance.now());
    this.setStatus('calibrating', 'Hold a comfortable neutral pose for 2 seconds.');
    return true;
  }

  setExercise(type) {
    this.recognizer.setExercise(type);
  }

  async enableObservations(enabled) {
    const generation=++this.observationGeneration;
    this.observationEnabled = Boolean(enabled);
    if (!enabled) {
      this.loadingFace=false;
      this.setObservationPhase('off');
      this.faceReady = false;
      this.faceObserver.stop();
      this.onObservation({enabled:false,faceReady:false,summary:this.getObservationSummary()});
      return false;
    }
    try {
      this.loadingFace=true;
      const ready = await this.faceObserver.start();
      if(generation!==this.observationGeneration||!this.observationEnabled)return false;
      this.faceReady = ready !== false && this.observationEnabled && this.active;
      this.onObservation({enabled:true,faceReady:this.faceReady,error:ready===false?this.faceObserver.error?.message:undefined,summary:this.getObservationSummary()});
      return this.faceReady;
    } catch(error) {
      if(generation!==this.observationGeneration||!this.observationEnabled)return false;
      this.faceReady = false;
      this.onObservation({enabled:true,faceReady:false,error:error.message,summary:this.getObservationSummary()});
      return false;
    } finally { if(generation===this.observationGeneration)this.loadingFace=false; }
  }

  resetObservations() {
    this.observations = new ObservationSession({startedAt:performance.now()});
    this.lastFaceAt = 0;
    this.lastFaceLandmarks = [];
  }

  setObservationPhase(phase) {
    this.observationPhase = this.observationEnabled ? phase : 'off';
    this.observations.setPhase(this.observationPhase,performance.now());
  }

  getObservationSummary() { return this.observations.summary(performance.now()); }

  tick(now) {
    if (!this.active) return;
    this.raf = requestAnimationFrame(time => this.tick(time));
    if (document.hidden) return;
    if (this.loadingFace) return;
    if (this.stream?.getVideoTracks().some(track => track.readyState === 'ended')) {
      this.fail(new Error('The camera disconnected. Reconnect it and enable the camera again.'));
      return;
    }
    if (now - this.lastInference < 1000 / 18) return;
    if (this.video.readyState < 2 || this.video.currentTime === this.lastVideoTime || this.stream?.getVideoTracks().some(track => track.muted)) {
      if (now - this.lastFrameAt > 500) {
        this.recognizer.update([], now);
        this.signalLost(now, 'Camera frames stopped. Check your camera connection.');
      }
      return;
    }
    try {
      const elapsed = this.lastInference ? now - this.lastInference : 1000 / 18;
      this.lastInference = now;
      this.lastVideoTime = this.video.currentTime;
      this.lastFrameAt = now;
      this.fps = this.fps ? this.fps * .8 + (1000 / elapsed) * .2 : 1000 / elapsed;
      this.frameContext.drawImage(this.video, 0, 0, this.frameCanvas.width, this.frameCanvas.height);
      this.preprocess();
      if(this.observationEnabled && this.faceReady && now-this.lastFaceAt >= (this.observationPhase==='face-check'?60:120)) {
        this.lastFaceAt=now;
        const face=this.faceObserver.detect(this.processingCanvas,now);
        this.observations.recordFace({landmarks:face,brightness:this.brightness,width:this.processingCanvas.width,height:this.processingCanvas.height},now);
        this.lastFaceLandmarks=face;
      }
      if(this.observationPhase==='face-check') {
        this.drawFace(this.lastFaceLandmarks||[]);
        if(now-this.lastObservationAt>250){this.lastObservationAt=now;this.onObservation({enabled:true,faceReady:this.faceReady,summary:this.getObservationSummary()});}
        this.setStatus('face-check','Face check active. Keep your face close, well lit and relaxed.');
        this.onInput({...EMPTY_INPUT});
        return;
      }
      const result = this.landmarker.detectForVideo(this.processingCanvas, now);
      const landmarks = this.brightness < .065 ? [] : (result.landmarks?.[0] || []);
      const poseInput = this.recognizer.update(landmarks, now);
      const poseInFrame = assessPose(landmarks).tracked;
      const flightPose = poseInput.calibrated ? poseInput : {...poseInput,tracked:poseInFrame};
      const control = this.flightControls.update(landmarks,now,flightPose,this.processingCanvas.width/this.processingCanvas.height);
      const input = {...poseInput,...control};
      if(this.observationEnabled)this.observations.recordBody({landmarks,input},now);
      const visibleTorso = poseInFrame && (input.controlsReady || !this.recognizer.calibrated);
      this.drawLandmarks(landmarks, input.fullBody);
      // Readiness transitions precede status callbacks so an automatic recovery
      // can resume using current calibration instead of a throttled old value.
      if (now - this.lastMetricsAt > 200 || input.rep
        || this.lastMetricsCalibrated !== this.recognizer.calibrated
        || this.lastMetricsControlsReady !== Boolean(input.controlsReady)) {
        this.emitMetrics(input, now);
      }
      if (visibleTorso) {
        this.lostSince = null;
        if (!this.recognizer.calibrated) {
          const seconds = Math.max(1, Math.ceil(2 * (1 - input.calibrationProgress)));
          this.setStatus('calibrating', `Hold a comfortable neutral pose · ${seconds}s`);
        } else this.setStatus('tracking', input.fullBody ? 'Full body tracked. Hands and leg controls are ready.' : 'Upper body tracked. Aim, fire and shield with your hands; legs are optional.');
        this.onInput(input);
      } else {
        this.signalLost(now, this.brightness < .065 ? 'Too dark to track. Face a light source.' : 'Show your shoulders, arms and both hands. Your hips and legs can stay outside the frame.');
      }
      if(this.observationEnabled && now-this.lastObservationAt>500){this.lastObservationAt=now;this.onObservation({enabled:true,faceReady:this.faceReady,summary:this.getObservationSummary()});}
    } catch (error) { this.fail(error); }
  }

  preprocess() {
    const cv = this.cv;
    let source, gray, blurred, adjusted;
    try {
      source = cv.imread(this.frameCanvas);
      gray = new cv.Mat();
      blurred = new cv.Mat();
      adjusted = new cv.Mat();
      cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY);
      this.brightness = cv.mean(gray)[0] / 255;
      cv.GaussianBlur(source, blurred, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);
      blurred.convertTo(adjusted, -1, this.brightness < .28 ? 1.12 : 1, this.brightness < .28 ? 10 : 0);
      // Pose inference receives these processed pixels, never the unprocessed video.
      cv.imshow(this.processingCanvas, adjusted);
    } finally {
      adjusted?.delete();
      blurred?.delete();
      gray?.delete();
      source?.delete();
    }
  }

  drawFace(landmarks) {
    const ctx=this.overlayContext;if(!ctx)return;
    const w=this.overlay.width,h=this.overlay.height;
    ctx.clearRect(0,0,w,h);
    if(!landmarks.length)return;
    ctx.fillStyle='#75e5d4';ctx.globalAlpha=.55;
    for(let i=0;i<landmarks.length;i+=3){const p=landmarks[i];if(!Number.isFinite(p.x)||!Number.isFinite(p.y))continue;ctx.beginPath();ctx.arc((1-p.x)*w,p.y*h,1.4,0,Math.PI*2);ctx.fill();}
    ctx.globalAlpha=1;
  }

  drawLandmarks(landmarks, fullBody) {
    const ctx = this.overlayContext;
    if (!ctx) return;
    const width = this.overlay.width, height = this.overlay.height;
    ctx.clearRect(0, 0, width, height);
    if (!landmarks.length) return;
    const valid = index => {
      const p = landmarks[index];
      return p && Number.isFinite(p.x) && Number.isFinite(p.y) && (p.visibility ?? 0) >= .55 && (p.presence ?? 1) >= .55;
    };
    const point = index => [(1 - landmarks[index].x) * width, landmarks[index].y * height];
    ctx.lineWidth = Math.max(2, width / 250);
    ctx.strokeStyle = fullBody ? '#6df4d5' : '#ffbd69';
    ctx.globalAlpha = .8;
    for (const [a, b] of CONNECTIONS) {
      if (!valid(a) || !valid(b)) continue;
      ctx.beginPath();
      ctx.moveTo(...point(a));
      ctx.lineTo(...point(b));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (let index = 0; index < 33; index++) {
      if (!valid(index)) continue;
      ctx.beginPath();
      ctx.arc(...point(index), index > 10 ? 3.5 : 2, 0, Math.PI * 2);
      ctx.fillStyle = '#f4fff9';
      ctx.fill();
    }
  }

  signalLost(now, message, immediate = false) {
    this.recognizer.update([], now);
    this.flightControls.interruptTracking();
    this.onInput({ ...EMPTY_INPUT, calibrated: this.recognizer.calibrated });
    if (this.lastMetricsControlsReady) this.emitMetrics({ ...EMPTY_INPUT, gesture: message }, now);
    if (this.lostSince === null) this.lostSince = now;
    if (immediate || now - this.lostSince >= 350) this.setStatus('lost', message);
  }

  emitMetrics(input, now) {
    this.lastMetricsAt = now;
    this.lastMetricsCalibrated = this.recognizer.calibrated;
    this.lastMetricsControlsReady = Boolean(input.controlsReady);
    this.onMetrics({ fps: this.fps, confidence: input.confidence ?? 0, brightness: this.brightness,
      tracked: Boolean(input.tracked), fullBody: Boolean(input.fullBody), controlsReady: Boolean(input.controlsReady),
      gesture: input.gesture, reps: { ...this.recognizer.reps }, calibrated: this.recognizer.calibrated });
  }

  setStatus(state, message) {
    if (this.state === state && this.message === message) return;
    this.state = state;
    this.message = message;
    this.onStatus({ state, message });
  }

  fail(error) {
    this.active = false;
    this.token++;
    this.release();
    this.onInput({ ...EMPTY_INPUT });
    this.emitMetrics({ ...EMPTY_INPUT, gesture: 'Camera unavailable' }, performance.now());
    this.setStatus('error', errorMessage(error));
  }

  release() {
    this.loadingFace=false;
    this.observationGeneration++;
    this.faceObserver.stop();
    this.faceReady=false;
    this.lastFaceLandmarks=[];
    this.observations.setPhase('paused',performance.now());
    if (this.raf !== null && globalThis.cancelAnimationFrame) cancelAnimationFrame(this.raf);
    this.raf = null;
    globalThis.document?.removeEventListener('visibilitychange', this.visibilityHandler);
    for (const { track, ended, muted } of this.trackListeners) {
      track.removeEventListener('ended', ended);
      track.removeEventListener('mute', muted);
    }
    this.trackListeners = [];
    stopStream(this.stream);
    this.stream = null;
    this.landmarker?.close();
    this.landmarker = null;
    this.video.pause?.();
    this.video.srcObject = null;
    this.overlayContext?.clearRect(0, 0, this.overlay.width, this.overlay.height);
    for (const canvas of [this.frameCanvas, this.processingCanvas]) if (canvas) { canvas.width = 0; canvas.height = 0; }
    this.frameCanvas = null;
    this.processingCanvas = null;
    this.frameContext = null;
    this.cv = null;
  }

  stop() {
    this.active = false;
    this.token++;
    this.release();
    const exercise = this.recognizer.exercise;
    this.recognizer = new PoseRecognizer();
    this.recognizer.setExercise(exercise);
    this.fps = 0;
    this.brightness = 0;
    this.onInput({ ...EMPTY_INPUT });
    this.emitMetrics({ ...EMPTY_INPUT, gesture: 'Camera off' }, performance.now());
    this.setStatus('off', 'Camera off. Keyboard controls are available.');
  }
}
