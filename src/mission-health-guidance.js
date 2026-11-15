const sleepSource = { title: 'NIH: Healthy sleep', url: 'https://health.nih.gov/health-topics-a-z/healthy-sleep' };
const eyeSource = { title: 'Mayo Clinic: Dark circles under eyes', url: 'https://www.mayoclinic.org/symptoms/dark-circles-under-eyes/basics/causes/sym-20050624' };
const exerciseSource = { title: 'NASA: Astronaut exercise', url: 'https://www.nasa.gov/general/astronaut-exercise/' };
const resistanceSource = { title: 'NASA: Exercise overview', url: 'https://www.nasa.gov/ochmo-tb-031-exercise-overview-2/' };

export const HEALTH_CHECK_IDS = ['sleep-alertness', 'eye-comfort', 'focus-recheck', 'movement-comfort'];
export const SPACE_EXERCISES = [
  {
    id: 'ared-squat', kind: 'resistance', title: 'Resisted squats', equipment: 'ARED or a crew-approved resistance device with restraints',
    instructions: 'Use the trained squat movement against the device resistance with feet secured as instructed. Free-floating bodyweight squats do not provide the same loading.',
    dose: 'Use the load, sets and repetitions prescribed by the crew exercise specialist.', source: resistanceSource,
  },
  {
    id: 'ared-heel-raise', kind: 'resistance', title: 'Resisted heel raises', equipment: 'ARED with its approved foot platform and restraints',
    instructions: 'Follow trained technique to raise and lower the heels against device resistance. Maintain the approved support and controlled movement.',
    dose: 'Follow the crew-prescribed resistance, repetitions and rest periods.', source: resistanceSource,
  },
  {
    id: 'cevis-cycle', kind: 'aerobic', title: 'Stationary cycling', equipment: 'CEVIS cycle ergometer with cycling shoes and approved restraints',
    instructions: 'Secure the feet and pedal at the assigned workload. Use the configured vibration isolation system; check equipment setup before starting.',
    dose: 'Follow the duration and intensity assigned in the crew exercise plan.', source: exerciseSource,
  },
  {
    id: 't2-walk', kind: 'aerobic', title: 'Harnessed treadmill walking or running', equipment: 'T2 treadmill, fitted loading harness and vibration isolation system',
    instructions: 'Fit the approved harness before using the treadmill. Walk or run only at the assigned speed and harness loading after equipment training.',
    dose: 'Use the crew-prescribed session duration, speed and harness load.', source: exerciseSource,
  },
];

const measured = value => typeof value === 'number' && Number.isFinite(value);
const display = value => Number(value.toFixed(1));
const ordered = (items, ids = []) => {
  const rank = new Map((Array.isArray(ids) ? ids : []).map((id, index) => [id, index]));
  return items.slice().sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
};

/** Input is the anonymous, quality-gated mission payload, never raw camera data.
 * Model selections change priority; the catalog supplies the health instructions.
 */
