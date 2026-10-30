const assert=require('node:assert/strict'),crypto=require('node:crypto');
global.WPA2=require('../web/crypto.js');
const PCAP=require('../standalone/src/pcap.js'),ENGINE=require('../standalone/src/engine.js'),{NumericSource,BirthdaySource,FileSource}=require('../standalone/src/source.js'),f=require('./pcap-fixture.cjs');
const blob=b=>new Blob([b]);
(async()=>{
 for(const little of [true,false])for(const nano of [false,true])for(const link of [105,127]){
  const frames=f.complete().map(a=>link===127?f.radio(a):a),parsed=await PCAP.parse(blob(f.pcap(frames,{little,nano,link}))),s=parsed.sessions[0];assert.equal(parsed.sessions.length,1);assert.equal(s.complete,true);assert.equal(s.ssid_hex,f.fixture.record.ssid_hex);assert.equal(s.eapol,f.fixture.record.eapol);
 }
 for(const little of [true,false])for(const simple of [false,true]){
  const p=await PCAP.parse(blob(f.pcapng(f.complete().map(a=>f.radio(a)),{little,simple,unknown:true})));assert.equal(p.sessions[0].complete,true);
 }
 const multi=Buffer.concat([f.pcapng(f.complete().map(a=>f.radio(a))),f.pcapng(f.complete().map(a=>f.radio(a)),{little:false})]);assert.equal((await PCAP.parse(blob(multi))).sessions.length,2);
 const q=[f.frame(2,{qos:true,ht:true,pad:true}),f.frame(1,{qos:true,ht:true,pad:true})].map(a=>f.radio(a,{extended:true,pad:true}));let p=await PCAP.parse(blob(f.pcap(q)));assert(p.sessions[0].verifiable);assert(!p.sessions[0].complete);assert.equal(p.sessions[0].ssid_hex,'');assert.equal(p.sessions[0].channel,6);
 p=await PCAP.parse(blob(f.pcap([f.frame(2),f.frame(2)].map(a=>f.radio(a)))));assert(!p.sessions[0].verifiable);assert.equal(p.sessions[0].count,2);
 p=await PCAP.parse(blob(f.pcap([f.frame(1),f.frame(2),f.frame(1,{nonceFlip:true})].map(a=>f.radio(a)))));assert(p.sessions.every(s=>!s.verifiable));
 p=await PCAP.parse(blob(f.pcap([f.frame(1,{version:3}),f.frame(2,{version:3})].map(a=>f.radio(a)))));assert(!p.sessions[0].verifiable);
 const capture=f.pcap(f.complete().map(a=>f.radio(a)));await assert.rejects(()=>PCAP.parse(blob(capture.subarray(0,capture.length-1))));await assert.rejects(()=>PCAP.parse(blob(f.pcap([],{link:1}))));
 const ng=f.pcapng(f.complete().map(a=>f.radio(a)));ng[ng.length-1]^=1;await assert.rejects(()=>PCAP.parse(blob(ng)));
 let src=new NumericSource('00000000','00000127',4),jobs=[],task;while((task=await src.nextBatch()))for(let i=task.start;i<=task.end;i++)jobs.push(i);assert.deepEqual(jobs,Array.from({length:128},(_,i)=>i));
 src=new NumericSource('99999999','99999999',256);assert.equal((await src.nextBatch()).start,99999999);assert.equal(await src.nextBatch(),null);assert.throws(()=>new NumericSource('00000010','00000001',4));
 src=new FileSource(blob(Buffer.from('\ufeffshort\r\n'+'x'.repeat(70000)+'\n  spaces-pass  \r\n00000002')));jobs=[];while((task=await src.nextBatch()))jobs.push(...task.candidates);assert.deepEqual(jobs,['  spaces-pass  ','00000002']);assert.equal(src.skipped,2);
 for(const [start,end,format,expected] of [
  ['1900-02-28','1900-03-01','YYYYMMDD',['19000228','19000301']],
  ['2000-02-28','2000-03-01','YYYYMMDD',['20000228','20000229','20000301']],
  ['2000-02-29','2000-02-29','DDMMYYYY',['29022000']],
  ['2000-02-29','2000-02-29','MMDDYYYY',['02292000']]]){
  const source=new BirthdaySource(start,end,4,format),values=[];let batch;while((batch=await source.nextBatch()))values.push(...batch.candidates);assert.deepEqual(values,expected);assert.equal(source.total,expected.length);
 }
 assert.throws(()=>new BirthdaySource('1900-02-29','1900-03-01',4));assert.throws(()=>new BirthdaySource('2000-03-01','2000-02-01',4));
 const birthday=require('./fixtures/wpa2-birthday.json');const birthdayVerifier=await ENGINE.create(birthday.record,'js');assert(await birthdayVerifier.verify('20000229'));assert(!await birthdayVerifier.verify('20000228'));
 Object.defineProperty(globalThis,'crypto',{value:crypto.webcrypto,configurable:true});
 for(const mode of ['js','native','auto']){const v=await ENGINE.create(f.fixture.record,mode);assert(await v.verify('00000002'));assert(!await v.verify('00000003'));}
 Object.defineProperty(globalThis,'crypto',{value:undefined,configurable:true});const fallback=await ENGINE.create(f.fixture.record,'auto');assert.equal(fallback.engine,'js');assert(await fallback.verify('00000002'));await assert.rejects(()=>ENGINE.create(f.fixture.record,'native'));
 console.log('PASS standalone parser: PCAP endian/micro/nano/raw/radiotap, PCAPNG EPB/SPB/endian/sections, QoS/HT/padding, retransmits, missing SSID, conflicts, unsupported and corrupt input');
 console.log('PASS sources/engine: disjoint numeric batches, last value, streaming TXT, JS/native MIC and HTTP fallback');
})().catch(e=>{console.error(e);process.exitCode=1;});
