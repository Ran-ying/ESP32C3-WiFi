(function(root){
'use strict';
function recordKey(r){return JSON.stringify(['version','ap','client','anonce','snonce','mic','eapol','ssid_hex'].map(k=>r[k]));}
function sameSource(a,b){if(a.kind!==b.kind)return false;if(a.kind==='file')return a.file===b.file;if(a.kind==='regex')return a.pattern===b.pattern;return a.start===b.start&&a.end===b.end&&a.format===b.format;}
class Pool{
 constructor(url,onUpdate,WorkerClass){this.url=url;this.onUpdate=onUpdate;this.WorkerClass=WorkerClass||root.Worker;this.run=null;}
 canResume({record,source}){const r=this.run;return !!r&&(r.phase==='stopped'||(r.phase==='running'&&r.paused))&&r.key===recordKey(record)&&sameSource(r.source,source);}
 start({record,source,workers,engine}){
  this.validateWorkers(workers);let r=this.run;
  if(this.canResume({record,source})){
   if(r.phase==='running'){this.resize(workers);this.resume();return;}
   r.savedElapsed=this.snapshot(r).elapsed;r.started=performance.now();r.pauseMs=0;r.paused=false;r.ended=null;r.cancelled=false;r.stopRequested=false;r.phase='running';r.engine=engine;r.slots=[];r.resumes++;this.resize(workers);this.emit(r);return;
  }
  if(r&&!r.cancelled)throw Error('请先停止当前任务');
  r={record,key:recordKey(record),engine,source,slots:[],pending:[],reads:0,completed:0,savedElapsed:0,started:performance.now(),paused:false,pauseMs:0,cancelled:false,stopRequested:false,eof:false,seq:0,slotSeq:0,chain:Promise.resolve(),frontier:0,frontierId:1,finished:new Map(),phase:'running',password:null,error:null,resumes:0};this.run=r;this.resize(workers);this.emit(r);
 }
 validateWorkers(n){if(!Number.isInteger(n)||n<1||n>256)throw Error('并行数须为 1–256 的整数');}
 resize(n){
  this.validateWorkers(n);const r=this.run;if(!r||r.cancelled||r.stopRequested)return;
  r.desired=r.source.kind==='file'?n:Math.min(n,r.source.total);
  const live=r.slots.filter(s=>!s.retiring);for(const s of live.slice(r.desired).reverse()){s.retiring=true;s.worker.postMessage({type:'halt'});}
  this.ensure(r);this.emit(r);
 }
 ensure(r){
  if(r.cancelled||r.stopRequested)return;
  while(r.slots.filter(s=>!s.retiring).length<r.desired){
   try{
    const worker=new this.WorkerClass(this.url),s={worker,id:++r.slotSeq,active:null,assigning:false,total:0,ready:false,paused:false,retiring:false,dead:false,engine:'初始化'};r.slots.push(s);
    worker.onmessage=e=>{if(this.run===r&&!r.cancelled&&!s.dead)this.message(r,s,e.data);};
    worker.onerror=e=>{if(this.run===r&&!r.cancelled)this.finish(r,'error',e.message||'Worker 失败');};worker.postMessage({type:'init',record:r.record,engine:r.engine});
   }catch(e){this.finish(r,'error',e.message);return;}
  }
  for(const s of r.slots)if(!s.retiring)this.assign(r,s);
 }
 markDone(r,t){r.finished.set(t.id,t.endByte);while(r.finished.has(r.frontierId)){r.frontier=r.finished.get(r.frontierId);r.finished.delete(r.frontierId++);}}
 account(r,s,tested,partial){
  const t=s.active;if(!t)return;r.completed+=tested;s.total+=tested;
  if(tested<t.size&&partial){const tail={...t,size:t.size-tested,tested:0};if(t.candidates)tail.candidates=t.candidates.slice(tested);else tail.start=t.start+tested;r.pending.unshift(tail);}else this.markDone(r,t);
  s.active=null;
 }
 remove(r,s){s.dead=true;s.worker.terminate();r.slots=r.slots.filter(x=>x!==s);}
 message(r,s,m){
  if(m.type==='error'){this.finish(r,'error',m.message);return;}
  if(m.type==='ready'){s.ready=true;s.engine=m.engine;if(s.retiring||r.stopRequested)s.worker.postMessage({type:'halt'});else{if(r.paused)s.worker.postMessage({type:'pause'});this.assign(r,s);}}
  if(m.type==='paused'&&r.paused){if(s.active&&s.active.id===m.taskId)s.active.tested=m.tested;s.paused=true;}
  if(['progress','done','found','halted'].includes(m.type)){
   if(s.active){if(s.active.id!==m.taskId)return;s.active.tested=m.tested;}
   else if(m.taskId!==null)return;
   if(m.type==='found'){r.password=m.password;this.finish(r,'found');return;}
   if(m.type==='done'){this.account(r,s,m.tested,false);if(s.retiring||r.stopRequested){this.remove(r,s);}else this.assign(r,s);}
   if(m.type==='halted'){this.account(r,s,m.tested,true);this.remove(r,s);}
  }
  this.ensure(r);this.complete(r);this.emit(r);
 }
 async assign(r,s){
  if(r.cancelled||r.stopRequested||r.paused||s.dead||s.retiring||s.active||s.assigning||!s.ready)return;
  if(r.pending.length){this.dispatch(s,r.pending.shift());return;}
  if(r.eof){this.complete(r);return;}
  s.assigning=true;r.reads++;
  try{
   const promise=r.chain.then(async()=>{if(r.cancelled)return null;if(r.pending.length)return r.pending.shift();const t=await r.source.nextBatch();return t?{...t,id:++r.seq,tested:0}:null;});r.chain=promise.catch(()=>null);
   const t=await promise;if(r.cancelled)return;
   if(!t)r.eof=true;else if(r.stopRequested||r.paused||s.retiring||s.dead)r.pending.push(t);else this.dispatch(s,t);
  }catch(e){if(!r.cancelled)this.finish(r,'error',e.message);}
  finally{s.assigning=false;r.reads--;if(!r.cancelled){this.ensure(r);this.complete(r);this.emit(r);}}
 }
 dispatch(s,t){s.active=t;s.worker.postMessage({type:'task',task:t});}
 complete(r){
  if(r.cancelled)return;
  if(r.stopRequested){if(!r.slots.length&&!r.reads){clearTimeout(r.stopTimer);r.phase='stopped';r.cancelled=true;r.ended=performance.now();this.emit(r);}return;}
  if(r.eof&&!r.pending.length&&!r.reads&&!r.slots.some(s=>s.active))this.finish(r,'done');
 }
 pause(){const r=this.run;if(!r||r.cancelled||r.paused||r.stopRequested)return;r.paused=true;r.pauseStart=performance.now();for(const s of r.slots){s.paused=false;s.worker.postMessage({type:'pause'});}this.emit(r);}
 resume(){const r=this.run;if(!r||r.cancelled||!r.paused||r.stopRequested)return;r.pauseMs+=performance.now()-r.pauseStart;r.paused=false;for(const s of r.slots){s.paused=false;s.worker.postMessage({type:'resume'});}this.ensure(r);this.emit(r);}
 stop(){
  const r=this.run;if(!r||r.cancelled||r.stopRequested)return;if(r.paused){r.pauseMs+=performance.now()-r.pauseStart;r.paused=false;}
  r.phase='stopping';r.stopRequested=true;for(const s of [...r.slots]){s.retiring=true;s.worker.postMessage({type:'halt'});}
  r.stopTimer=setTimeout(()=>{for(const s of [...r.slots]){this.account(r,s,s.active?.tested||0,true);this.remove(r,s);}this.complete(r);},3000);this.complete(r);this.emit(r);
 }
 finish(r,phase,error=null){if(r.cancelled)return;clearTimeout(r.stopTimer);r.phase=phase;r.error=error;r.ended=performance.now();r.cancelled=true;for(const s of r.slots)s.worker.terminate();this.emit(r);}
 snapshot(r=this.run){
  if(!r)return null;const now=r.ended||performance.now(),elapsed=Math.max(.001,r.savedElapsed+(now-r.started-r.pauseMs-(r.paused?now-r.pauseStart:0))/1000);
  const tested=r.completed+r.slots.reduce((n,s)=>n+(s.active?.tested||0),0),processed=r.source.kind!=='file'?tested:r.frontier,total=r.source.total,rate=tested/elapsed;
  return {phase:r.phase,paused:r.paused,allPaused:r.slots.every(s=>s.paused),tested,skipped:r.source.skipped,processed,total,rate,elapsed,percent:Math.min(100,processed/total*100),eta:r.source.kind!=='file'&&rate>0?(total-tested)/rate:null,password:r.password,error:r.error,kind:r.source.kind,desired:r.desired,resumes:r.resumes,
   slots:r.slots.map(s=>({id:s.id,total:s.total+(s.active?.tested||0),engine:s.engine,state:r.cancelled?'结束':s.retiring?'收回任务':r.paused?(s.paused?'已暂停':'暂停中'):s.active?'计算中':s.assigning?'分配中':s.ready?'等待':'初始化',range:s.active?(s.active.label||(s.active.candidates?`TXT 批次 ${s.active.id}`:`${String(s.active.start).padStart(8,'0')}–${String(s.active.end).padStart(8,'0')}`)):'—'}))};
 }
 emit(r){this.onUpdate(this.snapshot(r));}
}
if(typeof module!=='undefined'&&module.exports)module.exports={Pool};else root.ParallelPool=Pool;
})(typeof self!=='undefined'?self:globalThis);
