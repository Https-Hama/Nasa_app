import './style.css';
import './observation.css';
import './face-check.css';
import './health.css';
import './player-profiles.css';
import './mission-review.css';
import { requestMissionReview } from './mission-review-client.js';
import { missionReviewHTML } from './mission-review-ui.js';
import { activateReportCharts } from './report-charts.js';
import { createPlayerProfiles } from './player-profiles.js';
import { requirePlayerIdentity } from './player-onboarding.js';
import { TrackingRecovery } from './tracking-recovery.js';
import { readReports, storeReport, REPORTS_KEY } from './report-storage.js';
import { readFaceChecks, storeFaceCheck } from './face-check-storage.js';
import { createHealthDashboard } from './health-ui.js';
import { MissionAudio } from './mission-audio.js';
import { OrbitGame } from './game.js';
import { BodyController } from './body-controller.js';
import { MindCheck } from './cognitive.js';
import { icon } from './icons.js';
import { mountReactBits } from './react-bits.jsx';
import { sanitizeRecord,createDemoRecords,compareRecords } from './report-model.js';
import { reportHTML,esc } from './report-ui.js';
import { loadNasaReference } from './nasa-resources.js';

const $=id=>document.getElementById(id);
let players;
try {
  players = createPlayerProfiles(localStorage);
} catch {
  // Keep the app usable without silently falling back to another player's data.
  players = {
    profile: { name: 'Current visit' },
    records: {
      getItem: () => null,
      setItem() { throw new Error('Player storage unavailable'); },
      removeItem() { throw new Error('Player storage unavailable'); },
    },
  };
}
const playerStorage = players.records;
const safeGet = key => { try { return playerStorage.getItem(key); } catch { return null; } };
const safeSet = (key, value) => {
  try { playerStorage.setItem(key, value); return true; }
  catch { toast('Could not save on this device. Changes are available for this visit.'); return false; }
};
const safeDelete = key => { try { playerStorage.removeItem(key); return true; } catch { return false; } };
let reportStorageError = '';
function readSavedReports() {
  try { return readReports(playerStorage); }
  catch (error) { reportStorageError = error.message; return []; }
}
let saved = readSavedReports();
let faceChecks=[],pendingFaceChecks=[];
try { faceChecks=readFaceChecks(playerStorage); } catch(error) { reportStorageError ||= error.message; }
let settings={sound:true,saveReports:true,sensitivity:1,autoGemini:true};try{settings={...settings,...JSON.parse(safeGet('human-exe-preferences-v2')||'{}')};}catch{}
settings.saveReports = true;
settings.autoGemini = settings.autoGemini !== false;
const missionReviewStates=new Map(),pendingReviewSaves=new Map();
let reportGeneration=0;
let identityReady=false,sessionReportId=null,lastAutosave=0,trackingPausedFlight=false,trackingPausedMind=false;
let sessionReports=[],demoRecords=[],showDemo=false,currentView='flight',inputMode='keyboard',sessionMode='keyboard',modeChanged=false,stage='ready',cameraActive=false,cameraState='off',calibrated=false,fullBody=false,observationsEnabled=false,observationReady=false,faceCheckDone=false,faceCheckEnd=0,faceCheckStarted=0,latestObservation=null,snapshot=null,flightResult=null,pendingObservation=null,sessionTimestamp=0,mentalActive=false,mentalPaused=false,lastFire=false,lastShield=false,selectedReportId=null,previousReportId=null,lastReport=null;
const keys=new Set();
const FACE_CHECK_SECONDS = 30;
let observationRequest=0,faceCheckDurationSec=null;
const nasaReferencePromise=loadNasaReference();
const mind=new MindCheck();
const missionAudio=new MissionAudio();
const skeleton=`<svg class="body-skeleton" viewBox="0 0 200 240" fill="none" aria-hidden="true"><g stroke="currentColor" stroke-width="1.5"><circle cx="100" cy="40" r="14"/><path d="m79 69 21-6 21 6m-42 0-20 32-14 27m76-59 20 32 14 27M79 69l5 62h32l5-62M84 131l-7 44-5 44m44-88 7 44 5 44"/></g><g fill="currentColor">${[[79,69],[121,69],[59,101],[141,101],[45,128],[155,128],[84,131],[116,131],[77,175],[123,175],[72,219],[128,219]].map(([x,y])=>`<circle cx="${x}" cy="${y}" r="3"/>`).join('')}</g></svg>`;

