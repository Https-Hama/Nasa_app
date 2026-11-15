import { compareRecords, sanitizeRecord } from './report-model.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]);
const number = (value, digits = 0) => Number.isFinite(value) ? Number(value.toFixed(digits)).toString() : 'N/A';
const pct = value => Number.isFinite(value) ? `${number(value, 1)}%` : 'N/A';
const count = value => Number.isInteger(value) && value >= 0;

function taskSummary(task, key, label) {
  const usable = count(task?.correct) && count(task?.attempts) && task.attempts > 0 && task.correct <= task.attempts;
  const attempts = usable ? task.attempts : null;
  const correct = usable ? task.correct : null;
  const errors = usable ? attempts - correct : null;
  const segments = usable ? [{ key: 'correct', label: 'Correct', count: correct, tone: 'cyan' }] : [];
  let detail = key === 'memory' ? 'Counts individual direction entries, including retries.' : 'Correct includes GO responses and correctly withheld WAIT responses.';
  let falseAlarms = null, misses = null;
  if (usable && key === 'attention' && count(task.falseAlarms) && count(task.misses) && task.falseAlarms + task.misses <= errors) {
    falseAlarms = task.falseAlarms;
    misses = task.misses;
    segments.push({ key:'false-alarms', label:'False alarms', count:falseAlarms, tone:'gold' }, { key:'misses', label:'Missed GO', count:misses, tone:'orange' });
    if (falseAlarms + misses < errors) segments.push({ key:'other-errors', label:'Other errors', count:errors - falseAlarms - misses, tone:'muted' });
  } else if (usable) {
    segments.push({ key:'errors', label:'Errors', count:errors, tone:'orange' });
    if (key === 'attention') detail += ' The saved error breakdown is unavailable.';
  }
  return { key, label, attempts, correct, errors, falseAlarms, misses, segments, detail, accuracy:usable ? correct / attempts * 100 : null };
}

/** Values come from this saved session; camera measurements retain report quality gates. */
export function buildReportCharts(raw) {
  const record = sanitizeRecord(raw);
  const comparison = compareRecords(record, null);
  const face = record?.observations.face || {}, body = record?.observations.body || {};
  const faceDuration = record?.conditions.faceCheckDurationSec;
  const faceObserved = face.validSeconds > 0 || faceDuration > 0;
  const bodyObserved = body.validSeconds > 0 || (record?.observations.durationSec > (faceDuration ?? 0) && record?.durationSec > 0);
  const memory = taskSummary(record?.cognitive.memory, 'memory', 'Pattern memory');
  const attention = taskSummary(record?.cognitive.attention, 'attention', 'Focus & response');
  const coverage = (value, observed) => observed && Number.isFinite(value) ? value * 100 : null;
  const signal = [
    { key:'face', label:'Face check', value:coverage(face.coverage, faceObserved), detail:faceObserved ? `${number(face.validSeconds, 1)} usable seconds from the separate face check.` : 'No face check was recorded for this mission.' },
    { key:'body', label:'Upper body', value:coverage(body.coverage, bodyObserved), detail:bodyObserved ? `${number(body.validSeconds, 1)} usable seconds during flight.` : 'No body observation was recorded for this mission.' },
    { key:'full-body', label:'Full body', value:coverage(body.fullBodyCoverage, bodyObserved), detail:bodyObserved ? 'Flight time with hips, knees and ankles visible. Portrait play can have 0% full-body coverage.' : 'Full-body observation was not recorded. Legs are optional.' },
  ];
  const hands = [
    { key:'left', label:'Left hand', value:comparison.body?.metrics?.leftHandTravel?.current ?? null, tone:'cyan' },
    { key:'right', label:'Right hand', value:comparison.body?.metrics?.rightHandTravel?.current ?? null, tone:'orange' },
  ];
  const largestHandValue = Math.max(0, ...hands.map(hand => hand.value ?? 0));
  const handScale = largestHandValue > 0 ? Math.ceil(largestHandValue / 5) * 5 : 1;
  return { memory, attention, signal, hands, handScale };
}

function valuesTable(rows, caption) {
  return `<details class="report-chart-values"><summary>View chart values <span aria-hidden="true">+</span></summary><table><caption>${esc(caption)}</caption><thead><tr><th scope="col">Measure</th><th scope="col">Value</th></tr></thead><tbody>${rows.map(row => `<tr><th scope="row">${esc(row[0])}</th><td>${esc(row[1])}</td></tr>`).join('')}</tbody></table></details>`;
}

