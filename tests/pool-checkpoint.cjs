'use strict';
const assert=require('node:assert/strict'),{Pool}=require('../standalone/src/pool.js'),{TaskRunner}=require('../standalone/src/task-runner.js'),{NumericSource,FileSource}=require('../standalone/src/source.js'),{RegexSource}=require('../standalone/src/regex.js');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let attempted=[],concurrent=0,maximum=0;
class Lane{
 constructor(){this.dead=false;this.runner=new TaskRunner(m=>queueMicrotask(()=>{if(!this.dead)this.onmessage?.({data:m});}));}
 postMessage(m){queueMicrotask(async()=>{if(this.dead)return;try{if(m.type==='init'){this.runner.verifier={async verify(p){attempted.push(p);maximum=Math.max(maximum,++concurrent);await sleep(2);concurrent--;return false;}};this.onmessage?.({data:{type:'ready',engine:'test'}});}else if(m.type==='task')await this.runner.run(m.task);else if(m.type==='pause')this.runner.pause();else if(m.type==='resume')this.runner.resume();else if(m.type==='halt')this.runner.halt();}catch(e){this.onmessage?.({data:{type:'error',message:e.message}});}});}
 terminate(){this.dead=true;this.runner.halt();}
}
async function until(test){const start=Date.now();while(!test()){if(Date.now()-start>10000)throw Error('Pool state timeout');await sleep(2);}}
(async()=>{
 const record={version:2,ap:'a',client:'b',mic:'m',eapol:'e',ssid_hex:'s'};let last;
 const pool=new Pool(null,s=>last=s,Lane),config={record,source:new NumericSource('00001000','00001255',4),workers:4,engine:'test'};
 pool.start(config);await sleep(10);pool.resize(1);await sleep(8);pool.resize(6);await sleep(10);pool.pause();await until(()=>last.paused&&last.allPaused);const paused=last.tested;await sleep(10);assert.equal(last.tested,paused);
 assert(pool.canResume({...config,source:new NumericSource('00001000','00001255',2)}));pool.start({...config,workers:3});await sleep(10);pool.stop();await until(()=>last.phase==='stopped');assert(last.tested>0&&last.tested<256);const stopped=last.tested;
 pool.start({...config,source:new NumericSource('00001000','00001255',2),workers:2});await until(()=>last.phase==='done');assert.equal(last.tested,256);assert.equal(last.resumes,1);assert.equal(attempted.length,256);assert.equal(new Set(attempted).size,256);assert(last.tested>=stopped);
 attempted=[];const file=new Blob([Array.from({length:40},(_,i)=>`pass-${String(i).padStart(3,'0')}`).join('\n')]);pool.start({record,source:new FileSource(file,4),workers:4,engine:'test'});await sleep(8);pool.stop();await until(()=>last.phase==='stopped');assert(pool.canResume({record,source:new FileSource(file,8)}));assert(!pool.canResume({record,source:new FileSource(new Blob(['different-pass']),8)}));pool.start({record,source:new FileSource(file,4),workers:4,engine:'test'});await until(()=>last.phase==='done');assert.equal(last.tested,40);assert.equal(last.percent,100);assert.equal(new Set(attempted).size,40);assert.equal(attempted.length,40);assert(maximum>=3);
 attempted=[];const pattern='^abcde[0-3]{3}$';pool.start({record,source:new RegexSource(pattern,4),workers:4,engine:'test'});await sleep(10);pool.stop();await until(()=>last.phase==='stopped');assert(!pool.canResume({record,source:new RegexSource('^abcde[0-2]{3}$',4)}));pool.start({record,source:new RegexSource(pattern,4),workers:4,engine:'test'});await until(()=>last.phase==='done');assert.equal(last.tested,64);assert.equal(new Set(attempted).size,64);assert.equal(attempted.length,64);
 console.log('PASS shared pool: live 4→1→6 resize, pause/start continuation, stop/start exact checkpoints, numeric/TXT/regex coverage without lost or duplicate candidates, changed-source reset gate');
})().catch(e=>{console.error(e);process.exitCode=1;});
