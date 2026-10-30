const assert=require('node:assert/strict'),crypto=require('node:crypto');
const w=require('../web/crypto.js'),fixture=require('./fixtures/wpa2-synthetic.json');
const b=s=>new TextEncoder().encode(s),h=w.toHex;
assert.equal(h(w.sha1(b('abc'))),'a9993e364706816aba3e25717850c26c9cd0d89d');
// RFC 2202, HMAC-SHA1 case 1 and case 2.
assert.equal(h(w.hmac(new Uint8Array(20).fill(0x0b),b('Hi There'))),'b617318655057264e28bc0b6fb378c8ef146be00');
assert.equal(h(w.hmac(b('Jefe'),b('what do ya want for nothing?'))),'effcdf6ae5eb2fa2d27416d5f184df9c259a7c79');
// RFC 6070, all practical iteration counts incl. binary NULs and >20-byte DK.
for(const [p,s,c,n,expected] of [
 ['password','salt',1,20,'0c60c80f961f0e71f3a9b524af6012062fe037a6'],
 ['password','salt',2,20,'ea6c014dc72d6f8ccd1ed92ace1d41f0d8de8957'],
 ['password','salt',4096,20,'4b007901b765489abead49d926f721d065a429c1'],
 ['passwordPASSWORDpassword','saltSALTsaltSALTsaltSALTsaltSALTsalt',4096,25,'3d2eec4fe41c849b80c8d83662c0e44a8b291a964cf2f07038'],
 ['pass\0word','sa\0lt',4096,16,'56fa6aa75548099dcc37d7f03425e0c3']])assert.equal(h(w.pbkdf2(b(p),b(s),c,n)),expected);
assert.equal(h(w.pbkdf2(b('password'),b('IEEE'))),'f42c6fc52df0ebef9ebb4b90b38a5f902e83fe1b135a70e23aed762e9710a12e');
// Cross-check SHA/HMAC boundary lengths against independent Node/OpenSSL.
for(const n of [0,1,20,55,56,63,64,65,119,120,127,128,255,512]){
 const data=Uint8Array.from({length:n},(_,i)=>(i*31+7)&255),key=Uint8Array.from({length:n},(_,i)=>(i*13+11)&255);
 assert.equal(h(w.sha1(data)),crypto.createHash('sha1').update(data).digest('hex'));
 assert.equal(h(w.hmac(key,data)),crypto.createHmac('sha1',key).update(data).digest('hex'));
}
const r=w.prepare(fixture.record),pmk=w.pbkdf2(b(fixture.password),r.ssid);assert.equal(h(pmk),fixture.pmk);
assert.equal(h(w.ptk(pmk,r.ap,r.client,r.anonce,r.snonce)),fixture.ptk);
assert(w.verify(fixture.password,fixture.record));assert(!w.verify('wrong-password',fixture.record));
assert(!w.verify('short',fixture.record));assert(!w.verify('非ASCII密码',fixture.record));
const copy=()=>structuredClone(fixture.record);
let bad=copy();bad.version=3;assert.throws(()=>w.prepare(bad));
bad=copy();bad.anonce='00';assert.throws(()=>w.prepare(bad));
bad=copy();bad.snonce='00'.repeat(32);assert.throws(()=>w.prepare(bad));
bad=copy();bad.mic='01'.repeat(16);assert.throws(()=>w.prepare(bad));
bad=copy();bad.eapol=bad.eapol.slice(0,-2);assert.throws(()=>w.prepare(bad));
bad=copy();bad.eapol=bad.eapol.slice(0,32)+'08'+bad.eapol.slice(34);assert(!w.verify(fixture.password,bad));
bad=copy();bad.ssid_hex='';assert.throws(()=>w.prepare(bad));
console.log('PASS SHA1, RFC2202 HMAC, RFC6070 PBKDF2, WPA PMK, OpenSSL boundaries, Python PMK/PTK/MIC fixture, correct/wrong candidates, malformed input');
