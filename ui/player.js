'use strict';
class LatestPlayback {
  constructor(load, output) { this.load = load; this.output = output; this.generation = 0; this.key = null; this.pending = false; this.current = null; this.snapshot = null; this.listeners = new Set(); }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  publish(snapshot) { this.snapshot = snapshot; for (const listener of this.listeners) listener(snapshot); }
  cancel() { this.generation++; this.key = null; this.pending = false; this.current?.stop(); this.current = null; this.publish(null); }
  async seek(time, scope, end) {
    const s=this.snapshot;if(this.pending||!s||!this.current?.seek||time<s.start||time>=s.end||Math.abs(end-s.end)>.002)return false;
    if(scope.sourceId ? s.sourceId!==scope.sourceId : s.context!==(scope.context||'track')||s.args.id!==scope.id)return false;
    const generation=this.generation,output=this.current;output.seek(time-s.start);this.publish({...s,time,playing:true,ended:false,status:'playing'});try{await output.play();return generation===this.generation;}catch(error){if(generation!==this.generation)return false;throw error;}
  }
  async playFrom(args) {
    const generation=this.generation,scope={context:args.context||'track',sourceId:args.sourceId,id:args.id};
    if(await this.seek(Number(args.start),scope,Number(args.end)))return true;
    if(generation!==this.generation)return false;
    return this.play(args);
  }
  async play(args) {
    const key = JSON.stringify(args); if (this.pending && this.key === key) return false;
    this.cancel(); const generation = this.generation; this.key = key; this.pending = true;
    const initial=Number(args.start);if(Number.isFinite(initial))this.publish({playbackId:generation,args:{...args},context:args.context||'track',sourceId:args.sourceId,start:initial,end:Number(args.end),time:initial,playing:false,ended:false,status:'loading'});
    try {
      const result = await this.load(args); if (generation !== this.generation) return false;
      const start=Number.isFinite(result?.start)?result.start:Number(args.start)||0,end=Number.isFinite(result?.end)?result.end:Number(args.end)||Infinity;
      this.pending=false;this.publish({playbackId:generation,args:{...args},context:result?.context||args.context||'track',sourceId:result?.sourceId||args.sourceId,start,end,time:start,playing:false,ended:false,status:'ready'});
      const report=update=>{if(generation!==this.generation||!this.snapshot)return;const time=Number.isFinite(update.time)?Math.max(start,Math.min(end,update.time)):this.snapshot.time;this.publish({...this.snapshot,...update,time});};
      const output=this.output(result,args,report);this.current=output;await output.play();return generation===this.generation;
    }
    catch (error) { if (generation !== this.generation) return false; this.pending=false;this.current?.stop();this.current=null;this.publish(null);throw error; }
  }
}
if (typeof module !== 'undefined') module.exports = {LatestPlayback};
else globalThis.LatestPlayback = LatestPlayback;
