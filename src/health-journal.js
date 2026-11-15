import { compareRecords } from './report-model.js';

export const CHECKIN_KEY = 'human-exe-checkins-v1';
export const NASA_SLEEP = 'https://humanresearchroadmap.nasa.gov/risks/risk.aspx?i=100';
export const NASA_RISKS = 'https://www.nasa.gov/hrp/risks/';
export const BP_GUIDE = 'https://www.heart.org/en/health-topics/high-blood-pressure/understanding-blood-pressure-readings/monitoring-your-blood-pressure-at-home';
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone:'Asia/Baghdad', year:'numeric', month:'2-digit', day:'2-digit',
});
export const FIELDS = {
  pulse: ['Resting heart rate', 'bpm', 1, 300, 1],
  temperature: ['Temperature', '°C', 25, 50, .1],
  sleep: ['Sleep last night', 'hours', 0, 24, .1],
  mood: ['Mood', '/ 5', 1, 5, 1],
  systolic: ['Systolic pressure', 'mmHg', 1, 350, 1],
  diastolic: ['Diastolic pressure', 'mmHg', 1, 300, 1],
};

export function journalDay(timestamp = Date.now()) {
  const parts = Object.fromEntries(dateFormatter.formatToParts(timestamp).map(part=>[part.type,part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function validateCheckin(input) {
  const day = input?.day;
  if (typeof day !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(day)
      || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0,10) !== day || day > journalDay()) {
    throw new Error('Choose today or an earlier valid date.');
  }
  const result = { day };
  for (const [key, [label,, min, max, step]] of Object.entries(FIELDS)) {
    const raw = input[key];
    if (raw == null || (typeof raw === 'string' && !raw.trim())) { result[key] = null; continue; }
    const value = typeof raw === 'number' || typeof raw === 'string' ? Number(raw) : NaN;
    if (!Number.isFinite(value) || value < min || value > max || Math.abs(value/step - Math.round(value/step)) > 1e-6) {
      throw new Error(`Check the ${label.toLowerCase()} entry and its units.`);
    }
    result[key] = value;
  }
  if ((result.systolic === null) !== (result.diastolic === null)) throw new Error('Enter both blood pressure numbers or leave both blank.');
  if (result.systolic !== null && result.systolic <= result.diastolic) throw new Error('Systolic pressure should be greater than diastolic pressure. Check the entry.');
  result.diagnosis = typeof input.diagnosis === 'string' ? input.diagnosis.trim().slice(0,300) : '';
  if (Object.keys(FIELDS).every(key => result[key] === null) && !result.diagnosis) throw new Error('Enter at least one reading or a clinician-confirmed diagnosis.');
  result.updatedAt = Number.isFinite(input.updatedAt) ? input.updatedAt : Date.now();
  return result;
}

export function readCheckins(storage) {
  const data = JSON.parse(storage.getItem(CHECKIN_KEY) ?? '{}');
  if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error('The saved check-in history cannot be opened.');
  return Object.values(data).map(validateCheckin).sort((a,b) => a.day.localeCompare(b.day));
}

export function storeCheckin(storage, input) {
  const item = validateCheckin(input);
  const history = readCheckins(storage).filter(entry => entry.day !== item.day).concat(item);
  storage.setItem(CHECKIN_KEY, JSON.stringify(Object.fromEntries(history.map(entry => [entry.day,entry]))));
  return item;
}

const median = values => {
  const v = [...values].sort((a,b) => a-b);
  return (v[Math.floor((v.length-1)/2)] + v[Math.floor(v.length/2)])/2;
};
const delta = (a,b) => Math.round((a-b)*10)/10;
export function personalTrend(points, threshold, direction = 'either') {
  const valid = points.filter(p => Number.isFinite(p.value));
  const [current,previous] = valid.slice(-2).reverse();
  const prior = valid.slice(0,-2).slice(-7);
  const baseline = prior.length >= 3 ? median(prior.map(p => p.value)) : null;
  const change = baseline === null ? null : delta(current.value,baseline);
  const side = amount => Math.abs(amount) < threshold ? 0 : Math.sign(amount);
  const repeated = change !== null && side(change) !== 0
    && (direction !== 'lower' || change < 0) && side(change) === side(delta(previous.value,baseline));
  return { current, baseline, change, repeated };
}

export function reportTrends(reports, day) {
  const ordered = reports.filter(r => r.source === 'measured' && !r.conditions?.inputModeChanged && journalDay(r.timestamp) <= day)
    .sort((a,b) => b.timestamp-a.timestamp);
  const result = {};
  for (const [id,group,key] of [['attention','cognitive','attentionAccuracy'],['memory','cognitive','memoryAccuracy'],['motion','body','meanTorsoSway']]) {
    const metric = (r,p) => compareRecords(r,p)[group]?.metrics?.[key];
    const reference = ordered.find(r => Number.isFinite(metric(r,null)?.current));
    const days = new Map();
    for (const r of ordered) {
      const date = journalDay(r.timestamp);
      if (!days.has(date) && reference && (r === reference || metric(reference,r)?.comparable)) {
        const value = metric(r,null)?.current;
        if (Number.isFinite(value)) days.set(date,{ day:date,value });
      }
    }
    result[id] = [...days.values()].reverse();
  }
  return result;
}

export function reviewHealth(entries, reports, day, showUrgent = true) {
  const current = entries.find(e => e.day === day);
  const points = Object.fromEntries(Object.keys(FIELDS).map(key => [key,
    entries.filter(e => e.day <= day).map(e => ({day:e.day,value:e[key]}))]));
  Object.assign(points,reportTrends(reports,day));
  const rules = [
    ['sleep',1,'lower','Sleep below your baseline','Log sleep under similar conditions and review changes to your schedule.',NASA_SLEEP],
    ['mood',1,'lower','Mood ratings below your baseline','Note what changed and share persistent concerns with your care team.',NASA_RISKS],
    ['attention',12.5,'lower','Attention-task accuracy fell','Repeat the same task with the same controls and fewer interruptions.',NASA_SLEEP],
    ['memory',12.5,'lower','Memory-task accuracy fell','Repeat the same protocol and note interruptions or changes in input.',NASA_SLEEP],
    ['motion',.15,'either','Movement pattern changed','Repeat with the same camera framing, calibration, and play conditions.',NASA_RISKS],
    ['pulse',10,'either','Resting pulse changed','Confirm the reading at rest using the same device and conditions.',null],
    ['temperature',.5,'either','Temperature moved from your baseline','Confirm the reading using the same thermometer and method.',null],
    ['systolic',10,'either','Systolic pressure changed','Recheck with a properly fitted cuff and record both numbers.',BP_GUIDE],
    ['diastolic',10,'either','Diastolic pressure changed','Recheck with a properly fitted cuff and record both numbers.',BP_GUIDE],
  ];
  const alerts = [];
  if (showUrgent && current && (current.systolic > 180 || current.diastolic > 120)) alerts.push({
    level:'urgent',title:'Very high blood pressure reading',key:'bp',source:BP_GUIDE,
    evidence:`${current.systolic}/${current.diastolic} mmHg entered for this day.`,
    action:'If you have chest pain, shortness of breath, back pain, numbness, weakness, a vision change, or trouble speaking, seek emergency help now (follow mission emergency procedures if aboard). Otherwise, wait at least one minute and repeat the reading; if still this high, contact your medical team immediately.',
  });
  const trends = {};
  for (const [key,threshold,direction,title,action,source] of rules) {
    const trend = personalTrend(points[key],threshold,direction);
    trends[key] = trend;
    if (trend.repeated && trend.current.day === day && !(alerts[0]?.key === 'bp' && ['systolic','diastolic'].includes(key))) {
      alerts.push({ key,level:'review',title,action,source,
        evidence:`Two readings shifted in the same direction. Latest ${trend.current.value}, earlier personal median ${trend.baseline} (${FIELDS[key]?.[1] ?? (key==='motion' ? 'shoulder widths' : '%')}).` });
    }
  }
  const latestReport = reports.filter(r => r.source === 'measured' && journalDay(r.timestamp) === day).sort((a,b)=>b.timestamp-a.timestamp)[0];
  const face = latestReport?.observations?.face;
  if (face?.qualityReasons?.some(reason => ['low-face-coverage','low-light','face-too-small','low-face-fps','no-valid-face-samples'].includes(reason))) {
    alerts.push({key:'camera',level:'quality',title:'Face check had limited evidence',evidence:'Camera quality can change the result.',action:'Adjust lighting and camera position, then repeat the face check.'});
  }
  const sleepAndAttention = alerts.some(a => a.key === 'sleep') && alerts.some(a => a.key === 'attention');
  if (sleepAndAttention) alerts.push({
    key:'sleep-attention',level:'review',title:'Sleep and attention changed together',source:NASA_SLEEP,
    evidence:'Both dropped against your own recent baselines. Sleep timing, workload, and interruptions are worth discussing.',
    action:'Review your schedule, then repeat the task under similar conditions and share the record if the changes persist.',
  });
  return { current, points, trends, alerts, latestReport };
}
