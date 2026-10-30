const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const fixture=require('./fixtures/wpa2-synthetic.json');
const birthday=require('./fixtures/wpa2-birthday.json');
const pcapFixture=require('./pcap-fixture.cjs');
const numeric=require('./fixtures/wpa2-numeric.json');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined,args:['--no-sandbox']});
 let releaseStall;
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  let selected=null,scans=0,posts=[],channel=6,target=fixture.record.ap,generation=1,busy=false;
  let record=fixture.record,captureId=1,statusCalls=0,stallStatus=false,stallBeganResolve,navigations=0;
  page.on('framenavigated',f=>{if(f===page.mainFrame())navigations++;});
  await page.route('http://192.168.4.1/**',async route=>{
   const p=new URL(route.request().url()).pathname;
   if(!p.startsWith('/api/')){await route.fulfill({path:path.join(__dirname,'../web',p==='/'?'index.html':p.slice(1))});return;}
   let body={};if(route.request().method()==='POST')posts.push(route.request().postData());
   if(p==='/api/status'){
    statusCalls++;
    if(stallStatus){stallStatus=false;stallBeganResolve();await new Promise(r=>releaseStall=r);try{await route.abort();}catch{}return;}
    body={phase:busy?'SWITCHING':'READY',busy,ssid:'ESP32C3-Auditor',channel,target_bssid:target,target_channel:channel,ip:'192.168.4.1',error:'ESP_OK',max_channel:13,boot_id:1,uptime_ms:123000};
   }
   if(p==='/api/networks')body=[
    {ssid:'<img src=x onerror=alert(1)>',bssid:'02:00:00:00:00:01',channel:6,rssi:-40,auth:'WPA2-Personal'},
    {ssid:'<img src=x onerror=alert(1)>',bssid:'02:00:00:00:00:02',channel:11,rssi:-70,auth:'WPA2-Personal'},
    {ssid:'Synthetic-13',bssid:'02:00:00:00:00:03',channel:13,rssi:-60,auth:'WPA2-Personal'},
    {ssid:'Unsupported-14',bssid:'02:00:00:00:00:04',channel:14,rssi:-60,auth:'WPA2-Personal'}];
   if(p==='/api/capture')body={ssid_hex:record.ssid_hex,channel,bssid:target,listening:true,security:'WPA2-PSK / CCMP',data_frames:4,captured:2,queue_drops:0,oversize:0,record_overwrites:0,session_evictions:0,last_rx_us:1234567,generation,sessions:[{...record,id:captureId,state:'VERIFIABLE',verifiable:true,mask:3,missing:''}]};
   if(p==='/api/scan'){scans++;body={message:'scan accepted'};}
   if(p==='/api/target'){
    selected=route.request().postDataJSON();busy=true;body={message:'switch accepted'};
    setTimeout(()=>{channel=11;target=selected.bssid;generation++;busy=false;},1300);
   }
   await route.fulfill({json:body});
  });
  await page.goto('http://192.168.4.1/');await page.waitForSelector('.network');
  assert.equal(await page.locator('.network').count(),4);assert.equal(await page.locator('.network img').count(),0);
  assert.equal(await page.locator('.network button').first().textContent(),'切换');
  const infoBox=await page.locator('.network-info').first().boundingBox(),buttonBox=await page.locator('.network button').first().boundingBox();assert(infoBox.x+infoBox.width<=buttonBox.x);
  assert(!(await page.locator('.network button').nth(2).isDisabled()));assert(await page.locator('.network button').nth(3).isDisabled());
  await page.locator('.network button').first().click();assert.equal(selected,null);assert(!(await page.locator('#switch-dialog').isVisible()));
  assert(await page.locator('#start').isDisabled());
  await page.waitForFunction(()=>document.getElementById('sessions').options.length===1&&document.getElementById('sessions').value==='1');
  await page.locator('#authorized').check();await page.locator('#workers').fill('4');
  await page.locator('.network button').nth(1).click();
  assert(await page.locator('#switch-dialog').isVisible());assert.equal(selected,null);
  assert.match(await page.locator('#switch-target').textContent(),/02:00:00:00:00:02/);
  await page.locator('#switch-cancel').click();assert.equal(selected,null);
  await page.locator('.network button').nth(1).click();await page.locator('#switch-confirm').click();
  await page.waitForFunction(()=>document.getElementById('switch-title').textContent==='切换成功',{},{timeout:12000});
  assert.equal(selected.bssid,'02:00:00:00:00:02');assert.equal(selected.authorized,true);
  assert.match(await page.locator('#status').textContent(),/实际信道: 11/);await page.locator('#switch-close').click();
  await page.locator('#scan').click();await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('扫描已开始'));assert.equal(scans,1);
  await page.locator('#source').selectOption('file');assert(await page.locator('#start').isDisabled());
  await page.locator('#dictionary').setInputFiles({name:'local.txt',mimeType:'text/plain',buffer:Buffer.from('wrong-password\n'+fixture.password+'\n')});
  assert(!(await page.locator('#start').isDisabled()));assert.equal(await page.evaluate(()=>window.isSecureContext),false);
  await page.locator('#start').click();await page.waitForFunction(()=>document.getElementById('verification').textContent.includes('匹配密码:'),{},{timeout:15000});
  assert.match(await page.locator('#verification').textContent(),new RegExp(fixture.password));
  assert(posts.every(body=>!body.includes(fixture.password)&&!body.includes('wrong-password')));
  await page.locator('#dictionary').setInputFiles({name:'many.txt',mimeType:'text/plain',buffer:Buffer.from('wrong-password\n'.repeat(100))});
  await page.locator('#start').click();await page.locator('#pause').click();await page.waitForFunction(()=>document.getElementById('verification').textContent.includes('已暂停'));
  await page.locator('#pause').click();await page.locator('#stop').click();assert.match(await page.locator('#verification').textContent(),/已停止/);
  assert(await page.locator('#pause').isDisabled());
  record=numeric.record;captureId=2;
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await page.waitForFunction(()=>document.getElementById('capture').textContent.includes('会话 2'));
  await page.locator('#load').click();await page.locator('#source').selectOption('numeric8');
  await page.locator('#numeric-start').fill('00000011');await page.locator('#numeric-end').fill('00000010');assert(await page.locator('#start').isDisabled());
  await page.locator('#numeric-start').fill('00000000');await page.locator('#numeric-end').fill('00000003');
  await page.locator('#start').click();await page.waitForFunction(()=>document.getElementById('verification').textContent.includes('匹配密码: 00000002'),{},{timeout:15000});
  const verified=Number((await page.locator('#verification').textContent()).match(/已验证: (\d+)/)[1]);assert(verified>=1&&verified<=4);assert.equal(await page.locator('#worker-table tr').count(),4);assert(posts.every(body=>!body.includes('00000002')));
  record=birthday.record;captureId=3;await page.evaluate(()=>window.dispatchEvent(new Event('online')));await page.waitForFunction(()=>document.getElementById('capture').textContent.includes('会话 3'));
  await page.locator('#load').click();await page.locator('#source').selectOption('birthday');await page.locator('#birthday-start').fill('2000-02-28');await page.locator('#birthday-end').fill('2000-03-01');
  await page.locator('#start').click();await page.waitForFunction(()=>document.getElementById('verification').textContent.includes('匹配密码: 20000229'),{},{timeout:15000});assert.equal(await page.locator('#worker-table tr').count(),3);
  await page.locator('#capture-file').setInputFiles({name:'local.pcap',mimeType:'application/octet-stream',buffer:pcapFixture.pcap([pcapFixture.frame(1),pcapFixture.frame(2)].map(a=>pcapFixture.radio(a)))});
  await page.waitForFunction(()=>document.getElementById('import-status').textContent.includes('已导入'));assert(await page.locator('#start').isDisabled());await page.locator('#ssid').fill('Synthetic-Lab');
  await page.locator('#source').selectOption('numeric8');await page.locator('#numeric-start').fill('00000000');await page.locator('#numeric-end').fill('00000003');await page.locator('#start').click();
  await page.waitForFunction(()=>document.getElementById('verification').textContent.includes('匹配密码: 00000002'),{},{timeout:15000});assert(posts.every(body=>!body.includes('ssid_hex')&&!body.includes('20000229')));
  await page.reload();await page.waitForFunction(()=>document.getElementById('sessions').value==='3');
  assert(await page.locator('#start').isDisabled()); // Capture restored, authorization not silently restored.
  // A request that never returns must time out and allow subsequent polling, without reloading.
  let began=new Promise(r=>stallBeganResolve=r);const count=statusCalls,nav=navigations;stallStatus=true;channel=13;
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));await began;
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('实际信道: 13'),{},{timeout:12000});
  assert(statusCalls>=count+2);assert.equal(navigations,nav);releaseStall();releaseStall=null;
  // Returning to the page cancels the stale poll immediately.
  began=new Promise(r=>stallBeganResolve=r);stallStatus=true;channel=6;
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));await began;
  await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('实际信道: 6'),{},{timeout:3000});
  releaseStall();releaseStall=null;
  console.log('PASS mobile UI: escaped SSID/BSSID selection, authorization, channel bounds, switch confirm/cancel/success');
  console.log('PASS real parallel Workers on insecure HTTP: TXT/numeric8/birthday, leap-day MIC, local PCAP/SSID gate, no candidate upload, range validation, pause/resume/stop');
  console.log('PASS reconnect: retained-capture auto load, hung-request timeout recovery and pageshow recovery without reload');
 }finally{if(releaseStall)releaseStall();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
