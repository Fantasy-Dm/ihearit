'use strict';
class SamplingNavigator {
  constructor(prefix,{follow=false,maxSelection=10,initialSpan=12}={}){
    this.prefix=prefix;this.follow=follow;this.maxSelection=maxSelection;this.initialSpan=initialSpan;this.source=null;this.epoch=0;this.request=0;this.data=null;this.overviewData=null;this.overviewLoading=false;
    this.detail=$(prefix+'Canvas');this.overview=$(prefix+'Overview');this.start=$(prefix+'Start');this.end=$(prefix+'End');this.position=$(prefix+'Position');
    for(const [suffix,fn]of Object.entries({ZoomIn:()=>this.zoom(.5),ZoomOut:()=>this.zoom(2),PanBack:()=>this.pan(-.8),PanForward:()=>this.pan(.8),Focus:()=>this.focusSelection(),Reset:()=>this.resetView(),OverviewControl:()=>this.toggleOverview()}))$(prefix+suffix).onclick=()=>{if(!busy&&this.source)fn();};
    this.position.oninput=()=>{if(!this.source||busy)return;const width=this.view[1]-this.view[0],a=Number(this.position.value);this.setView(a,a+width);};
    for(const field of [this.start,this.end])field.addEventListener('change',()=>{if(!this.source)return;const a=seconds(this.start.value),b=seconds(this.end.value);if(Number.isFinite(a)&&Number.isFinite(b)&&b>a){this.setSelection(a,b);this.focusSelection();}});
    this.bindDetail();this.bindOverview();player.subscribe(()=>this.playbackChanged());new ResizeObserver(()=>this.draw()).observe(this.detail);new ResizeObserver(()=>this.drawOverview()).observe(this.overview);
  }
  clear(){if(this.cursor())player.cancel();this.epoch++;this.request++;clearTimeout(this.timer);clearTimeout(this.followTimer);this.followTimer=null;this.source=null;this.data=null;this.overviewData=null;this.overviewLoading=false;this.draw();this.drawOverview();}
  async load(source,start=source.start,end=source.end){
    this.clear();this.source=source;this.setSelection(start,end);const width=Math.min(source.duration,this.initialSpan),center=(this.selection[0]+this.selection[1])/2;
    this.setView(center-width/2,center+width/2,false);if(this.follow)this.setSelection(...this.view);this.loadOverview();await this.loadView();
  }
  setSelection(a,b){
    if(!this.source)return;const duration=this.source.duration,min=Math.min(.02,duration);a=Math.max(0,Math.min(a,duration-min));b=Math.max(a+min,Math.min(duration,b,a+this.maxSelection));this.selection=[a,b];
    this.start.value=a.toFixed(3);this.end.value=b.toFixed(3);player.cancel();this.draw();this.drawOverview();
    $(this.prefix+'Selection').textContent=`已选 ${(b-a).toFixed(3)} 秒 · ${tc(a)} — ${tc(b)}`;
  }
  setView(a,b,fetch=true,followSelection=true){
    if(!this.source)return;const duration=this.source.duration,width=Math.min(duration,120,Math.max(Math.min(.08,duration),b-a));a=Math.max(0,Math.min(a,duration-width));this.view=[a,a+width];
    if(followSelection)this.autoFollow=false;
    if(this.follow&&followSelection)this.setSelection(...this.view);
    this.position.min=0;this.position.max=Math.max(0,duration-width);this.position.step=Math.max(.001,width/500);this.position.value=a;
    $(this.prefix+'Window').textContent=`视窗 ${width.toFixed(width<1?3:1)} 秒`;
    this.draw();this.drawOverview();if(fetch){clearTimeout(this.timer);this.timer=setTimeout(()=>this.loadView(),100);}
  }
  async loadView(){
    if(!this.source)return;clearTimeout(this.timer);const epoch=this.epoch,request=++this.request,sourceId=this.source.sourceId,[start,end]=this.view;
    try{const result=await api('viewWave',{sourceId,start,end});if(epoch!==this.epoch||request!==this.request||!this.source||result.sourceId!==sourceId)return;this.data=result;this.draw();}
    catch(error){if(epoch===this.epoch&&request===this.request)$(this.prefix+'OverviewStatus').textContent=error.message;}
  }
  async loadOverview(){
    if(!this.source)return;const epoch=this.epoch,sourceId=this.source.sourceId;this.overviewLoading=true;$(this.prefix+'OverviewStatus').textContent='概览在后台生成，可先使用局部波形和位置滑条。';$(this.prefix+'OverviewControl').textContent='停止概览';
    try{const result=await api('overview',{sourceId});if(epoch!==this.epoch||!this.source||result.sourceId!==sourceId)return;this.overviewData=result;$(this.prefix+'OverviewStatus').textContent='单击试听 · 拖动概览换位置 · 局部拖选 · 滚轮缩放 · Shift 平移';this.drawOverview();}
    catch(error){if(epoch===this.epoch)$(this.prefix+'OverviewStatus').textContent='概览未完成，仍可使用位置滑条和局部波形。';}
    finally{if(epoch===this.epoch){this.overviewLoading=false;$(this.prefix+'OverviewControl').textContent=this.overviewData?'刷新概览':'生成概览';}}
  }
  toggleOverview(){if(this.overviewLoading)api('cancelOverview').catch(()=>{});else this.loadOverview();}
  zoom(factor,center){if(!this.source)return;const [a,b]=this.view,at=center??(a+b)/2,fraction=(at-a)/(b-a),width=(b-a)*factor;this.setView(at-width*fraction,at+width*(1-fraction));}
  pan(fraction){const [a,b]=this.view,width=b-a;this.setView(a+width*fraction,b+width*fraction);}
  resetView(){if(!this.source)return;const width=Math.min(this.source.duration,this.initialSpan),center=(this.selection[0]+this.selection[1])/2;this.setView(center-width/2,center+width/2);}
  focusSelection(){if(!this.source)return;const [a,b]=this.selection,width=Math.min(120,Math.max(.12,(b-a)*(this.follow?1:2.5))),center=(a+b)/2;this.setView(center-width/2,center+width/2);}
  timeAt(canvas,event,span){const rect=canvas.getBoundingClientRect();return span[0]+Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width))*(span[1]-span[0]);}
  cursor(){const s=player.snapshot;return this.source&&s&&['calibration','wizard'].includes(s.context)&&s.sourceId===this.source.sourceId?s:null;}
  playbackChanged(){const s=this.cursor();if(s&&s.playbackId!==this.lastPlaybackId){this.lastPlaybackId=s.playbackId;this.autoFollow=true;}if(!s)this.lastPlaybackId=null;if(s?.playing&&this.autoFollow&&this.detail.clientWidth&&this.view){const width=this.view[1]-this.view[0];if((s.time>=this.view[1]||s.time<this.view[0])&&s.time<this.source.duration){this.setView(s.time-width*.2,s.time+width*.8,false,false);if(!this.followTimer)this.followTimer=setTimeout(()=>{this.followTimer=null;this.loadView();},60);}}this.draw();this.drawOverview();}
  async playFrom(at){
    if(!this.source||busy)return;const epoch=this.epoch,duration=this.source.duration,start=Math.max(0,Math.min(at,duration-Math.min(.02,duration))),inside=start>=this.selection[0]&&start<this.selection[1],end=Math.min(duration,start+10,inside?this.selection[1]:Math.max(start+.02,this.view[1]));
    const args={context:'calibration',sourceId:this.source.sourceId,start,end};this.autoFollow=true;
    try{await player.playFrom(args);}catch(error){if(epoch===this.epoch)$(this.prefix+'OverviewStatus').textContent=error.message;}
  }
  bindOverview(){let drag=null;
    this.overview.addEventListener('pointerdown',event=>{if(event.button!==0||!this.source||busy)return;drag={x:event.clientX,y:event.clientY,moved:false,at:this.timeAt(this.overview,event,[0,this.source.duration])};this.overview.setPointerCapture(event.pointerId);});
    this.overview.addEventListener('pointermove',event=>{if(!drag||!this.source||busy)return;if(!drag.moved&&Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<4)return;drag.moved=true;const center=this.timeAt(this.overview,event,[0,this.source.duration]),width=this.view[1]-this.view[0];this.setView(center-width/2,center+width/2);});
    this.overview.addEventListener('pointerup',()=>{if(!drag||!this.source)return;const click=drag.moved?null:drag.at;drag=null;if(click!==null){const width=this.view[1]-this.view[0];this.setView(click-width/2,click+width/2,false,false);this.playFrom(click);}this.loadView();});this.overview.addEventListener('pointercancel',()=>drag=null);
  }
  bindDetail(){let drag=null;
    this.detail.addEventListener('pointerdown',event=>{if(event.button!==0||!this.source||busy)return;const at=this.timeAt(this.detail,event,this.view),rect=this.detail.getBoundingClientRect(),tolerance=9/rect.width*(this.view[1]-this.view[0]);let mode=event.shiftKey?'pan':Math.abs(at-this.selection[0])<tolerance?'left':Math.abs(at-this.selection[1])<tolerance?'right':'new';drag={at,mode,range:[...this.selection],view:[...this.view],x:event.clientX,y:event.clientY,moved:false};this.detail.setPointerCapture(event.pointerId);});
    this.detail.addEventListener('pointermove',event=>{if(!drag||busy)return;if(!drag.moved&&Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<4)return;drag.moved=true;const at=this.timeAt(this.detail,event,this.view);
      if(drag.mode==='pan'){const width=drag.view[1]-drag.view[0],delta=(drag.x-event.clientX)/this.detail.getBoundingClientRect().width*width;this.setView(drag.view[0]+delta,drag.view[1]+delta);}
      else if(drag.mode==='left')this.setSelection(Math.min(at,drag.range[1]-.02),drag.range[1]);
      else if(drag.mode==='right')this.setSelection(drag.range[0],Math.max(at,drag.range[0]+.02));
      else{const [a,b]=[drag.at,at].sort((x,y)=>x-y);if(b-a>=.02)this.setSelection(a,b);}
    });
    this.detail.addEventListener('pointerup',()=>{const previous=drag;drag=null;if(previous?.mode==='pan')this.loadView();else if(previous&&!previous.moved)this.playFrom(previous.at);});this.detail.addEventListener('pointercancel',()=>drag=null);
    this.detail.addEventListener('wheel',event=>{if(!this.source||busy)return;event.preventDefault();if(event.shiftKey)this.pan(event.deltaY>0?.25:-.25);else this.zoom(event.deltaY>0?1.4:1/1.4,this.timeAt(this.detail,event,this.view));},{passive:false});
  }
  context(canvas){const rect=canvas.getBoundingClientRect(),w=Math.max(1,rect.width),h=Math.max(1,rect.height),ratio=devicePixelRatio||1;canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio);const ctx=canvas.getContext('2d');ctx.scale(ratio,ratio);ctx.clearRect(0,0,w,h);return {ctx,w,h};}
  plot(ctx,w,h,data,span){if(!data)return;let peak=.005;for(const p of data.samples)peak=Math.max(peak,Math.abs(p[0]),Math.abs(p[1]));ctx.strokeStyle='#4d8195';ctx.beginPath();for(let i=0;i<data.samples.length;i++){const at=data.span[0]+(i+.5)/data.samples.length*(data.span[1]-data.span[0]),x=(at-span[0])/(span[1]-span[0])*w;if(x<0||x>w)continue;const [a,b]=data.samples[i];ctx.moveTo(x,h/2-b/peak*h*.36);ctx.lineTo(x,h/2-a/peak*h*.36);}ctx.stroke();}
  draw(){if(!this.detail.clientWidth)return;const {ctx,w,h}=this.context(this.detail);if(!this.source||!this.view)return;const [a,b]=this.view,[start,end]=this.selection;ctx.fillStyle='#d8eee4';ctx.fillRect((start-a)/(b-a)*w,0,(end-start)/(b-a)*w,h);this.plot(ctx,w,h-17,this.data,this.view);ctx.fillStyle='#6e8595';ctx.font='11px Segoe UI';for(let i=0;i<=4;i++){const at=a+(b-a)*i/4,x=w*i/4;ctx.textAlign=i===0?'left':i===4?'right':'center';ctx.fillText(at.toFixed(b-a<1?3:2)+' 秒',x,h-3);}ctx.strokeStyle='#398269';ctx.lineWidth=2;for(const at of [start,end]){const x=(at-a)/(b-a)*w;if(x>=0&&x<=w){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h-17);ctx.stroke();ctx.fillStyle='#398269';ctx.fillRect(x-3,3,6,10);}}drawPlayhead(ctx,w,h-17,this.view,this.cursor());}
  drawOverview(){if(!this.overview.clientWidth)return;const {ctx,w,h}=this.context(this.overview);if(!this.source||!this.view)return;this.plot(ctx,w,h,this.overviewData,[0,this.source.duration]);const scale=w/this.source.duration;ctx.fillStyle='#bcd3e855';ctx.fillRect(this.view[0]*scale,0,Math.max(2,(this.view[1]-this.view[0])*scale),h);ctx.strokeStyle='#638ba9';ctx.strokeRect(this.view[0]*scale+.5,.5,Math.max(2,(this.view[1]-this.view[0])*scale)-1,h-1);ctx.fillStyle='#42886d';ctx.fillRect(this.selection[0]*scale,h-5,Math.max(2,(this.selection[1]-this.selection[0])*scale),4);drawPlayhead(ctx,w,h,[0,this.source.duration],this.cursor());}
}
const calNavigator=new SamplingNavigator('cal'),wizardNavigator=new SamplingNavigator('wizard',{follow:true,maxSelection:120,initialSpan:60});
let trackSampleSelection=null;
function openTrackSample(){
  if(busy||!selected||!mainWave.data)return message('请先选择并拖选需要保存的片段。');
  const start=$('rangeStart').value,end=$('rangeEnd').value;trackSampleSelection={start,end,profileId:state.profile.id};
  options($('sampleGroup'),state.profile.groups,selected.groupId||$('reviewGroup').value);$('sampleRange').textContent=`当前音轨选区 · ${(seconds(end)-seconds(start)).toFixed(3)} 秒 · 当前库：${$('profileName').textContent.replace('当前库：','')}`;
  $('sampleStatus').textContent=state.profile.groups.length?'选一个分组，即可将当前选区加入样本库。':'当前库还没有分组，请先编辑分组。';$('sampleDialog').showModal();
}
$('saveSample').onclick=openTrackSample;$('sampleClose').onclick=()=>{if(!busy)$('sampleDialog').close();};
$('sampleDialog').addEventListener('cancel',event=>{if(busy)event.preventDefault();});
$('sampleManage').onclick=()=>{$('sampleDialog').close();openLibrary();};
$('sampleSave').onclick=async()=>{if(!trackSampleSelection)return;const result=await act('trackSample',{...trackSampleSelection,groupId:$('sampleGroup').value});if(result)$('sampleDialog').close();};
$('samplePlay').onclick=async()=>{if(busy||!trackSampleSelection)return;try{await player.play(trackSampleSelection);}catch(error){$('sampleStatus').textContent=error.message;}};