$('app').innerHTML=`<aside class="sidebar"><a href="#" class="brand"><span class="brand-mark">H<span>·</span></span><span>HUMAN<span class="exe">.exe</span><small>THE HUMAN OBSERVATORY</small></span></a><div class="workspace-label"><i class="dot orange"></i> ODYSSEY / HUMAN SYSTEMS</div><nav aria-label="Main navigation">${[['flight','orbit','Flight deck'],['health','body','Mission health'],['journal','log','Health journal'],['science','spark','NASA basis'],['guide','book','Movement guide'],['settings','settings','Preferences']].map(([v,i,t])=>`<button class="nav-item ${v==='flight'?'active':''}" data-view="${v}" aria-label="${t}">${icon(i)}<span>${t}</span></button>`).join('')}</nav><div class="sidebar-bottom"><div class="orbit-symbol">${icon('body',45)}</div><p>One mission.<br><strong>The whole human.</strong></p><div class="sidebar-divider"></div><span class="version"><i class="dot cyan"></i> LOCAL VISION <b>V 2.0</b></span><small class="privacy-note">No video saved or uploaded.<br>Reports saved here.<br>Gemini reviews mission summaries.</small></div></aside>
<div class="shell"><header class="topbar"><div class="breadcrumb">HUMAN SYSTEMS <span>/</span><strong id="breadcrumb">FLIGHT DECK</strong></div><div class="topbar-right"><span class="system"><i class="dot cyan"></i> LOCAL VISION</span><button class="icon-button" id="sound-toggle" aria-label="Toggle sound">${icon('sound',18)}</button><button class="crew" id="player-menu" type="button" aria-haspopup="dialog"><span aria-hidden="true">${icon('body',16)}</span><span id="player-name">${esc(players.profile.name)}</span></button></div></header><main><div id="storage-warning" class="storage-warning" role="alert" hidden><span id="storage-warning-text"></span><button id="retry-save" type="button" class="outline-button">Retry saving</button></div>
<section id="flight-view"><div class="page-heading"><div><div class="eyebrow" id="react-tagline">THE HUMAN SIDE OF SPACE</div><h1>Stay sharp. Stay human<span>.</span></h1><p>One space mission. Hands or full-body control. A clearer picture over time.</p></div><div class="flight-heading-actions"><button class="outline-button" id="open-mission-health">${icon('body',16)} Daily check-in</button><button class="outline-button" id="demo-preview">${icon('spark',16)} Preview the report</button></div></div>
<div class="journey"><div data-step="check"><b>01</b><span>Face check<small>30 SEC · OPTIONAL</small></span></div><i></i><div data-step="flight"><b>02</b><span>Orbital defense<small>HANDS · LEGS OPTIONAL</small></span></div><i></i><div data-step="mind"><b>03</b><span>Mind check<small>MEMORY + FOCUS</small></span></div><i></i><div data-step="report"><b>04</b><span>Your observations<small>COMPARE OVER TIME</small></span></div></div>
<div class="dashboard"><div class="main-column"><div class="section-heading"><h2>Orbital defense</h2><span>ONE CONTINUOUS MISSION / 02:00</span></div>
<section class="flight-stage" id="flight-stage"><canvas id="game-canvas" tabindex="0" aria-label="Orbital defense. WASD steer, J fires, Space shield, Shift boost, C duck, P pause."></canvas><div class="stage-vignette"></div><div class="stage-grid"></div><div class="stage-top"><span class="stage-label"><i class="dot orange"></i> ODYSSEY DEFENSE <b>SECTOR 07</b></span><button class="stage-icon" id="fullscreen" aria-label="Full screen">${icon('expand',17)}</button></div><div class="stage-title" id="stage-title"><span>ONE PILOT. EVERY MOVEMENT COUNTS.</span><h2>DEFEND<br>YOUR ORBIT.</h2><p>Enemy drones are closing in.<br>Move with purpose. Protect the ship.</p></div>
<div class="live-hud" id="live-hud" hidden><div><span>TIME REMAINING</span><b id="hud-time">02:00</b></div><div><span>DRONES DOWN</span><b id="hud-kills">00</b></div><div><span>INTEGRITY</span><b id="hud-hull">100%</b></div><div><span>SHIELD</span><b id="hud-shield">100%</b></div></div><div class="aim-reticle">+<span>AIM WITH YOUR HANDS</span></div><div class="stage-bottom" id="idle-stage-bottom"><span>MOVE / FIRE / SHIELD / BOOST / DUCK</span><div class="stage-signal"><i></i><i></i><i></i><i></i><i></i></div></div>
<div class="game-objective" id="game-objective" hidden><span>DEFEND THE CORRIDOR</span><strong id="objective-text">Destroy enemy drones. Avoid debris.</strong><div class="mission-progress"><i id="mission-progress-fill"></i></div><small id="objective-detail"></small></div><div class="combat-action-badge" id="combat-action-badge" hidden></div>
<div class="pause-overlay" id="pause-overlay" hidden><span class="eyebrow">HOLDING POSITION</span><h2>Mission paused.</h2><p id="pause-reason">Resume whenever you are ready.</p><button class="primary-button" id="resume">Resume flight ${icon('play',17)}</button><button class="text-button" id="end-flight">Finish flight & continue</button></div></section>
<div class="launch-strip"><div><span class="eyebrow" id="launch-label">COMBAT → MEMORY → FOCUS → REPORT</span><h3 id="launch-title">Your hands are the controller.</h3><p id="launch-description">Play seated or standing with shoulders and hands in view. Show legs for extra moves.</p></div><div class="launch-actions"><span class="input-badge" id="input-badge">${icon('grid',13)} KEYBOARD MODE</span><div class="launch-wrapper"><button class="primary-button" id="launch"><span id="launch-react" aria-hidden="true"></span><span>Launch defense</span>${icon('arrow',18)}</button></div><button class="primary-button" id="pause-button" hidden>Pause flight ${icon('pause',17)}</button></div></div>
<div class="movement-cards"><article>${icon('target',20)}<strong>Left hand aims</strong><span>Move your left hand in any direction.</span></article><article>${icon('spark',20)}<strong>Extend to fire</strong><span>Extend the right arm at shoulder height.</span></article><article>${icon('shield',20)}<strong>Arms shield</strong><span>Raise both hands overhead.</span></article><article>${icon('body',20)}<strong>Legs evade</strong><span>Knee lift = boost. Squat & rise = duck.</span></article></div>
<div class="controls-strip"><span>${icon('grid',17)}<b>Keyboard fallback</b></span><div><kbd>WASD</kbd><span>aim</span><kbd>J</kbd><span>fire</span><kbd>SPACE</kbd><span>shield</span><kbd>SHIFT</kbd><span>boost</span><kbd>C</kbd><span>duck</span></div><button class="text-button" id="controls-help">All controls ${icon('arrow',13)}</button></div>
<section class="after-flight"><div class="after-art"></div><div><span class="eyebrow">THE MISSION CONTINUES INSIDE</span><h2>Test your recall.<br>Find your focus.</h2><p>After flight, repeat three growing patterns and respond to eight focus cues. Task results add context to the camera observations.</p><p class="auto-review-disclosure">After finishing, Gemini reviews your mission summary automatically. Names, video and check-in notes stay here. Manage this in Preferences.</p><span class="mini-pill">MEMORY PATTERNS</span> <span class="mini-pill">GO / NO-GO</span></div>${icon('memory',45)}</section>
<section class="science-strip"><span class="science-icon">${icon('orbit',30)}</span><div><span class="eyebrow">OFFICIAL NASA CHALLENGE RESOURCES</span><p>NASA Human Research Program resources explain the mission hazards, health risks, and research basis behind this observation tool.</p></div><button class="text-button" id="open-nasa-basis">See how they are used ${icon('arrow',13)}</button></section>
</div><aside class="right-rail"><section class="panel tracking-panel"><div class="panel-heading"><h2>Body & face link</h2><span class="mini-pill" id="camera-status-pill">OFFLINE</span></div><div id="tracking-preview-home"><div class="tracking-preview" id="tracking-preview"><div class="tracking-grid"></div><video id="camera-video" autoplay playsinline muted hidden></video><canvas id="pose-overlay" hidden></canvas><div id="camera-placeholder">${skeleton}<span>YOUR MOVEMENT. YOUR MISSION.</span></div><div class="camera-preview-status"><i class="dot"></i><span id="preview-status">AWAITING CONNECTION</span></div></div></div><div class="tracking-copy"><h3 id="tracking-title">Connect the human.</h3><p id="tracking-message">Camera controls are optional. Video is processed locally and never recorded.</p></div><button class="outline-button" id="enable-camera">${icon('camera',17)} Enable camera controls <span>↗</span></button><div class="camera-actions" id="camera-actions" hidden><button class="text-button" id="recalibrate">Recalibrate</button><button class="text-button" id="keyboard-mode">Use keyboard</button><button class="text-button" id="camera-off">Disconnect</button></div><div class="tracking-metrics"><div><span>BODY VIEW</span><b id="body-view">—</b></div><div><span>FRAME RATE</span><b id="tracking-fps">—</b></div><div><span>GESTURE</span><b id="gesture-label">—</b></div></div></section>
<section class="panel observation-panel"><div class="panel-heading"><h2>Human observatory</h2><span class="orange-icon">${icon('body',19)}</span></div><p>Go beyond the score.</p><label class="consent-check"><input type="checkbox" id="observation-consent"><span><strong>Enable face & body observations</strong><small>Separate from game controls. Saved mission summaries can be reviewed by Gemini.</small></span></label><button class="outline-button" id="face-check" disabled>${icon('camera',17)} Start 30-second face check</button><div class="live-observations"><div><span>FACE COVERAGE</span><b id="live-face-coverage">—</b></div><div><span>BODY COVERAGE</span><b id="live-body-coverage">—</b></div></div><p class="observation-note" id="observation-note">Stay close with your shoulders and hands visible for portrait play. The optional face check measures your face separately; legs are optional.</p><label class="consent-check save-consent"><input type="checkbox" id="save-reports" checked disabled><span><strong>Reports save automatically</strong><small>Compare today's sessions with a later day.</small></span></label><small class="wellness-boundary">Observations only. Not a medical diagnosis.</small></section>
<div class="session-counter"><span class="counter-orbit">${icon('log',29)}</span><div><strong id="session-total">${saved.length.toString().padStart(2,'0')}</strong><span>REPORTS SAVED LOCALLY</span></div><button id="open-journal" aria-label="Open health journal">${icon('arrow',18)}</button></div></aside></div></section>
<section id="health-view" class="secondary-view" hidden></section><section id="journal-view" class="secondary-view" hidden></section><section id="science-view" class="secondary-view" hidden></section><section id="guide-view" class="secondary-view" hidden></section><section id="settings-view" class="secondary-view" hidden></section><footer><span>HUMAN.exe <i>©</i> 2026 / V2</span><span>STAY CURIOUS. KEEP MOVING.</span><span><i class="dot cyan"></i> NASA-INFORMED LOCAL OBSERVATIONS</span></footer></main></div>
<dialog class="face-scan-dialog" id="face-scan-dialog" aria-labelledby="face-scan-title" aria-describedby="face-scan-instruction">
  <header class="face-scan-header">
    <h2 id="face-scan-title">Face check</h2>
    <div class="face-scan-count"><span id="face-check-time" role="timer" aria-label="Seconds remaining">30</span><span>sec left</span></div>
  </header>
  <div id="face-scan-preview"></div>
  <div class="face-scan-progress" aria-hidden="true"><i id="face-check-fill"></i></div>
  <p id="face-check-status" role="status">Finding a clear view of your face</p>
  <p id="face-scan-instruction">Look toward the camera in even light and keep your eyes naturally open.</p>
  <button class="outline-button" id="skip-check" type="button">Finish check early</button>
</dialog>
<dialog id="player-dialog" aria-labelledby="player-title"></dialog>
<dialog class="mind-dialog" id="mind-dialog"></dialog><dialog class="help-dialog" id="help-dialog"></dialog><div id="toast" role="status" aria-live="polite"></div>`;

