import { compareRecords, buildObservationNarrative } from './report-model.js';
import { icon } from './icons.js';
import { NASA_CHALLENGE_RESOURCES } from './nasa-resources.js';
export const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=(v,d=1)=>Number.isFinite(v)?Number(v).toFixed(d):'—';
const date=v=>new Date(v).toLocaleString('en-GB',{timeZone:'Asia/Baghdad',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
const qualityText=reasons=>(reasons||[]).map(reason=>({
 'low-light':'Lighting was too dark.',
 'invalid-frame-size':'Camera frames were unavailable.',
 'no-face':'The face was not clearly visible.',
 'face-too-small':'Move closer for a larger face view.',
 'unstable-face-geometry':'Face positioning was unsuitable for reliable sampling.',
 'body-not-tracked':'The body was not clearly visible.',
 'body-not-calibrated':'Body calibration was incomplete.',
 'body-too-small':'Adjust the camera for a clearer body view.',
 'face-sampling-gap':'Face sampling was interrupted.',
 'partial-body':'Portrait controls and hand observations are available. Leg measurements need hips, knees and ankles in view.',
 'wrists-not-visible':'Hands were not consistently visible.',
 'body-sampling-gap':'Body sampling was interrupted.',
 'no-valid-face-samples':'No usable face samples were captured.',
 'open-eye-baseline-incomplete':'The open-eye calibration was incomplete.',
 'low-face-fps':'The camera sampling rate was too low for eye-event measurements.',
 'insufficient-eye-observation':'More usable eye-observation time is needed.',
 'low-face-coverage':'Too little of the face check was usable.',
 'no-valid-body-samples':'No usable body samples were captured.',
 'low-body-coverage':'Too little of the flight had usable body tracking.',
 }[reason]||reason)).join(' ');

function delta(metric){if(!metric?.comparable)return '<span class="delta unavailable">Not comparable</span>';return `<span class="delta ${Math.abs(metric.delta)<.01?'stable':'changed'}">${metric.delta>0?'+':''}${num(metric.delta,metric.unit==='count'?0:1)} ${esc(metric.unit||'')} <span>vs previous</span></span>`;}
function row(label,value,unit,metric,note=''){return `<div class="report-metric"><div><strong>${esc(label)}</strong>${note?`<small>${esc(note)}</small>`:''}</div><div><b>${num(value,unit==='events'||unit==='reps'?0:1)} <em>${esc(unit)}</em></b>${delta(metric)}</div></div>`;}
function trend(records,key,path,label,color='#7acfc5'){
 const points=records.filter(r=>r.source===records[0]?.source).slice().sort((a,b)=>a.timestamp-b.timestamp).map(r=>({time:r.timestamp,value:path.reduce((a,k)=>a?.[k],r)})).filter(p=>Number.isFinite(p.value));
 if(points.length<2)return `<div class="chart-empty">${icon('orbit',30)}<span>Complete two comparable sessions to see a trend.</span></div>`;
 const min=Math.min(...points.map(p=>p.value)),max=Math.max(...points.map(p=>p.value)),range=Math.max(1,max-min),x=i=>30+i*(540/(points.length-1)),y=v=>111-(v-min)/range*75;
 return `<svg class="trend-svg" viewBox="0 0 600 160" role="img" aria-label="${esc(label)} trend"><defs><linearGradient id="fill-${key}" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${color}" stop-opacity=".2"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><path d="M30 40h540M30 80h540M30 120h540" stroke="#343e47" stroke-dasharray="3 5"/><path d="M${points.map((p,i)=>`${x(i)},${y(p.value)}`).join(' L')} L570 120 L30 120Z" fill="url(#fill-${key})"/><path d="M${points.map((p,i)=>`${x(i)},${y(p.value)}`).join(' L')}" fill="none" stroke="${color}" stroke-width="2"/>${points.map((p,i)=>`<circle cx="${x(i)}" cy="${y(p.value)}" r="4" fill="${color}"/><text x="${x(i)}" y="${y(p.value)-12}" fill="#dce7e7" text-anchor="middle" font-size="10">${num(p.value,1)}</text>`).join('')}<text x="30" y="149" fill="#87929d" font-size="9">${date(points[0].time)}</text><text x="570" y="149" fill="#87929d" text-anchor="end" font-size="9">${date(points.at(-1).time)}</text></svg>`;
}

export function reportHTML(record,records,previousId){
 const prior=records.filter(r=>r.id!==record.id&&r.timestamp<record.timestamp).sort((a,b)=>b.timestamp-a.timestamp);
 const previous=prior.find(r=>r.id===previousId)||prior.find(r=>compareRecords(record,r).comparable)||prior[0]||null;
 const comp=compareRecords(record,previous),narrative=buildObservationNarrative(record,comp),o=record.observations||{},f={...(o.face||{})},b={...(o.body||{})},c=record.cognitive||{},demo=record.source==='demo';
 // Publish only measurements that pass their own sampling gate, even when
 // there is no earlier record. A missing comparison must never invent zero.
 for(const [key,metric] of Object.entries(comp.face?.metrics||{}))f[key]=metric.current;
 for(const [key,metric] of Object.entries(comp.body?.metrics||{}))if(key!=='fullBodyCoverage')b[key]=metric.current;
 const compatible=records.filter(r=>r.id===record.id||compareRecords(record,r).comparable);
 const faceTrend=compatible.filter(r=>r.id===record.id||compareRecords(record,r).face?.metrics?.eyeClosurePct?.comparable).map(r=>({...r,observations:{...r.observations,face:{...r.observations?.face,eyeClosurePct:compareRecords(r,null).face?.metrics?.eyeClosurePct?.current??null}}}));
 const bodyTrend=compatible.filter(r=>r.id===record.id||compareRecords(record,r).body?.metrics?.meanTorsoSway?.comparable).map(r=>({...r,observations:{...r.observations,body:{...r.observations?.body,meanTorsoSway:compareRecords(r,null).body?.metrics?.meanTorsoSway?.current??null}}}));
 return `${demo?`<div class="demo-banner">${icon('spark',20)}<div><strong>ILLUSTRATIVE DEMO · FICTIONAL RECORDS</strong><span>These numbers demonstrate the interface. They were not measured from a person and are never mixed with your reports.</span></div></div>`:''}
 <div class="report-heading"><div><div class="eyebrow">${demo?'DEMO PREVIEW':'LOCAL OBSERVATION REPORT'} / ${date(record.timestamp)}</div><h1>Your session, understood<span>.</span></h1><p>Face, body and mind. Observed separately, explained together.</p></div><button class="outline-button" id="export-report">${icon('download',17)} Export report</button></div>
 ${record.conditions?.sessionStage !== 'complete' ? `<div class="report-progress-note" role="status">Saved progress · ${record.conditions?.sessionStage === 'flight' ? 'Flight was still in progress.' : 'Mind check was still in progress.'} Your recorded results are kept here; unfinished tasks are not compared as completed checks.</div>` : ''}
 <div class="report-disclaimer">${icon('shield',17)} <span>Camera observations and task results. Not a medical diagnosis or a measure of your overall health.</span></div>
 <div class="report-nasa-basis"><div>${icon('orbit',20)}<span><strong>NASA research basis</strong><small>Official challenge resources guide the mission context and observation categories—not diagnostic thresholds.</small></span></div><nav aria-label="NASA research sources">${NASA_CHALLENGE_RESOURCES.map(source=>`<a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.title)} ${icon('arrow',11)}</a>`).join('')}</nav></div>
 <div class="compare-toolbar"><div><span class="eyebrow">COMPARE WITH</span><select id="compare-record" aria-label="Compare with an earlier session"><option value="">${prior.length?'Most recent earlier session':'No earlier session available'}</option>${prior.map(p=>`<option value="${esc(p.id)}" ${p.id===previous?.id?'selected':''}>${date(p.timestamp)} · ${p.inputMode}</option>`).join('')}</select></div><div class="comparison-status"><i class="dot ${comp.comparable?'cyan':'orange'}"></i> ${esc(previous?comp.previousLabel:'First session')}<small>${esc(comp.reason||'Each metric has its own evidence-quality check.')}</small></div></div>
 <div class="report-overview"><article><span>FACE CHECK COVERAGE</span><b>${num((f.coverage||0)*100,0)}<em>%</em></b><small>${num(f.validSeconds,1)} usable seconds · ${num(f.meanFps,1)} FPS</small></article><article><span>BODY OBSERVATION COVERAGE</span><b>${num((b.coverage||0)*100,0)}<em>%</em></b><small>${num((b.fullBodyCoverage||0)*100,0)}% full-body visibility</small></article><article><span>MEMORY PATTERN ACCURACY</span><b>${num(c.memory?.accuracy,0)}<em>%</em></b><small>${c.memory?.correct??0} correct signals / ${c.memory?.attempts??0} attempts</small></article></div>
 <div class="report-summary"><span class="eyebrow">WHAT WAS OBSERVED</span><h2>${esc(narrative.headline)}</h2>${(narrative.observations||[]).map(v=>`<p><strong>${esc(v.title)}</strong> ${esc(v.detail)}</p>`).join('')}</div>
 <div class="report-grid"><section class="report-panel"><div class="panel-heading"><h2>${icon('camera',19)} Face observations</h2><span class="mini-pill">${f.baselineReady?'CALIBRATED':'LIMITED SIGNAL'}</span></div><p class="report-context">From the standardized close-up check. Mouth openings are observable geometry, not a diagnosis of yawning or fatigue.</p>
 ${row('Approximate blink activity',f.blinkRate,'/ min',comp.face?.metrics?.blinkRate,'Requires enough calibrated, well-sampled video')}
 ${row('Eyes closed during valid samples',f.eyeClosurePct,'%',comp.face?.metrics?.eyeClosurePct)}
 ${row('Long eye-closure events',f.longClosureCount,'events',comp.face?.metrics?.longClosureCount,'Camera event longer than one second')}
 ${row('Longest observed closure',f.longestClosureSec,'sec',comp.face?.metrics?.longestClosureSec)}
 ${row('Mouth-opening events',f.mouthOpenEvents,'events',comp.face?.metrics?.mouthOpenEvents)}
 ${row('Head tilt range',f.headRollRangeDeg,'deg',comp.face?.metrics?.headRollRangeDeg)}
 <div class="quality-note">${esc(qualityText(f.qualityReasons)||'Use similar lighting, distance and camera position when comparing sessions.')}</div></section>
 <section class="report-panel"><div class="panel-heading"><h2>${icon('body',19)} Body observations</h2><span class="mini-pill">GAMEPLAY MOVEMENTS</span></div><p class="report-context">Movement is intentional during this game. Differences can reflect play style, framing and practice.</p>
 ${row('Left hand travel',b.leftHandTravel,'shoulder widths',comp.body?.metrics?.leftHandTravel,'Movement relative to the shoulders')}
 ${row('Right hand travel',b.rightHandTravel,'shoulder widths',comp.body?.metrics?.rightHandTravel)}
 ${row('Completed knee lifts',b.kneeLifts,'reps',comp.body?.metrics?.kneeLifts)}
 ${row('Completed squats',b.squats,'reps',comp.body?.metrics?.squats)}
 ${row('Shield activations',b.shields,'events',comp.body?.metrics?.shields)}
 ${row('Upper-body sway',b.meanTorsoSway,'shoulder widths',comp.body?.metrics?.meanTorsoSway,'Movement from the session starting position')}
 <div class="quality-note">${esc(qualityText(b.qualityReasons)||'Camera motion is not a measurement of strength, bone density or movement impairment.')}</div></section></div>
 <section class="report-panel mind-report"><div class="panel-heading"><h2>${icon('memory',19)} Mind check</h2><span class="mini-pill">TASK RESULTS</span></div><div class="mind-report-grid"><div><b>${num(c.memory?.accuracy,0)}<em>%</em></b><span>Pattern accuracy</span><small>${c.memory?.rounds??0} / 3 rounds completed</small></div><div><b>${num(c.attention?.medianReactionMs,0)}<em>ms</em></b><span>Median go-cue response</span>${delta(comp.cognitive?.metrics?.medianReactionMs)}</div><div><b>${c.attention?.falseAlarms??'—'}</b><span>Distractor responses</span><small>Orange cues that received a response</small></div><div><b>${c.attention?.misses??'—'}</b><span>Missed go cues</span><small>These tasks are not clinical cognitive tests.</small></div></div></section>
 <div class="report-grid"><section class="report-panel"><div class="panel-heading"><h2>Eye closure over sessions</h2><span class="chart-legend"><i class="dot cyan"></i> % OF VALID TIME</span></div>${trend(faceTrend,'closure',['observations','face','eyeClosurePct'],'Eye closure')}</section><section class="report-panel"><div class="panel-heading"><h2>Upper-body sway over sessions</h2><span class="chart-legend"><i class="dot orange"></i> BODY UNITS</span></div>${trend(bodyTrend,'sway',['observations','body','meanTorsoSway'],'Torso movement','#ffa177')}</section></div>
 <div class="report-grid"><section class="next-steps"><span class="eyebrow">WHAT YOU CAN DO NEXT</span><h2>A useful next step.</h2>${(narrative.nextSteps||[]).map((v,i)=>`<div><span>0${i+1}</span><p>${esc(typeof v==='string'?v:v.detail||v.title)}</p></div>`).join('')}</section><section class="report-panel limitations"><h2>Read the context.</h2><ul>${(narrative.limitations||[]).map(v=>`<li>${esc(v)}</li>`).join('')}</ul><p>For a medical diagnosis, a qualified clinician needs appropriate history, examination and validated tests.</p><div class="game-result-inline"><span>COMBAT RESULT</span><b>${record.game?.score??0} points · ${record.game?.kills??0} drones</b><small>Game score is separate from camera observations.</small></div></section></div>`;
}
