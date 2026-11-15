import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoRecords } from '../src/report-model.js';
import { buildReportCharts, reportChartsHTML } from '../src/report-charts.js';

const record = () => createDemoRecords(Date.parse('2026-11-15T10:00:00Z'))[0];

test('task charts derive separate accuracy and outcome counts from actual recorded attempts', () => {
  const source = record();
  source.cognitive.memory = { correct:9, attempts:12, rounds:2, accuracy:99 };
  source.cognitive.attention = { correct:5, attempts:8, falseAlarms:1, misses:2 };
  const charts = buildReportCharts(source);
  assert.equal(charts.memory.accuracy, 75, 'the saved accuracy label cannot override actual counts');
  assert.equal(charts.attention.accuracy, 62.5);
  assert.deepEqual(charts.memory.segments.map(segment => [segment.label, segment.count]), [['Correct',9],['Errors',3]]);
  assert.deepEqual(charts.attention.segments.map(segment => [segment.label, segment.count]), [['Correct',5],['False alarms',1],['Missed GO',2]]);
  assert.equal(charts.attention.segments.reduce((total, segment) => total + segment.count, 0), 8);
});

test('missing task attempts and absent observations remain unavailable rather than zero', () => {
  const source = record();
  source.conditions.faceCheckDurationSec = null;
  source.observations = { durationSec:0, face:{ validSeconds:0, coverage:0 }, body:{ validSeconds:0, coverage:0, fullBodyCoverage:0 } };
  source.cognitive = { memory:{correct:0,attempts:0}, attention:{correct:0,attempts:0,falseAlarms:0,misses:0} };
  const charts = buildReportCharts(source);
  assert.equal(charts.memory.accuracy, null);
  assert.equal(charts.attention.accuracy, null);
  assert.deepEqual(charts.signal.map(signal => signal.value), [null,null,null]);
  assert.deepEqual(charts.hands.map(hand => hand.value), [null,null]);
  const html = reportChartsHTML(source);
  assert.match(html, /No attempts recorded/);
  assert.match(html, /N\/A — no attempts recorded/);
});

test('a recorded failed face check shows real zero coverage, while portrait body coverage remains available', () => {
  const source = record();
  source.conditions.faceCheckDurationSec = 30;
  source.observations.face.validSeconds = 0;
  source.observations.face.coverage = 0;
  source.observations.body.fullBodyCoverage = 0;
  const charts = buildReportCharts(source);
  assert.equal(charts.signal[0].value, 0);
  assert.ok(charts.signal[1].value > 90);
  assert.equal(charts.signal[2].value, 0, 'offscreen legs are recorded coverage, not an invented missing value');
});

test('hand travel uses report quality gates even when a raw measurement exists', () => {
  const source = record();
  source.observations.body.validSeconds = 3;
  source.observations.body.coverage = .1;
  source.observations.body.leftHandTravel = 42;
  source.observations.body.rightHandTravel = 55;
  assert.deepEqual(buildReportCharts(source).hands.map(hand => hand.value), [null,null]);
  source.observations.body.validSeconds = 100;
  source.observations.body.coverage = .9;
  const charts = buildReportCharts(source);
  assert.deepEqual(charts.hands.map(hand => hand.value), [42,55]);
  assert.equal(charts.handScale, 55);
});

test('inconsistent error breakdown cannot create stacked counts greater than recorded attempts', () => {
  const source = record();
  source.cognitive.attention = { correct:6, attempts:8, falseAlarms:4, misses:1 };
  const attention = buildReportCharts(source).attention;
  assert.deepEqual(attention.segments.map(segment => [segment.label,segment.count]), [['Correct',6],['Errors',2]]);
  assert.equal(attention.falseAlarms, null);
  assert.equal(attention.misses, null);
  source.cognitive.memory = { correct:7, attempts:4 };
  assert.equal(buildReportCharts(source).memory.accuracy, null);
});

test('partially classified attention errors retain an explicit remainder without fabricating their cause', () => {
  const source = record();
  source.cognitive.attention = { correct:4, attempts:8, falseAlarms:1, misses:2 };
  const attention = buildReportCharts(source).attention;
  assert.deepEqual(attention.segments.at(-1), {key:'other-errors',label:'Other errors',count:1,tone:'muted'});
  assert.equal(attention.segments.reduce((total,segment) => total + segment.count,0), 8);
});

test('all four charts expose labels, keyboard explanations and equivalent value tables without raw camera data', () => {
  const source = record();
  source.id = '\"><img src=x onerror=alert(1)>';
  source.observations.face.pixels = 'private-camera-pixels';
  source.observations.body.landmarks = 'private-body-landmarks';
  const html = reportChartsHTML(source);
  assert.equal((html.match(/class="report-chart-card"/g) || []).length, 4);
  assert.equal((html.match(/<details class="report-chart-values">/g) || []).length, 4);
  assert.equal((html.match(/<caption>/g) || []).length, 4);
  assert.match(html, /tabindex="0"/);
  assert.match(html, /aria-label="Session charts"/);
  assert.match(html, /Coverage is usable observation time, not a health score/);
  assert.equal(html.includes('<img'), false);
  assert.equal(html.includes('private-camera-pixels'), false);
  assert.equal(html.includes('private-body-landmarks'), false);
  assert.equal(html.includes('NaN'), false);
  assert.equal(html.includes('Infinity'), false);
});
