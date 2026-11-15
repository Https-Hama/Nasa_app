import test from 'node:test';
import assert from 'node:assert/strict';
import { journalDay, readCheckins, storeCheckin, reviewHealth } from '../src/health-journal.js';
import { getGeminiSuggestions, createSuggestionHandler } from '../scripts/gemini-suggestions.mjs';

const dates = ['2025-01-01','2025-01-02','2025-01-03','2025-01-04','2025-01-05'];
const newStorage = () => {
  const values = new Map();
  return {getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
};

test('partial check-ins persist across loads, retain zero, and reject a half-entered blood pressure edit', () => {
  const storage = newStorage();
  storeCheckin(storage,{day:dates[0],sleep:'0',pulse:'',diagnosis:'Example note'});
  storeCheckin(storage,{day:dates[1],pulse:'68'});
  assert.throws(()=>storeCheckin(storage,{day:dates[0],systolic:'172'}),/both blood pressure/);
  const [first,second] = readCheckins(storage);
  assert.equal(first.sleep,0);
  assert.equal(first.pulse,null);
  assert.equal(first.diagnosis,'Example note');
  assert.equal(second.pulse,68);
});

test('a single lower sleep reading is not a trend, and a repeated drop uses earlier days only', () => {
  const entries = dates.map((day,index)=>({day,sleep:[7,8,7,5,5][index]}));
  assert.ok(!reviewHealth(entries,[],dates[3]).alerts.length);
  const result = reviewHealth(entries,[],dates[4]);
  assert.equal(result.trends.sleep.baseline,7);
  assert.equal(result.alerts[0].key,'sleep');
  entries[4].sleep=null;
  assert.ok(!reviewHealth(entries,[],dates[4]).alerts.length);
});

test('very high diastolic pressure triggers a check without a baseline', () => {
  const day=journalDay();
  const entry={day,systolic:170,diastolic:121};
  assert.equal(reviewHealth([entry],[],day).alerts[0].level,'urgent');
  assert.equal(reviewHealth([{...entry,diastolic:120}],[],day).alerts.length,0);
});

test('Gemini receives only the fixed question bank and cannot add arbitrary questions', async () => {
  const selections = {sleep:['sleep','context','new diagnosis'],task:['environment','followup'],readings:['technique','timing'],general:['context','followup']};
  const result = await getGeminiSuggestions({key:'test-only-key',fetcher:async (url,options)=>{
    assert.equal(new URL(url).hostname,'generativelanguage.googleapis.com');
    assert.ok(!url.includes('test-only-key'));
    assert.equal(options.headers['x-goog-api-key'],'test-only-key');
    assert.match(options.body,/no patient information/);
    return {ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(selections)}]}}]})};
  }});
  assert.deepEqual(result.sleep,['sleep','context']);
  const handler = createSuggestionHandler({key:'test-only-key',fetcher:()=>assert.fail('must reject request body')});
  let status;
  await handler({url:'/api/health-suggestions',method:'POST',resume(){},headers:{host:'127.0.0.1:4173',origin:'http://127.0.0.1:4173','x-human-suggestions':'generic-v1','content-length':'42'}},{writeHead(code){status=code;},end(){}});
  assert.equal(status,403);
});
