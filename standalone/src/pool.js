(function(root){
'use strict';
class Pool{
 constructor(url,onUpdate){this.url=url;this.onUpdate=onUpdate;this.run=null;}
 start({record,source,workers,engine}){
  if(this.run&&!this.run.cancelled)throw Error('任务正在运行');
  if(!Number.isInteger(workers)||workers<1||workers>256)throw Error('并行数须为 1–256 的整数');
  const n=source.kind==='numeric'?Math.min(workers,source.total):workers;
  const r={source,slots:[],completed:0,started:performance.now(),paused:false,pauseMs:0,cancelled:false,eof:false,seq:0,chain:Promise.resolve(),frontier:0,frontierId:1,finished:new Map(),phase:'running',password:null,error:null};this.run=r;
  try{
   for(let i=0;i<n;i++){
    const worker=new Worker(this.url),slot={worker,id:i+1,active:null,queued:null,assigning:false,total:0,ready:false,paused:false,engine:'初始化'};r.slots.push(slot);
    worker.onmessage=e=>{if(this.run!==r||r.cancelled)return;this.message(r,slot,e.data);};
    worker.onerror=e=>{if(this.run===r&&!r.cancelled)this.finish(r,'error',e.message||'Worker 启动失败');};
    worker.postMessage({type:'init',record,engine});
   }
  }catch(e){this.finish(r,'error',e.message);}
  this.emit(r);
 }
 message(r,slot,m){
  if(m.type==='error'){this.finish(r,'error',m.message);return;}
  if(m.type==='ready'){slot.ready=true;slot.engine=m.engine;if(r.paused)slot.worker.postMessage({type:'pause'});else this.assign(r,slot);}
  if(m.type==='paused'){if(slot.active&&m.taskId===slot.active.id)slot.active.tested=m.tested;slot.paused=true;}
  if(['progress','done','found'].includes(m.type)){
   if(!slot.active||slot.active.id!==m.taskId)return;slot.active.tested=m.tested;
   if(m.type==='found'){r.password=m.password;this.finish(r,'found');return;}
   if(m.type==='done'){
    const t=slot.active;r.completed+=m.tested;slot.total+=m.tested;slot.active=null;r.finished.set(t.id,t.endByte);
    while(r.finished.has(r.frontierId)){r.frontier=r.finished.get(r.frontierId);r.finished.delete(r.frontierId++);}
    if(!r.paused)this.assign(r,slot);
   }
  }
  this.complete(r);this.emit(r);
 }
 async assign(r,slot){
  if(r.cancelled||r.paused||slot.active||slot.assigning||!slot.ready)return;
  if(slot.queued){this.dispatch(r,slot,slot.queued);slot.queued=null;return;}
  slot.assigning=true;
  try{
   const promise=r.chain.then(async()=>{if(r.cancelled)return null;const task=await r.source.nextBatch();return task?{...task,id:++r.seq,tested:0}:null;});
   r.chain=promise.catch(()=>null);const task=await promise;if(r.cancelled)return;
   if(!task)r.eof=true;else if(r.paused)slot.queued=task;else this.dispatch(r,slot,task);
  }catch(e){if(!r.cancelled)this.finish(r,'error',e.message);}
  finally{slot.assigning=false;if(!r.cancelled){this.complete(r);this.emit(r);}}
 }
 dispatch(r,slot,task){slot.active=task;slot.worker.postMessage({type:'task',task});}
 complete(r){if(r.eof&&!r.slots.some(s=>s.active||s.queued||s.assigning))this.finish(r,'done');}
 pause(){const r=this.run;if(!r||r.cancelled||r.paused)return;r.paused=true;r.pauseStart=performance.now();for(const s of r.slots){s.paused=false;s.worker.postMessage({type:'pause'});}this.emit(r);}
 resume(){const r=this.run;if(!r||r.cancelled||!r.paused)return;r.pauseMs+=performance.now()-r.pauseStart;r.paused=false;for(const s of r.slots){s.paused=false;s.worker.postMessage({type:'resume'});this.assign(r,s);}this.emit(r);}
 stop(){const r=this.run;if(r&&!r.cancelled)this.finish(r,'stopped');}
 finish(r,phase,error=null){
  if(r.cancelled)return;r.phase=phase;r.error=error;r.ended=performance.now();r.cancelled=true;
  for(const s of r.slots)s.worker.terminate();this.emit(r);
 }
 snapshot(r=this.run){
  if(!r)return null;const now=r.ended||performance.now(),elapsed=Math.max(.001,(now-r.started-r.pauseMs-(r.paused?now-r.pauseStart:0))/1000);
  const tested=r.completed+r.slots.reduce((n,s)=>n+(s.active?.tested||0),0),processed=r.source.kind==='numeric'?tested:r.frontier,total=r.source.total,rate=tested/elapsed;
  return {phase:r.phase,paused:r.paused,allPaused:r.slots.every(s=>s.paused),tested,skipped:r.source.skipped,processed,total,rate,elapsed,percent:Math.min(100,processed/total*100),eta:r.source.kind==='numeric'&&rate>0?(total-tested)/rate:null,password:r.password,error:r.error,kind:r.source.kind,
   slots:r.slots.map(s=>({id:s.id,total:s.total+(s.active?.tested||0),engine:s.engine,state:r.cancelled?'结束':r.paused?(s.paused?'已暂停':'暂停中'):s.active?'计算中':s.assigning?'分配中':s.ready?'等待':'初始化',range:s.active?(s.active.candidates?`TXT 批次 ${s.active.id}`:`${String(s.active.start).padStart(8,'0')}–${String(s.active.end).padStart(8,'0')}`):'—'}))};
 }
 emit(r){this.onUpdate(this.snapshot(r));}
}
root.ParallelPool=Pool;
})(typeof self!=='undefined'?self:globalThis);
