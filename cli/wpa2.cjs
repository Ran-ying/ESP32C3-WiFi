#!/usr/bin/env node
'use strict';
const os=require('node:os'),{spawn}=require('node:child_process'),readline=require('node:readline');
const HELP=`本地 WPA2 原生并行验证（Node.js 22+，无运行时 npm 依赖）

列出会话：
 node cli/wpa2.cjs --pcap capture.pcap --list
数字验证：
 node cli/wpa2.cjs --pcap capture.pcap --ssid Lab --source numeric --start 00000000 --end 00009999 --workers 8 --authorized
生日验证：
 node cli/wpa2.cjs --pcap capture.pcap --ssid Lab --source birthday --from 1900-01-01 --to 2026-12-31 --format YYYYMMDD --workers 8 --authorized
正则验证：
 node cli/wpa2.cjs --pcap capture.pcap --ssid Lab --source regex --regex '^test[0-9]{4}$' --workers 8 --authorized
TXT 验证：
 node cli/wpa2.cjs --pcap capture.pcap --ssid Lab --source file --dictionary local.txt --workers 8 --authorized

--session ID       多个可验证会话时必须指定（先 --list）
--ssid-hex HEX     非 UTF-8 SSID 的原始字节，与 --ssid 二选一
--json             输出 NDJSON 进度和结果；匹配密码仅输出到终端
--interactive      非 TTY 也接收交互命令，适合脚本测试
交互：p 暂停/继续；s 停止并保留内存断点；r 从断点继续；q 退出。
Ctrl+C 安全退出。进程退出后内存断点消失；不会自动写入字典或结果。
退出码：0 找到匹配/列出会话，1 全部完成无匹配，2 输入/运行错误，130 中断。
`;
function args(argv){
 const result={workers:Math.min(256,os.availableParallelism?os.availableParallelism():os.cpus().length),source:'numeric',start:'00000000',end:'99999999',from:'1900-01-01',to:`${new Date().getFullYear()}-12-31`,format:'YYYYMMDD'};
 const flags=new Set(['help','list','json','authorized','interactive']),values=new Set(['pcap','session','ssid','ssid-hex','source','start','end','workers','from','to','format','regex','dictionary']),seen=new Set();
 for(let i=0;i<argv.length;i++){const key=argv[i].replace(/^--/,'');if(!argv[i].startsWith('--')||(!flags.has(key)&&!values.has(key)))throw Error(`未知参数：${argv[i]}`);if(seen.has(key))throw Error(`重复参数：--${key}`);seen.add(key);if(flags.has(key))result[key]=true;else{if(i+1>=argv.length||argv[i+1].startsWith('--'))throw Error(`--${key} 缺少值`);result[key]=argv[++i];}}
 result.workers=Number(result.workers);if(!Number.isInteger(result.workers)||result.workers<1||result.workers>256)throw Error('--workers 须为 1–256');
 if(result.session!==undefined&&(!/^\d+$/.test(result.session)||+result.session<1))throw Error('--session 必须为正整数');
 if(result.ssid!==undefined&&result['ssid-hex']!==undefined)throw Error('--ssid 与 --ssid-hex 二选一');
 return result;
}
async function run(options){
 const {NodeFile,NativeLane}=require('./core.cjs'),PCAP=require('../standalone/src/pcap.js'),SOURCES=require('../standalone/src/source.js'),{RegexSource}=require('../standalone/src/regex.js'),WPA2=require('../web/crypto.js'),{Pool}=require('../standalone/src/pool.js');
 if(!options.pcap)throw Error('请指定 --pcap 文件');const files=[];let timer,rl;
 const emit=o=>{if(options.json)console.log(JSON.stringify(o));else if(o.event==='result'){console.log(`\n${o.phase} · 已验证 ${o.tested} · ${o.rate.toFixed(2)} 候选/秒`);if(o.password!==null)console.log(`匹配密码：${o.password}`);if(o.error)console.error(o.error);}else if(o.event==='progress'){const line=`${o.paused?'已暂停':o.phase} · ${o.tested.toLocaleString()} · ${o.rate.toFixed(2)}/秒 · ${o.percent.toFixed(4)}% · 并行 ${o.slots.length}`;if(process.stderr.isTTY)process.stderr.write('\r'+line+'   ');else console.error(line);}else if(o.event==='sessions')for(const s of o.sessions)console.log(`#${s.id} ${s.ap} / ${s.client} ${s.state} SSID=${s.ssid_hex?JSON.stringify(Buffer.from(s.ssid_hex,'hex').toString()):'缺失'} ${s.reason||''}`);};
 try{
  const capture=await NodeFile.open(options.pcap);files.push(capture);const parsed=await PCAP.parse(capture),sessions=parsed.sessions;
  emit({event:'sessions',stats:parsed.stats,sessions:sessions.map(s=>({id:s.id,ap:s.ap,client:s.client,ssid_hex:s.ssid_hex,state:s.complete?'COMPLETE':s.verifiable?'VERIFIABLE':'CAPTURED',reason:s.reason}))});
  if(options.list)return 0;
  if(!options.authorized)throw Error('运行验证请通过 --authorized 确认是自己的授权测试网络');
  const candidates=sessions.filter(s=>s.verifiable);let record;
  if(options.session!==undefined)record=sessions.find(s=>s.id===Number(options.session));else{if(candidates.length!==1)throw Error('请先 --list，并用 --session ID 选择一个可验证会话');record=candidates[0];}
  if(!record||!record.verifiable)throw Error(record?.reason||'会话不存在或缺少验证材料');record={...record};
  if(options.ssid!==undefined)record.ssid_hex=Buffer.from(options.ssid).toString('hex');if(options['ssid-hex']!==undefined)record.ssid_hex=options['ssid-hex'];
  if(!record.ssid_hex)throw Error('抓包没有 SSID，请指定 --ssid 或 --ssid-hex');WPA2.prepare(record);
  let source;
  if(options.source==='numeric')source=new SOURCES.NumericSource(options.start,options.end,options.workers);
  else if(options.source==='birthday')source=new SOURCES.BirthdaySource(options.from,options.to,options.workers,options.format);
  else if(options.source==='regex')source=new RegexSource(options.regex,options.workers);
  else if(options.source==='file'){if(!options.dictionary)throw Error('TXT 来源需要 --dictionary 文件');const file=await NodeFile.open(options.dictionary);files.push(file);source=new SOURCES.FileSource(file,options.workers);}
  else throw Error('--source 支持 numeric / birthday / regex / file');
  const interactive=!!(process.stdin.isTTY||options.interactive);let quitting=false,finish,settled=false;
  const completed=new Promise(r=>finish=r);
  const pool=new Pool(null,s=>{
   if(s.phase==='stopping')return;
   if(['found','done','error'].includes(s.phase)||(s.phase==='stopped'&&(!interactive||quitting))){if(!settled){settled=true;emit({event:'result',...s});finish(quitting?130:s.phase==='found'?0:s.phase==='done'?1:s.phase==='error'?2:130);}}
   else if(s.phase==='stopped')emit({event:'progress',...s});
  },NativeLane);
  const begin=()=>pool.start({record,source,workers:options.workers,engine:'native'});
  const interrupt=()=>{quitting=true;if(pool.run?.cancelled){if(!settled){settled=true;finish(130);}}else pool.stop();};
  process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);
  try{
   if(interactive){if(!options.json)console.error('p 暂停/继续；s 停止保存断点；r 继续；q 退出（输入后按 Enter）');rl=readline.createInterface({input:process.stdin,terminal:false});rl.on('line',line=>{try{const cmd=line.trim();if(cmd==='p'){if(pool.run?.paused)pool.resume();else pool.pause();}else if(cmd==='s')pool.stop();else if(cmd==='r'||cmd==='start')begin();else if(cmd==='q')interrupt();}catch(e){emit({event:'progress',...pool.snapshot(),error:e.message});}});rl.on('close',()=>{if(!settled)interrupt();});}
   begin();timer=setInterval(()=>{if(pool.run&&!pool.run.cancelled)emit({event:'progress',...pool.snapshot()});},1000);return await completed;
  }finally{process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);if(pool.run&&!pool.run.cancelled)pool.finish(pool.run,'stopped');}
 }finally{clearInterval(timer);if(rl)rl.close();for(const f of files)await f.close();}
}
async function main(){let options;try{options=args(process.argv.slice(2));if(options.help){console.log(HELP);return;}if(Number(process.versions.node.split('.')[0])<22)throw Error('需要 Node.js 22 或更新版本');
 if(!options.list&&process.env.UV_THREADPOOL_SIZE!==String(options.workers)){
  const child=spawn(process.execPath,[__filename,...process.argv.slice(2)],{stdio:'inherit',env:{...process.env,UV_THREADPOOL_SIZE:String(options.workers)}});process.on('SIGINT',()=>{});process.on('SIGTERM',()=>child.kill('SIGTERM'));child.on('error',e=>{console.error(e.message);process.exitCode=2;});child.on('exit',(code,signal)=>{process.exitCode=code??(signal?130:2);});return;
 }
 process.exitCode=await run(options);
 }catch(e){if(options?.json||process.argv.includes('--json'))console.log(JSON.stringify({event:'result',phase:'error',error:e.message}));else console.error(`错误：${e.message}`);process.exitCode=2;}}
if(require.main===module)main();module.exports={args,run};
