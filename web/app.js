'use strict';
const $=id=>document.getElementById(id);
let allowedMax=11,lastStatus=null,latestCapture=null;
let refreshTimer=null,refreshRunning=false,refreshAgain=false,pollController=null;
let switchPending=null,switchActive=null;
async function api(path,data,signal){
 const controller=new AbortController(),forward=()=>controller.abort();
 if(signal){signal.addEventListener('abort',forward,{once:true});if(signal.aborted)controller.abort();}
 const timer=setTimeout(()=>controller.abort(),4000);
 try{
  const options=data===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json','X-Lab':'1'},body:JSON.stringify(data)};
  const r=await fetch(path,{...options,signal:controller.signal}),j=await r.json();
  if(!r.ok){const e=Error(j.message||`HTTP ${r.status}`);e.status=r.status;throw e;}return j;
 }catch(e){if(e.name==='AbortError')throw Error('请求超时或网络已切换，正在重新连接');throw e;}
 finally{clearTimeout(timer);if(signal)signal.removeEventListener('abort',forward);}
}
function notice(s){$('notice').textContent=s;}
async function scan(){
 $('scan').disabled=true;
 try{await api('/api/scan',{});notice('扫描已开始，期间暂停监听；扫描完成后自动更新列表。');}
 catch(e){notice(e.message);}finally{requestRefresh();}
}
function choose(network){
 if(!$('authorized').checked){notice('请先确认授权。');return;}
 switchPending={bssid:network.bssid,channel:network.channel,ssid:network.ssid};
 $('switch-title').textContent='确认切换目标';
 $('switch-target').textContent=`${network.ssid||'隐藏网络'}\n${network.bssid}\n目标信道：CH ${network.channel}`;
 $('switch-message').textContent='设备热点将短暂断开。请重新加入同一个 ESP32 热点，再回到此页面；状态会自动恢复。MCU 无需重启。';
 $('switch-confirm').hidden=false;$('switch-confirm').disabled=false;$('switch-cancel').hidden=false;
 $('switch-check').hidden=true;$('switch-close').hidden=true;$('switch-dialog').showModal();
}
async function confirmSwitch(){
 if(!switchPending||switchActive)return;
 const target=switchPending;
 switchActive={...target,started:performance.now(),generation:latestCapture?.generation,accepted:false};
 $('switch-confirm').disabled=true;$('switch-cancel').hidden=true;$('switch-check').hidden=false;$('switch-close').hidden=false;
 $('switch-title').textContent='正在切换信道';$('switch-message').textContent='正在通知设备…';
 try{
  await api('/api/target',{bssid:target.bssid,authorized:true});
  switchActive.accepted=true;
  $('switch-message').textContent=`切换请求已接受。请重新加入 ESP32 热点，回到此页面，等待实际信道变为 ${target.channel}。`;
  notice(`正在切换到 CH ${target.channel}；重新加入热点后将自动检查状态。`);
 }catch(e){
  if(e.status){switchActive=null;$('switch-confirm').disabled=false;$('switch-cancel').hidden=false;}
  else if(switchActive)switchActive.accepted=true;
  $('switch-message').textContent=e.status?e.message:'未确认设备是否已接收请求。请重新加入热点后检查状态，避免重复发送。';
  notice(e.message);
 }finally{requestRefresh();}
}
function checkSwitch(s,c){
 if(!switchActive?.accepted||performance.now()-switchActive.started<1800)return;
 if(s.phase==='ERROR'){
  $('switch-title').textContent='切换失败';$('switch-message').textContent=`设备报告：${s.error}。请检查实际信道后重新选择目标。`;
  notice(`切换失败：${s.error}`);switchActive=null;$('switch-confirm').hidden=true;return;
 }
 const newCapture=switchActive.generation===undefined||c.generation>switchActive.generation;
 if(s.phase==='READY'&&!s.busy&&s.target_bssid===switchActive.bssid&&s.channel===switchActive.channel&&newCapture){
  $('switch-title').textContent='切换成功';$('switch-message').textContent=`已重新连接，实际工作信道为 CH ${s.channel}。状态已自动刷新。`;
  notice(`切换成功，实际信道 CH ${s.channel}`);switchActive=null;$('switch-confirm').hidden=true;
 }
}
function networks(list){
 $('networks').replaceChildren();
 for(const n of list){
  const d=document.createElement('div');d.className='network';const info=document.createElement('div');info.className='network-info';const title=document.createElement('strong');title.textContent=n.ssid||'（隐藏 SSID：无法进行密码验证）';
  const p=document.createElement('p');p.textContent=`${n.bssid} · CH ${n.channel} · ${n.rssi} dBm · ${n.auth}`;
  const b=document.createElement('button');b.textContent='切换';b.disabled=n.channel>allowedMax||!!lastStatus?.busy||!!switchActive;b.onclick=()=>choose(n);info.append(title,p);d.append(info,b);$('networks').append(d);
 }
}
async function refresh(){
 if(refreshRunning){refreshAgain=true;return;}
 refreshRunning=true;clearTimeout(refreshTimer);const controller=new AbortController();pollController=controller;
 try{
  const s=await api('/api/status',undefined,controller.signal);lastStatus=s;allowedMax=s.max_channel||11;
  $('status').textContent=`状态: ${s.phase} · 启动标识: ${s.boot_id}\n运行时间: ${Math.floor((s.uptime_ms||0)/1000)} 秒\nSoftAP: ${s.ssid}\n实际信道: ${s.channel} · 可用范围: 1–${allowedMax}\nIP: ${s.ip}\n目标: ${s.target_ssid||'未选择'}\nBSSID: ${s.target_bssid||'—'}\n错误: ${s.error}`;
  $('scan').disabled=s.busy||!!switchActive;
  if(!s.busy)networks(await api('/api/networks',undefined,controller.signal));
  const c=await api('/api/capture',undefined,controller.signal);renderCapture(c);checkSwitch(s,c);
 }catch(e){if(!controller.signal.aborted)$('status').textContent='正在重新连接设备…\n切换信道后请重新加入 ESP32 热点，回到此页面即可自动恢复。';}
 finally{pollController=null;refreshRunning=false;refreshTimer=setTimeout(refresh,refreshAgain?0:2000);refreshAgain=false;}
}
function requestRefresh(){clearTimeout(refreshTimer);refresh();}
function resumePolling(){if(pollController)pollController.abort();requestRefresh();}
$('scan').onclick=scan;$('switch-confirm').onclick=confirmSwitch;
$('switch-cancel').onclick=()=>{$('switch-dialog').close();switchPending=null;};
$('switch-close').onclick=()=>{$('switch-dialog').close();switchActive=null;requestRefresh();};$('switch-check').onclick=resumePolling;
window.addEventListener('online',resumePolling);window.addEventListener('pageshow',resumePolling);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)resumePolling();});

