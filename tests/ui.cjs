const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const fixture=require('./fixtures/wpa2-synthetic.json');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined,args:['--no-sandbox']});try{
 const page=await browser.newPage({viewport:{width:390,height:844}});let selected=null,scans=0,posts=[];
 await page.route('http://192.168.4.1/**',async route=>{
 const p=new URL(route.request().url()).pathname;
 if(p.startsWith('/api/')){
 let body={};if(route.request().method()==='POST')posts.push(route.request().postData());
 if(p==='/api/status')body={phase:'READY',ssid:'ESP32C3-Auditor',channel:6,ip:'192.168.4.1',error:'ESP_OK',max_channel:13,boot_id:1,uptime_ms:123000};
 if(p==='/api/networks')body=[{ssid:'<img src=x onerror=alert(1)>',bssid:'02:00:00:00:00:01',channel:6,rssi:-40,auth:'WPA2-Personal'},{ssid:'<img src=x onerror=alert(1)>',bssid:'02:00:00:00:00:02',channel:11,rssi:-70,auth:'WPA2-Personal'},{ssid:'Synthetic-13',bssid:'02:00:00:00:00:03',channel:13,rssi:-60,auth:'WPA2-Personal'},{ssid:'Unsupported-14',bssid:'02:00:00:00:00:04',channel:14,rssi:-60,auth:'WPA2-Personal'}];
 if(p==='/api/capture')body={ssid_hex:fixture.record.ssid_hex,channel:6,bssid:fixture.record.ap,listening:true,security:'WPA2-PSK / CCMP',data_frames:4,captured:2,queue_drops:0,oversize:0,record_overwrites:0,session_evictions:0,last_rx_us:1234567,generation:1,sessions:[{...fixture.record,state:'VERIFIABLE',verifiable:true,mask:3,missing:''}]};
 if(p==='/api/scan'){scans++;body={message:'scan accepted'};}
 if(p==='/api/target'){selected=route.request().postDataJSON();body={message:'switch accepted'};}
 await route.fulfill({json:body});
 }else await route.fulfill({path:path.join(__dirname,'../web',p==='/'?'index.html':p.slice(1))});
 });
 await page.goto('http://192.168.4.1/');await page.waitForSelector('.network');
 assert.equal(await page.locator('.network').count(),4);assert.equal(await page.locator('.network img').count(),0);
 assert(!(await page.locator('.network button').nth(2).isDisabled()));assert(await page.locator('.network button').nth(3).isDisabled());
 await page.locator('.network button').first().click();assert.equal(selected,null);
 await page.locator('#authorized').check();await page.locator('.network button').nth(1).click();
 await page.waitForFunction(()=>document.getElementById('notice').textContent==='switch accepted');
 assert.equal(selected.bssid,'02:00:00:00:00:02');assert.equal(selected.authorized,true);
 await page.locator('#scan').click();await page.waitForFunction(()=>document.getElementById('notice').textContent==='scan accepted');assert.equal(scans,1);
 assert.match(await page.locator('#status').textContent(),/实际信道: 6/);
 assert(await page.locator('#start').isDisabled());
 await page.locator('#load').click();await page.locator('#dictionary').setInputFiles({name:'local.txt',mimeType:'text/plain',buffer:Buffer.from('wrong-password\n'+fixture.password+'\n')});
 assert(!(await page.locator('#start').isDisabled()));
 assert.equal(await page.evaluate(()=>window.isSecureContext),false);
 await page.locator('#start').click();await page.waitForFunction(()=>document.getElementById('verification').textContent.includes('匹配密码:'),{},{timeout:15000});
 assert.match(await page.locator('#verification').textContent(),new RegExp(fixture.password));
 assert(posts.every(body=>!body.includes(fixture.password)&&!body.includes('wrong-password')));
 // Pause/resume and stop with a long local dictionary.
 await page.locator('#dictionary').setInputFiles({name:'many.txt',mimeType:'text/plain',buffer:Buffer.from('wrong-password\n'.repeat(100))});
 await page.locator('#start').click();await page.locator('#pause').click();await page.waitForFunction(()=>document.getElementById('verification').textContent.includes('已暂停'));
 await page.locator('#pause').click();await page.locator('#stop').click();assert.match(await page.locator('#verification').textContent(),/已停止/);assert(await page.locator('#pause').isDisabled());
 console.log('PASS local Worker on insecure HTTP, result, no dictionary upload, pause/resume/stop');
 console.log('PASS mobile layout, escaped SSID, BSSID selection, authorization gate, scan, actual channel');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
