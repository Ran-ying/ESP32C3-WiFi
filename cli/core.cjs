'use strict';
const fs=require('node:fs/promises'),crypto=require('node:crypto'),{promisify}=require('node:util');
const WPA2=require('../web/crypto.js'),{TaskRunner}=require('../standalone/src/task-runner.js');
const pbkdf2=promisify(crypto.pbkdf2);
class NodeFile{
 static async open(path){const handle=await fs.open(path,'r');try{const stat=await handle.stat();if(!stat.isFile()||!stat.size||!Number.isSafeInteger(stat.size))throw Error('文件必须为非空普通文件');return new NodeFile(handle,stat.size);}catch(e){await handle.close();throw e;}}
 constructor(handle,size){this.handle=handle;this.size=size;}
 slice(start,end){start=Math.min(this.size,Math.max(0,start));end=Math.min(this.size,Math.max(start,end));return {arrayBuffer:async()=>{const data=Buffer.alloc(end-start);let at=0;while(at<data.length){const {bytesRead}=await this.handle.read(data,at,data.length-at,start+at);if(!bytesRead)throw Error('输入文件发生变化或提前结束');at+=bytesRead;}return data.buffer;}};}
 async close(){await this.handle.close();}
}
function nativeVerifier(record){
 const r=WPA2.prepare(record),order=(a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b))<0?[a,b]:[b,a];
 const context=Buffer.concat([Buffer.from('Pairwise key expansion\0'),...order(r.ap,r.client),...order(r.anonce,r.snonce),Buffer.from([0])].map(x=>Buffer.from(x)));
 return {engine:'node-native',async verify(password){if(!/^[\x20-\x7e]{8,63}$/.test(password))return false;const pmk=await pbkdf2(Buffer.from(password),r.ssid,4096,32,'sha1'),kck=crypto.createHmac('sha1',pmk).update(context).digest().subarray(0,16),mic=crypto.createHmac('sha1',kck).update(r.eapol).digest().subarray(0,16);return crypto.timingSafeEqual(mic,Buffer.from(r.mic));}};
}
class NativeLane{
 constructor(){this.dead=false;this.runner=new TaskRunner(m=>queueMicrotask(()=>{if(!this.dead)this.onmessage?.({data:m});}));}
 postMessage(m){queueMicrotask(async()=>{if(this.dead)return;try{if(m.type==='init'){this.runner.verifier=nativeVerifier(m.record);this.onmessage?.({data:{type:'ready',engine:'node-native'}});}else if(m.type==='task')await this.runner.run(m.task);else if(m.type==='pause')this.runner.pause();else if(m.type==='resume')this.runner.resume();else if(m.type==='halt')this.runner.halt();}catch(e){if(!this.dead)this.onmessage?.({data:{type:'error',message:e.message}});}});}
 terminate(){this.dead=true;this.runner.halt();}
}
module.exports={NodeFile,nativeVerifier,NativeLane};
