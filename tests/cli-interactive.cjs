'use strict';
const {spawn}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),f=require('./pcap-fixture.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'c3-cli-interactive-')),capture=path.join(dir,'test.pcap');fs.writeFileSync(capture,f.pcap(f.complete().map(x=>f.radio(x))));
const child=spawn(process.execPath,['cli/wpa2.cjs','--pcap',capture,'--start','10000000','--end','10010000','--workers','4','--authorized','--interactive','--json'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,UV_THREADPOOL_SIZE:'4'},stdio:['pipe','pipe','pipe']});
let text='',errors='',stage=0,stopped=0,final;
const timer=setTimeout(()=>{child.kill('SIGTERM');console.error('interactive timeout',stage,errors);process.exitCode=1;},15000);
child.stderr.on('data',b=>errors+=b);child.stdout.on('data',b=>{text+=b;let p;while((p=text.indexOf('\n'))>=0){const line=text.slice(0,p);text=text.slice(p+1);if(!line)continue;const e=JSON.parse(line);if(e.event==='result'){final=e;continue;}if(e.event!=='progress')continue;
 if(stage===0&&!e.paused){stage=1;child.stdin.write('p\n');}else if(stage===1&&e.paused){stage=2;child.stdin.write('s\n');}else if(stage===2&&e.phase==='stopped'){stopped=e.tested;stage=3;child.stdin.write('r\n');}else if(stage===3&&e.resumes===1&&e.phase==='running'){stage=4;child.stdin.write('q\n');}
}});
child.on('exit',code=>{clearTimeout(timer);try{assert.equal(code,130,errors);assert.equal(stage,4);assert(final);assert.equal(final.resumes,1);assert(final.tested>=stopped);assert.equal(final.phase,'stopped');console.log('PASS Node interactive pause/stop/start checkpoint and safe quit');}catch(e){console.error(e);process.exitCode=1;}finally{fs.rmSync(dir,{recursive:true,force:true});}});
