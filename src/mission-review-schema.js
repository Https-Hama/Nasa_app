import { HEALTH_CHECK_IDS, SPACE_EXERCISES, buildMissionHealthGuidance } from './mission-health-guidance.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const forbiddenAdvice = /\b(?:diagnos(?:e|es|ed|ing|is)|prescrib(?:e|es|ed)|medicat(?:e|es|ion|ions)|treatments?|therap(?:y|ies)|dementia|parkinson(?:'?s)?|alzheimer(?:'?s)?|adhd|depression|anxiety|disease|disorder|fatigue|health score)\b/i;
function unsafeClinicalContent(text) {
  const directAdvice = /\b(?:you (?:have|may have|likely have)|signs? of|symptoms? of|consistent with|evidence for|risk of|(?:take|start|stop|increase|decrease|prescribe|recommend|need|require)\b.{0,50}\b(?:medicat|treatment|therapy))/i;
  return text.split(/[.!?;]+/).some(sentence => {
    if (!forbiddenAdvice.test(sentence)) return false;
    const boundedDisclaimer = /\b(?:not (?:a |an )?(?:medical |clinical )?(?:diagnosis|assessment|test|treatment)|cannot (?:diagnose|establish|determine|infer|confirm)|does? not (?:diagnose|establish|determine|infer|confirm)|no (?:medical |clinical )?(?:diagnosis|treatment|medication) (?:is |was )?(?:provided|recommended))\b/i;
    return !boundedDisclaimer.test(sentence) || directAdvice.test(sentence);
  });
}
function line(value, maximum) {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  if (!clean || clean.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(clean) || unsafeClinicalContent(clean)) return null;
  return clean;
}

/** Whitelist model-generated content before displaying or saving it. */
export function sanitizeMissionReview(raw, { requireHealthGuidance = false, mission = null } = {}) {
  if (!object(raw)) return null;
  const summary = line(raw.summary, 700);
  if (!summary) return null;
  const safe = { summary };
  for (const field of ['strengths', 'observations', 'nextSteps', 'limitations']) {
    if (!Array.isArray(raw[field]) || raw[field].length > 3) return null;
    const values = raw[field].map(value => line(value, 400));
    if (values.some(value => value === null)) return null;
    safe[field] = values;
  }
  const allowedChecks = mission ? buildMissionHealthGuidance(mission).healthChecks.map(item => item.id) : HEALTH_CHECK_IDS;
  for (const [field, allowed] of [['healthChecks', allowedChecks], ['spaceExercises', SPACE_EXERCISES.map(item => item.id)]]) {
    if (raw[field] === undefined && !requireHealthGuidance) continue; // Older saved reviews remain readable.
    const ids = raw[field];
    if (!Array.isArray(ids) || ids.length < 2 || ids.length > 4 || new Set(ids).size !== ids.length
      || ids.some(id => !allowed.includes(id))) return null;
    safe[field] = ids.slice();
  }
  if (safe.healthChecks && !['sleep-alertness', 'eye-comfort'].every(id => safe.healthChecks.includes(id))) return null;
  if (safe.spaceExercises && !['resistance', 'aerobic'].every(kind => SPACE_EXERCISES.some(item => item.kind === kind && safe.spaceExercises.includes(item.id)))) return null;
  safe.provider = 'Gemini';
  safe.generatedAt = typeof raw.generatedAt === 'number' && Number.isFinite(raw.generatedAt)
    && raw.generatedAt >= 0 && raw.generatedAt <= 8640000000000000 ? raw.generatedAt : null;
  return safe;
}