function cardHeader(index, label, title, description, id) {
  return `<header class="report-chart-heading"><div class="report-chart-kicker"><span>${esc(label)}</span><span aria-hidden="true">0${index} / 04</span></div><h2 id="${id}">${esc(title)}</h2><p>${esc(description)}</p></header>`;
}

function accuracyRow(task, tone) {
  const description = task.attempts === null ? `${task.label}: no completed inputs were recorded.` : `${task.label}: ${pct(task.accuracy)}, ${task.correct} correct out of ${task.attempts} recorded attempts. ${task.detail}`;
  return `<div class="report-accuracy-row"><div class="report-chart-label"><span>${esc(task.label)}</span><strong>${pct(task.accuracy)}</strong></div><div class="report-chart-track ${task.accuracy === null ? 'is-missing' : ''}" tabindex="0" role="img" aria-label="${esc(description)}">${task.accuracy === null ? '<span class="report-chart-no-data">No attempts recorded</span>' : `<span class="report-chart-fill chart-tone-${tone}" style="--bar-value:${task.accuracy.toFixed(4)}%"></span>`}<span class="report-chart-tooltip" aria-hidden="true">${esc(description)}</span></div><small>${task.attempts === null ? 'Available after task input' : `${task.correct} correct / ${task.attempts} attempts`}</small></div>`;
}

function outcomeRow(task) {
  const description = task.attempts === null ? `${task.label}: no completed inputs recorded.` : `${task.label}: ${task.segments.map(segment => `${segment.count} ${segment.label.toLowerCase()}`).join(', ')} across ${task.attempts} attempts.`;
  return `<div class="report-outcome-row"><div class="report-chart-label"><span>${esc(task.label)}</span><small>${task.attempts === null ? 'N/A' : `${task.attempts} inputs`}</small></div><div class="report-outcome-stack ${task.attempts === null ? 'is-missing' : ''}" role="group" aria-label="${esc(description)}">${task.attempts === null ? '<span class="report-chart-no-data">No outcomes recorded</span>' : task.segments.filter(segment => segment.count > 0).map(segment => `<span class="report-outcome-segment chart-tone-${segment.tone}" style="--segment-value:${(segment.count / task.attempts * 100).toFixed(4)}%" tabindex="0" role="img" aria-label="${esc(`${task.label}: ${segment.count} ${segment.label.toLowerCase()} out of ${task.attempts} inputs`)}"><span class="report-chart-tooltip" aria-hidden="true">${esc(`${task.label} · ${segment.label}: ${segment.count} of ${task.attempts} inputs. ${task.detail}`)}</span></span>`).join('')}</div><div class="report-outcome-legend">${task.segments.map(segment => `<span><i class="chart-tone-${segment.tone}" aria-hidden="true"></i>${esc(segment.label)} <b>${segment.count}</b></span>`).join('')}</div></div>`;
}

function signalGauge(signal) {
  const available = signal.value !== null;
  const description = `${signal.label}: ${pct(signal.value)}. ${signal.detail}`;
  return `<div class="report-signal-gauge ${available ? '' : 'is-missing'}" tabindex="0" role="img" aria-label="${esc(description)}"><svg viewBox="0 0 100 100" aria-hidden="true"><circle class="report-gauge-track" cx="50" cy="50" r="40"/><circle class="report-gauge-value" cx="50" cy="50" r="40" pathLength="100" style="--gauge-offset:${available ? (100 - signal.value).toFixed(4) : 100}"/></svg><strong>${pct(signal.value)}</strong><span>${esc(signal.label)}</span><span class="report-chart-tooltip" aria-hidden="true">${esc(description)}</span></div>`;
}

