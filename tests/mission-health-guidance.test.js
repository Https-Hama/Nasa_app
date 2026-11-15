import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMissionHealthGuidance } from '../src/mission-health-guidance.js';
import { buildMissionReviewPayload } from '../src/mission-review-model.js';

function mission({ poorFace = false, poorBody = false, partial = false } = {}) {
  return buildMissionReviewPayload({
    id: 'health-check', timestamp: 1700000000000, source: 'measured', protocol: 'orbital-observation-v2',
    inputMode: 'motion', durationSec: 120, conditions: { sessionStage: 'complete' },
    observations: {
      face: { baselineReady: !poorFace, validSeconds: poorFace ? 2 : 25, coverage: .9, meanFps: 18,
        longClosureCount: 3, longestClosureSec: 1.8, eyeClosurePct: 12 },
      body: { validSeconds: poorBody ? 2 : 90, coverage: .9, fullBodyCoverage: .1,
        squats: 99, kneeLifts: 88, leftHandTravel: 10, rightHandTravel: 8 },
    },
    cognitive: {
      memory: { protocol: 'pattern-memory-3-4-5-random-v3', rounds: partial ? 1 : 3, correct: 10, attempts: 12 },
      attention: { protocol: 'focus-go-no-go-random-v3', correct: 6, attempts: partial ? 3 : 8, misses: 1, falseAlarms: 1 },
    },
  });
}

test('sleep follow-up connects usable eye-closure evidence to checks, recovery and escalation without diagnosing the cause', () => {
  const card = buildMissionHealthGuidance(mission()).healthChecks.find(item => item.id === 'sleep-alertness');
  assert.match(card.evidence, /3.*closure/i);
  assert.match(card.evidence, /1\.8/);
  assert.match(card.possibleExplanation, /tracking|deliberate/i);
  assert.match(card.check, /sleep/i);
  assert.match(card.action, /7.{0,3}9/);
  assert.match(card.seekHelp, /medical officer|clinician/i);
});

test('unusable face evidence and unobserved legs cannot become detected health concerns or reassuring zeroes', () => {
  const guide = buildMissionHealthGuidance(mission({ poorFace: true }));
  assert.match(guide.healthChecks.find(item => item.id === 'sleep-alertness').evidence, /unavailable/i);
  const movement = guide.healthChecks.find(item => item.id === 'movement-comfort');
  assert.match(movement.evidence, /leg.*unavailable/i);
  assert.doesNotMatch(movement.evidence, /99|88|0 squats/);
  assert.equal(buildMissionHealthGuidance(mission({ poorBody: true })).healthChecks.some(item => item.id === 'movement-comfort'), false);
});

test('focus follow-ups require completed tasks with errors and do not diagnose cognitive impairment', () => {
  const card = buildMissionHealthGuidance(mission()).healthChecks.find(item => item.id === 'focus-recheck');
  assert.match(card.evidence, /6.*8/);
  assert.match(card.check, /repeat|recheck/i);
  assert.match(card.possibleExplanation, /practice|distraction/i);
  assert.equal(buildMissionHealthGuidance(mission({ partial: true })).healthChecks.some(item => item.id === 'focus-recheck'), false);
});

test('dark-circle advice is conditional, explains measurement limits and gives actual follow-up actions', () => {
  const card = buildMissionHealthGuidance(null).healthChecks.find(item => item.id === 'eye-comfort');
  assert.match(card.evidence, /does not (?:measure|detect).*dark circles/i);
  assert.match(card.possibleExplanation, /allerg|genetic/i);
  assert.match(card.action, /sleep|screen/i);
  assert.match(card.check, /eye|vision/i);
  assert.match(card.seekHelp, /vision|one eye/i);
  assert.match(card.source.url, /^https:\/\/www\.mayoclinic\.org\//);
});

test('every default exercise menu includes actual microgravity resistance and aerobic equipment with crew-prescribed workloads', () => {
  const { spaceExercises } = buildMissionHealthGuidance(null);
  assert.ok(spaceExercises.some(item => item.kind === 'resistance'));
  assert.ok(spaceExercises.some(item => item.kind === 'aerobic'));
  for (const exercise of spaceExercises) {
    assert.ok(exercise.equipment.length > 5);
    assert.match(exercise.dose, /prescri|crew|assigned/i);
    assert.match(exercise.source.url, /^https:\/\/www\.nasa\.gov\//);
    assert.ok(exercise.instructions.length > 30);
  }
});

test('Gemini ordering cannot suppress essential checks, invent exercises or add inapplicable health findings', () => {
  const guide = buildMissionHealthGuidance(mission({ poorBody: true, partial: true }), {
    healthChecks: ['focus-recheck', 'eye-comfort', 'movement-comfort', 'unknown'],
    spaceExercises: ['t2-walk', 'ared-heel-raise', 'unknown'],
  });
  assert.deepEqual(guide.healthChecks.map(item => item.id), ['eye-comfort', 'sleep-alertness']);
  assert.deepEqual(guide.spaceExercises.map(item => item.id), ['t2-walk', 'ared-heel-raise']);
});
