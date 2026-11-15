import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeResult, safeHistory, addSession } from '../src/session.js';

test('session export contains derived metrics but never arbitrary camera payloads', () => {
  const result = summarizeResult({mission:'exercise',score:320,reps:12,hull:90,stats:{correct:7,attempts:10},video:'secret',landmarks:[1]},'motion',100);
  assert.equal(result.reps,12);
  assert.equal(result.accuracy,70);
  assert.equal('video' in result,false);
  assert.equal('landmarks' in result,false);
  assert.equal(result.inputMode,'motion');
});
test('corrupt local history recovers to an empty array', () => {
  assert.deepEqual(safeHistory('{broken'),[]);
  assert.deepEqual(safeHistory('{}'),[]);
});
test('history retains at most 30 newest sessions', () => {
  const history=Array.from({length:30},(_,i)=>({id:i,mission:'memory',score:0}));
  const next=addSession(history,{id:'new',mission:'asteroids',score:30});
  assert.equal(next.length,30);
  assert.equal(next[0].id,'new');
});
