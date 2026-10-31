'use strict';
const runner=new TaskRunner(m=>postMessage(m));
onmessage=async e=>{
 const m=e.data;
 try{
  if(m.type==='parse'){const result=await PCAP.parse(m.file,p=>postMessage({type:'importProgress',progress:p}));postMessage({type:'parsed',result});}
  else if(m.type==='init'){runner.verifier=await ENGINE.create(m.record,m.engine);postMessage({type:'ready',engine:runner.verifier.engine});}
  else if(m.type==='task')await runner.run(m.task);
  else if(m.type==='pause')runner.pause();else if(m.type==='resume')runner.resume();else if(m.type==='halt')runner.halt();
 }catch(err){postMessage({type:'error',message:err.message});}
};
