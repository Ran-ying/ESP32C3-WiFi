/* Bounded, local PCAP/PCAPNG reader. Only wireless DLT 105/127 is supported. */
(function(root){
'use strict';
const hex=a=>Array.from(a,x=>x.toString(16).padStart(2,'0')).join('');
const mac=a=>Array.from(a,x=>x.toString(16).padStart(2,'0')).join(':');
const eq=(a,b)=>a.length===b.length&&a.every((x,i)=>x===b[i]);
const nz=a=>a.some(x=>x!==0);
const be16=(a,i)=>(a[i]<<8)|a[i+1];
class Cursor{
 constructor(file){this.file=file;this.at=0;this.base=0;this.buf=new Uint8Array(0);}
 async read(n){
  if(!Number.isSafeInteger(n)||n<0||n>4*1024*1024||this.at+n>this.file.size)throw Error('抓包截断或记录长度非法');
  if(this.at<this.base||this.at+n>this.base+this.buf.length){this.base=this.at;this.buf=new Uint8Array(await this.file.slice(this.at,Math.min(this.file.size,this.at+Math.max(65536,n))).arrayBuffer());}
  const out=this.buf.subarray(this.at-this.base,this.at-this.base+n);this.at+=n;return out;
 }
 skip(n){if(n<0||this.at+n>this.file.size)throw Error('抓包块超出文件');this.at+=n;}
}
function rsn(data){
 try{
  const v=new DataView(data.buffer,data.byteOffset,data.length);let p=0;
  if(data.length<8||v.getUint16(p,true)!==1)return false;p+=6;
  const pairs=v.getUint16(p,true);p+=2;if(pairs<1||pairs>32||p+4*pairs+2>data.length)return false;
  const pair=[];for(let i=0;i<pairs;i++,p+=4)pair.push(hex(data.subarray(p,p+4)));
  const akms=v.getUint16(p,true);p+=2;if(akms<1||akms>32||p+4*akms>data.length)return false;
  const akm=[];for(let i=0;i<akms;i++,p+=4)akm.push(hex(data.subarray(p,p+4)));
  return pair.length===1&&pair[0]==='000fac04'&&akm.length===1&&akm[0]==='000fac02';
 }catch{return false;}
}
function ies(a){
 let ssid=null,mode=null;
 for(let p=0;p<a.length;){if(p+2>a.length)return null;const type=a[p++],n=a[p++];if(p+n>a.length)return null;const data=a.subarray(p,p+n);p+=n;
  if(type===0&&n>0&&n<=32&&nz(data))ssid=hex(data);
  if(type===48)mode=rsn(data);
 }
 return {ssid,mode};
}
function unwrap(a,link){
 if(link===105)return {frame:a,channel:0,pad:false};
 if(link!==127)throw Error(`不支持链路类型 ${link}，需要 802.11 或 radiotap PCAP`);
 if(a.length<8||a[0]!==0)return null;
 const v=new DataView(a.buffer,a.byteOffset,a.length),len=v.getUint16(2,true);if(len<8||len>a.length)return null;
 let p=4,first=0,word=0,words=0;
 do{if(p+4>len||words++>32)return null;word=v.getUint32(p,true);if(words===1)first=word;p+=4;}while(word&0x80000000);
 let flags=0,channel=0;const sizes=[[8,8],[1,1],[1,1],[2,4]];
 for(let bit=0;bit<4;bit++)if(first&(1<<bit)){
  const [align,size]=sizes[bit];p=Math.ceil(p/align)*align;if(p+size>len)return null;
  if(bit===1)flags=a[p];if(bit===3){const f=v.getUint16(p,true);channel=f===2484?14:f>=2412&&f<=2472&&(f-2407)%5===0?(f-2407)/5:0;}p+=size;
 }
 if(flags&0x40)return null;
 const end=a.length-((flags&0x10)?4:0);if(end<len)return null;
 return {frame:a.subarray(len,end),channel,pad:!!(flags&0x20)};
}
function key(frame,pad){
 const f=frame,n=f.length;if(n<24||(f[0]&15)!==8||(f[1]&0x44)||(f[22]&15)||(f[0]&0x40))return null;
 const ds=f[1]&3;if(ds===3)return null;
 const ap=ds===1?f.subarray(4,10):ds===2?f.subarray(10,16):f.subarray(16,22);
 const src=ds===2?f.subarray(16,22):f.subarray(10,16),dst=ds===1?f.subarray(16,22):f.subarray(4,10);
 if((ds===1&&!eq(dst,ap))||(ds===2&&!eq(src,ap))||(ds===0&&!eq(src,ap)&&!eq(dst,ap)))return null;
 let h=24;if(f[0]&128){if(n<h+2||(f[h]&128))return null;h+=2;if(f[1]&128)h+=4;}if(pad)h=Math.ceil(h/4)*4;
 const llc=[170,170,3,0,0,0,136,142];if(n<h+8+99||!llc.every((x,i)=>f[h+i]===x))return null;
 const p=f.subarray(h+8),len=be16(p,2)+4;if(![1,2].includes(p[0])||p[1]!==3||p[4]!==2||len<99||len>512||len>p.length||be16(p,97)!==len-99)return null;
 const info=be16(p,5);if(!(info&8)||(info&0x2c00))return null;
 const ack=!!(info&128),mic=!!(info&256),install=!!(info&64),secure=!!(info&512),encrypted=!!(info&4096),from=eq(src,ap),nonce=p.slice(17,49);
 let message=0;
 if(from&&ack&&!mic&&!install&&!secure&&!encrypted&&nz(nonce))message=1;
 if(!from&&!ack&&mic&&!install&&!secure&&!encrypted&&nz(nonce))message=2;
 if(from&&ack&&mic&&install&&nz(nonce))message=3;
 if(!from&&!ack&&mic&&!install&&secure&&!encrypted&&!nz(nonce)&&len===99)message=4;
 const client=from?dst:src;if(!message||(client[0]&1)||!nz(client)||!nz(ap)||eq(client,ap))return null;
 let replay=0n;for(let i=9;i<17;i++)replay=(replay<<8n)|BigInt(p[i]);
 if(message>=3&&replay===0n)return null;
 const parsed=message===2?ies(p.subarray(99,len)):null;
 return {ap:mac(ap),client:mac(client),message,replay,version:info&7,keyLength:be16(p,7),nonce:hex(nonce),mic:hex(p.subarray(81,97)),eapol:hex(p.subarray(0,len)),mode:message===2&&!parsed?false:parsed?.mode??null};
}
async function parse(file,onProgress=()=>{}){
 const c=new Cursor(file),groups=new Map(),networks=new Map(),stats={packets:0,eapol:0,ignored:0,truncated:0},links=new Set();let id=0,lastProgress=0;
 function packet(bytes,link,scope){
  stats.packets++;const u=unwrap(bytes,link);if(!u){stats.ignored++;return;}const f=u.frame;
  if(f.length>=36&&[0x80,0x50].includes(f[0])&&(f[1]&3)===0){const tags=ies(f.subarray(36)),bssid=mac(f.subarray(16,22));if(tags){let net=networks.get(bssid);if(!net){if(networks.size>=2048)throw Error('网络数过多，请裁剪抓包');net={ssids:new Set(),mode:null};networks.set(bssid,net);}if(tags.ssid){net.ssids.add(tags.ssid);if(net.ssids.size>16)throw Error('同一 BSSID 的 SSID 冲突过多');}if(tags.mode!==null)net.mode=tags.mode;}}
  const k=key(f,u.pad);if(!k){stats.ignored++;return;}stats.eapol++;
  const base=k.replay-(k.message>=3?1n:0n),groupKey=`${scope}/${u.channel}/${k.ap}/${k.client}/${base}`;
  let variants=groups.get(groupKey);if(!variants){if(groups.size>=2048)throw Error('会话数过多，请裁剪抓包');variants=[];groups.set(groupKey,variants);}
  let s=null,conflict=false;
  for(const x of variants){
   const nonceConflict=([1,3].includes(k.message)&&x.anonce&&x.anonce!==k.nonce)||(k.message===2&&x.snonce&&x.snonce!==k.nonce);
   if(nonceConflict||x.version!==k.version||(x.messages[k.message]&&x.messages[k.message].eapol!==k.eapol)){x.ambiguous=true;conflict=true;}else s=x;
  }
  if(!s){if(id>=2048)throw Error('会话数超过 2048，请裁剪抓包');s={id:++id,ap:k.ap,client:k.client,version:k.version,baseReplay:base.toString(),channel:u.channel,mask:0,count:0,messages:{},ambiguous:false};variants.push(s);}
  s.ambiguous||=conflict;s.mask|=1<<(k.message-1);s.count++;s.messages[k.message]=k;
  if([1,3].includes(k.message))s.anonce=k.nonce;if(k.message===2)s.snonce=k.nonce;
 }
 function linkCheck(link){if(![105,127].includes(link))throw Error(`不支持链路类型 ${link}；请导入 802.11 / radiotap 抓包`);links.add(link);}
 const first=await c.read(4),magic=hex(first);c.at=0;
 if(['d4c3b2a1','a1b2c3d4','4d3cb2a1','a1b23c4d'].includes(magic)){
  const little=['d4c3b2a1','4d3cb2a1'].includes(magic),h=await c.read(24),v=new DataView(h.buffer,h.byteOffset,h.length),link=v.getUint32(20,little)&65535,snap=v.getUint32(16,little);
  if(v.getUint16(4,little)!==2||v.getUint16(6,little)!==4||snap===0)throw Error('PCAP 文件头无效');linkCheck(link);
  while(c.at<file.size){const h=await c.read(16),v=new DataView(h.buffer,h.byteOffset,h.length),n=v.getUint32(8,little),original=v.getUint32(12,little);
   if(n>snap||n>original||n>262144)throw Error('PCAP 数据帧长度非法或超过 256KiB');const a=await c.read(n);if(n<original)stats.truncated++;else packet(a,link,'pcap');
   if(c.at-lastProgress>=1048576){lastProgress=c.at;onProgress(c.at/file.size);}
  }
 }else if(magic==='0a0d0d0a'){
  let little=true,section=-1,interfaces=[];
  while(c.at<file.size){
   const h=await c.read(12),v=new DataView(h.buffer,h.byteOffset,h.length),sectionHeader=hex(h.subarray(0,4))==='0a0d0d0a';
   if(sectionHeader){const bom=hex(h.subarray(8,12));if(!['4d3c2b1a','1a2b3c4d'].includes(bom))throw Error('PCAPNG 字节顺序非法');little=bom==='4d3c2b1a';interfaces=[];section++;}
   if(section<0)throw Error('PCAPNG 缺少 section');const type=v.getUint32(0,little),length=v.getUint32(4,little);
   if(length<12||length%4||length-12>file.size-c.at)throw Error('PCAPNG 块长度非法');
   if([0x0a0d0d0a,1,6,3].includes(type)){
    if(length>1048576)throw Error('PCAPNG 必要块超过 1MiB');
    const rest=await c.read(length-12),body=new Uint8Array(length-12);body.set(h.subarray(8,12));body.set(rest.subarray(0,rest.length-4),4);
    const trailer=new DataView(rest.buffer,rest.byteOffset+rest.length-4,4).getUint32(0,little);if(trailer!==length)throw Error('PCAPNG 块尾长度不一致');
    const b=new DataView(body.buffer);
    if(type===0x0a0d0d0a){if(length<28||b.getUint16(4,little)!==1)throw Error('不支持 PCAPNG section 版本');}
    if(type===1){if(length<20)throw Error('PCAPNG interface 截断');const link=b.getUint16(0,little);linkCheck(link);interfaces.push({link,snap:b.getUint32(4,little)});if(interfaces.length>256)throw Error('接口过多');}
    if(type===6){if(length<32)throw Error('PCAPNG EPB 截断');const iface=b.getUint32(0,little),n=b.getUint32(12,little),original=b.getUint32(16,little),cfg=interfaces[iface];if(!cfg||n>original||n>262144||(cfg.snap&&n>cfg.snap)||20+Math.ceil(n/4)*4>body.length)throw Error('PCAPNG 帧长度或接口非法');if(n<original)stats.truncated++;else packet(body.subarray(20,20+n),cfg.link,`${section}:${iface}`);}
    if(type===3){const cfg=interfaces[0];if(!cfg||body.length<4)throw Error('PCAPNG SPB 接口缺失');const original=b.getUint32(0,little),n=cfg.snap?Math.min(original,cfg.snap):original;if(n>262144||4+Math.ceil(n/4)*4!==body.length)throw Error('PCAPNG SPB 长度非法');if(n<original)stats.truncated++;else packet(body.subarray(4,4+n),cfg.link,`${section}:0`);}
   }else{if(length===12){if(v.getUint32(8,little)!==length)throw Error('PCAPNG 块尾损坏');}else{c.skip(length-16);const end=await c.read(4);if(new DataView(end.buffer,end.byteOffset,4).getUint32(0,little)!==length)throw Error('PCAPNG 块尾损坏');}}
   if(c.at-lastProgress>=1048576){lastProgress=c.at;onProgress(c.at/file.size);}
  }
 }else throw Error('文件不是支持的 PCAP/PCAPNG');
 const sessions=[];
 for(const variants of groups.values())for(const s of variants){
  const net=networks.get(s.ap),m2=s.messages[2];s.ssid_hex=net?.ssids.size===1?[...net.ssids][0]:'';
  const supported=s.version===2&&Object.values(s.messages).every(k=>k.version===2&&(k.keyLength===16||([2,4].includes(k.message)&&k.keyLength===0)))&&(m2?.mode===true||(m2?.mode===null&&net?.mode===true));
  s.supported=!!supported;s.mic=m2?.mic;s.eapol=m2?.eapol;
  s.reason=s.ambiguous?'Replay/Nonce 或验证数据冲突':s.version!==2?'不支持描述符版本':!m2?'缺少 M2':!s.anonce?'缺少 ANonce (M1/M3)':!s.snonce?'缺少 SNonce':!nz(WPA2.hex(m2.mic))?'M2 MIC 缺失':!supported?'UNSUPPORTED / NOT TESTED：未确认 WPA2-PSK + CCMP':'';
  s.verifiable=!s.reason;s.complete=s.verifiable&&s.mask===15;delete s.messages;sessions.push(s);
 }
 onProgress(1);return {sessions,stats,links:[...links]};
}
const api={parse,unwrap,key,rsn};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.PCAP=api;
})(typeof self!=='undefined'?self:globalThis);
