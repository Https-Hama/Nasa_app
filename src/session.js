export function summarizeResult(snapshot, inputMode, timestamp = Date.now()) {
  const stats = snapshot.stats || {};
  const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
  return {
    id: globalThis.crypto?.randomUUID?.() || `${timestamp}-${Math.random().toString(36).slice(2)}`,
    timestamp,
    mission: ['asteroids','memory','docking','exercise'].includes(snapshot.mission) ? snapshot.mission : 'asteroids',
    inputMode: inputMode === 'motion' ? 'motion' : 'keyboard',
    score: Math.round(finite(snapshot.score)),
    reps: Math.max(0, Math.round(finite(snapshot.reps))),
    hull: Math.round(finite(snapshot.hull)),
    accuracy: stats.attempts > 0 ? Math.round(finite(stats.correct) / stats.attempts * 100) : null,
    precision: Math.round(finite(snapshot.dockPrecision)),
    progress: finite(snapshot.progress),
  };
}

export function safeHistory(raw) {
  try {
    const value = JSON.parse(raw || '[]');
    return Array.isArray(value) ? value.filter(v => v && typeof v === 'object' && typeof v.mission === 'string' && Number.isFinite(v.score)).slice(0,30) : [];
  } catch { return []; }
}

export function addSession(history, session) {
  return [session, ...history].slice(0,30);
}
