import { buildMissionReviewPayload, sanitizeMissionReview } from './mission-review-model.js';
import { buildMissionHealthGuidance } from './mission-health-guidance.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const privacy = '<p class="mission-review-privacy">When automatic review is enabled, this mission’s derived camera measurements, flight results and task scores are sent to Gemini. Names, video and check-in notes stay on this device.</p>';
const retry = (id, label = 'Retry Gemini review') => `<button type="button" class="outline-button" data-mission-review-retry="${esc(id)}" data-report-id="${esc(id)}">${label}</button>`;
const heading = (label, detail = '') => `<header class="mission-review-heading"><div><span class="eyebrow">GEMINI / MISSION REVIEW</span><h2>${label}</h2></div>${detail}</header>`;
const section = (body, status = 'idle') => `<section class="mission-review mission-review-${status}" aria-label="Gemini mission review"${status === 'pending' ? ' aria-busy="true"' : ''}>${body}</section>`;
const list = (title, values) => values.length ? `<article><h3>${title}</h3><ul>${values.map(value => `<li>${esc(value)}</li>`).join('')}</ul></article>` : '';
const sourceLink = source => `<a class="mission-health-source" href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.title)} ↗</a>`;

function missionHealthHTML(record, review) {
  const guidance = buildMissionHealthGuidance(buildMissionReviewPayload(record), review);
  return `<section class="mission-health" aria-label="Health checks and recovery"><div class="mission-health-heading"><div><span class="eyebrow">AFTER YOUR MISSION</span><h3>Health checks & recovery</h3></div><span class="mission-health-label">${review?.healthChecks ? 'Prioritized by Gemini' : 'General guidance'}</span></div>
    <p class="mission-health-intro">Follow up on how you feel and the measurements available. These checks suggest what to investigate; they do not establish a diagnosis.</p>
    <div class="mission-health-grid">${guidance.healthChecks.map(item => `<article class="mission-health-card" data-health-check="${item.id}"><h4>${esc(item.title)}</h4><p class="mission-health-evidence"><strong>Recorded evidence</strong>${esc(item.evidence)}</p><dl><dt>What to do now</dt><dd>${esc(item.action)}</dd></dl><details><summary>What to check & when to seek help</summary><dl><dt>Possible explanations</dt><dd>${esc(item.possibleExplanation)}</dd><dt>What to check</dt><dd>${esc(item.check)}</dd><dt>When to seek help</dt><dd>${esc(item.seekHelp)}</dd></dl></details>${sourceLink(item.source)}</article>`).join('')}</div>
    <div class="mission-health-heading mission-exercise-heading"><div><span class="eyebrow">MOVING IN MICROGRAVITY</span><h3>Spacecraft exercise options</h3></div></div>
    <p class="mission-health-intro">Examples to discuss with the crew exercise specialist. Use only equipment available and approved on your spacecraft; follow your medical clearance and assigned plan. This game cannot set safe training loads or replace exercise.</p>
    <div class="mission-exercise-grid">${guidance.spaceExercises.map(item => `<article class="mission-exercise-card" data-space-exercise="${item.id}"><span class="mission-exercise-kind">${item.kind === 'resistance' ? 'RESISTANCE' : 'AEROBIC'}</span><h4>${esc(item.title)}</h4><p>${esc(item.instructions)}</p><dl><dt>Equipment</dt><dd>${esc(item.equipment)}</dd><dt>Workload</dt><dd>${esc(item.dose)}</dd></dl>${sourceLink(item.source)}</article>`).join('')}</div>
    <p class="mission-health-caution">Stop exercise for pain, dizziness or unusual breathlessness and contact the crew medical officer. Chest pain, fainting, severe breathlessness, sudden confusion or sudden vision loss needs urgent medical care.</p></section>`;
}

export function missionReviewHTML({ record, state } = {}) {
  if (!record) return '';
  if (record.source === 'demo') return section(`${heading('Fictional preview')}<p>This sample report is fictional. Gemini reviews are generated only from completed measured missions.</p>`, 'demo');
  if (['flight', 'mind'].includes(record.conditions?.sessionStage)) {
    return section(`${heading('Finish your mission first')}<p>This saved progress report keeps your place. Complete the flight and finish the mind check to generate the mission review.</p>${privacy}`, 'partial');
  }
  const review = sanitizeMissionReview(state?.review || record.geminiReview);
  const completedSection = (body, status = 'idle') => section(`${body}${missionHealthHTML(record, review)}`, status);
  if (state?.status === 'disabled' && !review) {
    return completedSection(`${heading('Automatic review is off')}<p>Your measured report is ready. Enable automatic Gemini mission reviews in Preferences to add a review of your results.</p>${privacy}`, 'disabled');
  }
  if (state?.status === 'pending') {
    return completedSection(`${heading('Preparing your mission review', '<span class="mission-review-provider">GEMINI</span>')}<div class="mission-review-progress" role="status" aria-live="polite"><span class="mission-review-pulse" aria-hidden="true"></span><p>Gemini is reviewing your measured results. Your local report remains available while it works.</p></div><div class="mission-review-skeleton" aria-hidden="true"><i></i><i></i><i></i><div><i></i><i></i></div></div>${privacy}`, 'pending');
  }
  if (state?.status === 'error' || (state?.status === 'ready' && !review)) {
    const error = state?.error || 'The saved review could not be opened. Please generate it again.';
    return completedSection(`${heading('Your measured report is ready. The review needs a retry.')}<p class="mission-review-error" role="alert">${esc(error)}</p>${retry(record.id)}${privacy}`, 'error');
  }
  if (review) {
    let generated = '<span>Generated by Gemini</span>';
    if (Number.isFinite(review.generatedAt) && review.generatedAt >= 0) {
      const date = new Date(review.generatedAt);
      if (!Number.isNaN(date.getTime())) generated += `<time datetime="${date.toISOString()}">${esc(date.toLocaleString('en-GB', { timeZone: 'Asia/Baghdad', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }))}</time>`;
    }
    return completedSection(`${heading('Your mission, reviewed.', `<div class="mission-review-generated">${generated}</div>`)}<p class="mission-review-summary">${esc(review.summary)}</p><div class="mission-review-grid">${list('What went well', review.strengths)}${list('What to notice', review.observations)}${list('Try next time', review.nextSteps)}${list('Limits of this review', review.limitations)}</div><p class="mission-review-boundary">AI-generated interpretation of this game session. It may make mistakes and is not a medical assessment.</p>${privacy}`, 'ready');
  }
  return completedSection(`${heading('A review of your mission is next.')}<p>Your measured report is ready. A Gemini review will generate automatically when automatic reviews are enabled.</p>${retry(record.id, 'Generate Gemini review')}${privacy}`);
}
