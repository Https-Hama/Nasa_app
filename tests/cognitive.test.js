import test from 'node:test';
import assert from 'node:assert/strict';
import { MindCheck } from '../src/cognitive.js';

test('pausing memory playback freezes the visible cue until explicit resume',()=>{
 const mind=new MindCheck({random:()=>.2});mind.start(0);
 const before=mind.snapshot(200).showIndex;
 mind.pause(200);
 assert.equal(mind.snapshot(1500).showIndex,before);
 mind.resume(1500);
 assert.equal(mind.snapshot(1500).showIndex,before);
 assert.equal(mind.snapshot(2200).showIndex,1);
});

test('pattern challenge ignores answers during playback and completes three increasing rounds',()=>{
 const mind=new MindCheck({random:()=>.2});mind.start(0);mind.answer('left',100);assert.equal(mind.snapshot().results.memory.attempts,0);
 let now=0,previous=[];for(let round=0;round<3;round++){now+=7000;mind.tick(now);const s=mind.snapshot();assert.equal(s.sequence.length,round+3);assert.deepEqual(s.sequence.slice(0,previous.length),previous);previous=s.sequence;for(const d of s.sequence)mind.answer(d,now+=200);}
 assert.equal(mind.snapshot().stage,'attention');assert.equal(mind.snapshot().results.memory.correct,12);assert.equal(mind.snapshot().results.memory.rounds,3);
});

test('each new memory session draws a fresh opening pattern from the injected random source',()=>{
 const values=[0,.25,.5,.75,.5,.25];
 const mind=new MindCheck({random:()=>values.shift()});
 mind.start(0);assert.deepEqual(mind.snapshot().sequence,['left','up','right']);
 mind.start(1000);assert.deepEqual(mind.snapshot().sequence,['down','right','up']);
 assert.equal(mind.snapshot().results.memory.protocol,'pattern-memory-3-4-5-random-v3');
 assert.equal(mind.snapshot().results.memory.attempts,0);
});

test('random selection includes every direction and repeated directions remain visible as separate cues',()=>{
 const mind=new MindCheck({random:()=>.999999});mind.start(0);
 assert.deepEqual(mind.snapshot().sequence,['down','down','down']);
 assert.equal(mind.snapshot(100).showIndex,0);
 assert.equal(mind.snapshot(700).showIndex,-1);
 assert.equal(mind.snapshot(950).showIndex,1);
});

test('wrong patterns are recorded and replayed without advancing a round',()=>{
 let randomCalls=0;const mind=new MindCheck({random:()=>{randomCalls++;return .2;}});mind.start(0);const sequence=mind.snapshot().sequence;mind.tick(5000);mind.answer('down',5100);const s=mind.snapshot();assert.equal(s.results.memory.attempts,1);assert.equal(s.results.memory.correct,0);assert.equal(s.round,0);assert.equal(s.phase,'showing');assert.deepEqual(s.sequence,sequence);assert.equal(randomCalls,3);
});
test('focus task measures actual onset reaction time and separates false alarms and misses',()=>{
 const mind=new MindCheck({random:()=>.999999});mind.startAttention(0);mind.tick(2000);assert.equal(mind.snapshot().cue,'go');mind.answer('respond',2350);assert.equal(mind.snapshot().results.attention.medianReactionMs,350);
 let now=4000;mind.tick(now);mind.tick(now+=2000);assert.equal(mind.snapshot().cue,'wait');mind.answer('respond',now+100);assert.equal(mind.snapshot().results.attention.falseAlarms,1);
 mind.tick(now+=3000);mind.tick(now+=2000);mind.tick(now+=2000);assert.ok(mind.snapshot().results.attention.misses>=1);
});

test('focus cues are shuffled each session with six GO and two WAIT cues',()=>{
 const collect=random=>{
  const mind=new MindCheck({random});mind.startAttention(0);const cues=[];let now=0;
  for(let trial=0;trial<8;trial++){
   mind.tick(now+=2000);const s=mind.snapshot();assert.equal(s.phase,'stimulus');cues.push(s.cue);
   if(s.cue==='go')mind.answer('respond',now+100);else mind.tick(now+=1500);
   mind.tick(now+=700);
  }
  assert.equal(mind.snapshot().stage,'complete');
  assert.equal(mind.snapshot().results.attention.correct,8);
  assert.equal(mind.snapshot().results.attention.protocol,'focus-go-no-go-random-v3');
  assert.equal(cues.filter(cue=>cue==='go').length,6);assert.equal(cues.filter(cue=>cue==='wait').length,2);
  return cues;
 };
 assert.deepEqual(collect(()=>.2),collect(()=>.2));
 assert.notDeepEqual(collect(()=>.2),collect(()=>.999999));
});
test('paused mental tasks ignore input and preserve the stimulus deadline',()=>{
 const mind=new MindCheck();mind.startAttention(0);mind.tick(1000);mind.pause(1100);mind.answer('respond',1200);mind.tick(10000);assert.equal(mind.snapshot().results.attention.attempts,0);mind.resume(10000);mind.tick(10100);assert.equal(mind.snapshot().phase,'stimulus');
});

test('a response after an expired attention cue counts as a miss even before the next animation frame',()=>{
 const mind=new MindCheck({random:()=>.999999});mind.startAttention(0);mind.tick(700);mind.answer('respond',5000);const a=mind.snapshot().results.attention;assert.equal(a.correct,0);assert.equal(a.misses,1);assert.equal(a.medianReactionMs,null);
});
