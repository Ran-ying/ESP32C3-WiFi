'use strict';
let allowedMax=11;
const $=id=>document.getElementById(id);
async function api(path,data){const r=await fetch(path,data===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json','X-Lab':'1'},body:JSON.stringify(data)});const j=await r.json();if(!r.ok)throw Error(j.message||r.status);return j;}
function notice(s){$('notice').textContent=s;}
async function scan(){try{const r=await api('/api/scan',{});notice(r.message);}catch(e){notice(e.message);}}
async function choose(bssid){if(!$('authorized').checked){notice('请先确认授权。');return;}try{const r=await api('/api/target',{bssid,authorized:true});notice(r.message);}catch(e){notice(e.message);}}
function networks(list){$('networks').replaceChildren();for(const n of list){const d=document.createElement('div');d.className='network';const title=document.createElement('strong');title.textContent=n.ssid||'（隐藏 SSID：无法进行密码验证）';const p=document.createElement('p');p.textContent=`${n.bssid} · CH ${n.channel} · ${n.rssi} dBm · ${n.auth}`;const b=document.createElement('button');b.textContent='选择并切换信道';b.disabled=n.channel>allowedMax;b.onclick=()=>choose(n.bssid);d.append(title,p,b);$('networks').append(d);}}
async function refresh(){try{const s=await api('/api/status');allowedMax=s.max_channel||11;$('status').textContent=`状态: ${s.phase} · 启动标识: ${s.boot_id}\n运行时间: ${Math.floor((s.uptime_ms||0)/1000)} 秒\nSoftAP: ${s.ssid}\n实际信道: ${s.channel} · 可用范围: 1–${allowedMax}\nIP: ${s.ip}\n目标: ${s.target_ssid||'未选择'}\nBSSID: ${s.target_bssid||'—'}\n错误: ${s.error}`;$('scan').disabled=s.busy;if(!s.busy)networks(await api('/api/networks'));renderCapture(await api('/api/capture'));}catch(e){$('status').textContent='设备连接中断；切换信道后请重新加入 ESP32 热点，打开 http://192.168.4.1';}finally{setTimeout(refresh,2000);}}
$('scan').onclick=scan;refresh();

let latestCapture=null;
function renderCapture(c){
 latestCapture=c;const section=$('capture');section.replaceChildren();const h=document.createElement('h2');h.textContent='认证帧 · '+(c.listening?'监听中':'已暂停');section.append(h);
 const p=document.createElement('pre');p.textContent=`${c.security}\nCH: ${c.channel} · BSSID: ${c.bssid}\n数据帧: ${c.data_frames} · 认证帧: ${c.captured}\n队列丢失: ${c.queue_drops} · 超长丢弃: ${c.oversize}\n记录覆盖: ${c.record_overwrites} · 会话淘汰: ${c.session_evictions}\n最近认证帧（启动后微秒）: ${c.last_rx_us}`;section.append(p);
 for(const s of c.sessions||[]){const row=document.createElement('pre');row.textContent=`会话 ${s.id} · 客户端 ${s.client}\n`+[1,2,3,4].map(i=>`M${i}: ${s.mask&(1<<(i-1))?'RECEIVED':'MISSING'}`).join('\n')+`\nHandshake: ${s.state}\n${s.missing||''}`;section.append(row);}
 for(const [url,label] of [['/api/capture.pcap','导出已校验 PCAP'],['/api/handshakes.json','导出结构化数据']]){const a=document.createElement('a');a.href=url;a.textContent=label;a.className='download';a.download='';section.append(a);}
}

let worker=null,loaded=[],paused=false;
function checkStart(){
 const r=loaded.find(x=>String(x.id)===$('sessions').value);
 let valid=false;let message='请选择具备 ANonce、SNonce、M2 MIC 和原始 EAPOL 的会话';
 if(r){try{WPA2.prepare(r);valid=true;message='材料可验证；四条消息齐全与 MIC 匹配是不同的判断。';}catch(e){message=e.message;}}
 $('missing').textContent=message;$('start').disabled=!!worker||!valid||!$('dictionary').files.length;
 return r;
}
function finishWorker(){if(worker)worker.terminate();worker=null;paused=false;$('pause').textContent='暂停';$('pause').disabled=true;$('stop').disabled=true;$('load').disabled=false;$('sessions').disabled=false;$('dictionary').disabled=false;checkStart();}
$('load').onclick=()=>{
 loaded=[];$('sessions').replaceChildren();
 if(latestCapture){for(const s of latestCapture.sessions||[]){if(s.verifiable)loaded.push({...s,ssid_hex:latestCapture.ssid_hex,generation:latestCapture.generation});}}
 for(const r of loaded){const o=document.createElement('option');o.value=r.id;o.textContent=`会话 ${r.id} · ${r.client} · ${r.state}`;$('sessions').append(o);}
 if(!loaded.length){const o=document.createElement('option');o.value='';o.textContent='无可验证会话';$('sessions').append(o);$('missing').textContent=(latestCapture?.sessions||[]).map(s=>s.missing).filter(Boolean).join('；')||'尚未捕获所需认证帧';$('start').disabled=true;return;}
 checkStart();
};
$('sessions').onchange=checkStart;$('dictionary').onchange=checkStart;
$('start').onclick=()=>{
 const r=checkStart();if(!r||worker||!$('dictionary').files.length)return;
 if(!$('authorized').checked){notice('请先确认这是自己的授权测试网络。');return;}
 try{
  WPA2.prepare(r);worker=new Worker('/worker.js');$('start').disabled=true;$('pause').disabled=false;$('stop').disabled=false;$('load').disabled=true;$('sessions').disabled=true;$('dictionary').disabled=true;$('progress').value=0;
  $('verification').textContent=`本地验证中 · 会话 ${r.id} · ${r.ap}`;
  worker.onerror=e=>{$('verification').textContent='Worker 错误: '+e.message;finishWorker();};
  worker.onmessage=e=>{const m=e.data;if(m.type==='error'){$('verification').textContent=m.message;finishWorker();return;}
   const percent=m.total?Math.min(100,m.bytes/m.total*100):0;$('progress').value=percent;
   $('verification').textContent=`已验证: ${m.tested} · 跳过无效行: ${m.skipped}\n速度: ${m.rate.toFixed(2)} 候选/秒\n字典处理: ${percent.toFixed(1)}%`+(m.type==='found'?`\n匹配密码: ${m.password}`:m.type==='done'?'\n完成，未找到匹配':m.type==='paused'?'\n已暂停':'');
   if(m.type==='found'||m.type==='done')finishWorker();
  };
  worker.postMessage({type:'start',record:r,file:$('dictionary').files[0]});
 }catch(e){$('verification').textContent=e.message;finishWorker();}
};
$('pause').onclick=()=>{if(!worker)return;paused=!paused;worker.postMessage({type:paused?'pause':'resume'});$('pause').textContent=paused?'继续':'暂停';};
$('stop').onclick=()=>{finishWorker();$('verification').textContent='已停止；可重新开始。';};
