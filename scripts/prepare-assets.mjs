import { mkdir, copyFile, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const assets = [
  ['https://docs.opencv.org/4.x/opencv.js', 'public/vendor/opencv.js'],
  ['https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task', 'public/models/pose_landmarker_lite.task'],
  ['https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task', 'public/models/face_landmarker.task'],
];
for (const [url, relative] of assets) {
  const target = resolve(root, relative);
  await mkdir(resolve(target, '..'), { recursive: true });
  if (await stat(target).then(s => s.size > 100000).catch(() => false)) {
    console.log(`Ready: ${relative}`);
    continue;
  }
  console.log(`Downloading ${relative}...`);
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  await writeFile(target, bytes);
  console.log(`Saved ${relative} (${bytes.length.toLocaleString()} bytes)`);
}
const wasmSource = resolve(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const wasmTarget = resolve(root, 'public/vendor/mediapipe');
await mkdir(wasmTarget, { recursive: true });
for (const file of await readdir(wasmSource)) {
  if (/\.(wasm|js)$/.test(file)) await copyFile(resolve(wasmSource, file), resolve(wasmTarget, file));
}
console.log('Camera assets are installed locally. No CDN is needed during play.');
