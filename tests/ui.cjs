const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});try{
 const page=await browser.newPage({viewport:{width:390,height:844}});let selected=null,scans=0;
 await page.route('http://192.168.4.1/**',async route=>{
 const p=new URL(route.request().url()).pathname;
 if(p.startsWith('/api/')){
 let body={};
 if(p==='/api/status')body={phase:'READY',ssid:'ESP32C3-Auditor',channel:6,ip:'192.168.4.1',error:'ESP_OK'};
 if(p==='/api/networks')body=[{ssid:'<img src=x onerror=alert(1)>',bssid:'02:00:00:00:00:01',channel:6,rssi:-40,auth:'WPA2-Personal'},{ssid:'<img src=x onerror=alert(1)>',bssid:'02:00:00:00:00:02',channel:11,rssi:-70,auth:'WPA2-Personal'}];
 if(p==='/api/scan'){scans++;body={message:'scan accepted'};}
 if(p==='/api/target'){selected=route.request().postDataJSON();body={message:'switch accepted'};}
 await route.fulfill({json:body});
 }else await route.fulfill({path:path.join(__dirname,'../web',p==='/'?'index.html':p.slice(1))});
 });
 await page.goto('http://192.168.4.1/');await page.waitForSelector('.network');
 assert.equal(await page.locator('.network').count(),2);assert.equal(await page.locator('.network img').count(),0);
 await page.locator('.network button').first().click();assert.equal(selected,null);
 await page.locator('#authorized').check();await page.locator('.network button').nth(1).click();
 await page.waitForFunction(()=>document.getElementById('notice').textContent==='switch accepted');
 assert.equal(selected.bssid,'02:00:00:00:00:02');assert.equal(selected.authorized,true);
 await page.locator('#scan').click();await page.waitForFunction(()=>document.getElementById('notice').textContent==='scan accepted');assert.equal(scans,1);
 assert.match(await page.locator('#status').textContent(),/实际信道: 6/);
 console.log('PASS mobile layout, escaped SSID, BSSID selection, authorization gate, scan, actual channel');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
