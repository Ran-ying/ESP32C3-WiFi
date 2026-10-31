(function(root){
'use strict';
class TaskRunner{
 constructor(send){this.send=send;this.verifier=null;this.busy=false;this.paused=false;this.halted=false;this.wake=null;}
 pause(){this.paused=true;if(!this.busy)this.send({type:'paused',taskId:null,tested:0});}
 resume(){this.paused=false;if(this.wake)this.wake();}
 halt(){this.halted=true;this.paused=false;if(this.wake)this.wake();if(!this.busy)this.send({type:'halted',taskId:null,tested:0});}
 async run(task){
  if(this.busy||!this.verifier)throw Error('计算任务状态错误');this.busy=true;let tested=0,last=performance.now();
  const report=(type,extra={})=>this.send({type,taskId:task.id,tested,...extra});
  try{
   const total=task.candidates?task.candidates.length:task.end-task.start+1;
   for(let i=0;i<total;i++){
    if(this.paused){report('paused');await new Promise(r=>this.wake=r);this.wake=null;}
    if(this.halted){report('halted');return;}
    const password=task.candidates?task.candidates[i]:String(task.start+i).padStart(8,'0');
    const match=await this.verifier.verify(password);tested++;
    if(match){report('found',{password});return;}
    if(performance.now()-last>200){report('progress');last=performance.now();await new Promise(r=>setTimeout(r,0));}
   }
   report(this.halted?'halted':'done');
  }finally{this.busy=false;if(this.paused&&!this.halted)this.send({type:'paused',taskId:null,tested:0});}
 }
}
if(typeof module!=='undefined'&&module.exports)module.exports={TaskRunner};else root.TaskRunner=TaskRunner;
})(typeof self!=='undefined'?self:globalThis);
