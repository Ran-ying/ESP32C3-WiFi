/* Finite printable-ASCII regex enumeration. Never executes an untrusted RegExp. */
(function(root){
'use strict';
let budget=0,cachedPattern=null,cachedTree=null;
const LIMIT=BigInt(Number.MAX_SAFE_INTEGER)+1n,MAX=63,ASCII=Array.from({length:95},(_,i)=>String.fromCharCode(i+32));
const add=(a,b)=>a+b>=LIMIT?LIMIT:a+b,mul=(a,b)=>a*b>=LIMIT?LIMIT:a*b;
function convolution(a,b){const c=Array(64).fill(0n);for(let i=0;i<=MAX;i++)if(a[i])for(let j=0;j+i<=MAX;j++)if(b[j]){if(++budget>1000000)throw Error('正则组合过于复杂，请简化');c[i+j]=add(c[i+j],mul(a[i],b[j]));}return c;}
function chars(values){const values2=[...new Set(values)],counts=Array(64).fill(0n);counts[1]=BigInt(values2.length);return {kind:'chars',values:values2,counts};}
function seq(nodes){const suffix=Array(nodes.length+1);suffix[nodes.length]=Array(64).fill(0n);suffix[nodes.length][0]=1n;for(let i=nodes.length-1;i>=0;i--)suffix[i]=convolution(nodes[i].counts,suffix[i+1]);return {kind:'seq',nodes,suffix,counts:suffix[0]};}
function alt(nodes){const counts=Array(64).fill(0n);for(const n of nodes)for(let i=0;i<=MAX;i++)counts[i]=add(counts[i],n.counts[i]);return {kind:'alt',nodes,counts};}
function parse(pattern){
 if(typeof pattern!=='string'||!pattern.length||pattern.length>512)throw Error('正则须为 1–512 个字符');
 let text=pattern;if(text.startsWith('^'))text=text.slice(1);if(text.endsWith('$')){let slashes=0;for(let i=text.length-2;i>=0&&text[i]==='\\';i--)slashes++;if(slashes%2===0)text=text.slice(0,-1);}
 let p=0,depth=0,nodes=0;
 function literal(c){if(!c||c.charCodeAt(0)<32||c.charCodeAt(0)>126)throw Error('候选仅支持可打印 ASCII');return c;}
 function escaped(){
  const c=text[p++];if(!c)throw Error('正则转义未结束');
  const word=ASCII.filter(x=>/[A-Za-z0-9_]/.test(x));
  if(c==='d')return [...'0123456789'];if(c==='D')return ASCII.filter(x=>!/[0-9]/.test(x));if(c==='w')return word;if(c==='W')return ASCII.filter(x=>!word.includes(x));if(c==='s')return [' '];if(c==='S')return ASCII.filter(x=>x!==' ');
  if(c==='x'||c==='u'){const n=c==='x'?2:4,h=text.slice(p,p+n);if(!new RegExp(`^[0-9a-fA-F]{${n}}$`).test(h))throw Error('无效字符转义');p+=n;return [literal(String.fromCharCode(parseInt(h,16)))];}
  if(/[A-Za-z0-9]/.test(c))throw Error('不支持边界、反向引用或该转义');return [literal(c)];
 }
 function atom(){
  if(++nodes>256)throw Error('正则结构过于复杂');const c=text[p++];
  if(c==='('){if(++depth>24)throw Error('分组嵌套超过 24 层');if(text.slice(p,p+2)==='?:')p+=2;else if(text[p]==='?')throw Error('不支持前后查找或特殊分组');const n=expression();if(text[p++]!==')')throw Error('缺少右括号');depth--;return n;}
  if(c==='['){let negative=false;if(text[p]==='^'){negative=true;p++;}const values=[];
   while(p<text.length&&text[p]!==']'){
    let left=text[p++];const set=left==='\\'?escaped():[literal(left)];
    if(text[p]==='-'&&text[p+1]!==']'&&p+1<text.length){p++;const right=text[p++],end=right==='\\'?escaped():[literal(right)];if(set.length!==1||end.length!==1||set[0]>end[0])throw Error('字符范围无效');for(let i=set[0].charCodeAt(0);i<=end[0].charCodeAt(0);i++)values.push(String.fromCharCode(i));}else values.push(...set);
   }
   if(text[p++]!==']'||!values.length)throw Error('字符集合未结束或为空');return chars(negative?ASCII.filter(x=>!values.includes(x)):values);
  }
  if(c==='.')return chars(ASCII);if(c==='\\')return chars(escaped());if(!c||'|)*+?{}^$]'.includes(c))throw Error('正则语法不支持或位置不正确');return chars([literal(c)]);
 }
 function term(){let n=atom(),min,max;if(text[p]==='*'||text[p]==='+')throw Error('不支持无界 * 或 +，请用 {最少,最多} 明确范围');
  if(text[p]==='?'){p++;min=0;max=1;}
  else if(text[p]==='{'){const m=text.slice(p).match(/^\{(\d+)(?:,(\d+))?\}/);if(!m)throw Error('重复必须为 {n} 或 {m,n}');p+=m[0].length;min=Number(m[1]);max=m[2]===undefined?min:Number(m[2]);if(min>max||max>63)throw Error('重复上限为 63，且最小值不能大于最大值');}
  if(min!==undefined){const choices=[];for(let k=min;k<=max;k++)choices.push(seq(Array(k).fill(n)));n=alt(choices);}return n;
 }
 function expression(){const choices=[];while(true){const list=[];while(p<text.length&&text[p]!=='|'&&text[p]!==')')list.push(term());choices.push(seq(list));if(text[p]!=='|')break;p++;}return choices.length===1?choices[0]:alt(choices);}
 const tree=expression();if(p!==text.length)throw Error('正则括号或结尾不匹配');return tree;
}
function unrank(node,length,index){
 if(node.kind==='chars')return node.values[Number(index)];
 if(node.kind==='alt'){for(const n of node.nodes){if(index<n.counts[length])return unrank(n,length,index);index-=n.counts[length];}throw Error('正则索引超出范围');}
 let out='',remaining=length;
 for(let i=0;i<node.nodes.length;i++){
  const n=node.nodes[i];let found=false;
  for(let len=0;len<=remaining;len++){const suffix=node.suffix[i+1][remaining-len],count=mul(n.counts[len],suffix);if(index<count){out+=unrank(n,len,index/suffix);index%=suffix;remaining-=len;found=true;break;}index-=count;}
  if(!found)throw Error('正则序列索引非法');
 }return out;
}
class RegexSource{
 constructor(pattern,workers){this.pattern=pattern;budget=0;if(cachedPattern!==pattern){cachedTree=parse(pattern);cachedPattern=pattern;}this.tree=cachedTree;let count=0n;for(let i=8;i<=63;i++)count=add(count,this.tree.counts[i]);if(count>=LIMIT)throw Error('候选数超过安全统计范围，请缩小正则');if(!count)throw Error('正则没有 8–63 字节的候选');this.total=Number(count);this.next=0;this.kind='regex';this.skipped=0;this.batch=Math.max(1,Math.min(128,Math.ceil(this.total/(workers*4))));}
 at(index){let rank=BigInt(index);for(let length=8;length<=63;length++){if(rank<this.tree.counts[length])return unrank(this.tree,length,rank);rank-=this.tree.counts[length];}throw Error('候选索引非法');}
 async nextBatch(){if(this.next>=this.total)return null;const first=this.next,candidates=[];while(candidates.length<this.batch&&this.next<this.total)candidates.push(this.at(this.next++));return {candidates,size:candidates.length,endByte:0,label:`正则 #${first+1}–${this.next}`};}
}
if(typeof module!=='undefined'&&module.exports)module.exports={RegexSource};else root.SOURCES.RegexSource=RegexSource;
})(typeof self!=='undefined'?self:globalThis);