export function buildMissionHealthGuidance(mission, review = null) {
  const face = mission?.face, body = mission?.body, focus = mission?.focus, memory = mission?.memory;
  const closures = [];
  if (face?.available) {
    if (measured(face.metrics?.longClosureCount)) closures.push(`${face.metrics.longClosureCount} long eye-closure events`);
    if (measured(face.metrics?.longestClosureSec)) closures.push(`longest closure ${display(face.metrics.longestClosureSec)} seconds`);
    if (measured(face.metrics?.eyeClosurePct)) closures.push(`eyes closed in ${display(face.metrics.eyeClosurePct)}% of valid samples`);
  }
  const healthChecks = [
    {
      id: 'sleep-alertness', title: 'Sleep and alertness check',
      evidence: closures.length ? `Camera observations: ${closures.join('; ')}.` : 'Eye-closure measurements are unavailable. This is a general self-check, not a detected problem.',
      possibleExplanation: 'Eye closures can reflect ordinary blinking, deliberate movement or tracking error. They do not establish sleep loss; ask how sleepy you actually feel.',
      check: 'Review last night\'s sleep duration, interruptions and current sleepiness. Log sleep in Mission health; a clinician can assess persistent sleep problems.',
      action: 'If sleepy, pause demanding tasks and rest. For adults, protect 7–9 hours of sleep and a consistent sleep schedule; follow crew rest procedures in flight.',
      seekHelp: 'Contact a clinician or crew medical officer if sleepiness persists despite adequate rest or interferes with safe duties.', source: sleepSource,
    },
    {
      id: 'eye-comfort', title: 'Eye comfort and dark circles',
      evidence: 'This camera check does not measure dark circles, under-eye color, vision or eye disease. This advice applies only if you notice a concern yourself.',
      possibleExplanation: 'If you notice dark circles, possible explanations include inherited pigmentation, allergies or shadows made more visible by poor sleep. Appearance alone cannot identify the cause.',
      check: 'Check whether the change is new, affects one eye, or accompanies irritation or vision changes. An eye examination can investigate persistent concerns.',
      action: 'Review sleep if you have slept poorly. Take regular screen breaks, reduce glare and avoid rubbing irritated eyes; do not assume dark circles mean you need more sleep.',
      seekHelp: 'Seek prompt medical advice for new one-sided swelling or changes. Sudden vision loss or severe eye pain needs urgent medical care.', source: eyeSource,
    },
  ];
  const taskEvidence = [];
  if (focus?.complete && measured(focus.accuracy) && focus.accuracy < 100) taskEvidence.push(`${focus.correct} of ${focus.trials} focus responses correct`);
  if (memory?.complete && measured(memory.accuracy) && memory.accuracy < 100) taskEvidence.push(`${memory.correct} of ${memory.attempts} memory inputs correct`);
  if (taskEvidence.length) healthChecks.push({
    id: 'focus-recheck', title: 'Attention and recall follow-up', evidence: `Completed tasks: ${taskEvidence.join('; ')}.`,
    possibleExplanation: 'Practice, distraction, input timing and rest can affect this game. Errors do not diagnose a memory or attention disorder.',
    check: 'Repeat the same tasks after rest with the same input method and fewer distractions. Record whether difficulties also occur in daily activities.',
    action: 'Take a comfortable break before another check. If you feel sleepy, prioritize rest over extra task practice.',
    seekHelp: 'Discuss persistent real-world changes with a clinician or crew medical officer for an appropriate assessment. Sudden confusion needs urgent medical care.', source: sleepSource,
  });
  if (body?.available) {
    const movements = ['squats', 'kneeLifts'].filter(key => measured(body.metrics?.[key]))
      .map(key => `${body.metrics[key]} ${key === 'squats' ? 'squats' : 'knee lifts'}`);
    healthChecks.push({
      id: 'movement-comfort', title: 'Movement comfort and exercise readiness',
      evidence: movements.length ? `Gameplay recorded ${movements.join(' and ')}. These are movement counts, not a strength test.`
        : 'Upper-body movement was recorded; leg measurements are unavailable. The camera cannot measure strength, bone density or exercise readiness.',
      possibleExplanation: 'Movement counts depend on controls, framing and play style. They cannot establish muscle loss, injury or a need for heavier exercise.',
      check: 'Check for pain, dizziness or unusual breathlessness before exercise. Ask the crew medical officer about persistent symptoms and appropriate physical assessment.',
      action: 'If comfortable and cleared for exercise, follow the crew\'s resistance and aerobic plan using approved equipment. Stop if symptoms develop.',
      seekHelp: 'Stop exercise and contact the medical officer for concerning symptoms. Chest pain, fainting or severe breathlessness needs urgent medical care.', source: exerciseSource,
    });
  }
  const selected = SPACE_EXERCISES.filter(item => Array.isArray(review?.spaceExercises) && review.spaceExercises.includes(item.id));
  const balanced = selected.some(item => item.kind === 'resistance') && selected.some(item => item.kind === 'aerobic');
  const exercises = balanced ? selected : SPACE_EXERCISES.filter(item => ['ared-squat', 'cevis-cycle', 't2-walk'].includes(item.id));
  return { healthChecks: ordered(healthChecks, review?.healthChecks), spaceExercises: ordered(exercises, review?.spaceExercises) };
}
