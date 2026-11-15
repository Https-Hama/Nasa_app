import test from 'node:test';
import assert from 'node:assert/strict';
import { readReports, storeReport, REPORTS_KEY } from '../src/report-storage.js';

const report = (id, extra = {}) => ({id, timestamp: 1000, source: 'measured', protocol: 'orbital-observation-v2', inputMode: 'keyboard', durationSec: 10, ...extra});
function memoryStorage() {
  const data = new Map();
  return {getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value)};
}

test('a partial mission is updated under the same id and restored on reopening storage', () => {
  const storage = memoryStorage();
  storeReport(storage, report('mission', {cognitive: {memory: {correct: 1, attempts: 1, rounds: 0}}}));
  storeReport(storage, report('mission', {cognitive: {memory: {correct: 12, attempts: 12, rounds: 3}}}));
  const restored = readReports(storage);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].cognitive.memory.rounds, 3);
});

test('saving rereads current storage and retains reports from another tab without imposing a history cap', () => {
  const storage = memoryStorage();
  for (let i = 0; i < 45; i++) storeReport(storage, report(`mission-${i}`));
  assert.equal(readReports(storage).length, 45);
  storeReport(storage, report('other-tab'));
  storeReport(storage, report('mission-0', {durationSec: 20}));
  assert.equal(readReports(storage).length, 46);
  assert.equal(readReports(storage).find(r => r.id === 'mission-0').durationSec, 20);
});

test('malformed history and storage write failures are reported without overwriting existing data', () => {
  const storage = memoryStorage();
  storage.setItem(REPORTS_KEY, '{broken history');
  assert.throws(() => storeReport(storage, report('new')));
  assert.equal(storage.getItem(REPORTS_KEY), '{broken history');
  assert.throws(() => storeReport({getItem: () => null, setItem() { throw new Error('quota'); }}, report('new')), /quota/);
});

test('only sanitized derived observations can be persisted', () => {
  const storage = memoryStorage();
  storeReport(storage, report('mission', {video: 'private', observations: {face: {landmarks: [1,2], blinkRate: 10}}}));
  const raw = storage.getItem(REPORTS_KEY);
  assert.equal(raw.includes('private'), false);
  assert.equal(raw.includes('landmarks'), false);
  assert.throws(() => storeReport(storage, report('demo', {source: 'demo'})));
});
