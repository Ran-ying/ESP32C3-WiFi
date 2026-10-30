'use strict';
const $=id=>document.getElementById(id);
async function api(path,data){const r=await fetch(path,data===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json','X-Lab':'1'},body:JSON.stringify(data)});const j=await r.json();if(!r.ok)throw Error(j.message||r.status);return j;}
function notice(s){$('notice').textContent=s;}
async function scan(){try{const r=await api('/api/scan',{});notice(r.message);}catch(e){notice(e.message);}}
async function choose(bssid){if(!$('authorized').checked){notice('请先确认授权。');return;}try{const r=await api('/api/target',{bssid,authorized:true});notice(r.message);}catch(e){notice(e.message);}}
function networks(list){$('networks').replaceChildren();for(const n of list){const d=document.createElement('div');d.className='network';const title=document.createElement('strong');title.textContent=n.ssid||'（隐藏 SSID：无法进行密码验证）';const p=document.createElement('p');p.textContent=`${n.bssid} · CH ${n.channel} · ${n.rssi} dBm · ${n.auth}`;const b=document.createElement('button');b.textContent='选择并切换信道';b.disabled=n.channel>11;b.onclick=()=>choose(n.bssid);d.append(title,p,b);$('networks').append(d);}}
async function refresh(){try{const s=await api('/api/status');$('status').textContent=`状态: ${s.phase}\nSoftAP: ${s.ssid}\n实际信道: ${s.channel}\nIP: ${s.ip}\n目标: ${s.target_ssid||'未选择'}\nBSSID: ${s.target_bssid||'—'}\n错误: ${s.error}`;$('scan').disabled=s.busy;if(!s.busy)networks(await api('/api/networks'));}catch(e){$('status').textContent='设备连接中断；切换信道后请重新加入 ESP32 热点，打开 http://192.168.4.1';}finally{setTimeout(refresh,2000);}}
$('scan').onclick=scan;refresh();
