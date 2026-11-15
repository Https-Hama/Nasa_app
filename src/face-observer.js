import { clearForeignOpenCvModule } from './vision-runtime.js';

const defaultVisionLoader = () => import('@mediapipe/tasks-vision');

// FaceObserver owns the inference resource, never the camera or capture canvas.
export class FaceObserver {
  constructor({ onStatus = () => {}, timeoutMs = 40000, delegate = 'CPU', loadVision = defaultVisionLoader } = {}) {
    this.onStatus = onStatus;
    this.timeoutMs = timeoutMs;
    this.loadVision = loadVision;
    // CPU avoids a synchronous GPU graph initialization stall seen with
    // software WebGL alongside the game's renderer and body tracking task.
    this.preferredDelegate = delegate === 'GPU' ? 'GPU' : 'CPU';
    this.state = 'off';
    this.token = 0;
    this.landmarker = null;
    this.starting = null;
    this.busy = false;
    this.lastTimestamp = -Infinity;
    this.error = null;
  }

  setStatus(state, message) {
    this.state = state;
    this.onStatus({ state, message });
  }

  start() {
    if (this.landmarker) return Promise.resolve(true);
    if (this.starting) return this.starting;
    const token = ++this.token;
    this.error = null;
    this.setStatus('starting', 'Loading local face landmark model…');
    let timer;
    const isCurrent = () => token === this.token;
    const load = async () => {
      const { FilesetResolver, FaceLandmarker } = await this.loadVision();
      if (!isCurrent()) return null;
      const files = await FilesetResolver.forVisionTasks('/vendor/mediapipe');
      if (!isCurrent()) return null;
      const options = {
        baseOptions: { modelAssetPath: '/models/face_landmarker.task', delegate: this.preferredDelegate },
        runningMode: 'VIDEO', numFaces: 1,
        minFaceDetectionConfidence: .6, minFacePresenceConfidence: .6, minTrackingConfidence: .6,
        outputFaceBlendshapes: false, outputFacialTransformationMatrixes: false,
      };
      let model;
      try {
        clearForeignOpenCvModule();
        model = await FaceLandmarker.createFromOptions(files, options);
      } catch (error) {
        if (!isCurrent()) return null;
        clearForeignOpenCvModule();
        model = await FaceLandmarker.createFromOptions(files, {
          ...options, baseOptions: { ...options.baseOptions, delegate: this.preferredDelegate === 'CPU' ? 'GPU' : 'CPU' },
        });
      }
      if (!isCurrent()) { model.close(); return null; }
      return model;
    };
    const initialization = load();
    const pending = Promise.race([
      initialization,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('The local face model took too long to load. Retry observation.')), this.timeoutMs); }),
    ]).then(model => {
      if (!isCurrent()) { model?.close(); return false; }
      if (!model) return false;
      this.landmarker = model;
      this.lastTimestamp = -Infinity;
      this.setStatus('ready', 'Local face observation ready.');
      return true;
    }).catch(error => {
      if (isCurrent()) {
        this.error = error;
        // Invalidate the late async initialization before it produces a model.
        this.token++;
        this.setStatus('error', error?.message || 'Face observation could not start.');
      }
      return false;
    }).finally(() => {
      clearTimeout(timer);
      if (this.starting === pending) this.starting = null;
    });
    this.starting = pending;
    return pending;
  }

  detect(canvas, now) {
    if (!this.landmarker || this.busy || !Number.isFinite(now) || now <= this.lastTimestamp || !(canvas?.width > 0 && canvas?.height > 0)) return [];
    this.busy = true;
    this.lastTimestamp = now;
    try {
      return this.landmarker.detectForVideo(canvas, now)?.faceLandmarks?.[0] || [];
    } catch (error) {
      this.error = error;
      this.setStatus('error', error?.message || 'Face landmarks are unavailable for this frame.');
      return [];
    } finally {
      this.busy = false;
    }
  }

  stop() {
    this.token++;
    this.starting = null;
    this.landmarker?.close();
    this.landmarker = null;
    this.lastTimestamp = -Infinity;
    this.busy = false;
    this.setStatus('off', 'Face observation off.');
  }
}