export function reportChartsHTML(record) {
  const charts = buildReportCharts(record);
  const prefix = `report-chart-${String(record?.id || 'session').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60)}`;
  const { memory, attention, signal, hands, handScale } = charts;
  const taskRows = [memory, attention];
  const handValues = hands.some(hand => hand.value !== null);
  return `<section class="report-charts" aria-label="Session charts">
    <article class="report-chart-card" aria-labelledby="${prefix}-accuracy">${cardHeader(1, 'TASK ACCURACY', 'Two tasks. Two results.', 'Your recorded responses in this session, shown separately.', `${prefix}-accuracy`)}<div class="report-accuracy-chart">${accuracyRow(memory, 'cyan')}${accuracyRow(attention, 'orange')}<div class="report-chart-axis"><span>0%</span><span>50%</span><span>100%</span></div></div>${valuesTable(taskRows.map(task => [task.label, task.attempts === null ? 'N/A — no attempts recorded' : `${pct(task.accuracy)} · ${task.correct} / ${task.attempts} correct`]), 'Task accuracy from recorded attempts')}</article>
    <article class="report-chart-card" aria-labelledby="${prefix}-outcomes">${cardHeader(2, 'RESPONSE OUTCOMES', 'Every response, counted.', 'Counts describe task inputs; the two tasks have different rules.', `${prefix}-outcomes`)}<div class="report-outcome-chart">${outcomeRow(memory)}${outcomeRow(attention)}</div><p class="report-chart-footnote">Focus correct counts include withholding on WAIT. A false alarm is a response to WAIT; a miss is an unanswered GO.</p>${valuesTable([['Memory correct', number(memory.correct)], ['Memory errors', number(memory.errors)], ['Focus correct', number(attention.correct)], ['Focus errors', number(attention.errors)], ['Focus false alarms', number(attention.falseAlarms)], ['Focus missed GO cues', number(attention.misses)]], 'Recorded task outcome counts')}</article>
    <article class="report-chart-card" aria-labelledby="${prefix}-signal">${cardHeader(3, 'CAMERA SIGNAL', 'How much was visible.', 'Coverage is usable observation time, not a health score.', `${prefix}-signal`)}<div class="report-signal-chart">${signal.map(signalGauge).join('')}</div><p class="report-chart-footnote">Face: separate close-up check. Body: flight time. Full-body visibility is optional for portrait play.</p>${valuesTable(signal.map(item => [item.label, pct(item.value)]), 'Recorded camera coverage')}</article>
    <article class="report-chart-card" aria-labelledby="${prefix}-hands">${cardHeader(4, 'OBSERVED MOVEMENT', 'Your hands in motion.', 'Travel relative to shoulder width during usable flight samples.', `${prefix}-hands`)}<div class="report-hand-chart ${handValues ? '' : 'is-missing'}"><div class="report-hand-axis" aria-hidden="true"><span>${number(handScale)} sw</span><span>${number(handScale / 2, 1)}</span><span>0</span></div><div class="report-hand-columns">${hands.map(hand => `<div class="report-hand-column"><strong>${number(hand.value, 1)}</strong><div class="report-hand-bar-space" tabindex="0" role="img" aria-label="${esc(`${hand.label}: ${hand.value === null ? 'unavailable because usable calibrated hand evidence is insufficient' : `${number(hand.value, 1)} shoulder widths of travel`}`)}">${hand.value === null ? '<span class="report-hand-unavailable">N/A</span>' : `<span class="report-hand-bar chart-tone-${hand.tone}" style="--hand-value:${(hand.value / handScale * 100).toFixed(4)}%"></span>`}<span class="report-chart-tooltip" aria-hidden="true">${esc(`${hand.label}: ${hand.value === null ? 'needs enough calibrated body samples and a visible hand' : `${number(hand.value, 1)} shoulder widths of recorded travel`}. Intentional gameplay movement; this does not measure strength.`)}</span></div><span>${hand.label}</span></div>`).join('')}</div></div><p class="report-chart-footnote">${handValues ? 'sw = shoulder widths. Both hands share the same scale; no target or clinical reference is implied.' : 'N/A until the session has enough calibrated body evidence. Missing camera measurements are never shown as zero.'}</p>${valuesTable(hands.map(hand => [hand.label, hand.value === null ? 'N/A — insufficient camera evidence' : `${number(hand.value, 1)} shoulder widths`]), 'Quality-gated hand travel')}</article>
  </section>`;
}

let reportChartObserver;

/** Animate each chart once when it enters view, including charts below a review. */
export function activateReportCharts(container) {
  reportChartObserver?.disconnect();
  reportChartObserver = null;
  if (!container?.querySelectorAll) return;
  const charts = [...container.querySelectorAll('.report-chart-card, .trend-svg')];
  const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  const Observer = globalThis.IntersectionObserver;
  if (reducedMotion || !Observer) {
    charts.forEach(chart => chart.classList.add('chart-in-view'));
    return;
  }
  const pending = new Set(charts.filter(chart => !chart.classList.contains('chart-in-view')));
  if (!pending.size) return;
  const observer = new Observer(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('chart-in-view');
      pending.delete(entry.target);
      observer.unobserve(entry.target);
    }
    if (!pending.size) {
      observer.disconnect();
      if (reportChartObserver === observer) reportChartObserver = null;
    }
  }, { threshold:.08 });
  reportChartObserver = observer;
  pending.forEach(chart => observer.observe(chart));
}
