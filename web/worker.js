'use strict';
importScripts('/crypto.js');
let running=false,paused=false,state=null,pumping=false;
function progress(type,extra={}){
 const elapsed=Math.max(.001,(performance.now()-state.started-state.pauseMs)/1000);
 const numeric=state.source==='numeric8',processed=numeric?state.tested:state.offset+state.pos,total=numeric?state.end-state.start+1:state.file.size;
 postMessage({type,tested:state.tested,skipped:state.skipped,processed,bytes:numeric?0:processed,total,unit:numeric?'candidates':'bytes',rate:state.tested/elapsed,etaSeconds:processed>0?(total-processed)*elapsed/processed:null,...extra});
}
async function line(){
 const s=state;
 while(true){
  if(s.pos>=s.chunk.length){
   s.offset+=s.chunk.length;s.pos=0;
   if(s.offset>=s.file.size){if(s.pending.length||s.long){const out=s.pending;s.pending=[];const bad=s.long;s.long=false;if(out.at(-1)===13)out.pop();return bad?'':out;}return null;}
   s.chunk=new Uint8Array(await s.file.slice(s.offset,s.offset+65536).arrayBuffer());
  }
  const b=s.chunk[s.pos++];
  if(b===10){const out=s.pending;s.pending=[];const bad=s.long;s.long=false;if(out.at(-1)===13)out.pop();return bad?'':out;}
  if(!s.long){s.pending.push(b);if(s.pending.length>(s.first?67:64)){s.long=true;s.pending=[];}}
 }
}
async function candidate(){
 if(state.source==='numeric8')return state.next>state.end?null:String(state.next++).padStart(8,'0');
 let bytes=await line();if(bytes===null)return null;
 if(state.first){state.first=false;if(bytes[0]===239&&bytes[1]===187&&bytes[2]===191)bytes=bytes.slice(3);}
 if(bytes.length<8||bytes.length>63||bytes.some(b=>b<32||b>126))return '';
 return String.fromCharCode(...bytes);
}
async function step(){
 if(!running||paused||pumping)return;
 pumping=true;
 try{
  let attempts=0;
  while(attempts++<32){
   const password=state.pendingCandidate!==undefined?state.pendingCandidate:await candidate();delete state.pendingCandidate;
   if(!running||paused){state.pendingCandidate=password;return;}
   if(password===null){running=false;progress('done');return;}
   if(!password){state.skipped++;continue;}
   state.tested++;
   if(WPA2.verifyPrepared(password,state.record)){running=false;progress('found',{password});return;}
   break;
  }
  if(performance.now()-state.lastUpdate>200){progress('progress');state.lastUpdate=performance.now();}
 }catch(e){running=false;postMessage({type:'error',message:e.message});}
 finally{pumping=false;if(running&&!paused)setTimeout(step,0);}
}
onmessage=e=>{
 const m=e.data;
 try{
  if(m.type==='start'){
   if(running)throw Error('验证正在运行');
   const source=m.source||'file';
   if(!['file','numeric8'].includes(source))throw Error('不支持的候选来源');
   let start=0,end=0;
   if(source==='file'){if(!(m.file instanceof Blob)||m.file.size===0)throw Error('请选择非空 TXT 字典');}
   else{
    if(typeof m.start!=='string'||typeof m.end!=='string'||!/^\d{8}$/.test(m.start)||!/^\d{8}$/.test(m.end))throw Error('数字范围必须各为 8 位数字');
    start=Number(m.start);end=Number(m.end);if(start>end)throw Error('起始数字不能大于结束数字');
   }
   state={source,start,end,next:start,file:m.file,record:WPA2.prepare(m.record),chunk:new Uint8Array(0),pos:0,offset:0,pending:[],long:false,first:true,tested:0,skipped:0,started:performance.now(),pauseMs:0,lastUpdate:0};
   running=true;paused=false;step();
  }else if(m.type==='pause'&&running&&!paused){paused=true;state.pauseStart=performance.now();progress('paused');}
  else if(m.type==='resume'&&running&&paused){state.pauseMs+=performance.now()-state.pauseStart;paused=false;step();}
 }catch(err){postMessage({type:'error',message:err.message});}
};
