const fixture=require('./fixtures/wpa2-numeric.json');
const ap=Buffer.from(fixture.record.ap.replaceAll(':',''),'hex'),client=Buffer.from(fixture.record.client.replaceAll(':',''),'hex');
function frame(m,{qos=false,ht=false,pad=false,nonceFlip=false,version=2}={}){
 const from=m===1||m===3;let h=24+(qos?2:0)+(qos&&ht?4:0);if(pad)h=Math.ceil(h/4)*4;
 const head=Buffer.alloc(h);head[0]=qos?0x88:8;head[1]=(from?2:1)|(ht?128:0);(from?client:ap).copy(head,4);(from?ap:client).copy(head,10);ap.copy(head,16);
 let p;if(m===2)p=Buffer.from(fixture.record.eapol,'hex');else{
  p=Buffer.alloc(99);p[0]=2;p[1]=3;p.writeUInt16BE(95,2);p[4]=2;p.writeUInt16BE(m===1?0x8a:m===3?0x3ca:0x30a,5);p.writeUInt16BE(16,7);p.writeBigUInt64BE(m>=3?8n:7n,9);
  if(m!==4)Buffer.from(fixture.record.anonce,'hex').copy(p,17);if(m!==1)p.fill(0x55,81,97);
 }
 if(nonceFlip)p[17]^=1;p[6]=(p[6]&0xf8)|version;
 return Buffer.concat([head,Buffer.from('aaaa03000000888e','hex'),p]);
}
function beacon(){const h=Buffer.alloc(36);h[0]=0x80;h.fill(255,4,10);ap.copy(h,10);ap.copy(h,16);const ssid=Buffer.from(fixture.record.ssid_hex,'hex');return Buffer.concat([h,Buffer.from([0,ssid.length]),ssid,Buffer.from('30140100000fac040100000fac040100000fac020000','hex')]);}
function radio(f,{extended=false,pad=false}={}){
 let h;if(extended){h=Buffer.alloc(30);h.writeUInt16LE(30,2);h.writeUInt32LE(0x8000000f,4);h[24]=pad?0x20:0;h[25]=12;h.writeUInt16LE(2437,26);h.writeUInt16LE(128,28);}else{h=Buffer.alloc(12);h.writeUInt16LE(12,2);h.writeUInt32LE(8,4);h.writeUInt16LE(2437,8);h.writeUInt16LE(128,10);}return Buffer.concat([h,f]);
}
function pcap(frames,{little=true,nano=false,link=127}={}){
 const h=Buffer.alloc(24),put=(b,v,p)=>little?b.writeUInt32LE(v,p):b.writeUInt32BE(v,p);
 put(h,nano?0xa1b23c4d:0xa1b2c3d4,0);little?h.writeUInt16LE(2,4):h.writeUInt16BE(2,4);little?h.writeUInt16LE(4,6):h.writeUInt16BE(4,6);put(h,262144,16);put(h,link,20);
 return Buffer.concat([h,...frames.map(f=>{const r=Buffer.alloc(16);put(r,1,0);put(r,f.length,8);put(r,f.length,12);return Buffer.concat([r,f]);})]);
}
function pcapng(frames,{little=true,link=127,simple=false,unknown=false}={}){
 const u32=(b,x,p)=>little?b.writeUInt32LE(x,p):b.writeUInt32BE(x,p),u16=(b,x,p)=>little?b.writeUInt16LE(x,p):b.writeUInt16BE(x,p);
 function block(type,body){const b=Buffer.alloc(12+body.length);u32(b,type,0);u32(b,b.length,4);body.copy(b,8);u32(b,b.length,b.length-4);return b;}
 const sh=Buffer.alloc(16);u32(sh,0x1a2b3c4d,0);u16(sh,1,4);sh.fill(255,8);const id=Buffer.alloc(8);u16(id,link,0);u32(id,262144,4);
 return Buffer.concat([block(0x0a0d0d0a,sh),block(1,id),...(unknown?[block(0x12345678,Buffer.alloc(0))]:[]),...frames.map(f=>{const b=Buffer.alloc((simple?4:20)+Math.ceil(f.length/4)*4);if(simple)u32(b,f.length,0);else{u32(b,f.length,12);u32(b,f.length,16);}f.copy(b,simple?4:20);return block(simple?3:6,b);})]);
}
const complete=()=>[beacon(),frame(1),frame(2),frame(3),frame(4)];
module.exports={fixture,frame,beacon,radio,pcap,pcapng,complete};
