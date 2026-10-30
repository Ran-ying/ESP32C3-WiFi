const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const fixture=require('./fixtures/wpa2-synthetic.json'),WPA2=require('../web/crypto.js');
const source=fs.readFileSync(require.resolve('../web/worker.js'),'utf8');
function harness(){
 const events=[],timers=new Set();let resolve,reject;
 const done=new Promise((a,b)=>{resolve=a;reject=b;});
 const context={WPA2,Blob,Uint8Array,performance,console,importScripts:p=>assert.equal(p,'/crypto.js'),postMessage:m=>{events.push(m);if(['found','done','error'].includes(m.type))resolve(m);},setTimeout:(f,ms)=>{const t=setTimeout(()=>{timers.delete(t);f();},ms);timers.add(t);return t;}};
 vm.createContext(context);vm.runInContext(source,context);
 return {events,send:m=>context.onmessage({data:m}),done,close:()=>{for(const t of timers)clearTimeout(t);},wait:()=>Promise.race([done,new Promise((_,r)=>{const t=setTimeout(()=>r(Error('Worker test timeout')),15000);timers.add(t);})])};
}
(async()=>{
 let h=harness();try{
  // Correct candidate across the 64 KiB chunk boundary; BOM/CRLF, invalid lines,
  // overlong line, spaces kept and EOF without newline. No crypto.subtle exists.
  const prefix='\ufeffshort\r\n'+'x'.repeat(65520)+'\r\n'+'wrong-password\n';
  h.send({type:'start',record:fixture.record,file:new Blob([prefix,fixture.password])});
  const m=await h.wait();assert.equal(m.type,'found');assert.equal(m.password,fixture.password);assert.equal(m.tested,2);assert.equal(m.skipped,2);assert.equal(m.bytes,m.total);
 }finally{h.close();}
 h=harness();try{
  h.send({type:'start',record:fixture.record,file:new Blob([fixture.password+'\n'])});
  h.send({type:'pause'});await new Promise(r=>setTimeout(r,40));assert(h.events.some(x=>x.type==='paused'));assert(!h.events.some(x=>x.type==='found'));
  h.send({type:'resume'});assert.equal((await h.wait()).type,'found');
 }finally{h.close();}
 h=harness();try{
  h.send({type:'start',record:fixture.record,file:new Blob(['wrong-password\r\n123\n'])});const m=await h.wait();assert.equal(m.type,'done');assert.equal(m.tested,1);assert.equal(m.skipped,1);
 }finally{h.close();}
 h=harness();try{
  h.send({type:'start',record:{...fixture.record,version:3},file:new Blob([fixture.password])});assert.equal((await h.wait()).type,'error');
 }finally{h.close();}
 console.log('PASS Worker without WebCrypto: 64KiB boundaries, BOM/CRLF/EOF, long/invalid lines, correct/wrong candidates, pause/resume, rejected unsupported handshake');
})().catch(e=>{console.error(e);process.exitCode=1;});
