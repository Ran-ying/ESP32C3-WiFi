/* Local WPA2-PSK/CCMP verifier. No Web Crypto, network, or persistent storage. */
(function(root){
'use strict';
const enc=new TextEncoder();
function concat(...parts){const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out;}
function hex(s,bytes){if(typeof s!=='string'||!s.length||s.length%2||!/^[0-9a-f]+$/i.test(s)||(bytes!==undefined&&s.length!==bytes*2))throw Error('无效十六进制字段');return Uint8Array.from(s.match(/../g),x=>parseInt(x,16));}
function toHex(a){return Array.from(a,x=>x.toString(16).padStart(2,'0')).join('');}
function equal(a,b){if(a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a[i]^b[i];return n===0;}
function sha1(data){
 const length=Math.ceil((data.length+9)/64)*64,p=new Uint8Array(length);p.set(data);p[data.length]=0x80;
 const view=new DataView(p.buffer);view.setUint32(length-8,Math.floor(data.length/0x20000000));view.setUint32(length-4,(data.length*8)>>>0);
 let a0=0x67452301,b0=0xefcdab89,c0=0x98badcfe,d0=0x10325476,e0=0xc3d2e1f0;
 const w=new Int32Array(80),rol=(x,n)=>(x<<n)|(x>>>(32-n));
 for(let off=0;off<length;off+=64){
  for(let i=0;i<16;i++)w[i]=view.getInt32(off+4*i);
  for(let i=16;i<80;i++)w[i]=rol(w[i-3]^w[i-8]^w[i-14]^w[i-16],1);
  let a=a0,b=b0,c=c0,d=d0,e=e0;
  for(let i=0;i<80;i++){
   let f,k;if(i<20){f=(b&c)|(~b&d);k=0x5a827999;}else if(i<40){f=b^c^d;k=0x6ed9eba1;}else if(i<60){f=(b&c)|(b&d)|(c&d);k=0x8f1bbcdc;}else{f=b^c^d;k=0xca62c1d6;}
   const t=(rol(a,5)+f+e+k+w[i])|0;e=d;d=c;c=rol(b,30);b=a;a=t;
  }
  a0=(a0+a)|0;b0=(b0+b)|0;c0=(c0+c)|0;d0=(d0+d)|0;e0=(e0+e)|0;
 }
 const out=new Uint8Array(20),v=new DataView(out.buffer);[a0,b0,c0,d0,e0].forEach((x,i)=>v.setInt32(i*4,x));return out;
}
function hmacFactory(key){
 if(key.length>64)key=sha1(key);const inner=new Uint8Array(64),outer=new Uint8Array(64);inner.fill(0x36);outer.fill(0x5c);
 for(let i=0;i<key.length;i++){inner[i]^=key[i];outer[i]^=key[i];}
 return data=>sha1(concat(outer,sha1(concat(inner,data))));
}
function hmac(key,data){return hmacFactory(key)(data);}
function pbkdf2(password,salt,iterations=4096,length=32){
 if(!Number.isInteger(iterations)||iterations<1||!Number.isInteger(length)||length<1||length>64)throw Error('PBKDF2 参数无效');
 const prf=hmacFactory(password),out=new Uint8Array(Math.ceil(length/20)*20);
 for(let block=1;block<=out.length/20;block++){
  const ctr=new Uint8Array(4);new DataView(ctr.buffer).setUint32(0,block);
  let u=prf(concat(salt,ctr)),t=u.slice();for(let i=1;i<iterations;i++){u=prf(u);for(let j=0;j<20;j++)t[j]^=u[j];}out.set(t,(block-1)*20);
 }return out.slice(0,length);
}
function compare(a,b){for(let i=0;i<a.length;i++)if(a[i]!==b[i])return a[i]-b[i];return 0;}
function ordered(a,b){return compare(a,b)<0?concat(a,b):concat(b,a);}
function ptk(pmk,ap,client,anonce,snonce){
 const label=enc.encode('Pairwise key expansion'),data=concat(ordered(ap,client),ordered(anonce,snonce)),out=new Uint8Array(80);
 for(let i=0;i<4;i++)out.set(hmac(pmk,concat(label,new Uint8Array([0]),data,new Uint8Array([i]))),i*20);
 return out.slice(0,64);
}
function validate(record){
 if(!record||record.version!==2)throw Error('仅支持 Key Descriptor Version 2 / HMAC-SHA1-128');
 const ap=hex(record.ap.replaceAll(':',''),6),client=hex(record.client.replaceAll(':',''),6);
 if((ap[0]&1)||(client[0]&1)||equal(ap,client))throw Error('无效 AP/客户端 MAC');
 const anonce=hex(record.anonce,32),snonce=hex(record.snonce,32),ssid=hex(record.ssid_hex),mic=hex(record.mic,16),eapol=hex(record.eapol);
 if(ssid.length>32||!anonce.some(x=>x)||!snonce.some(x=>x)||!mic.some(x=>x))throw Error('缺少有效 SSID / Nonce / MIC');
 if(eapol.length<99||eapol.length>512||![1,2].includes(eapol[0])||eapol[1]!==3||eapol[4]!==2)throw Error('EAPOL 格式无效');
 const v=new DataView(eapol.buffer),info=v.getUint16(5);
 if(v.getUint16(2)+4!==eapol.length||v.getUint16(97)+99!==eapol.length)throw Error('EAPOL 长度不一致');
 if((info&7)!==2||(info&8)===0||(info&0x100)===0||(info&(0x80|0x40|0x200|0x400|0x800|0x1000|0x2000))!==0)throw Error('验证记录必须使用未加密的 M2，版本 2');
 if(![0,16].includes(v.getUint16(7))||!equal(eapol.slice(17,49),snonce)||!equal(eapol.slice(81,97),mic))throw Error('M2 Nonce / MIC / 密钥长度不一致');
 eapol.fill(0,81,97);return {ap,client,anonce,snonce,ssid,mic,eapol};
}
function prepare(record){return validate(record);}
function verifyPrepared(password,r){
 if(typeof password!=='string'||password.length<8||password.length>63||!/^[\x20-\x7e]+$/.test(password))return false;
 const pmk=pbkdf2(enc.encode(password),r.ssid),key=ptk(pmk,r.ap,r.client,r.anonce,r.snonce).slice(0,16);
 return equal(hmac(key,r.eapol).slice(0,16),r.mic);
}
const api={sha1,hmac,pbkdf2,ptk,hex,toHex,prepare,verifyPrepared,verify:(p,r)=>verifyPrepared(p,prepare(r))};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.WPA2=api;
})(typeof self!=='undefined'?self:globalThis);
