'use strict';
let verifier=null,job=null,paused=false,wake=null,busy=false;
async function run(task){
 if(busy)throw Error('Worker 同时收到多个任务');busy=true;job=task;
 let tested=0,last=performance.now();
 function report(type,extra={}){postMessage({type,taskId:task.id,tested,...extra});}
 try{
  const total=task.candidates?task.candidates.length:task.end-task.start+1;
  for(let i=0;i<total;i++){
   if(paused){report('paused');await new Promise(r=>wake=r);wake=null;}
   const password=task.candidates?task.candidates[i]:String(task.start+i).padStart(8,'0');
   const match=await verifier.verify(password);tested++;
   if(match){report('found',{password});return;}
   if(performance.now()-last>250){report('progress');last=performance.now();await new Promise(r=>setTimeout(r,0));}
  }
  report('done');
 }finally{busy=false;job=null;}
}
onmessage=async e=>{
 const m=e.data;
 try{
  if(m.type==='parse'){const result=await PCAP.parse(m.file,p=>postMessage({type:'importProgress',progress:p}));postMessage({type:'parsed',result});}
  else if(m.type==='init'){verifier=await ENGINE.create(m.record,m.engine);postMessage({type:'ready',engine:verifier.engine});}
  else if(m.type==='task'){if(!verifier)throw Error('Worker 尚未初始化');await run(m.task);}
  else if(m.type==='pause'){paused=true;if(!busy)postMessage({type:'paused',taskId:null,tested:0});}
  else if(m.type==='resume'){paused=false;if(wake)wake();}
 }catch(err){postMessage({type:'error',message:err.message,taskId:job?.id});}
};