$('open-nasa-basis').onclick=()=>changeView('science');
$('open-mission-health').onclick=()=>changeView('health');
const game=new OrbitGame({canvas:$('game-canvas'),onState:renderGame,onEvent:gameEvent});
const healthDashboard=createHealthDashboard({target:$('health-view'),storage:playerStorage,getPlayerName:()=>players.profile.name,getReports:allMeasured,getFaceChecks:()=>faceChecks,download:downloadJSON,openReport:id=>{showDemo=false;selectedReportId=id;previousReportId=null;changeView('journal');}});
const body=new BodyController({video:$('camera-video'),overlay:$('pose-overlay'),onInput:bodyInput,onStatus:bodyStatus,onMetrics:bodyMetrics,onObservation:observationUpdate});
const trackingRecovery = new TrackingRecovery({
  onInterrupt() {
    if (inputMode !== 'motion') return;
    trackingPausedFlight = snapshot?.status === 'running';
    trackingPausedMind = mentalActive && !mind.paused;
    if (trackingPausedFlight) pause('Camera tracking is recovering. Flight resumes automatically when your shoulders and hands return.', 'tracking');
    if (trackingPausedMind) pauseMind('Camera tracking is recovering. This check resumes automatically when you return.', 'tracking');
  },
  onRecover() {
    const flight = trackingPausedFlight, mental = trackingPausedMind;
    trackingPausedFlight = trackingPausedMind = false;
    if (document.hidden || currentView !== 'flight') return;
    if (flight && snapshot?.status === 'paused') resume();
    if (mental && mind.paused) resumeMind();
  },
});
mountReactBits();

function cancelTrackingRecovery() {
  trackingRecovery.cancel();
  trackingPausedFlight = trackingPausedMind = false;
}

function storageWarning(message = '') {
  const warning = $('storage-warning');
  warning.hidden = !message;
  $('storage-warning-text').textContent = message ? `Not saved: ${message} Keep this page open and retry saving or export your report.` : '';
}

function persistFaceChecks() {
  try {
    while (pendingFaceChecks.length) {
      const check=storeFaceCheck(playerStorage,pendingFaceChecks[0]);
      faceChecks=[check,...faceChecks.filter(previous=>previous.id!==check.id)];
      pendingFaceChecks.shift();
    }
    return true;
  } catch(error) { storageWarning(error.message); return false; }
}

function persistSession(final = false) {
  if (!identityReady || !sessionReportId || !['flight', 'mind'].includes(stage)) return false;
  const f = flightResult || snapshot;
  if (!(f?.stats?.elapsed > 0)) return false;
  const report = sanitizeRecord({
    id: sessionReportId, timestamp: sessionTimestamp, source: 'measured',
    protocol: 'orbital-observation-v2', inputMode: sessionMode, durationSec: f.stats.elapsed,
    conditions: {inputModeChanged: modeChanged, faceCheckProtocol: 'face-check-30s-v2', faceCheckDurationSec, sessionStage: final ? 'complete' : stage, geminiReviewRequested: final && settings.autoGemini},
    game: {score: f.score, hull: f.hull, kills: f.stats.enemiesDestroyed || 0, shots: f.stats.shotsFired || 0, accuracy: f.stats.shotsFired ? f.stats.shotsHit / f.stats.shotsFired * 100 : null},
    observations: pendingObservation || (observationsEnabled ? body.getObservationSummary() : {
      protocol: 'orbital-observation-v2', durationSec: 0,
      face: {validSeconds: 0, coverage: 0, meanFps: 0, baselineReady: false, qualityReasons: ['Face observations were not enabled for this mission.']},
      body: {validSeconds: 0, coverage: 0, fullBodyCoverage: 0, qualityReasons: ['Body observations were not enabled for this mission.']},
    }),
    cognitive: mind.snapshot().results,
  });
  if (!report) return false;
  lastReport = report;
  sessionReports = [report, ...sessionReports.filter(previous => previous.id !== report.id)];
  try {
    saved = storeReport(playerStorage, report);
    $('session-total').textContent = saved.length.toString().padStart(2, '0');
    if (!pendingFaceChecks.length && !pendingReviewSaves.size) storageWarning();
    return true;
  } catch (error) {
    storageWarning(error.message || 'Browser storage is unavailable.');
    return false;
  }
}

