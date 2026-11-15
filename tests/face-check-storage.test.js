import test from 'node:test';
import assert from 'node:assert/strict';
import { FACE_CHECKS_KEY, readFaceChecks, storeFaceCheck } from '../src/face-check-storage.js';
import { createPlayerProfiles } from '../src/player-profiles.js';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

function check(overrides = {}) {
  return {
    id: 'face-check-one', timestamp: 1794646800000, durationSec: 30,
    face: {
      validSeconds: 27, coverage: .9, meanFps: 12, blinkCount: 4,
      blinkRate: 10, eyeClosurePct: 3, longClosureCount: 0, longestClosureSec: .2,
      mouthOpenEvents: 1, headRollMeanDeg: -2, headRollRangeDeg: 7,
      baselineReady: true, qualityReasons: [],
    },
    ...overrides,
  };
}

test('completed and immediately stopped face checks persist without needing a flight', () => {
  const storage = memoryStorage();
  assert.deepEqual(readFaceChecks(storage), []);
  const completed = storeFaceCheck(storage, check());
  assert.equal(completed.protocol, 'face-check-30s-v2');
  storeFaceCheck(storage, check({ id: 'early-check', timestamp: completed.timestamp + 1,
    durationSec: 0, face: { validSeconds: 0, baselineReady: false, qualityReasons: ['no-face'] } }));
  const reloaded = readFaceChecks(storage);
  assert.equal(reloaded.length, 2);
  assert.equal(reloaded[0].durationSec, 0);
  assert.equal(reloaded[0].face.blinkCount, null);
  assert.equal(reloaded[0].face.baselineReady, false);
  assert.deepEqual(reloaded[0].face.qualityReasons, ['no-face']);
  assert.equal(reloaded[1].face.blinkCount, 4);
});

test('only whitelisted derived face scalars survive saving and reading', () => {
  const storage = memoryStorage();
  const input = check();
  input.image = 'private-image';
  input.landmarks = [{ x: .5, y: .3 }];
  input.face.video = 'private-video';
  input.face.pixels = [200, 100];
  input.face.landmarks = [{ x: .5 }];
  input.face.currentQualityReason = 'no-face';
  input.face.baselineProgress = .5;
  input.face.meanFps = Infinity;
  input.face.blinkRate = '12';
  const saved = storeFaceCheck(storage, input);
  assert.equal(saved.face.meanFps, null);
  assert.equal(saved.face.blinkRate, null);
  for (const text of ['private-image', 'private-video', 'landmarks', 'pixels', 'baselineProgress', 'currentQualityReason']) {
    assert.equal(storage.getItem(FACE_CHECKS_KEY).includes(text), false);
  }
  assert.equal(input.face.video, 'private-video', 'sanitizing does not mutate the original result');
  const loaded = readFaceChecks(storage);
  loaded[0].face.blinkCount = 999;
  assert.equal(readFaceChecks(storage)[0].face.blinkCount, 4);
});

test('a repeated check ID updates its existing summary and keeps all other checks', () => {
  const storage = memoryStorage();
  storeFaceCheck(storage, check());
  storeFaceCheck(storage, check({ id: 'another', timestamp: 1794646801000 }));
  storeFaceCheck(storage, check({ durationSec: 12.5, timestamp: 1794646802000 }));
  const loaded = readFaceChecks(storage);
  assert.deepEqual(loaded.map(item => item.id), ['face-check-one', 'another']);
  assert.equal(loaded[0].durationSec, 12.5);
});

test('saving more than one hundred checks does not trim older results', () => {
  const storage = memoryStorage();
  for (let index = 0; index < 125; index++) {
    storeFaceCheck(storage, check({ id: `check-${index}`, timestamp: index }));
  }
  const loaded = readFaceChecks(storage);
  assert.equal(loaded.length, 125);
  assert.equal(loaded[0].id, 'check-124');
  assert.equal(loaded.at(-1).id, 'check-0');
});

test('corrupted saved collections are rejected without overwriting their original bytes', () => {
  const invalid = [
    '{broken', 'null', '{}', '[null]', '[{}]',
    JSON.stringify([check({ timestamp: 'yesterday' })]),
    JSON.stringify([check({ face: [] })]),
    JSON.stringify([check({ protocol: 'unknown-protocol' })]),
    JSON.stringify([check(), check()]),
  ];
  for (const raw of invalid) {
    const storage = memoryStorage({ [FACE_CHECKS_KEY]: raw });
    assert.throws(() => readFaceChecks(storage), /history cannot be opened/);
    assert.throws(() => storeFaceCheck(storage, check({ id: 'new-check' })), /history cannot be opened/);
    assert.equal(storage.getItem(FACE_CHECKS_KEY), raw);
  }
});

test('invalid new check identities and durations cannot replace saved data', () => {
  const storage = memoryStorage();
  storeFaceCheck(storage, check());
  const original = storage.getItem(FACE_CHECKS_KEY);
  for (const invalid of [null, [], {}, check({ id: '' }), check({ id: 'x'.repeat(121) }),
    check({ timestamp: NaN }), check({ durationSec: -1 }), check({ durationSec: Infinity }),
    check({ durationSec: '30' }), check({ face: null })]) {
    assert.throws(() => storeFaceCheck(storage, invalid), /summary is invalid/);
    assert.equal(storage.getItem(FACE_CHECKS_KEY), original);
  }
});

test('face checks use the selected player adapter and retain legacy local-player data', () => {
  const storage = memoryStorage();
  const local = createPlayerProfiles(storage);
  local.rename('Alex');
  storeFaceCheck(local.records, check());
  const secondId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const creator = createPlayerProfiles(storage, () => secondId);
  creator.create('Sam');
  const second = createPlayerProfiles(storage);
  assert.deepEqual(readFaceChecks(second.records), []);
  storeFaceCheck(second.records, check({ id: 'sams-check' }));
  assert.deepEqual(readFaceChecks(second.records).map(item => item.id), ['sams-check']);
  second.select('local-player');
  assert.deepEqual(readFaceChecks(createPlayerProfiles(storage).records).map(item => item.id), ['face-check-one']);
  assert.deepEqual(readFaceChecks(storage).map(item => item.id), ['face-check-one']);
});

test('browser storage failures propagate so the app can report that a check is still unsaved', () => {
  const storage = memoryStorage();
  storeFaceCheck(storage, check());
  const original = storage.getItem(FACE_CHECKS_KEY);
  const unavailable = { ...storage, setItem: () => { throw new DOMException('Storage is full', 'QuotaExceededError'); } };
  assert.throws(() => storeFaceCheck(unavailable, check({ id: 'next' })), /Storage is full/);
  assert.equal(storage.getItem(FACE_CHECKS_KEY), original);
  assert.throws(() => readFaceChecks({ getItem: () => { throw new Error('Storage denied'); } }), /Storage denied/);
});
