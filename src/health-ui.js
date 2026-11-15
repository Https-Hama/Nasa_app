import { requestGeminiSuggestions } from './gemini-client.js';
import { esc } from './report-ui.js';
import { journalDay, FIELDS, readCheckins, storeCheckin, reviewHealth, CHECKIN_KEY, NASA_SLEEP } from './health-journal.js';
import { reviewQuestions } from './review-questions.js';

const SERIES = { ...FIELDS, attention:['Attention accuracy','%'], memory:['Memory accuracy','%'], motion:['Upper-body sway','shoulder widths'] };
const dayNumber = day => Date.parse(day)/86400000;
const one = n => Number(n.toFixed(2));
const sourceLink = url => url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${url.includes('heart.org')?'AHA blood pressure guidance':'NASA research context'} ↗</a>` : '';

function chart(points, name, unit, day) {
  const start = dayNumber(day)-13;
  const recent = points.filter(p => dayNumber(p.day) >= start);
  const values = recent.filter(p => Number.isFinite(p.value));
  if (!values.length) return '<p class="health-empty">No usable readings in this 14-day window.</p>';
  const low = Math.min(...values.map(p=>p.value));
  const high = Math.max(...values.map(p=>p.value));
  const pad = (high-low)*.2 || .5;
  const min = low-pad, max = high+pad;
  const coordinates = p => [8 + (dayNumber(p.day)-start)*384/13, 12 + (max-p.value)*96/(max-min)].map(one);
  let previous;
  const path = values.map(p => {
    const cmd = previous && dayNumber(p.day)-dayNumber(previous.day) === 1 ? 'L' : 'M';
    previous = p;
    return cmd+coordinates(p).join(' ');
  }).join(' ');
  return `<figure class="health-chart"><figcaption>${esc(name)} · ${esc(unit)} <span>${values.length} days with readings</span></figcaption>
    <div class="health-chart-grid"><div aria-hidden="true"><span>${one(max)}</span><span>${one(min)}</span></div>
    <svg viewBox="0 0 400 120" preserveAspectRatio="none" role="img" aria-label="${esc(name + ': '+values.map(p=>p.day+' '+p.value+' '+unit).join('; '))}">
      <path d="M0 12H400 M0 60H400 M0 108H400" class="health-gridlines"/>
      <path d="${path}" class="health-line"/>
      ${values.map(p => {const [x,y]=coordinates(p);return `<line x1="${x}" x2="${x}" y1="${y}" y2="${y}" class="health-point"><title>${p.day}: ${p.value} ${esc(unit)}</title></line>`;}).join('')}
    </svg></div><div class="health-axis"><span>${new Date(start*86400000).toISOString().slice(5,10)}</span><span>${day.slice(5)}</span></div></figure>`;
}

export function createHealthDashboard({ target, storage, getPlayerName, getReports, getFaceChecks = () => [], download, openReport }) {
  let day = journalDay(), selectedMetric='sleep', aiSelections=null, aiMessage='', aiPending=false, opened = false;
  let saveMessage = '';
  let refreshQuestions = () => {};
  function render(draft = null) {
    const reports = getReports();
    let history = [], storageError = '';
    try { history = readCheckins(storage); } catch { storageError = 'The saved history could not be read. Check browser storage before making changes.'; }
    const { current, points, trends, alerts, latestReport } = reviewHealth(history,reports,day,day===journalDay());
    const urgent = alerts.some(a=>a.level==='urgent');
    const pending = Object.keys(FIELDS).filter(key => current?.[key] == null).length;
    const age = current && day === journalDay() ? 'Today’s check-in saved' : current ? 'Saved check-in' : 'No check-in for this date';
    target.innerHTML = `<header class="health-head"><div><div class="eyebrow">CREW HEALTH / DAILY CHECK-IN</div><h1>Mission health<span>.</span></h1><p>Journal for <strong id="health-player-name">${esc(getPlayerName())}</strong></p></div>
      <label class="health-date">Journal date<input id="health-day" type="date" value="${day}" max="${journalDay()}"></label></header>
    <div class="health-jump"><a href="#health-alerts">Warnings ${alerts.length ? ' · '+alerts.length : ''}</a><a href="#health-diagnosis">Diagnosis &amp; review</a><a href="#health-checkin">Check in</a></div>
    <section class="health-panel" id="health-alerts" aria-labelledby="health-alert-title"><h2 id="health-alert-title" tabindex="-1">Warnings &amp; next steps</h2>
      ${alerts.length ? alerts.map(a=>`<article class="health-warning ${a.level}" ${a.level==='urgent'?'role="alert"':''}><small>${a.level==='urgent'?'ACT NOW':a.level==='quality'?'RETAKE CHECK':'REPEATED CHANGE'}</small><h3>${esc(a.title)}</h3><p>${esc(a.evidence)}</p><p><strong>Next step:</strong> ${esc(a.action)}</p>${sourceLink(a.source)}</article>`).join('')
        : '<p>No repeat-change flags for this date. Missing readings and short histories cannot show a trend.</p>'}
      ${current && day!==journalDay() ? '<p>Past entries are for review. The urgent blood pressure message evaluates today’s entry only.</p>' : ''}
      ${!current && day===journalDay()?'<p><a href="#health-checkin">Log today’s readings</a> to start or continue your baseline.</p>':''}
      <details><summary>How a flag works</summary><p>Two comparable observations must move past the same prototype threshold versus the median of 3–7 earlier readings. NASA studies the effects of sleep and workload on attention, which is why the dashboard tracks those signals together. The very-high blood pressure message follows AHA guidance and uses the current reading.</p>${sourceLink(NASA_SLEEP)}</details>
    </section>
    <div class="health-columns">
      <section class="health-panel" id="health-checkin"><h2>Daily check-in</h2><p>${age}${current && pending ? ` · ${pending} reading fields blank` : ''}. Use readings from your own devices. All fields are optional.</p>
        <form id="health-form">
          <div class="health-fields">${Object.entries(FIELDS).map(([key,[label,unit,min,max,step]])=>`<label>${label} <small>${unit}</small>${key==='mood'
            ? `<select name="mood"><option value="">Not recorded</option>${['Very low','Low','Neutral','Good','Very good'].map((v,i)=>`<option value="${i+1}" ${current?.mood===i+1?'selected':''}>${i+1} · ${v}</option>`).join('')}</select>`
            : `<input name="${key}" type="number" min="${min}" max="${max}" step="${step}" inputmode="decimal" value="${esc(current?.[key])}">`}</label>`).join('')}</div>
          <button class="primary-button" type="submit" ${storageError?'disabled':''}>Save check-in</button>
        </form>
        <p class="health-feedback" id="health-feedback" role="status">${esc(storageError || saveMessage)}</p>
      </section>
      <section class="health-panel" aria-labelledby="health-trends-title"><h2 id="health-trends-title">Trends</h2><label for="health-metric">Choose a signal</label>
        <select id="health-metric"><optgroup label="Manual check-in">${Object.keys(FIELDS).map(key=>option(key)).join('')}</optgroup>
        <optgroup label="Comparable mission tasks">${['attention','memory','motion'].map(key=>option(key)).join('')}</optgroup></select>
        ${chart(points[selectedMetric],...SERIES[selectedMetric].slice(0,2),day)}
        <p>${trends[selectedMetric].baseline===null?'A baseline needs at least five readings.':`Earlier personal median: ${trends[selectedMetric].baseline} ${SERIES[selectedMetric][1]}`}</p>
        <details><summary>View recorded values</summary><ul class="health-values">${points[selectedMetric].filter(p=>Number.isFinite(p.value)).slice().reverse().map(p=>`<li>${p.day} <strong>${one(p.value)} ${SERIES[selectedMetric][1]}</strong></li>`).join('') || '<li>No readings</li>'}</ul></details>
      </section>
    </div>
    <section class="health-panel" aria-labelledby="health-mission-title"><h2 id="health-mission-title">Movement &amp; cognition on this date</h2>
      ${latestReport ? `<p>Latest measured mission · ${esc(latestReport.inputMode)} controls.</p><div class="health-metrics">${[['motion','Upper-body sway'],['memory','Pattern accuracy'],['attention','Attention accuracy']].map(([key,label])=>{ const value=points[key].find(p=>p.day===day)?.value;
        return `<div><span>${label} · latest usable</span><strong>${Number.isFinite(value)?one(value)+' '+SERIES[key][1]:'Unavailable'}</strong></div>`;}).join('')}</div><button type="button" class="outline-button" id="health-mission-report">Open mission report</button>`
        : '<p>No measured mission report on this date. Complete a mission and mind check to add data.</p>'}
    </section>
    <section class="health-panel" id="health-diagnosis"><h2>Diagnosis &amp; clinician review</h2>
      <p>Record a diagnosis a qualified clinician has confirmed. The app cannot confirm a diagnosis from game results or readings.</p>
      <label>Clinician-confirmed diagnosis <small>(optional)</small><input name="diagnosis" form="health-form" maxlength="300" value="${esc(current?.diagnosis)}"></label>
      <button type="submit" form="health-form" class="outline-button" ${storageError?'disabled':''}>Save diagnosis note</button>
      <div class="health-review"><h3>Questions to discuss with your clinician</h3><ul id="health-review-list"></ul>
        <p>Gemini can prioritize a generic question bank. Your readings, diagnosis notes and session results stay on this device.</p>
        <button type="button" id="health-ai" class="outline-button" ${urgent || aiPending?'disabled':''}>${aiPending?'Loading…':'Use Gemini suggestions'}</button>
        <p id="health-ai-status" role="status">${esc(urgent?'Address the warning above first.':aiMessage)}</p>
      </div>
    </section>
    <section class="health-panel"><h2>Local records</h2><p>${history.length} saved daily check-ins · ${reports.length} available measured reports · ${getFaceChecks().length} recorded face checks. Export a backup before clearing browser data.</p>
      <div class="health-jump"><button type="button" id="health-export" class="outline-button" ${storageError?'disabled':''}>Export health history</button>
      <button type="button" id="health-delete" class="outline-button" ${!current || storageError?'disabled':''}>Delete this check-in</button></div>
    </section>`;
    function option(key) { return `<option value="${key}" ${key===selectedMetric?'selected':''}>${SERIES[key][0]}</option>`; }
    const find = id => target.querySelector('#'+id);
    const renderQuestions = () => {
      find('health-review-list').innerHTML = urgent ? '<li>See the warning above.</li>' : reviewQuestions(alerts,aiSelections).map(q=>`<li>${esc(q)}</li>`).join('');
      find('health-ai').disabled = urgent || aiPending;
      find('health-ai').textContent = aiPending ? 'Loading…' : 'Use Gemini suggestions';
      find('health-ai-status').textContent = urgent ? 'Address the warning above first.' : aiMessage;
    };
    refreshQuestions = renderQuestions;
    renderQuestions();
    find('health-day').onchange = e => { if(e.target.value && e.target.value<=journalDay()) day=e.target.value; saveMessage=''; render(); find('health-day').focus(); };
    if (draft) for (const [key,value] of draft) find('health-form').elements.namedItem(key).value=value;
    find('health-metric').onchange = e => {
      selectedMetric=e.target.value;
      render(new FormData(find('health-form')));
      find('health-metric').focus();
    };
    find('health-form').onsubmit = e => {
      e.preventDefault();
      try {
        storeCheckin(storage,{ ...Object.fromEntries(new FormData(e.currentTarget)),day });
        saveMessage = 'Check-in saved on this device.';
        render();
        find('health-alert-title').focus();
      } catch(error) { find('health-feedback').textContent = error instanceof DOMException ? 'Could not save. Check your browser storage and try again.' : error.message; }
    };
    find('health-ai').onclick = async () => {
      aiPending=true; aiMessage=''; renderQuestions();
      try {
        aiSelections=await requestGeminiSuggestions();
        aiMessage='Gemini prioritized the questions above.';
      } catch(error) { aiMessage=error.message+' Local suggestions remain available.'; }
      finally {
        aiPending=false;
        if(opened) refreshQuestions();
      }
    };
    if (latestReport) find('health-mission-report').onclick=()=>openReport(latestReport.id);
    find('health-export').onclick=()=>download({ kind:'PRIVATE LOCAL HEALTH HISTORY', player:getPlayerName(), checkins:history, missionReports:reports, faceChecks:getFaceChecks() },'HUMAN-exe-health-history.json');
    find('health-delete').onclick=()=>{
      if (!confirm(`Delete the saved check-in and diagnosis note for ${day}?`)) return;
      try {
        const remaining=Object.fromEntries(readCheckins(storage).filter(e=>e.day!==day).map(e=>[e.day,e]));
        storage.setItem(CHECKIN_KEY,JSON.stringify(remaining));
        saveMessage='Check-in deleted.'; render();
      } catch { find('health-feedback').textContent='Unable to delete the check-in.'; }
    };
  }
  return { open(){opened=true;render();}, close(){opened=false;} };
}
