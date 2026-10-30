(function(root){
'use strict';
async function create(record,mode='auto'){
 const r=WPA2.prepare(record),enc=new TextEncoder(),native=!!root.crypto?.subtle;
 if(!['auto','native','js'].includes(mode))throw Error('无效运算引擎');
 if(mode==='native'&&!native)throw Error('当前页面无 Web Crypto，请选自动或纯 JS');
 const engine=mode==='js'?'js':native?'native':'js';
 function order(a,b){for(let i=0;i<a.length;i++){if(a[i]<b[i])return [a,b];if(a[i]>b[i])return [b,a];}return [a,b];}
 const parts=[enc.encode('Pairwise key expansion'),new Uint8Array([0]),...order(r.ap,r.client),...order(r.anonce,r.snonce),new Uint8Array([0])];
 const context=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){context.set(p,at);at+=p.length;}
 return {engine,async verify(password){
  if(!/^[\x20-\x7e]{8,63}$/.test(password))return false;
  const bytes=enc.encode(password);let pmk;
  if(engine==='native'){
   const key=await root.crypto.subtle.importKey('raw',bytes,'PBKDF2',false,['deriveBits']);
   pmk=new Uint8Array(await root.crypto.subtle.deriveBits({name:'PBKDF2',salt:r.ssid,iterations:4096,hash:'SHA-1'},key,256));
  }else pmk=WPA2.pbkdf2(bytes,r.ssid,4096,32);
  const kck=WPA2.hmac(pmk,context).slice(0,16),mic=WPA2.hmac(kck,r.eapol);let diff=0;
  for(let i=0;i<16;i++)diff|=mic[i]^r.mic[i];return diff===0;
 }};
}
const api={create};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ENGINE=api;
})(typeof self!=='undefined'?self:globalThis);
