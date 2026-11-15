import { sanitizeRecord } from './report-model.js';

export const FACE_CHECKS_KEY = 'human-exe-face-checks-v1';
const FACE_CHECK_PROTOCOL = 'face-check-30s-v2';
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const historyError = () => new Error('The saved face-check history cannot be opened. Export or recover it before saving another check.');

function sanitizeFaceCheck(input) {
  if (!isObject(input) || !isObject(input.face)
    || typeof input.id !== 'string' || !input.id.trim() || input.id.trim().length > 120
    || !Number.isFinite(input.durationSec) || input.durationSec < 0 || input.durationSec > 7200
    || (input.protocol !== undefined && input.protocol !== FACE_CHECK_PROTOCOL)) return null;
  // Reuse the report whitelist so this archive can never retain camera pixels,
  // images, raw landmarks or arbitrary unknown properties from a face result.
  const report = sanitizeRecord({
    id: input.id, timestamp: input.timestamp, source: 'measured',
    protocol: 'orbital-observation-v2', inputMode: 'motion',
    // An immediately stopped check can have zero elapsed time, unlike a flight.
    durationSec: Math.max(Number.EPSILON, input.durationSec),
    conditions: { faceCheckDurationSec: input.durationSec },
    observations: { face: input.face },
  });
  if (!report) return null;
  return {
    id: report.id, timestamp: report.timestamp, protocol: FACE_CHECK_PROTOCOL,
    durationSec: report.conditions.faceCheckDurationSec,
    face: report.observations.face,
  };
}

export function readFaceChecks(storage) {
  const raw = storage.getItem(FACE_CHECKS_KEY);
  if (raw === null) return [];
  let history;
  try { history = JSON.parse(raw); } catch { throw historyError(); }
  if (!Array.isArray(history)) throw historyError();
  const checks = history.map(sanitizeFaceCheck);
  if (checks.some(check => check === null)
    || new Set(checks.map(check => check.id)).size !== checks.length) throw historyError();
  return checks.sort((a, b) => b.timestamp - a.timestamp);
}

export function storeFaceCheck(storage, input) {
  const check = sanitizeFaceCheck(input);
  if (!check) throw new Error('The face check could not be saved because its summary is invalid.');
  // Read and validate the complete previous collection before a single write.
  // There is no retention limit: another check must never discard older data.
  const history = readFaceChecks(storage).filter(previous => previous.id !== check.id);
  history.push(check);
  history.sort((a, b) => b.timestamp - a.timestamp);
  storage.setItem(FACE_CHECKS_KEY, JSON.stringify(history));
  return check;
}
