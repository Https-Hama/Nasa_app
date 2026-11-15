// Fixed, reviewed question bank. AI can select IDs; it cannot add clinical advice.
export const QUESTIONS = {
  technique: 'Could measurement technique or the device explain the change?',
  timing: 'Would it help to repeat this at a consistent time and under the same conditions?',
  sleep: 'Could changes in sleep timing or workload be relevant to these observations?',
  environment: 'Could interruptions, camera setup, or an input change affect the task results?',
  context: 'What other details should I record before we review this pattern?',
  followup: 'What follow-up would you recommend after reviewing the log?',
};
export const REVIEW_TOPICS = {
  sleep: ['sleep','timing','context','followup'],
  task: ['environment','sleep','context','followup'],
  readings: ['technique','timing','context','followup'],
  general: ['context','followup','timing'],
};

export function reviewQuestions(alerts, selections) {
  const topic = alerts.some(a => a.key === 'sleep' || a.key === 'mood') ? 'sleep'
    : alerts.some(a => ['camera','attention','memory','motion'].includes(a.key)) ? 'task'
    : alerts.some(a => a.level === 'review') ? 'readings' : 'general';
  const allowed = REVIEW_TOPICS[topic];
  const ids = Array.isArray(selections?.[topic]) ? selections[topic].filter(id => allowed.includes(id)) : [];
  return [...new Set([...ids,...allowed])].slice(0,3).map(id => QUESTIONS[id]);
}
