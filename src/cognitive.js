const dirs=['left','up','right','down'];
const attentionBank=['go','wait','go','go','wait','go','go','go'];
const median=values=>{if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b);const i=Math.floor(sorted.length/2);return sorted.length%2?sorted[i]:(sorted[i-1]+sorted[i])/2;};

export class MindCheck {
 constructor({random=Math.random}={}){this.random=random;this.reset();}
 reset(){this.stage='idle';this.phase='idle';this.paused=false;this.round=0;this.sequence=[];this.attentionCues=[];this.memoryIndex=0;this.phaseStart=0;this.deadline=0;this.trial=0;this.cue=null;this.pauseAt=0;this.reactionTimes=[];this.results={memory:{protocol:'pattern-memory-3-4-5-random-v3',correct:0,attempts:0,rounds:0,accuracy:null},attention:{protocol:'focus-go-no-go-random-v3',correct:0,attempts:0,falseAlarms:0,misses:0,medianReactionMs:null}};}
 randomIndex(length){return Math.floor(this.random()*length);}
 start(now=0){this.reset();this.sequence=Array.from({length:3},()=>dirs[this.randomIndex(dirs.length)]);this.stage='memory';this.phase='showing';this.phaseStart=now;this.deadline=now+this.sequence.length*850+600;}
 startAttention(now=0){
  // Keep task difficulty consistent while making the cue order unpredictable.
  this.attentionCues=[...attentionBank];
  for(let i=this.attentionCues.length-1;i>0;i--){const j=this.randomIndex(i+1);[this.attentionCues[i],this.attentionCues[j]]=[this.attentionCues[j],this.attentionCues[i]];}
  this.stage='attention';this.phase='waiting';this.trial=0;this.cue=null;this.phaseStart=now;this.deadline=now+700;
 }
 tick(now){
  if(this.paused)return;
  if(this.stage==='memory'&&this.phase==='showing'&&now>=this.deadline){this.phase='input';this.phaseStart=now;}
  if(this.stage!=='attention')return;
  if(this.phase==='waiting'&&now>=this.deadline){this.phase='stimulus';this.cue=this.attentionCues[this.trial];this.phaseStart=now;this.deadline=now+1400;}
  else if(this.phase==='stimulus'&&now>=this.deadline){const a=this.results.attention;a.attempts++;if(this.cue==='wait')a.correct++;else a.misses++;this.feedback(now);}
  else if(this.phase==='feedback'&&now>=this.deadline){this.trial++;if(this.trial>=8){this.stage='complete';this.phase='complete';}else{this.phase='waiting';this.cue=null;this.deadline=now+650+this.random()*450;}}
 }
 answer(value,now){
  if(this.paused)return;
  if(this.stage==='attention'&&this.phase==='stimulus'&&now>=this.deadline){this.tick(now);return;}
  if(this.stage==='memory'&&this.phase==='input'&&dirs.includes(value)){
   const m=this.results.memory;m.attempts++;
   if(value===this.sequence[this.memoryIndex]){m.correct++;this.memoryIndex++;if(this.memoryIndex===this.sequence.length){m.rounds++;this.round++;this.memoryIndex=0;if(this.round===3)this.startAttention(now);else{this.sequence.push(dirs[this.randomIndex(dirs.length)]);this.phase='showing';this.phaseStart=now+400;this.deadline=this.phaseStart+this.sequence.length*850+600;}}}
   else{this.memoryIndex=0;this.phase='showing';this.phaseStart=now+500;this.deadline=this.phaseStart+this.sequence.length*850+600;}
   m.accuracy=Math.round(m.correct/m.attempts*100);
  }else if(this.stage==='attention'&&this.phase==='stimulus'&&value==='respond'){
   const a=this.results.attention;a.attempts++;if(this.cue==='go'){a.correct++;this.reactionTimes.push(Math.max(0,now-this.phaseStart));a.medianReactionMs=Math.round(median(this.reactionTimes));}else a.falseAlarms++;this.feedback(now);
  }
 }
 feedback(now){this.phase='feedback';this.deadline=now+500;}
 pause(now){if(this.paused)return;this.paused=true;this.pauseAt=now;}
 resume(now){if(!this.paused)return;const gap=now-this.pauseAt;this.phaseStart+=gap;this.deadline+=gap;this.paused=false;}
 snapshot(now=this.phaseStart){
  const elapsed=(this.paused?this.pauseAt:now)-this.phaseStart;
  const showIndex=this.stage==='memory'&&this.phase==='showing'&&elapsed>=0&&elapsed%850<590?Math.floor(elapsed/850):-1;
  return {stage:this.stage,phase:this.phase,paused:this.paused,round:this.round,sequence:[...this.sequence],showIndex:showIndex<this.sequence.length?showIndex:-1,memoryIndex:this.memoryIndex,trial:this.trial,cue:this.cue,results:structuredClone(this.results)};
 }
}
