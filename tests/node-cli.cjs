'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {nativeVerifier}=require('../cli/core.cjs'),{RegexSource}=require('../standalone/src/regex.js'),f=require('./pcap-fixture.cjs');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'c3-node-cli-')),pcap=path.join(folder,'test.pcap');fs.writeFileSync(pcap,f.pcap(f.complete().map(x=>f.radio(x))));
function run(args,expected){const r=spawnSync(process.execPath,['cli/wpa2.cjs','--pcap',pcap,'--json',...args],{cwd:path.resolve(__dirname,'..'),encoding:'utf8',timeout:15000});assert.equal(r.status,expected,r.stdout+r.stderr);const events=r.stdout.trim().split('\n').filter(Boolean).map(x=>JSON.parse(x));return events.at(-1);}
(async()=>{try{
 const verifier=nativeVerifier(f.fixture.record);assert(await verifier.verify('00000002'));assert(!await verifier.verify('00000003'));
 assert.equal(run(['--list'],0).sessions[0].state,'COMPLETE');
 assert.equal(run(['--source','numeric','--start','00000000','--end','00000003','--workers','4','--authorized'],0).password,'00000002');
 let r=run(['--source','numeric','--start','00001000','--end','00001063','--workers','4','--authorized'],1);assert.equal(r.tested,64);assert.equal(r.percent,100);
 assert.equal(run(['--source','regex','--regex','^0{7}[0-3]$','--workers','4','--authorized'],0).password,'00000002');
 const dict=path.join(folder,'words.txt');fs.writeFileSync(dict,'\ufeffwrong-password\r\nshort\n00000002');assert.equal(run(['--source','file','--dictionary',dict,'--workers','4','--authorized'],0).password,'00000002');
 fs.writeFileSync(dict,'wrong-password\r\nshort\nwrong-password');r=run(['--source','file','--dictionary',dict,'--workers','4','--authorized'],1);assert.equal(r.tested,2);assert.equal(r.skipped,1);assert.equal(r.percent,100);
 assert.equal(run(['--source','regex','--regex','a*','--authorized'],2).phase,'error');assert.equal(run(['--workers','0','--authorized'],2).phase,'error');assert.equal(run([],2).phase,'error');
 fs.writeFileSync(pcap,f.pcap([f.frame(1),f.frame(2)].map(x=>f.radio(x))));assert.match(run(['--authorized'],2).error,/SSID/);assert.equal(run(['--ssid','Synthetic-Lab','--start','00000002','--end','00000002','--authorized'],0).password,'00000002');
 fs.writeFileSync(pcap,f.pcap([f.frame(2)].map(x=>f.radio(x))));assert.equal(run(['--ssid','Synthetic-Lab','--authorized'],2).phase,'error');
 const birthday=require('./fixtures/wpa2-birthday.json');fs.writeFileSync(pcap,f.pcap(f.complete().map((x,i)=>{if(i===2){x=Buffer.from(x);Buffer.from(birthday.record.eapol,'hex').copy(x,x.length-Buffer.from(birthday.record.eapol,'hex').length);}return f.radio(x);})));assert.equal(run(['--source','birthday','--from','2000-02-28','--to','2000-03-01','--workers','4','--authorized'],0).password,'20000229');
 for(const [pattern,total,first,last] of [['^[0-9]{8}$',100000000,'00000000','99999999'],['^test[0-2]{4}$',81,'test0000','test2222'],['^(AB|CD)[0-1]{6}$',128,'AB000000','CD111111'],['^abcde(f|g)?[0-1]{2,3}$',32,'abcde000','abcdeg111']]){const s=new RegexSource(pattern,4);assert.equal(s.total,total);assert.equal(s.at(0),first);assert.equal(s.at(total-1),last);if(total<1000){const values=[];let b;while((b=await s.nextBatch()))values.push(...b.candidates);assert.equal(values.length,total);assert(values.every(x=>new RegExp(pattern).test(x)));}}
 for(const pattern of ['a*','a+','(?=a)a{8}','(a)\\1','[z-a]{8}','.{9}','abc'])assert.throws(()=>new RegexSource(pattern,4));
 console.log('PASS Node CLI: native MIC, PCAP/list/SSID gates, numeric/regex/birthday/TXT, exact exhaustion counts, invalid flags; finite regex counts and syntax bounds');
 }finally{fs.rmSync(folder,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
