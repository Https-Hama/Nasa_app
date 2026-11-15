const cues = {
  action:[[0,520,680,.10,.045]],
  launch:[[0,170,290,.28,.08,'triangle'],[.09,300,440,.2,.06],[.21,440,660,.24,.055]],
  fire:[[0,330,90,.095,.065,'triangle'],[0,760,240,.04,.018]],
  shield:[[0,260,480,.18,.064],[.025,390,640,.19,.04]],
  impact:[[0,115,42,.20,.12,'triangle'],[0,190,52,.14,.035,'sawtooth']],
  destroy:[[0,180,60,.22,.09,'triangle'],[.10,392,523,.16,.065],[.19,523,660,.20,.055]],
  boost:[[0,85,260,.27,.10,'triangle'],[.09,220,390,.23,.05]],
  duck:[[0,350,135,.17,.07,'triangle']],
  pickup:[[0,620,720,.09,.06],[.06,840,990,.14,.04]],
  transition:[[0,392,392,.15,.05],[.09,523,523,.22,.05]],
  complete:[[0,392,392,.16,.07],[.09,523,523,.20,.06],[.18,659,659,.28,.06]],
  go:[[0,700,800,.09,.052]], wait:[[0,294,286,.095,.043]],
  'memory-up':[[0,659,659,.14,.06]], 'memory-down':[[0,392,392,.14,.06]],
  'memory-left':[[0,494,494,.14,.06]], 'memory-right':[[0,587,587,.14,.06]],
};

export class MissionAudio {
  setEnabled(enabled) {
    this.enabled = enabled;
    if (this.master) this.master.gain.value = enabled ? .65 : 0;
  }
  play(cue) {
    if (!this.enabled || !cues[cue] || !globalThis.AudioContext) return;
    try {
      if (!this.context) {
        this.context=new AudioContext();
        this.master=this.context.createGain();
        this.master.gain.value=.65;
        this.master.connect(this.context.destination);
      }
      const ctx=this.context;
      if (ctx.state==='suspended') void ctx.resume().catch(()=>{});
      const start=ctx.currentTime+.006;
      for(const [delay,from,to,length,volume,wave='sine'] of cues[cue]) {
        const at=start+delay, osc=ctx.createOscillator(), gain=ctx.createGain();
        osc.type=wave;
        osc.frequency.setValueAtTime(from,at);
        osc.frequency.exponentialRampToValueAtTime(to,at+length);
        gain.gain.setValueAtTime(.0001,at);
        gain.gain.exponentialRampToValueAtTime(volume,at+.01);
        gain.gain.exponentialRampToValueAtTime(.0001,at+length);
        osc.connect(gain).connect(this.master);
        osc.onended=()=>{osc.disconnect();gain.disconnect();};
        osc.start(at);osc.stop(at+length+.01);
      }
    } catch { /* Audio must not interrupt gameplay. */ }
  }
}
