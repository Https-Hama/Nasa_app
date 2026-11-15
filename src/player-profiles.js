const PROFILE_KEY = 'human-exe-player-profiles-v1';
const LOCAL_PLAYER = 'local-player';
const DEFAULT_PROFILE = { id: LOCAL_PLAYER, name: 'Local player' };

function normalizeName(name) {
  if (typeof name !== 'string') return '';
  return name.trim().replace(/\s+/g, ' ');
}

function validName(name) {
  return name.length >= 1 && name.length <= 32 && !/[\u0000-\u001f\u007f]/.test(name);
}

function isNamed(profile) {
  // Names entered before onboarding was introduced remain valid identities.
  return profile?.named === true || (profile && profile.name !== DEFAULT_PROFILE.name);
}

function readProfiles(storage) {
  const raw = storage.getItem(PROFILE_KEY);
  if (raw === null) return { activeId: LOCAL_PLAYER, profiles: [{ ...DEFAULT_PROFILE }] };
  const state = JSON.parse(raw);
  const profiles = state?.profiles;
  if (!Array.isArray(profiles) || !profiles.every(profile => profile &&
      /^(local-player|[a-f0-9-]{36})$/.test(profile.id) && validName(normalizeName(profile.name))) ||
      new Set(profiles.map(profile => profile.id)).size !== profiles.length ||
      !profiles.some(profile => profile.id === LOCAL_PLAYER)) {
    throw new Error('Saved player profiles could not be opened.');
  }
  // An unknown last-selected ID must lead to the chooser, without losing any records.
  return { ...state, activeId: profiles.some(profile => profile.id === state.activeId) ? state.activeId : null };
}

export function createPlayerProfiles(storage, newId = () => crypto.randomUUID()) {
  const initial = readProfiles(storage);
  const activeId = initial.activeId ?? LOCAL_PLAYER;
  const profile = initial.profiles.find(entry => entry.id === activeId);
  // The original local player keeps the original keys so existing data needs no copy or migration.
  const storageKey = key => activeId === LOCAL_PLAYER ? key : `human-exe-profile:${activeId}:${key}`;
  const records = {
    getItem: key => storage.getItem(storageKey(key)),
    setItem: (key, value) => storage.setItem(storageKey(key), value),
    removeItem: key => storage.removeItem(storageKey(key)),
  };
  const saveProfiles = state => storage.setItem(PROFILE_KEY, JSON.stringify(state));

  function checkedName(name, profiles, exceptId) {
    const clean = normalizeName(name);
    if (!validName(clean)) throw new Error('Enter a player name between 1 and 32 characters.');
    if (profiles.some(other => other.id !== exceptId && normalizeName(other.name).toLocaleLowerCase() === clean.toLocaleLowerCase())) {
      throw new Error('That name is already used. Select that player or choose a different name.');
    }
    return clean;
  }

  return {
    profile,
    records,
    get isIdentified() { return initial.activeId !== null && isNamed(profile); },
    get remembered() { return initial.activeId !== null && isNamed(profile) ? { ...profile } : null; },
    list: () => readProfiles(storage).profiles,
    rename(name) {
      const state = readProfiles(storage);
      const clean = checkedName(name, state.profiles, activeId);
      state.profiles = state.profiles.map(entry => entry.id === activeId ? { ...entry, name: clean, named: true } : entry);
      state.activeId = activeId;
      saveProfiles(state);
      profile.name = clean;
      profile.named = true;
      initial.activeId = activeId;
      return { ...profile };
    },
    create(name) {
      const state = readProfiles(storage);
      const clean = checkedName(name, state.profiles);
      const id = newId();
      if (!/^[a-f0-9-]{36}$/.test(id) || state.profiles.some(entry => entry.id === id)) {
        throw new Error('Could not create a player ID. Please try again.');
      }
      state.profiles.push({ id, name: clean, named: true });
      state.activeId = id;
      saveProfiles(state);
      return { id, name: clean, named: true };
    },
    select(id) {
      const state = readProfiles(storage);
      if (!state.profiles.some(entry => entry.id === id)) throw new Error('Choose an existing player.');
      saveProfiles({ ...state, activeId: id });
      return { ...state.profiles.find(entry => entry.id === id) };
    },
  };
}
