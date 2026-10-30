(function(root){
'use strict';
class NumericSource{
 constructor(start,end,workers){if(!/^\d{8}$/.test(start)||!/^\d{8}$/.test(end)||+start>+end)throw Error('请输入有效的 8 位数字闭区间');this.start=+start;this.end=+end;this.next=this.start;this.total=this.end-this.start+1;this.batch=Math.max(1,Math.min(256,Math.ceil(this.total/(workers*4))));this.skipped=0;this.kind='numeric';}
 async nextBatch(){if(this.next>this.end)return null;const start=this.next,end=Math.min(this.end,start+this.batch-1);this.next=end+1;return {start,end,size:end-start+1,endByte:0};}
}
class FileSource{
 constructor(file){if(!file||!file.size)throw Error('请选择非空 TXT 字典');this.file=file;this.total=file.size;this.kind='file';this.chunk=new Uint8Array(0);this.offset=0;this.pos=0;this.pending=[];this.long=false;this.first=true;this.skipped=0;this.eof=false;this.lineDone=false;}
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
  while(candidates.length<128&&this.position-begin<65536){const p=await this.line();if(p===null){this.eof=true;break;}if(p)candidates.push(p);}
  if(!candidates.length&&this.position===begin)return null;
  return {candidates,size:candidates.length,endByte:this.position};
 }
}
const api={NumericSource,FileSource};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SOURCES=api;
})(typeof self!=='undefined'?self:globalThis);
