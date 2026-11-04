'use strict';
const fs=require('node:fs'),path=require('node:path');
const {run}=require('./audio'),{atomic,hash}=require('./util');
async function viewWave(audio,start,end,columns=1400,signal){
  if(!(Number.isFinite(start)&&Number.isFinite(end)&&start>=0&&end>start&&end<=audio.duration+1e-6&&end-start<=120))throw Error('波形视窗需位于音源内，长度不超过120秒。');
  audio.validate();const count=Math.min(columns,Math.max(1,Math.round((end-start)*16000))),points=Array.from({length:count},()=>[0,0]);
  for(let at=start;at<end;at+=30){if(signal?.aborted)throw Error('已停止读取波形。');const data=await audio.read(at,Math.min(30,end-at),signal),base=Math.round((at-start)*16000),total=(end-start)*16000;
    for(let i=0;i<data.length;i++){const column=Math.min(count-1,Math.floor((base+i)/total*count));points[column][0]=Math.min(points[column][0],data[i]);points[column][1]=Math.max(points[column][1],data[i]);}}
  audio.validate();return {span:[start,end],samples:points};
}
async function assetPeaks(audio,start,end,step,root,signal){
  const n=Math.max(80,Math.ceil(step*16000)),file=path.join(root,'wave-overview',hash(JSON.stringify([2,audio.key,start,end,n]))+'.json');
  if(fs.existsSync(file)){const cached=JSON.parse(fs.readFileSync(file,'utf8'));if(cached.version===2)return cached;}
  if(signal?.aborted)throw Error('已停止生成概览。');
  const filter=`aformat=channel_layouts=mono,aresample=16000,asetnsamples=n=${n}:p=1,astats=metadata=1:reset=1:measure_perchannel=none:measure_overall=Peak_level,ametadata=mode=print:key=lavfi.astats.Overall.Peak_level:file='pipe\\:1'`;
  const output=await run(audio.tools.ffmpeg,['-nostdin','-v','error','-protocol_whitelist','file,pipe','-ss',String(start),'-i',audio.path,'-t',String(end-start),'-map',`0:${audio.stream}`,'-vn','-sn','-dn','-af',filter,'-f','null','-'],{signal,timeout:120000,maxBytes:4*1024*1024});
  const peaks=[...output.toString('utf8').matchAll(/lavfi\.astats\.Overall\.Peak_level=([^\r\n]+)/g)].map(m=>{const db=Number(m[1]);return Number.isFinite(db)?Math.min(16,10**(db/20)):0;});
  if(!peaks.length)throw Error('无法生成音源概览，请继续使用位置滑条或重新载入音源。');
  audio.validate();if(signal?.aborted)throw Error('已停止生成概览。');const result={version:2,start,end,step:n/16000,peaks};atomic(file,JSON.stringify(result));return result;
}
async function overview(audio,root,signal,progress=()=>{},columns=1400){
  audio.validate();const duration=audio.duration;if(!(duration>0))throw Error('音源为空。');const out=new Float32Array(columns),jobs=[],step=duration/columns;
  if(audio.assets){const fps=audio.project.fps;
    for(const [id,source]of audio.assets){const clips=audio.clips.filter(c=>audio.assetId(c)===id),intervals=[];
      for(const [a,b]of clips.map(c=>[c.source_in/fps,(c.source_out+1)/fps]).sort((a,b)=>a[0]-b[0])){if(intervals.length&&a<=intervals.at(-1)[1]+2)intervals.at(-1)[1]=Math.max(intervals.at(-1)[1],b);else intervals.push([a,b]);}
      for(const [a,b]of intervals)jobs.push({source,start:a,end:b,clips:clips.filter(c=>c.source_in/fps<b&&(c.source_out+1)/fps>a),fps});
    }
  }else jobs.push({source:audio,start:0,end:duration});
  for(let index=0;index<jobs.length;index++){
    if(signal?.aborted)throw Error('已停止生成概览。');const job=jobs[index];progress(index/jobs.length,'后台生成音源概览');
    const data=await assetPeaks(job.source,job.start,job.end,Math.max(step,(job.end-job.start)/2400),root,signal);
    const spans=job.clips?job.clips.map(c=>({a:c.source_in/job.fps,b:(c.source_out+1)/job.fps,offset:(c.timeline_in-c.source_in)/job.fps})):[{a:0,b:duration,offset:0}];
    for(const clip of spans)for(let i=Math.max(0,Math.floor((clip.a-data.start)/data.step));i<data.peaks.length;i++){
      const a=Math.max(clip.a,data.start+i*data.step),b=Math.min(clip.b,data.end,data.start+(i+1)*data.step);if(a>=clip.b)break;if(b<=a)continue;
      const first=Math.max(0,Math.floor((a+clip.offset)/duration*columns)),last=Math.min(columns-1,Math.ceil((b+clip.offset)/duration*columns)-1);for(let j=first;j<=last;j++)out[j]=Math.max(out[j],data.peaks[i]);
    }
  }
  audio.validate();progress(1,'音源概览已就绪');return {span:[0,duration],samples:Array.from(out,n=>[-n,n])};
}
module.exports={viewWave,overview};