function toast(text){$('toast').textContent=text;$('toast').classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').classList.remove('visible'),4500);}
function beep(type='action'){missionAudio.setEnabled(settings.sound);if(settings.sound)missionAudio.play(type);}
function savePreferences(){safeSet('human-exe-preferences-v2',JSON.stringify(settings));}

function openPlayerProfiles() {
  if (active() || mentalActive || stage === 'face-check') {
    toast('Finish the current session before changing players.');
    return;
  }
  const dialog = $('player-dialog');
  let profiles;
  try {
    profiles = players.list?.();
  } catch {
    profiles = null;
  }
  dialog.innerHTML = `
    <header><h2 id="player-title">Player profiles</h2><button type="button" class="outline-button" id="close-player">Close</button></header>
    ${profiles ? `
      <p>HUMAN.exe remembers the last selected player in this browser. Anyone using this browser can switch profiles.</p>
      <form id="rename-player">
        <label for="current-player-name">Current player</label>
        <div class="player-form-row">
          <input id="current-player-name" name="name" maxlength="32" required value="${esc(players.profile.name)}">
          <button type="submit" class="outline-button">Save name</button>
        </div>
      </form>
      ${profiles.length > 1 ? `
        <form id="switch-player">
          <label for="switch-player-id">Switch to a saved player</label>
          <div class="player-form-row"><select id="switch-player-id" name="profile" required>
            ${profiles.filter(profile => profile.id !== players.profile.id).map(profile => `<option value="${esc(profile.id)}">${esc(profile.name)}</option>`).join('')}
          </select><button type="submit" class="outline-button">Switch player</button></div>
        </form>` : ''}
      <form id="add-player">
        <label for="new-player-name">New player name</label>
        <div class="player-form-row">
          <input id="new-player-name" name="name" maxlength="32" required>
          <button type="submit" class="primary-button">Add player</button>
        </div>
      </form>
      <p>Save your check-in before switching. The original Local player keeps any records saved before profiles were added.</p>
    ` : '<p>Player profiles could not be opened. Check whether this browser allows this site to store data.</p>'}
    <p id="player-feedback" role="status"></p>`;
  $('close-player').onclick = () => dialog.close();
  if (profiles) {
    const bind = (id, field, action) => {
      const form = $(id);
      if (!form) return;
      form.onsubmit = event => {
        event.preventDefault();
        try { action(new FormData(form).get(field)); }
        catch (error) { $('player-feedback').textContent = error instanceof DOMException ? 'Could not save this profile. Check browser storage.' : error.message; }
      };
    };
    bind('rename-player', 'name', name => {
      players.rename(name);
      $('current-player-name').value = players.profile.name;
      $('player-name').textContent = players.profile.name;
      const journalName = $('health-player-name');
      if (journalName) journalName.textContent = players.profile.name;
      $('player-feedback').textContent = 'Player name saved.';
    });
    // Reload after switching to clear the outgoing journal, report selection and camera session.
    bind('switch-player', 'profile', id => { players.select(id); location.reload(); });
    bind('add-player', 'name', name => { players.create(name); location.reload(); });
  }
  dialog.showModal();
}
function active(){return snapshot&&['running','paused'].includes(snapshot.status);}
function setStep(step){document.querySelectorAll('[data-step]').forEach(el=>el.classList.toggle('current',el.dataset.step===step));}
function setMode(mode){if((active()||mentalActive)&&inputMode!==mode)modeChanged=true;inputMode=mode;keys.clear();game.updateInput({x:0,y:0,fire:false,shield:false,relative:mode==='keyboard'});$('input-badge').innerHTML=`${icon(mode==='motion'?'body':'grid',13)} ${mode==='motion'?'BODY CONTROL':'KEYBOARD MODE'}`;}
function renderGame(s){snapshot=s;const live=['running','paused'].includes(s.status);$('stage-title').hidden=live||s.status==='complete';$('live-hud').hidden=!live;$('game-objective').hidden=!live;$('idle-stage-bottom').hidden=live;$('launch').hidden=live;$('pause-button').hidden=!live;$('pause-overlay').hidden=s.status!=='paused';$('pause-button').innerHTML=`${s.status==='paused'?'Resume flight':'Pause flight'} ${icon(s.status==='paused'?'play':'pause',17)}`;if(!live)return;const sec=Math.ceil(s.timeLeft||0);$('hud-time').textContent=`${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;$('hud-hull').textContent=`${s.hull}%`;$('hud-shield').textContent=`${s.shield}%`;$('hud-kills').textContent=String(s.stats?.enemiesDestroyed||0).padStart(2,'0');$('mission-progress-fill').style.width=`${Math.min(100,(s.progress||0)*100)}%`;$('objective-detail').textContent=`${s.score} energy points · J or extend right arm to fire · knee lift to boost`;$('combat-action-badge').hidden=!(s.boostRemaining>0||s.duckRemaining>0);$('combat-action-badge').textContent=s.boostRemaining>0?'BOOST ACTIVE':'EVASIVE DUCK';}
function pause(reason='Your ship is holding position.',source='manual'){if(source!=='tracking')cancelTrackingRecovery();if(snapshot?.status!=='running')return;persistSession();keys.clear();game.updateInput({x:0,y:0,shield:false,fire:false});$('pause-reason').textContent=reason;body.setObservationPhase('paused');game.pause();}
function resume(){if(inputMode==='motion'&&(!calibrated||cameraState!=='tracking')){toast('Restore tracking or select Use keyboard before resuming.');return;}if(cameraState==='tracking')trackingRecovery.observe('tracking',performance.now());game.resume();if(observationsEnabled)body.setObservationPhase('flight');$('game-canvas').focus({preventScroll:true});}
function launch(){if(!identityReady||active()||mentalActive||stage==='face-check')return;if(inputMode==='motion'&&(!calibrated||cameraState!=='tracking')){toast('Keep your shoulders and hands visible and hold a relaxed pose to calibrate. Legs are optional.');return;}if(!faceCheckDone){body.resetObservations();faceCheckDurationSec=null;}sessionTimestamp=Date.now();sessionReportId=crypto.randomUUID();lastAutosave=0;mind.reset();sessionMode=inputMode;modeChanged=false;flightResult=null;pendingObservation=null;lastFire=false;lastShield=false;stage='flight';setStep('flight');if(observationsEnabled)body.setObservationPhase('flight');game.start('asteroids',{duration:120,enemies:true});setMode(inputMode);$('game-canvas').focus({preventScroll:true});beep('launch');}
function gameEvent(event){if(event.type==='audio')beep(event.cue);if(event.type==='toast')toast(event.message);if(event.type==='complete'&&stage==='flight'){flightResult=event.result||snapshot;body.setObservationPhase('paused');pendingObservation=observationsEnabled?body.getObservationSummary():null;stage='mind';beep('transition');startMind();persistSession();}}
function bodyInput(input){
 if(inputMode!=='motion')return;
 if(mentalActive){if(!input.tracked)lastFire=false;if(input.tracked){const fire=!!(input.fire||input.shield);if(fire&&!lastFire){if(mind.stage==='attention')answerMind('respond',performance.now(),'motion');else{const {x,y}=input;if(Math.max(Math.abs(x||0),Math.abs(y||0))>.3)answerMind(Math.abs(x)>Math.abs(y)?x<0?'left':'right':y>0?'up':'down',performance.now(),'motion');}}lastFire=fire;}return;}
 if(!input.tracked){game.updateInput({x:0,y:0,fire:false,shield:false});return;}
 game.updateInput({x:Math.max(-1,Math.min(1,input.x*settings.sensitivity)),y:Math.max(-1,Math.min(1,input.y*settings.sensitivity)),fire:!!input.fire,shield:!!input.shield,relative:false});
 if(snapshot?.status==='running'){if(input.boost)game.action('boost');if(input.duck)game.action('duck');}
 lastShield=!!input.shield;
}
function bodyStatus(status){
 cameraState=status.state;
 trackingRecovery.observe(status.state,performance.now());
 const label={off:'OFFLINE',starting:'CONNECTING',ready:'READY',calibrating:'CALIBRATING',tracking:'CONNECTED',lost:'RECOVERING',error:'UNAVAILABLE','face-check':'FACE CHECK'};
 $('camera-status-pill').textContent=label[status.state]||status.state.toUpperCase();
 $('camera-status-pill').classList.toggle('connected',['tracking','face-check'].includes(status.state));
 $('preview-status').textContent=status.state==='off'?'AWAITING CONNECTION':status.state==='face-check'?'478-POINT FACE MESH · LOCAL':'LIVE LOCAL VISION';
 $('tracking-message').textContent=status.message;
 $('tracking-title').textContent=status.state==='tracking'?'You are the controller.':status.state==='face-check'?'Observing the visible.':status.state==='error'?'Camera link unavailable.':'Connect the human.';
 if(status.state==='error'){
  const wasRecovering=trackingPausedFlight, mindWasRecovering=trackingPausedMind;
  if(observationsEnabled)pendingObservation=body.getObservationSummary();
  cancelTrackingRecovery();observationRequest++;observationsEnabled=false;observationReady=false;
  $('observation-consent').checked=false;$('face-check').disabled=true;body.enableObservations(false);
  cameraActive=false;calibrated=false;fullBody=false;setMode('keyboard');
  $('camera-actions').hidden=true;$('enable-camera').hidden=false;$('enable-camera').disabled=false;
  $('camera-video').hidden=true;$('pose-overlay').hidden=true;$('camera-placeholder').hidden=false;
  if(stage==='face-check')finishFaceCheck();
  if(wasRecovering&&snapshot?.status==='paused'&&!document.hidden)resume();
  if(mindWasRecovering&&mind.paused&&!document.hidden)resumeMind();
  toast('Camera unavailable. Keyboard controls are ready: WASD, J to fire, Space to shield.');
 }
}
function bodyMetrics(m){calibrated=!!m.calibrated;fullBody=!!m.fullBody;$('body-view').textContent=m.fullBody?'FULL':m.confidence>0?'UPPER':'—';$('tracking-fps').textContent=m.fps?`${Math.round(m.fps)} FPS`:'—';$('gesture-label').textContent=(m.gesture||'—').slice(0,20);}
function observationUpdate(data){latestObservation=data.summary;observationReady=!!data.faceReady;if(data.error)toast(`Face observations unavailable: ${data.error}`);const f=data.summary?.face,b=data.summary?.body;$('live-face-coverage').textContent=f?.coverage>0?`${Math.round(f.coverage*100)}%`:'—';$('live-body-coverage').textContent=b?.coverage>0?`${Math.round(b.coverage*100)}%`:'—';if(stage==='face-check'){
    const guidance={'face-too-small':'Move closer until your face fills more of the preview.','low-light':'Face a steady light so your eyes are clearly visible.','no-face':'Look toward the camera with your whole face visible.','unstable-face-geometry':'Face the camera and hold a relaxed, steady position.','invalid-frame-size':'Waiting for a clear camera frame.'};
    const status = guidance[f?.currentQualityReason] || (f?.baselineReady ? 'Face calibrated. Keep relaxed.' : `Keep your eyes naturally open. Calibrating ${Math.round((f?.baselineProgress||0)*100)}%.`);
    if ($('face-check-status').textContent !== status) $('face-check-status').textContent = status;
  }}
async function enableCamera(){if(!identityReady)return false;pause('Setting up camera controls. Calibrate, then resume.');$('enable-camera').disabled=true;try{const ok=await body.start();if(!ok){setMode('keyboard');return false;}cameraActive=true;setMode('motion');$('enable-camera').hidden=true;$('camera-actions').hidden=false;$('camera-video').hidden=false;$('pose-overlay').hidden=false;$('camera-placeholder').hidden=true;return true;}finally{$('enable-camera').disabled=false;}}
async function enableObservations(enabled){
 const request=++observationRequest;
 pause('Observation settings changed. Resume when ready.');
 if(!enabled){if(stage==='face-check')finishFaceCheck();observationsEnabled=false;observationReady=false;faceCheckDone=false;faceCheckDurationSec=null;await body.enableObservations(false);body.resetObservations();$('face-check').disabled=true;return;}
 observationsEnabled=true;game.setScenePaused(true);$('face-check').disabled=true;
 try{if(!cameraActive&&!await enableCamera()){if(request===observationRequest){observationsEnabled=false;$('observation-consent').checked=false;}return;}
 if(request!==observationRequest||!observationsEnabled)return;
 const ok=await body.enableObservations(true);
 if(request!==observationRequest||!observationsEnabled)return;
 observationReady=ok;$('face-check').disabled=!ok;if(!ok)toast('Face model could not start. Camera controls remain available.');
 }catch(e){if(request===observationRequest)toast(e.message);}finally{if(request===observationRequest)game.setScenePaused(currentView!=='flight'||mentalActive||stage==='face-check');}
}
function moveCameraPreview(container) {
  const preview = $('tracking-preview');
  if (typeof container.moveBefore === 'function') container.moveBefore(preview, null);
  else container.append(preview);
}

function startFaceCheck() {
  if (!identityReady || stage === 'face-check') return;
  if (active() || mentalActive) {
    toast('Finish this mission before starting a new face check.');
    return;
  }
  if (!observationsEnabled || !observationReady) {
    toast('Enable observations first.');
    return;
  }
  body.resetObservations();
  faceCheckDone = false;
  stage = 'face-check';
  game.setScenePaused(true);
  setStep('check');

  $('face-check-time').textContent = FACE_CHECK_SECONDS;
  $('face-check-fill').style.width = '0%';
  $('face-check-status').textContent = 'Finding a clear view of your face';
  moveCameraPreview($('face-scan-preview'));
  $('face-scan-dialog').showModal();
  $('face-check').disabled = true;
  $('launch').disabled = true;

  body.setObservationPhase('face-check');
  faceCheckStarted = performance.now();
  faceCheckEnd = faceCheckStarted + FACE_CHECK_SECONDS * 1000;
}
function finishFaceCheck() {
  if (stage !== 'face-check') return;
  const elapsed = (performance.now() - faceCheckStarted) / 1000;
  faceCheckDurationSec = Math.min(FACE_CHECK_SECONDS, Math.max(0, elapsed));
  if (faceCheckDurationSec >= FACE_CHECK_SECONDS - .5) faceCheckDurationSec = FACE_CHECK_SECONDS;
  body.setObservationPhase('paused');
  const faceCheck={id:crypto.randomUUID(),timestamp:Date.now(),durationSec:faceCheckDurationSec,face:body.getObservationSummary().face};
  pendingFaceChecks.push(faceCheck);
  faceChecks=[faceCheck,...faceChecks];
  persistFaceChecks();
  faceCheckDone = true;
  stage = 'ready';
  game.setScenePaused(currentView !== 'flight');

  $('face-check').disabled = !observationReady;
  moveCameraPreview($('tracking-preview-home'));
  $('face-scan-dialog').close();
  $('launch').disabled = false;

  const usable=faceCheck.face.baselineReady&&faceCheck.face.validSeconds>=10&&faceCheck.face.coverage>=.5;
  $('observation-note').textContent = usable ? 'Face check ready for this mission. Stay close for portrait controls, or step back for optional leg moves. Recalibrate after moving.' : 'Face check needs a clearer view. You can still play with your shoulders and hands visible. Repeat the optional face check closer to the camera for measurements.';
  if (cameraActive) body.calibrate();
  setStep('flight');
  toast(usable ? 'Face check complete. Stay close for hand controls, recalibrate, then launch.' : 'You can play now. For face measurements, repeat the check closer to the camera in steady light.');
}
function disconnect(){if(observationsEnabled)pendingObservation=body.getObservationSummary();observationRequest++;pause('Camera disconnected. Keyboard control is ready.');if(stage==='face-check')finishFaceCheck();body.stop();cameraActive=false;observationsEnabled=false;observationReady=false;calibrated=false;fullBody=false;$('observation-consent').checked=false;$('face-check').disabled=true;setMode('keyboard');$('enable-camera').hidden=false;$('camera-actions').hidden=true;$('camera-video').hidden=true;$('pose-overlay').hidden=true;$('camera-placeholder').hidden=false;}

function startMind(){game.setScenePaused(true);mentalActive=true;mentalPaused=false;lastFire=false;setStep('mind');mind.start(performance.now());$('mind-dialog').innerHTML=`<div class="mind-header"><span class="eyebrow">POST-FLIGHT / HUMAN SYSTEMS</span><button class="text-button" id="skip-mind">Skip to report</button></div><div class="mind-layout"><div class="mind-intro"><span class="mini-pill" id="mind-task-label">01 / PATTERN MEMORY</span><h2 id="mind-title">Hold the pattern.<br>Then make it yours.</h2><p id="mind-instruction">Watch the illuminated directions. Repeat them when prompted.</p><div class="mind-progress-label" id="mind-progress-label">ROUND 1 OF 3</div><div class="mind-progress-dots" id="mind-progress-dots"></div><small>Camera results and task scores are separate observations. These are not clinical cognitive tests.</small></div><div class="mind-play"><div class="mind-pattern" id="mind-pattern">${[['left','←'],['up','↑'],['down','↓'],['right','→']].map(([d,a])=>`<button data-mind-direction="${d}" aria-label="${d}"><span>${a}</span><small>${d.toUpperCase()}</small></button>`).join('')}</div><div class="attention-cue" id="attention-cue" hidden><div id="cue-orb"></div><strong id="cue-word">WAIT FOR THE SIGNAL</strong><button class="primary-button" id="attention-response">Respond ${icon('spark',17)}</button></div><p id="mind-status">WATCH THE SEQUENCE</p><div class="mind-pause" id="mind-pause" hidden><strong>Mind check paused.</strong><p id="mind-pause-reason">Resume when ready.</p><button class="outline-button" id="resume-mind">Resume check</button><button class="text-button" id="mind-use-keyboard">Use keyboard & resume</button></div></div></div>`;$('mind-dialog').showModal();$('skip-mind').onclick=finishMind;document.querySelectorAll('[data-mind-direction]').forEach(e=>e.onclick=()=>answerMind(e.dataset.mindDirection,performance.now()));$('attention-response').onclick=()=>answerMind('respond',performance.now());$('resume-mind').onclick=resumeMind;$('mind-use-keyboard').onclick=()=>{setMode('keyboard');modeChanged=true;resumeMind();};}
function renderMind(now){if(!mentalActive)return;mind.tick(now);const s=mind.snapshot(now);if(s.stage==='complete'){finishMind();return;}const memory=s.stage==='memory';$('mind-pattern').hidden=!memory;$('attention-cue').hidden=memory;$('mind-task-label').textContent=memory?'01 / PATTERN MEMORY':'02 / FOCUS & RESPONSE';$('mind-title').innerHTML=memory?'Hold the pattern.<br>Then make it yours.':'Find the signal.<br>Let distractions pass.';$('mind-instruction').textContent=memory?'Watch the directions, then repeat them. Arrow keys or tap the tiles. With body control, aim then extend your arm.':'Respond to cyan GO cues. Let orange WAIT cues pass. Press Space, tap Respond, or extend your arm.';$('mind-progress-label').textContent=memory?`ROUND ${s.round+1} OF 3 · ${s.sequence.length} DIRECTIONS`:`FOCUS TRIAL ${Math.min(8,s.trial+1)} OF 8`;$('mind-progress-dots').innerHTML=Array.from({length:memory?3:8},(_,i)=>`<i class="${i<(memory?s.round:s.trial)?'done':''}"></i>`).join('');$('mind-status').textContent=memory?(s.phase==='showing'?'WATCH THE SEQUENCE':`YOUR TURN · ${s.memoryIndex} / ${s.sequence.length}`):s.phase==='stimulus'?(s.cue==='go'?'CYAN = RESPOND':'ORANGE = DO NOT RESPOND'):s.phase==='feedback'?'RESPONSE RECORDED':'WAIT FOR THE SIGNAL';document.querySelectorAll('[data-mind-direction]').forEach(e=>{e.classList.toggle('lit',memory&&s.sequence[s.showIndex]===e.dataset.mindDirection);e.disabled=s.phase!=='input'||s.paused;});if(!memory){$('cue-orb').className=s.phase==='stimulus'?s.cue:'';$('cue-word').textContent=s.phase==='stimulus'?(s.cue==='go'?'GO':'WAIT'):'· · ·';$('attention-response').disabled=s.phase!=='stimulus'||s.paused;}$('mind-pause').hidden=!s.paused;}
function pauseMind(reason,source='manual'){if(source!=='tracking')cancelTrackingRecovery();if(!mentalActive)return;mind.pause(performance.now());mentalPaused=true;lastFire=false;$('mind-pause-reason').textContent=reason||'The task is holding its place.';persistSession();}
function resumeMind(){if(inputMode==='motion'&&cameraState!=='tracking'){toast('Restore tracking or use the keyboard.');return;}if(cameraState==='tracking')trackingRecovery.observe('tracking',performance.now());mind.resume(performance.now());mentalPaused=false;}
function finishMind(){if(!mentalActive)return;persistSession(true);mentalActive=false;cancelTrackingRecovery();$('mind-dialog').close();if(!lastReport){toast('The report could not be finalized.');return;}stage='ready';faceCheckDone=false;setStep('report');game.preview('asteroids');showDemo=false;selectedReportId=lastReport.id;previousReportId=null;changeView('journal');beep('complete');}

function reviewState(record) {
  if (!settings.autoGemini && !record.geminiReview) return {status:'disabled'};
  return missionReviewStates.get(record.id);
}
function bindMissionReviewRetry() {
  document.querySelectorAll('[data-mission-review-retry]').forEach(button=>{
    button.onclick=()=>{
      const record=allMeasured().find(item=>item.id===button.dataset.missionReviewRetry);
      if(record)ensureMissionReview(record,true);
    };
  });
}
function refreshMissionReview(id) {
  if(currentView!=='journal'||showDemo||selectedReportId!==id)return;
  const record=allMeasured().find(item=>item.id===id);
  const panel=$('journal-view').querySelector('.mission-review');
  if(record&&panel){panel.outerHTML=missionReviewHTML({record,state:reviewState(record)});bindMissionReviewRetry();}
}
function mountMissionReview(record) {
  if(!record||record.source!=='measured')return;
  $('journal-view').querySelector('.report-overview')?.insertAdjacentHTML('afterend',missionReviewHTML({record,state:reviewState(record)}));
  bindMissionReviewRetry();
  if(settings.autoGemini&&record.conditions?.geminiReviewRequested)ensureMissionReview(record);
}
async function ensureMissionReview(record,force=false) {
  if(!identityReady||record.source!=='measured'||record.conditions?.sessionStage!=='complete')return;
  if(!force&&(!settings.autoGemini||record.geminiReview||missionReviewStates.has(record.id)))return;
  if(missionReviewStates.get(record.id)?.status==='pending')return;
  const generation=reportGeneration;
  missionReviewStates.set(record.id,{status:'pending'});
  refreshMissionReview(record.id);
  try {
    const previous=allMeasured().filter(item=>item.timestamp<record.timestamp).find(item=>compareRecords(record,item).comparable);
    const review=await requestMissionReview(record,previous);
    if(generation!==reportGeneration)return;
    const current=allMeasured().find(item=>item.id===record.id);
    if(!current)return;
    const updated=sanitizeRecord({...current,geminiReview:review});
    if(!updated?.geminiReview)throw Error('The generated review could not be saved with this report.');
    sessionReports=[updated,...sessionReports.filter(item=>item.id!==updated.id)];
    if(lastReport?.id===updated.id)lastReport=updated;
    pendingReviewSaves.set(updated.id,updated);
    try{saved=storeReport(playerStorage,updated);pendingReviewSaves.delete(updated.id);if(!pendingFaceChecks.length&&!pendingReviewSaves.size)storageWarning();}
    catch(error){storageWarning(error.message||'The Gemini review is available for this visit. Retry saving to keep it.');}
    missionReviewStates.set(record.id,{status:'ready',review:updated.geminiReview});
  } catch(error) {
    if(generation!==reportGeneration)return;
    missionReviewStates.set(record.id,{status:'error',error:error.message||'Gemini could not review this mission. Please retry.'});
  }
  refreshMissionReview(record.id);
}

function allMeasured(){return [...new Map([...saved,...sessionReports].map(r=>[r.id,r])).values()].sort((a,b)=>b.timestamp-a.timestamp);}
function changeView(view){if(!identityReady)return;pause('Mission paused while you review another panel.');currentView=view;if(view!=='health')healthDashboard.close();game.setScenePaused(view!=='flight'||mentalActive||stage==='face-check');['flight','health','journal','science','guide','settings'].forEach(v=>$(`${v}-view`).hidden=v!==view);document.querySelectorAll('[data-view]').forEach(e=>e.classList.toggle('active',e.dataset.view===view));$('breadcrumb').textContent=({flight:'FLIGHT DECK',health:'MISSION HEALTH',journal:'HEALTH JOURNAL',science:'NASA RESEARCH BASIS',guide:'MOVEMENT GUIDE',settings:'PREFERENCES'})[view];if(view==='health'){healthDashboard.open();window.scrollTo(0,0);}if(view==='journal'){renderJournal();window.scrollTo(0,0);}if(view==='science')renderScience();if(view==='guide')renderGuide();if(view==='settings')renderSettings();}
function renderJournal(){const records=showDemo?(demoRecords.length?demoRecords:demoRecords=createDemoRecords(Date.now())):allMeasured();const record=records.find(r=>r.id===selectedReportId)||records[0];if(record)selectedReportId=record.id;$('journal-view').innerHTML=`<div class="journal-controls"><div class="segmented"><button id="measured-tab" class="${!showDemo?'selected':''}">Your reports <span>${allMeasured().length}</span></button><button id="demo-tab" class="${showDemo?'selected':''}">Demo preview</button></div><div><select id="current-report" aria-label="Select report">${records.map(r=>`<option value="${esc(r.id)}" ${r.id===record?.id?'selected':''}>${new Date(r.timestamp).toLocaleString('en-GB',{timeZone:'Asia/Baghdad',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})} · ${r.source==='demo'?'DEMO':r.inputMode}</option>`).join('')}</select><button class="text-button" id="delete-reports">${icon('trash',14)} Delete saved reports</button></div></div>${record?reportHTML(record,records,previousReportId):`<div class="empty-state">${icon('body',55)}<h2>A clearer picture starts here.</h2><p>Enable observations, complete the face check and play a mission.<br>Save your reports to compare sessions across days.</p><button class="primary-button" id="empty-demo">Preview a sample report ${icon('arrow',17)}</button><p class="empty-demo-label">Sample records are clearly labeled fictional demo data.</p></div>`}`;mountMissionReview(record);activateReportCharts($('journal-view'));$('measured-tab').onclick=()=>{showDemo=false;selectedReportId=null;previousReportId=null;renderJournal();};$('demo-tab').onclick=previewDemo;$('empty-demo')?.addEventListener('click',previewDemo);$('current-report').onchange=e=>{selectedReportId=e.target.value;previousReportId=null;renderJournal();};$('compare-record')?.addEventListener('change',e=>{previousReportId=e.target.value;renderJournal();});$('export-report')?.addEventListener('click',()=>{const latest=record.source==='measured'?allMeasured().find(item=>item.id===record.id)||record:record;downloadJSON({application:'HUMAN.exe Human Observatory',player:players.profile.name,kind:latest.source==='demo'?'FICTIONAL DEMO DATA':'MEASURED OBSERVATIONS',record:latest},`HUMAN-exe-${latest.source}-report.json`);});$('delete-reports').onclick=()=>{if(!safeDelete(REPORTS_KEY)){toast('Could not delete saved reports. Check browser storage.');return;}reportGeneration++;missionReviewStates.clear();pendingReviewSaves.clear();lastReport=null;if(!pendingFaceChecks.length)storageWarning();saved=[];sessionReports=[];safeDelete('human-exe-history');$('session-total').textContent='00';selectedReportId=null;renderJournal();toast('Saved and in-memory measured reports deleted. Exported files remain separate copies.');};}
function previewDemo(){showDemo=true;demoRecords=createDemoRecords(Date.now());selectedReportId=demoRecords[0].id;previousReportId=null;changeView('journal');}
function downloadJSON(value,name){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function renderScience(){const target=$('science-view');target.innerHTML=`<div class="nasa-loading"><i class="dot cyan"></i> Loading the bundled NASA resource index…</div>`;const reference=await nasaReferencePromise;target.innerHTML=`<div class="nasa-hero"><div><div class="eyebrow">NASA HUMAN RESEARCH PROGRAM / PROJECT BASIS</div><h1>Research connected to every observation<span>.</span></h1><p>These are the official NASA resources listed for our Space Apps challenge. They explain why long missions need monitoring and how HUMAN.exe turns that need into an on-device observation workflow.</p></div><span class="nasa-mark">NASA<br><small>RESOURCE<br>BASIS</small></span></div><div class="nasa-method"><article><span>01</span><div><strong>Gather local indicators</strong><p>The camera describes visible face and body geometry. The mission records movement, memory, and attention-task results.</p></div></article><article><span>02</span><div><strong>Compare over time</strong><p>Reports keep each signal separate, check evidence quality, and compare only sessions with matching conditions.</p></div></article><article><span>03</span><div><strong>Keep a clear boundary</strong><p>NASA research supplies mission context—not diagnostic thresholds. HUMAN.exe does not diagnose health conditions or claim NASA validation.</p></div></article></div><div class="nasa-section-heading"><div><span class="eyebrow">THE THREE OFFICIAL CHALLENGE RESOURCES</span><h2>What we used, and where.</h2></div><span>${esc(reference.challenge)}</span></div><div class="nasa-source-grid">${reference.sources.map((source,index)=>`<article><div class="nasa-source-number">0${index+1}</div><span class="mini-pill">NASA.GOV</span><h3>${esc(source.title)}</h3><p>${esc(source.summary)}</p><div class="nasa-used-for"><strong>USED IN HUMAN.exe</strong><span>${esc(source.usedFor)}</span></div><a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">Open official NASA resource ${icon('arrow',14)}</a></article>`).join('')}</div><div class="nasa-boundary">${icon('shield',22)}<div><strong>Scientific and safety boundary</strong><p>The resources guide the project’s mission framing, observation categories, and explanations. Measurements come from the user’s local session. This prototype is not a medical device and is not endorsed or validated by NASA.</p></div></div>`;}
function renderGuide(){$('guide-view').innerHTML=`<div class="eyebrow">ONE MISSION / MANY WAYS TO MOVE</div><h1>Make every movement count<span>.</span></h1><p class="view-intro">Choose camera or keyboard controls. Observations are a separate, optional feature.</p><div class="guide-grid">${[['target','Aim & fire','Move your left hand left, right, up or down to aim the ship. Extend your right arm at shoulder height to fire continuously. Raise both arms overhead to shield; shielding takes priority over firing.','WASD / ARROWS = aim · J = fire · SPACE = shield','orbital-run'],['body','Knees & squats','Keep hips, knees and ankles in view. Lift and lower one knee for a short boost. Complete a squat-and-rise movement to trigger a brief evasive duck. Held poses cannot repeatedly create actions.','SHIFT = boost · C = duck · P = pause','zero-g-training'],['camera','A useful face check','Enable observations separately. Move closer for 30 seconds of relaxed, well-lit face sampling. Stay close for portrait play, or step back for leg moves. Recalibrate after changing position. A face that is too small, dark or poorly sampled is marked unavailable.','No video, images or raw landmarks are saved.','perfect-approach'],['memory','Memory & focus','After flight, repeat three random patterns of 3, 4 and 5 directions. Then respond to cyan GO cues and ignore orange WAIT cues. Practice, distraction, movement and input mode can affect these results.','ARROWS = memory input · SPACE = attention response','reactor-recall']].map(([i,t,p,k,a])=>`<article class="guide-card" style="--art:url('/art/${a}.png')"><span class="mission-icon">${icon(i,25)}</span><h2>${t}</h2><p>${p}</p><div class="guide-control">${k}</div></article>`).join('')}</div><div class="guide-footnote"><h3>What the report can tell you.</h3><p>It describes measured camera events and task performance, tracks changes in comparable sessions, and explains evidence quality. It does not infer medical conditions, emotions, heart rate, oxygen, bone density or muscle strength from your appearance. Next steps focus on repeat measurements, camera conditions and comfortable breaks. Persistent concerns belong with a qualified clinician.</p><p>In microgravity, actual astronaut exercise relies on prescribed resistance and aerobic equipment. This camera-controlled game cannot supply resistance or establish health benefits.</p><a href="https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker" target="_blank" rel="noopener noreferrer">MediaPipe face tracking documentation ↗</a><br><a href="https://www.nasa.gov/missions/station/iss-research/astronaut-exercise/" target="_blank" rel="noopener noreferrer">NASA astronaut exercise ↗</a></div>`;}
function renderSettings(){$('settings-view').innerHTML=`<div class="eyebrow">YOUR SPACE / YOUR CHOICES</div><h1>Human preferences<span>.</span></h1><p class="view-intro">Camera controls and observations are optional. Your results save automatically to your selected player.</p><div class="settings-list"><div class="setting-row"><div><h3>Mission audio</h3><p>Subtle action and completion sounds.</p></div><label class="switch"><input type="checkbox" id="setting-sound" aria-label="Mission audio" ${settings.sound?'checked':''}><span></span></label></div><div class="setting-row"><div><h3>Automatic local saving</h3><p>Mission progress and completed reports save to the selected player in this browser. Check-ins and preferences are also kept here. Use the same browser and address to return.</p></div><label class="switch"><input type="checkbox" id="setting-history" aria-label="Reports save automatically" checked disabled><span></span></label></div><div class="setting-row"><div><h3>Hand control sensitivity</h3><p>Adjust steering after neutral calibration.</p></div><div class="range-setting"><input type="range" min=".5" max="2" step=".1" value="${settings.sensitivity}" id="setting-sensitivity" aria-label="Hand control sensitivity"><output id="sensitivity-value">${Number(settings.sensitivity).toFixed(1)}×</output></div></div><div class="setting-row"><div><h3>Automatic Gemini mission reviews</h3><p>After a mission ends, send its derived camera observations, game scores and task results to Gemini for a written review. Names, video, images and check-in notes stay on this device. Reviews save with each report.</p></div><label class="switch"><input type="checkbox" id="setting-auto-gemini" aria-label="Automatic Gemini mission reviews" ${settings.autoGemini?'checked':''}><span></span></label></div><div class="setting-row"><div><h3>Camera and observations</h3><p>Use the Flight deck to enable controls, opt into observations or disconnect the camera.</p></div><button class="outline-button" id="settings-flight">Open flight deck ${icon('arrow',16)}</button></div></div><div class="guide-footnote"><h3>Measured data and demo data stay separate.</h3><p>The demo preview is always labeled and is never written into your measured journal. Comparisons require matching tasks, input mode, duration and enough usable camera evidence. Frame-rate and coverage checks are engineering checks, not clinical thresholds.</p></div>`;$('setting-auto-gemini').onchange=e=>{settings.autoGemini=e.target.checked;savePreferences();};$('setting-sound').onchange=e=>{settings.sound=e.target.checked;savePreferences();beep();};$('setting-history').onchange=e=>{settings.saveReports=e.target.checked;$('save-reports').checked=settings.saveReports;savePreferences();};$('setting-sensitivity').oninput=e=>{settings.sensitivity=Number(e.target.value);$('sensitivity-value').textContent=settings.sensitivity.toFixed(1)+'×';savePreferences();};$('settings-flight').onclick=()=>changeView('flight');}
function showHelp(){pause('Control guide open.');$('help-dialog').innerHTML=`<button class="dialog-close icon-button" aria-label="Close control guide">${icon('close')}</button><span class="eyebrow">HANDS / LEGS / MIND</span><h2>You are the controller.</h2><div class="help-columns"><div><h3>Camera</h3><p>Hold a relaxed neutral pose with shoulders and hands visible. Your hips and legs can stay outside the frame for portrait play. Move your left hand to aim. Extend your right arm at shoulder height to fire; both hands overhead shield. Lift-and-lower a knee to boost. Squat then stand to duck. Show your entire body for leg actions.</p><p>After flight, aim toward a memory direction and extend your arm to confirm. Extend your arm to respond to cyan attention cues.</p></div><div><h3>Keyboard</h3><ul><li>WASD / arrows: aim</li><li>J: hold to fire</li><li>Space: shield</li><li>Shift: boost · C: duck · P: pause</li><li>After flight: arrows enter patterns, Space responds to attention cues.</li></ul><p>Brief tracking gaps are tolerated. Sustained loss pauses temporarily and resumes automatically when you return. A hidden tab stays paused until you resume. Camera failure restores keyboard controls.</p></div></div><div class="guide-footnote"><p>Face observations are optional. For usable eye measurements, complete the separate close-up face check. You can stay close and play with your upper body and hands. These observations are not medical diagnoses.</p></div>`;$('help-dialog').showModal();$('help-dialog').querySelector('.dialog-close').onclick=()=>$('help-dialog').close();}

$('launch').onclick=launch;$('pause-button').onclick=()=>snapshot?.status==='paused'?resume():pause();$('resume').onclick=resume;$('end-flight').onclick=()=>game.end();$('enable-camera').onclick=enableCamera;$('camera-off').onclick=disconnect;$('keyboard-mode').onclick=()=>{pause('Keyboard controls selected. Resume when ready.');setMode('keyboard');};$('recalibrate').onclick=()=>{pause('Recalibrate your body, then resume.');body.calibrate();setMode('motion');};$('observation-consent').onchange=e=>enableObservations(e.target.checked);$('save-reports').onchange=e=>{settings.saveReports=e.target.checked;savePreferences();};$('face-check').onclick=startFaceCheck;$('skip-check').onclick=finishFaceCheck;$('demo-preview').onclick=previewDemo;$('open-journal').onclick=()=>changeView('journal');$('controls-help').onclick=showHelp;document.querySelector('.brand').onclick=e=>{e.preventDefault();changeView('flight');};document.querySelectorAll('[data-view]').forEach(e=>e.onclick=()=>changeView(e.dataset.view));$('sound-toggle').onclick=()=>{settings.sound=!settings.sound;savePreferences();$('sound-toggle').classList.toggle('sound-enabled',settings.sound);beep();};$('fullscreen').onclick=async()=>{try{document.fullscreenElement?await document.exitFullscreen():await $('flight-stage').requestFullscreen();}catch{toast('Full screen is unavailable.');}};
$('sound-toggle').classList.toggle('sound-enabled',settings.sound);
$('player-menu').onclick = openPlayerProfiles;
$('face-scan-dialog').addEventListener('cancel', event => {
  event.preventDefault();
  finishFaceCheck();
});
$('mind-dialog').addEventListener('cancel',e=>{e.preventDefault();pauseMind('Use Resume or Skip to report to leave this task.');});
$('game-canvas').addEventListener('keydown',e=>{const k=e.key.toLowerCase();if(!active()||e.repeat)return;if(['w','a','s','d','j','c','shift','p',' ','arrowup','arrowdown','arrowleft','arrowright'].includes(k))e.preventDefault();if(k==='p'){snapshot.status==='paused'?resume():pause();return;}if(snapshot.status!=='running'||inputMode!=='keyboard')return;keys.add(k);if(k==='shift')game.action('boost');if(k==='c')game.action('duck');updateKeys();});
function updateKeys(){if(!active()||inputMode!=='keyboard')return;game.updateInput({x:Number(keys.has('d')||keys.has('arrowright'))-Number(keys.has('a')||keys.has('arrowleft')),y:Number(keys.has('w')||keys.has('arrowup'))-Number(keys.has('s')||keys.has('arrowdown')),fire:keys.has('j'),shield:keys.has(' '),relative:true});}
window.addEventListener('keyup',e=>{keys.delete(e.key.toLowerCase());updateKeys();});$('game-canvas').addEventListener('blur',()=>{keys.clear();updateKeys();});
document.addEventListener('keydown',e=>{if(!mentalActive||e.repeat)return;const k=e.key.toLowerCase();if(k==='p'){e.preventDefault();mind.paused?resumeMind():pauseMind();return;}if(mind.paused)return;const dir={arrowleft:'left',a:'left',arrowup:'up',w:'up',arrowright:'right',d:'right',arrowdown:'down',s:'down'}[k];if(dir&&mind.stage==='memory'){e.preventDefault();answerMind(dir,performance.now());}if(k===' '&&mind.stage==='attention'){e.preventDefault();answerMind('respond',performance.now());}});
document.addEventListener('visibilitychange',()=>{if(document.hidden){persistSession();pause('Tab hidden. Resume when ready.');pauseMind('Tab hidden. Resume when ready.');if(stage==='face-check'){body.setObservationPhase('paused');faceCheckEnd=0;finishFaceCheck();}}});
window.addEventListener('pagehide',()=>persistSession());
function uiLoop(now) {
  trackingRecovery.tick(now);
  if(now-lastAutosave>=5000){lastAutosave=now;persistSession();}
  if (stage === 'face-check') {
    const remaining = Math.max(0, faceCheckEnd - now);
    const seconds = String(Math.ceil(remaining / 1000));
    const timer = $('face-check-time');
    if (timer.textContent !== seconds) timer.textContent = seconds;
    $('face-check-fill').style.width = `${100 * (1 - Math.min(1, remaining / (FACE_CHECK_SECONDS * 1000)))}%`;
    if (!remaining) finishFaceCheck();
  }
  renderMind(now);
  requestAnimationFrame(uiLoop);
}
requestAnimationFrame(uiLoop);
setStep('flight');
$('retry-save').onclick=()=>{try{if(!persistFaceChecks())return;for(const [id,report] of pendingReviewSaves){saved=storeReport(playerStorage,report);pendingReviewSaves.delete(id);}if(['flight','mind'].includes(stage)){if(!persistSession())throw Error('Saving did not complete.');}else if(lastReport){saved=storeReport(playerStorage,lastReport);$('session-total').textContent=saved.length.toString().padStart(2,'0');storageWarning();toast('Report saved on this device.');}else{readReports(playerStorage);storageWarning();}}catch(error){storageWarning(error.message);}};
if(reportStorageError)storageWarning(reportStorageError);
requirePlayerIdentity({players,dialog:$('player-dialog'),onReady:profile=>{identityReady=true;$('player-name').textContent=profile.name;},onSwitch:()=>location.reload()});

function answerMind(value,now=performance.now(),source='keyboard'){if(inputMode==='motion'&&source!=='motion')modeChanged=true;mind.answer(value,now);persistSession();}
