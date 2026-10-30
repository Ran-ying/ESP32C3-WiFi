const {chromium}=require('playwright'),assert=require('node:assert/strict'),path=require('node:path');
const f=require('./pcap-fixture.cjs');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined,args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844}});await context.setOffline(true);const page=await context.newPage(),requests=[];
  page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
  await page.goto('file://'+path.resolve(__dirname,'../standalone/wpa2-parallel.html'));
  async function importCapture(bytes){await page.locator('#capture-file').setInputFiles({name:'synthetic.pcap',mimeType:'application/octet-stream',buffer:bytes});await page.waitForFunction(()=>document.getElementById('import-status').textContent.startsWith('解析完成'),{},{timeout:15000});}
  await importCapture(f.pcap(f.complete().map(a=>f.radio(a))));
  assert.equal(await page.locator('#ssid').inputValue(),Buffer.from(f.fixture.record.ssid_hex,'hex').toString());assert.match(await page.locator('#handshake').textContent(),/COMPLETE/);assert(await page.locator('#start').isDisabled());
  await page.locator('#authorized').check();await page.locator('#workers').fill('0');assert(await page.locator('#start').isDisabled());await page.locator('#workers').fill('4');await page.locator('#range-start').fill('00000000');await page.locator('#range-end').fill('00000007');await page.locator('#engine').selectOption('js');
  await page.locator('#start').click();await page.waitForFunction(()=>document.getElementById('run-state').textContent==='找到匹配',{},{timeout:20000});assert.match(await page.locator('#result').textContent(),/00000002/);assert.equal(await page.locator('#worker-table tr').count(),4);
  // All candidates must be exhausted exactly once, even when worker completion is out of order.
  for(const workers of [1,4]){
   await page.locator('#workers').fill(String(workers));await page.locator('#range-start').fill('00001000');await page.locator('#range-end').fill('00001063');
   await page.locator('#start').click();await page.waitForFunction(()=>document.getElementById('run-state').textContent==='全部完成，未找到匹配',{},{timeout:30000});
   assert.match(await page.locator('#metrics').textContent(),/已验证（回报）：64/);assert.equal(await page.locator('#progress').getAttribute('value'),'100');
   console.log(`PASS real ${workers}-Worker exhaustive JS run: 64 candidates`);
  }
  // Pause, resume and stop a substantial interval.
  await page.locator('#range-start').fill('00001000');await page.locator('#range-end').fill('00100000');await page.locator('#start').click();await page.locator('#pause').click();
  await page.waitForFunction(()=>document.getElementById('run-state').textContent==='已暂停',{},{timeout:15000});const paused=await page.locator('#metrics').textContent();await page.waitForTimeout(350);assert.equal(await page.locator('#metrics').textContent(),paused);
  await page.locator('#pause').click();await page.locator('#stop').click();assert.equal(await page.locator('#run-state').textContent(),'已停止');
  // Stream a local dictionary through the same pool, then compare the native engine.
  await page.locator('#source').selectOption('file');await page.locator('#dictionary').setInputFiles({name:'local.txt',mimeType:'text/plain',buffer:Buffer.from('wrong-password\n00000002\n')});
  await page.locator('#start').click();await page.waitForFunction(()=>document.getElementById('run-state').textContent==='找到匹配',{},{timeout:15000});assert.match(await page.locator('#result').textContent(),/00000002/);
  await page.locator('#dictionary').setInputFiles({name:'wrong.txt',mimeType:'text/plain',buffer:Buffer.from('\ufeffwrong-password\r\nshort\nwrong-password\nwrong-password')});
  await page.locator('#start').click();await page.waitForFunction(()=>document.getElementById('run-state').textContent==='全部完成，未找到匹配',{},{timeout:15000});assert.match(await page.locator('#metrics').textContent(),/已验证（回报）：3/);assert.equal(await page.locator('#progress').getAttribute('value'),'100');
  await page.locator('#source').selectOption('numeric');await page.locator('#engine').selectOption('native');await page.locator('#range-start').fill('00000000');await page.locator('#range-end').fill('00000007');
  await page.locator('#start').click();await page.waitForFunction(()=>document.getElementById('run-state').textContent==='找到匹配',{},{timeout:15000});assert.match(await page.locator('#worker-table').textContent(),/native/);
  // ESP32 exports lack beacons: SSID cannot be invented.
  await importCapture(f.pcap([f.frame(1),f.frame(2)].map(a=>f.radio(a))));assert.equal(await page.locator('#ssid').inputValue(),'');assert(await page.locator('#start').isDisabled());await page.locator('#ssid').fill('Synthetic-Lab');assert(!(await page.locator('#start').isDisabled()));
  await importCapture(f.pcap([f.frame(2)].map(a=>f.radio(a))));await page.locator('#ssid').fill('Synthetic-Lab');assert(await page.locator('#start').isDisabled());assert.match(await page.locator('#validation').textContent(),/ANonce/);
  assert.deepEqual(requests,[]);
  console.log('PASS single HTML via file:// offline: import, adjustable parallelism, real MIC, native/JS, TXT, pause/resume/stop, missing material gate, zero HTTP requests');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
