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
  const d=document.createElement('div');d.className='network';const title=document.createElement('strong');title.textContent=n.ssid||'（隐藏 SSID：无法进行密码验证）';
  const p=document.createElement('p');p.textContent=`${n.bssid} · CH ${n.channel} · ${n.rssi} dBm · ${n.auth}`;
  const b=document.createElement('button');b.textContent='选择并切换信道';b.disabled=n.channel>allowedMax||!!lastStatus?.busy||!!switchActive;b.onclick=()=>choose(n);d.append(title,p,b);$('networks').append(d);
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
 latestCapture=c;if(!worker&&!loaded.length&&(c.sessions||[]).some(s=>s.verifiable))loadCaptured();const section=$('capture');section.replaceChildren();const h=document.createElement('h2');h.textContent='认证帧 · '+(c.listening?'监听中':'已暂停');section.append(h);
 const p=document.createElement('pre');p.textContent=`${c.security}\nCH: ${c.channel} · BSSID: ${c.bssid}\n数据帧: ${c.data_frames} · 认证帧: ${c.captured}\n队列丢失: ${c.queue_drops} · 超长丢弃: ${c.oversize}\n记录覆盖: ${c.record_overwrites} · 会话淘汰: ${c.session_evictions}\n最近认证帧（启动后微秒）: ${c.last_rx_us}`;section.append(p);
 for(const s of c.sessions||[]){const row=document.createElement('pre');row.textContent=`会话 ${s.id} · 客户端 ${s.client}\n`+[1,2,3,4].map(i=>`M${i}: ${s.mask&(1<<(i-1))?'RECEIVED':'MISSING'}`).join('\n')+`\nHandshake: ${s.state}\n${s.missing||''}`;section.append(row);}
 for(const [url,label] of [['/api/capture.pcap','导出已校验 PCAP'],['/api/handshakes.json','导出结构化数据']]){const a=document.createElement('a');a.href=url;a.textContent=label;a.className='download';a.download='';section.append(a);}
}

let worker=null,loaded=[],paused=false;
function sourceConfig(){
 const source=$('source').value;
 if(source==='file'){const file=$('dictionary').files[0];if(!file||!file.size)throw Error('请选择非空 TXT 字典');return {source,file};}
 const start=$('numeric-start').value,end=$('numeric-end').value;
 if(!/^\d{8}$/.test(start)||!/^\d{8}$/.test(end)||Number(start)>Number(end))throw Error('请输入有效的 8 位起始与结束数字');
 return {source:'numeric8',start,end};
}
function sourceChanged(){
 const numeric=$('source').value==='numeric8';$('numeric-settings').hidden=!numeric;$('file-settings').hidden=numeric;checkStart();
}
function duration(seconds){
 if(seconds===null||!Number.isFinite(seconds))return '等待测速';
 const n=Math.max(0,Math.ceil(seconds));if(n<60)return `${n} 秒`;if(n<3600)return `${Math.ceil(n/60)} 分钟`;if(n<86400)return `${(n/3600).toFixed(1)} 小时`;return `${(n/86400).toFixed(1)} 天`;
}

function checkStart(){
 const r=loaded.find(x=>String(x.id)===$('sessions').value);
 let valid=false;let message='请选择具备 ANonce、SNonce、M2 MIC 和原始 EAPOL 的会话';
 if(r){try{WPA2.prepare(r);valid=true;message='材料可验证；四条消息齐全与 MIC 匹配是不同的判断。';}catch(e){message=e.message;}}
 try{sourceConfig();}catch(e){valid=false;if(r)message=e.message;}
 $('missing').textContent=message;$('start').disabled=!!worker||!valid||!$('authorized').checked;
 return r;
}
function finishWorker(){if(worker)worker.terminate();worker=null;paused=false;$('pause').textContent='暂停';$('pause').disabled=true;$('stop').disabled=true;$('load').disabled=false;$('sessions').disabled=false;$('dictionary').disabled=false;$('source').disabled=false;$('numeric-start').disabled=false;$('numeric-end').disabled=false;checkStart();}
function loadCaptured(){
 loaded=[];$('sessions').replaceChildren();
 if(latestCapture){for(const s of latestCapture.sessions||[]){if(s.verifiable)loaded.push({...s,ssid_hex:latestCapture.ssid_hex,generation:latestCapture.generation});}}
 loaded.sort((a,b)=>(b.last_us||0)-(a.last_us||0));
 for(const r of loaded){const o=document.createElement('option');o.value=r.id;o.textContent=`会话 ${r.id} · ${r.client} · ${r.state}`;$('sessions').append(o);}
 if(!loaded.length){const o=document.createElement('option');o.value='';o.textContent='无可验证会话';$('sessions').append(o);$('missing').textContent=(latestCapture?.sessions||[]).map(s=>s.missing).filter(Boolean).join('；')||'尚未捕获所需认证帧';$('start').disabled=true;return;}
 checkStart();
};
$('load').onclick=loadCaptured;
$('sessions').onchange=checkStart;$('dictionary').onchange=checkStart;$('authorized').onchange=checkStart;
$('source').onchange=sourceChanged;$('numeric-start').oninput=checkStart;$('numeric-end').oninput=checkStart;
$('start').onclick=()=>{
 const r=checkStart();if(!r||worker)return;
 if(!$('authorized').checked){notice('请先确认这是自己的授权测试网络。');return;}
 try{
  WPA2.prepare(r);const config=sourceConfig();worker=new Worker('/worker.js');$('start').disabled=true;$('pause').disabled=false;$('stop').disabled=false;$('load').disabled=true;$('sessions').disabled=true;$('dictionary').disabled=true;$('source').disabled=true;$('numeric-start').disabled=true;$('numeric-end').disabled=true;$('progress').value=0;
  $('verification').textContent=`本地验证中 · 会话 ${r.id} · ${r.ap}`;
  worker.onerror=e=>{$('verification').textContent='Worker 错误: '+e.message;finishWorker();};
  worker.onmessage=e=>{const m=e.data;if(m.type==='error'){$('verification').textContent=m.message;finishWorker();return;}
   const percent=m.total?Math.min(100,m.processed/m.total*100):0;$('progress').value=percent;
   $('verification').textContent=`已验证: ${m.tested} · 跳过无效行: ${m.skipped}\n速度: ${m.rate.toFixed(2)} 候选/秒\n${m.unit==='candidates'?'候选进度':'字典处理'}: ${percent.toFixed(4)}% · ${m.total.toLocaleString()} ${m.unit==='candidates'?'个候选':'字节'}\n预计剩余: ${duration(m.etaSeconds)}`+(m.type==='found'?`\n匹配密码: ${m.password}`:m.type==='done'?'\n完成，未找到匹配':m.type==='paused'?'\n已暂停':'');
   if(m.type==='found'||m.type==='done')finishWorker();
  };
  worker.postMessage({type:'start',record:r,...config});
 }catch(e){$('verification').textContent=e.message;finishWorker();}
};
$('pause').onclick=()=>{if(!worker)return;paused=!paused;worker.postMessage({type:paused?'pause':'resume'});$('pause').textContent=paused?'继续':'暂停';};
$('stop').onclick=()=>{finishWorker();$('verification').textContent='已停止；可重新开始。';};

sourceChanged();refresh();
