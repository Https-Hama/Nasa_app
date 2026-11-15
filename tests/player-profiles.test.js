import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayerProfiles } from '../src/player-profiles.js';

const PROFILE_KEY = 'human-exe-player-profiles-v1';
const ID_ONE = '11111111-1111-4111-8111-111111111111';
const ID_TWO = '22222222-2222-4222-8222-222222222222';
function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

test('first visit requires a name and naming preserves legacy reports and check-ins', () => {
  const storage = memoryStorage({ 'human-exe-observations-v2': '[{"id":"legacy"}]', 'human-exe-checkins-v1': '{"day":"saved"}' });
  const players = createPlayerProfiles(storage);
  assert.equal(players.isIdentified, false);
  assert.equal(players.remembered, null);
  assert.throws(() => players.rename('   '), /Enter a player name/);
  assert.equal(storage.getItem(PROFILE_KEY), null);
  assert.deepEqual(players.rename('  Layla   Ali  '), { id: 'local-player', name: 'Layla Ali', named: true });
  assert.equal(players.isIdentified, true);
  assert.equal(players.records.getItem('human-exe-observations-v2'), '[{"id":"legacy"}]');
  assert.equal(players.records.getItem('human-exe-checkins-v1'), '{"day":"saved"}');
  const returned = createPlayerProfiles(storage);
  assert.equal(returned.isIdentified, true);
  assert.equal(returned.remembered.name, 'Layla Ali');
});

test('new and returning players keep reports, check-ins and preferences isolated', () => {
  const storage = memoryStorage();
  let players = createPlayerProfiles(storage, () => ID_ONE);
  players.rename('First player');
  for (const key of ['human-exe-observations-v2', 'human-exe-checkins-v1', 'human-exe-preferences-v2']) players.records.setItem(key, `first:${key}`);
  players.create('Second player');
  players = createPlayerProfiles(storage, () => ID_TWO);
  assert.equal(players.remembered.name, 'Second player');
  for (const key of ['human-exe-observations-v2', 'human-exe-checkins-v1', 'human-exe-preferences-v2']) {
    assert.equal(players.records.getItem(key), null);
    players.records.setItem(key, `second:${key}`);
  }
  players.select('local-player');
  players = createPlayerProfiles(storage);
  for (const key of ['human-exe-observations-v2', 'human-exe-checkins-v1', 'human-exe-preferences-v2']) assert.equal(players.records.getItem(key), `first:${key}`);
  players.select(ID_ONE);
  players = createPlayerProfiles(storage);
  for (const key of ['human-exe-observations-v2', 'human-exe-checkins-v1', 'human-exe-preferences-v2']) assert.equal(players.records.getItem(key), `second:${key}`);
});

test('unrecognized active player opens selection while preserving existing players and data', () => {
  const original = { activeId: 'deleted-or-invalid-id', profiles: [{ id: 'local-player', name: 'Original player' }, { id: ID_ONE, name: 'Second player' }] };
  const storage = memoryStorage({ [PROFILE_KEY]: JSON.stringify(original), 'human-exe-observations-v2': 'original reports' });
  const players = createPlayerProfiles(storage);
  assert.equal(players.isIdentified, false);
  assert.equal(players.remembered, null);
  assert.equal(players.list().length, 2);
  assert.deepEqual(players.select(ID_ONE), { id: ID_ONE, name: 'Second player' });
  assert.equal(createPlayerProfiles(storage).remembered.name, 'Second player');
  assert.equal(storage.getItem('human-exe-observations-v2'), 'original reports');
});

test('existing custom names are recognized and explicitly named Local player is remembered', () => {
  const storage = memoryStorage({ [PROFILE_KEY]: JSON.stringify({ activeId: 'local-player', profiles: [{ id: 'local-player', name: 'Before onboarding' }] }) });
  assert.equal(createPlayerProfiles(storage).isIdentified, true);
  const fresh = memoryStorage();
  createPlayerProfiles(fresh).rename('Local player');
  assert.equal(createPlayerProfiles(fresh).isIdentified, true);
});

test('duplicates, invalid names, unknown selections and ID collisions never overwrite a player', () => {
  const storage = memoryStorage();
  const players = createPlayerProfiles(storage, () => ID_ONE);
  players.rename('Layla');
  players.create('Omar');
  const before = storage.getItem(PROFILE_KEY);
  assert.throws(() => players.rename(' OMAR '), /already used/);
  assert.throws(() => players.create('layla'), /already used/);
  assert.throws(() => players.create('Third'), /player ID/);
  assert.throws(() => players.rename('x'.repeat(33)), /between 1 and 32/);
  assert.throws(() => players.rename('name\u0000'), /between 1 and 32/);
  assert.throws(() => players.select('unknown'), /existing player/);
  assert.equal(storage.getItem(PROFILE_KEY), before);
});

test('a failed name save leaves identity unconfirmed and existing records intact', () => {
  const storage = memoryStorage({ 'human-exe-observations-v2': 'existing reports' });
  const players = createPlayerProfiles(storage);
  storage.setItem = () => { throw new DOMException('Storage quota exceeded', 'QuotaExceededError'); };
  assert.throws(() => players.rename('Layla'), /quota/i);
  assert.equal(players.isIdentified, false);
  assert.equal(players.profile.name, 'Local player');
  assert.equal(storage.getItem(PROFILE_KEY), null);
  assert.equal(storage.getItem('human-exe-observations-v2'), 'existing reports');
});
