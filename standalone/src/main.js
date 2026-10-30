'use strict';
const $=id=>document.getElementById(id);
const workerText=new TextDecoder().decode(Uint8Array.from(atob($('worker-code').textContent.trim()),c=>c.charCodeAt(0)));
const workerURL=URL.createObjectURL(new Blob([workerText],{type:'application/javascript'}));
let sessions=[],parser=null,selectedAp=null,active=false,importing=false;
const inputIds=['capture-file','session','ssid','ssid-hex','source','range-start','range-end','dictionary','workers','engine','authorized','birthday-start','birthday-end','birthday-format'];
function controls(lock){active=lock;for(const id of inputIds)$(id).disabled=lock;$('pause').disabled=!lock;$('stop').disabled=!lock;validate();}
function selected(){return sessions.find(s=>String(s.id)===$('session').value);}
function ssidHex(){
 const text=$('ssid').value;let bytes;
 if($('ssid-hex').checked){if(!/^(?:[a-fA-F0-9]{2}){1,32}$/.test(text))throw Error('SSID HEX 必须为 1–32 字节');return text.toLowerCase();}
 bytes=new TextEncoder().encode(text);if(bytes.length<1||bytes.length>32)throw Error('请填写正确的 SSID（1–32 字节）');
 return Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
}
function readyRecord(){const s=selected();if(!s)throw Error('请导入并选择握手');if(!s.verifiable)throw Error(s.reason||'缺少验证材料');return {...s,ssid_hex:ssidHex()};}
function candidateSource(n){
 if($('source').value==='numeric')return new SOURCES.NumericSource($('range-start').value,$('range-end').value,n);
 if($('source').value==='birthday')return new SOURCES.BirthdaySource($('birthday-start').value,$('birthday-end').value,n,$('birthday-format').value);
 return new SOURCES.FileSource($('dictionary').files[0]);
}
function validate(){
 let ok=false,message='';
 try{readyRecord();const n=Number($('workers').value);if(!Number.isInteger(n)||n<1||n>256)throw Error('并行数须为 1–256 的整数');
  candidateSource(n);
  if(!$('authorized').checked)throw Error('请确认网络授权');ok=true;message='材料与设置有效，可开始本地并行验证。';
 }catch(e){message=e.message;}
 $('validation').textContent=message;$('start').disabled=!ok||active||importing;return ok;
}
function sessionInfo(fill=false){
 const s=selected();if(!s){$('handshake').textContent='没有可选择的握手';validate();return;}
 if(fill){
  if(s.ssid_hex){const bytes=Uint8Array.from(s.ssid_hex.match(/../g),x=>parseInt(x,16));try{$('ssid').value=new TextDecoder('utf-8',{fatal:true}).decode(bytes);$('ssid-hex').checked=false;}catch{$('ssid').value=s.ssid_hex;$('ssid-hex').checked=true;}}
  else if(selectedAp!==s.ap){$('ssid').value='';$('ssid-hex').checked=false;}selectedAp=s.ap;
 }
 let state=s.verifiable?(s.complete?'COMPLETE':'VERIFIABLE'):'CAPTURED';if(!s.supported)state='UNSUPPORTED / NOT TESTED';
 $('handshake').textContent=`AP: ${s.ap}\n客户端: ${s.client}\n接收信道: ${s.channel||'未知（抓包未提供 2.4GHz 信道）'}\nReplay 基数: ${s.baseReplay}\n`+[1,2,3,4].map(i=>`M${i}: ${s.mask&(1<<(i-1))?'RECEIVED':'MISSING'}`).join('\n')+`\n${state} · 捕获 ${s.count} 条\n${s.reason||'捕获状态不等于 MIC 已匹配；验证还需要正确 SSID。'}`;validate();
}
$('capture-file').onchange=()=>{
 const file=$('capture-file').files[0];if(!file)return;if(parser)parser.terminate();
 sessions=[];selectedAp=null;$('session').replaceChildren();$('ssid').value='';$('handshake').textContent='解析中…';importing=true;validate();$('import-status').textContent='正在本地解析…';
 const w=new Worker(workerURL);parser=w;
 const fail=message=>{if(parser!==w)return;importing=false;$('import-status').textContent=`导入失败：${message}`;w.terminate();parser=null;validate();};
 w.onerror=e=>fail(e.message||'解析 Worker 失败');
 w.onmessage=e=>{
  if(parser!==w)return;const m=e.data;
  if(m.type==='error'){fail(m.message);return;}
  if(m.type==='importProgress')$('import-status').textContent=`本地解析 ${(m.progress*100).toFixed(1)}%`;
  if(m.type==='parsed'){
   sessions=m.result.sessions.sort((a,b)=>Number(b.complete)-Number(a.complete)||Number(b.verifiable)-Number(a.verifiable)||b.id-a.id);
   for(const s of sessions){const option=document.createElement('option');option.value=s.id;option.textContent=`#${s.id} · ${s.ap} → ${s.client} · ${s.complete?'COMPLETE':s.verifiable?'VERIFIABLE':'材料不足/不支持'}`;$('session').append(option);}
   const t=m.result.stats;$('import-status').textContent=`解析完成：${t.packets.toLocaleString()} 帧，${t.eapol} 条认证消息，${sessions.length} 个会话；忽略 ${t.ignored} 帧，截断 ${t.truncated} 帧。`;
   importing=false;w.terminate();parser=null;sessionInfo(true);
  }
 };
 w.postMessage({type:'parse',file});
};
function duration(seconds){if(seconds===null||!Number.isFinite(seconds))return '—';if(seconds<60)return `${Math.ceil(seconds)} 秒`;if(seconds<3600)return `${(seconds/60).toFixed(1)} 分钟`;if(seconds<86400)return `${(seconds/3600).toFixed(1)} 小时`;return `${(seconds/86400).toFixed(1)} 天`;}
function render(s){
 if(!s)return;
 const names={running:s.paused?(s.allPaused?'已暂停':'正在暂停…'):'并行验证中',found:'找到匹配',done:'全部完成，未找到匹配',stopped:'已停止',error:'运行失败'};
 $('run-state').textContent=names[s.phase];$('progress').value=s.percent;
 $('metrics').textContent=`已验证（回报）：${s.tested.toLocaleString()}\n速度：${s.rate.toFixed(2)} 候选/秒 · 已用 ${duration(s.elapsed)}\n进度：${s.percent.toFixed(4)}% · ${s.kind!=='file'?`${s.total.toLocaleString()} 个候选`:`${s.processed.toLocaleString()} / ${s.total.toLocaleString()} 字节已确认`}\n跳过非法行：${s.skipped.toLocaleString()} · 预计剩余：${['found','done'].includes(s.phase)?'0 秒':duration(s.eta)}\n已启动 Worker：${s.slots.length}`;
 $('result').textContent=s.password!==null?`匹配密码：${s.password}`:s.error||'';
 $('worker-table').replaceChildren();for(const slot of s.slots){const tr=document.createElement('tr');for(const value of [slot.id,slot.engine,slot.state,slot.total.toLocaleString(),slot.range]){const td=document.createElement('td');td.textContent=value;tr.append(td);}$('worker-table').append(tr);}
 $('pause').textContent=s.paused?'继续':'暂停';if(s.phase!=='running'&&active)controls(false);
}
const pool=new ParallelPool(workerURL,render);
$('start').onclick=()=>{if(!validate())return;try{const workers=Number($('workers').value),record=readyRecord(),source=candidateSource(workers);$('result').textContent='';controls(true);pool.start({record,source,workers,engine:$('engine').value});}catch(e){controls(false);$('result').textContent=e.message;}};
$('pause').onclick=()=>{if(pool.run?.paused)pool.resume();else pool.pause();};$('stop').onclick=()=>pool.stop();
$('session').onchange=()=>sessionInfo(true);
$('source').onchange=()=>{$('numeric-settings').hidden=$('source').value!=='numeric';$('file-settings').hidden=$('source').value!=='file';$('birthday-settings').hidden=$('source').value!=='birthday';validate();};
for(const id of ['ssid','ssid-hex','range-start','range-end','dictionary','workers','engine','authorized','birthday-start','birthday-end','birthday-format'])$(id).addEventListener('input',validate);
const reported=navigator.hardwareConcurrency;$('workers').value=Math.min(256,Math.max(1,reported||4));$('hardware').textContent=`浏览器报告逻辑核数：${reported||'未知'}。并行数由你设置；原生计算后端和浏览器会影响实际加速。`;
$('birthday-end').value=`${new Date().getFullYear()}-12-31`;
setInterval(()=>{if(pool.run&&!pool.run.cancelled)render(pool.snapshot());},250);
window.addEventListener('beforeunload',()=>{pool.stop();if(parser)parser.terminate();URL.revokeObjectURL(workerURL);});validate();
