(function(root){
'use strict';
class NumericSource{
 constructor(start,end,workers){if(!/^\d{8}$/.test(start)||!/^\d{8}$/.test(end)||+start>+end)throw Error('请输入有效的 8 位数字闭区间');this.start=+start;this.end=+end;this.next=this.start;this.total=this.end-this.start+1;this.batch=Math.max(1,Math.min(256,Math.ceil(this.total/(workers*4))));this.skipped=0;this.kind='numeric';}
 async nextBatch(){if(this.next>this.end)return null;const start=this.next,end=Math.min(this.end,start+this.batch-1);this.next=end+1;return {start,end,size:end-start+1,endByte:0};}
}
class BirthdaySource{
 constructor(start,end,workers,format='YYYYMMDD'){
  function day(text){
   if(!/^\d{4}-\d{2}-\d{2}$/.test(text))throw Error('生日日期格式须为 YYYY-MM-DD');
   const [y,m,d]=text.split('-').map(Number),date=new Date(0);date.setUTCHours(0,0,0,0);date.setUTCFullYear(y,m-1,d);
   if(y<1||date.getUTCFullYear()!==y||date.getUTCMonth()!==m-1||date.getUTCDate()!==d)throw Error('生日范围含无效日期');return date.getTime();
  }
  this.start=day(start);this.end=day(end);if(this.start>this.end)throw Error('生日开始日期不能晚于结束日期');
  if(!['YYYYMMDD','DDMMYYYY','MMDDYYYY'].includes(format))throw Error('不支持的生日格式');
  this.format=format;this.next=0;this.total=(this.end-this.start)/86400000+1;this.kind='birthday';this.skipped=0;this.batch=Math.max(1,Math.min(256,Math.ceil(this.total/(workers*4))));
 }
 async nextBatch(){
  if(this.next>=this.total)return null;const candidates=[];
  while(candidates.length<this.batch&&this.next<this.total){
   const d=new Date(this.start+this.next++*86400000),parts={YYYY:String(d.getUTCFullYear()).padStart(4,'0'),MM:String(d.getUTCMonth()+1).padStart(2,'0'),DD:String(d.getUTCDate()).padStart(2,'0')};
   candidates.push(this.format.replace(/YYYY|MM|DD/g,x=>parts[x]));
  }
  return {candidates,size:candidates.length,endByte:0,label:`${candidates[0]}–${candidates.at(-1)}`};
 }
}
class FileSource{
 constructor(file,workers=4){if(!file||!file.size)throw Error('请选择非空 TXT 字典');this.file=file;this.total=file.size;this.kind='file';this.chunk=new Uint8Array(0);this.offset=0;this.pos=0;this.pending=[];this.long=false;this.first=true;this.skipped=0;this.eof=false;this.lineDone=false;this.workers=workers;this.batches=0;}
 get position(){return this.offset+this.pos;}
 async line(){
  if(this.lineDone)return null;
  while(true){
   if(this.pos>=this.chunk.length){this.offset+=this.chunk.length;this.pos=0;
    if(this.offset>=this.file.size){this.lineDone=true;if(!this.pending.length&&!this.long)return null;const out=this.pending;this.pending=[];const bad=this.long;this.long=false;return this.decode(out,bad);}
    this.chunk=new Uint8Array(await this.file.slice(this.offset,this.offset+65536).arrayBuffer());
   }
   const b=this.chunk[this.pos++];if(b===10){const out=this.pending;this.pending=[];const bad=this.long;this.long=false;return this.decode(out,bad);}
   if(!this.long){this.pending.push(b);if(this.pending.length>(this.first?67:64)){this.pending=[];this.long=true;}}
  }
 }
 decode(bytes,bad){
  if(bytes.at(-1)===13)bytes.pop();if(this.first){this.first=false;if(bytes[0]===239&&bytes[1]===187&&bytes[2]===191)bytes=bytes.slice(3);}
  if(bad||bytes.length<8||bytes.length>63||bytes.some(x=>x<32||x>126)){this.skipped++;return '';}
  return String.fromCharCode(...bytes);
 }
 async nextBatch(){
  if(this.eof)return null;const begin=this.position,candidates=[];
  const batchSize=this.batches<this.workers?1:128;
  while(candidates.length<batchSize&&this.position-begin<65536){const p=await this.line();if(p===null){this.eof=true;break;}if(p)candidates.push(p);}
  if(!candidates.length&&this.position===begin)return null;
  if(candidates.length)this.batches++;return {candidates,size:candidates.length,endByte:this.position};
 }
}
const api={NumericSource,BirthdaySource,FileSource};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SOURCES=api;
})(typeof self!=='undefined'?self:globalThis);
