import test from 'node:test';
import assert from 'node:assert/strict';
import { NASA_CHALLENGE_RESOURCES, loadNasaReference } from '../src/nasa-resources.js';

test('official challenge resources use complete NASA URLs', () => {
  assert.equal(NASA_CHALLENGE_RESOURCES.length, 3);
  for (const source of NASA_CHALLENGE_RESOURCES) {
    assert.match(source.url, /^https:\/\/www\.nasa\.gov\/hrp\//);
    assert.ok(source.usedFor.length > 40);
  }
});

test('runtime NASA reference loads and keeps only approved challenge resources', async () => {
  const payload = {
    title: 'NASA Human Research Program basis',
    challenge: 'Create Health Monitoring Software for Astronauts on Space Missions',
    sources: [...NASA_CHALLENGE_RESOURCES, { id: 'unrelated', title: 'Other', url: 'https://example.com' }],
  };
  const reference = await loadNasaReference(async () => ({ ok: true, json: async () => payload }));
  assert.equal(reference.fallback, false);
  assert.deepEqual(reference.sources.map(source => source.id), NASA_CHALLENGE_RESOURCES.map(source => source.id));
});

test('runtime NASA reference has a safe offline fallback', async () => {
  const reference = await loadNasaReference(async () => { throw new Error('offline'); });
  assert.equal(reference.fallback, true);
  assert.equal(reference.sources.length, 3);
});