function renderCapture(c){
 latestCapture=c;if(!verifying&&!parsing&&recordOrigin==='live'&&!loaded.length&&(c.sessions||[]).some(s=>s.verifiable))loadCaptured();const section=$('capture');section.replaceChildren();const h=document.createElement('h2');h.textContent='认证帧 · '+(c.listening?'监听中':'已暂停');section.append(h);
 const p=document.createElement('pre');p.textContent=`${c.security}\nCH: ${c.channel} · BSSID: ${c.bssid}\n数据帧: ${c.data_frames} · 认证帧: ${c.captured}\n队列丢失: ${c.queue_drops} · 超长丢弃: ${c.oversize}\n记录覆盖: ${c.record_overwrites} · 会话淘汰: ${c.session_evictions}\n最近认证帧（启动后微秒）: ${c.last_rx_us}`;section.append(p);
 for(const s of c.sessions||[]){const row=document.createElement('pre');row.textContent=`会话 ${s.id} · 客户端 ${s.client}\n`+[1,2,3,4].map(i=>`M${i}: ${s.mask&(1<<(i-1))?'RECEIVED':'MISSING'}`).join('\n')+`\nHandshake: ${s.state}\n${s.missing||''}`;section.append(row);}
 for(const [url,label] of [['/api/capture.pcap','导出已校验 PCAP'],['/api/handshakes.json','导出结构化数据']]){const a=document.createElement('a');a.href=url;a.textContent=label;a.className='download';a.download='';section.append(a);}
}

let loaded=[],verifying=false,parsing=false,parser=null,recordOrigin='live',selectedAp=null;
const verifyInputs=['load','capture-file','sessions','ssid','ssid-hex','source','dictionary','numeric-start','numeric-end','birthday-start','birthday-end','birthday-format','workers','engine'];
function currentRecord(){
 const r=loaded.find(x=>String(x.id)===$('sessions').value);if(!r)throw Error('请选择具备 ANonce、SNonce、M2 MIC 和原始 EAPOL 的会话');
 if(!r.verifiable)throw Error(r.reason||r.missing||'该会话的验证材料不完整');
 const value=$('ssid').value;let ssid_hex;
 if($('ssid-hex').checked){if(!/^(?:[a-fA-F0-9]{2}){1,32}$/.test(value))throw Error('SSID HEX 须为 1–32 字节');ssid_hex=value.toLowerCase();}
 else{const bytes=new TextEncoder().encode(value);if(!bytes.length||bytes.length>32)throw Error('请填写正确的 SSID（1–32 字节）');ssid_hex=WPA2.toHex(bytes);}
 const record={...r,ssid_hex};WPA2.prepare(record);return record;
}
function createSource(){
 const workers=Number($('workers').value);if(!Number.isInteger(workers)||workers<1||workers>256)throw Error('并行数须为 1–256 的整数');
 if($('source').value==='numeric8')return new SOURCES.NumericSource($('numeric-start').value,$('numeric-end').value,workers);
 if($('source').value==='birthday')return new SOURCES.BirthdaySource($('birthday-start').value,$('birthday-end').value,workers,$('birthday-format').value);
 return new SOURCES.FileSource($('dictionary').files[0]);
}
function checkStart(){
 let valid=false,message='';
 try{currentRecord();createSource();if(!$('authorized').checked)throw Error('请先确认网络授权');valid=true;message='材料可验证，候选将在手机本地并行处理。';}
 catch(e){message=e.message;}
 $('missing').textContent=message;$('start').disabled=!valid||verifying||parsing;return valid;
}
function sourceChanged(){
 $('numeric-settings').hidden=$('source').value!=='numeric8';$('birthday-settings').hidden=$('source').value!=='birthday';$('file-settings').hidden=$('source').value!=='file';checkStart();
}
function recordSelected(fill=false){
 const r=loaded.find(x=>String(x.id)===$('sessions').value);
 if(r){
  if(fill){
   if(r.ssid_hex){try{const text=new TextDecoder('utf-8',{fatal:true}).decode(WPA2.hex(r.ssid_hex));if(/[\u0000-\u001f\u007f]/.test(text))throw Error('使用 HEX');$('ssid').value=text;$('ssid-hex').checked=false;}catch{$('ssid').value=r.ssid_hex;$('ssid-hex').checked=true;}}
   else if(selectedAp!==r.ap){$('ssid').value='';$('ssid-hex').checked=false;}selectedAp=r.ap;
  }
  $('record-info').textContent=`来源: ${recordOrigin==='file'?'本地 PCAP':'设备当前捕获'}\nAP: ${r.ap} · 客户端: ${r.client}\n`+[1,2,3,4].map(i=>`M${i}: ${r.mask&(1<<(i-1))?'RECEIVED':'MISSING'}`).join(' · ')+`\n${r.state||(r.complete?'COMPLETE':r.verifiable?'VERIFIABLE':'CAPTURED')}`;
 }else $('record-info').textContent='尚无可验证会话';checkStart();
}
function populateRecords(){
 $('sessions').replaceChildren();
 for(const r of loaded){const o=document.createElement('option');o.value=r.id;o.textContent=`会话 ${r.id} · ${r.client} · ${r.state||(r.complete?'COMPLETE':r.verifiable?'VERIFIABLE':'材料不足')}`;$('sessions').append(o);}
 if(!loaded.length){const o=document.createElement('option');o.value='';o.textContent='无可验证会话';$('sessions').append(o);}
 recordSelected(true);
}
function loadCaptured(){
 if(parser){parser.terminate();parser=null;parsing=false;}
 recordOrigin='live';loaded=[];$('import-status').textContent='';
 if(latestCapture)for(const s of latestCapture.sessions||[])if(s.verifiable)loaded.push({...s,ssid_hex:latestCapture.ssid_hex,generation:latestCapture.generation});
 loaded.sort((a,b)=>(b.last_us||0)-(a.last_us||0));populateRecords();
 if(!loaded.length)$('missing').textContent=(latestCapture?.sessions||[]).map(s=>s.missing).filter(Boolean).join('；')||'尚未捕获所需认证帧';
}
$('capture-file').onchange=()=>{
 const file=$('capture-file').files[0];if(!file)return;if(parser)parser.terminate();
 recordOrigin='file';loaded=[];selectedAp=null;$('ssid').value='';parsing=true;populateRecords();$('import-status').textContent='正在手机本地解析 PCAP…';
 const w=new Worker('/parallel-worker.js');parser=w;
 const fail=message=>{if(parser!==w)return;parsing=false;w.terminate();parser=null;$('import-status').textContent=`导入失败：${message}`;checkStart();};
 w.onerror=e=>fail(e.message||'解析 Worker 失败');w.onmessage=e=>{
  if(parser!==w)return;const m=e.data;if(m.type==='error'){fail(m.message);return;}
  if(m.type==='importProgress')$('import-status').textContent=`本地解析 ${(m.progress*100).toFixed(1)}%`;
  if(m.type==='parsed'){loaded=m.result.sessions.sort((a,b)=>Number(b.complete)-Number(a.complete)||Number(b.verifiable)-Number(a.verifiable)||b.id-a.id);parsing=false;w.terminate();parser=null;populateRecords();$('import-status').textContent=`已导入 ${m.result.stats.eapol} 条认证消息、${loaded.length} 个会话；文件未上传。`;}
 };w.postMessage({type:'parse',file});
};
function duration(seconds){if(seconds===null||!Number.isFinite(seconds))return '等待测速';if(seconds<60)return `${Math.ceil(seconds)} 秒`;if(seconds<3600)return `${(seconds/60).toFixed(1)} 分钟`;if(seconds<86400)return `${(seconds/3600).toFixed(1)} 小时`;return `${(seconds/86400).toFixed(1)} 天`;}
function verificationControls(lock){verifying=lock;for(const id of verifyInputs)$(id).disabled=lock;$('pause').disabled=!lock;$('stop').disabled=!lock;checkStart();}
function renderVerification(s){
 $('progress').value=s.percent;const phase=s.phase==='found'?`匹配密码: ${s.password}`:s.phase==='done'?'完成，未找到匹配':s.phase==='error'?`运行失败: ${s.error}`:s.phase==='stopped'?'已停止；可重新开始。':s.paused?(s.allPaused?'已暂停':'正在暂停…'):'并行验证中';
 $('verification').textContent=`已验证: ${s.tested} · 跳过无效行: ${s.skipped}\n速度: ${s.rate.toFixed(2)} 候选/秒\n${s.kind==='file'?'字典处理':'候选进度'}: ${s.percent.toFixed(4)}% · ${s.total.toLocaleString()} ${s.kind==='file'?'字节':'个候选'}\n预计剩余: ${duration(['found','done'].includes(s.phase)?0:s.eta)}\nWorker: ${s.slots.length}\n${phase}`;
 $('worker-table').replaceChildren();for(const slot of s.slots){const tr=document.createElement('tr');for(const value of [slot.id,slot.engine,slot.state,slot.total]){const td=document.createElement('td');td.textContent=value;tr.append(td);}$('worker-table').append(tr);}
 $('pause').textContent=s.paused?'继续':'暂停';if(s.phase!=='running'&&verifying)verificationControls(false);
}
const pool=new ParallelPool('/parallel-worker.js',renderVerification);
$('start').onclick=()=>{if(!checkStart())return;try{const record=currentRecord(),source=createSource(),workers=Number($('workers').value),engine=$('engine').value;verificationControls(true);pool.start({record,source,workers,engine});}catch(e){verificationControls(false);$('verification').textContent=e.message;}};
$('pause').onclick=()=>{if(pool.run?.paused)pool.resume();else pool.pause();};$('stop').onclick=()=>pool.stop();
$('load').onclick=loadCaptured;$('sessions').onchange=()=>recordSelected(true);$('source').onchange=sourceChanged;
for(const id of ['ssid','ssid-hex','dictionary','numeric-start','numeric-end','birthday-start','birthday-end','birthday-format','workers','engine','authorized'])$(id).addEventListener('input',checkStart);
const cores=navigator.hardwareConcurrency;$('workers').value=Math.min(256,Math.max(1,cores||4));$('hardware').textContent=`浏览器报告逻辑核数：${cores||'未知'}；可自行设置 1–256 个 Worker。`;
$('birthday-end').value=`${new Date().getFullYear()}-12-31`;
setInterval(()=>{if(pool.run&&!pool.run.cancelled)renderVerification(pool.snapshot());},250);
window.addEventListener('beforeunload',()=>{pool.stop();if(parser)parser.terminate();});sourceChanged();refresh();
