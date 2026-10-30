"""Deterministic synthetic WPA2 fixture, independently computed with Python stdlib.
No real capture, identifier or password is used. Regenerate and compare before commit.
"""
import hashlib,hmac,json,pathlib,struct
root=pathlib.Path(__file__).resolve().parent
def build_fixture(password):
    ssid=b'Synthetic-Lab'
    ap=bytes.fromhex('020000000001');client=bytes.fromhex('020000000002')
    anonce=bytes(range(32));snonce=bytes(range(32,64))
    pmk=hashlib.pbkdf2_hmac('sha1',password.encode(),ssid,4096,32)
    data=min(ap,client)+max(ap,client)+min(anonce,snonce)+max(anonce,snonce)
    ptk=b''.join(hmac.new(pmk,b'Pairwise key expansion\x00'+data+bytes([i]),hashlib.sha1).digest() for i in range(4))[:64]
    rsn=bytes.fromhex('30140100000fac040100000fac040100000fac020000')
    p=bytearray(99+len(rsn));p[0:5]=b'\x02\x03'+struct.pack('>H',len(p)-4)+b'\x02'
    struct.pack_into('>HHQ',p,5,0x010a,16,7);p[17:49]=snonce;struct.pack_into('>H',p,97,len(rsn));p[99:]=rsn
    mic=hmac.new(ptk[:16],p,hashlib.sha1).digest()[:16];p[81:97]=mic
    record=dict(id=1,version=2,ssid_hex=ssid.hex(),ap='02:00:00:00:00:01',client='02:00:00:00:00:02',anonce=anonce.hex(),snonce=snonce.hex(),mic=mic.hex(),eapol=p.hex())
    fixture=dict(description='Synthetic authorized-lab fixture; no real network data',password=password,pmk=pmk.hex(),ptk=ptk.hex(),record=record)
    return fixture

if __name__=='__main__':
    for name,password in [('wpa2-synthetic.json','Lab-password-123'),('wpa2-numeric.json','00000002'),('wpa2-birthday.json','20000229')]:
        (root/'fixtures'/name).write_text(json.dumps(build_fixture(password),indent=2)+'\n')
    print('Generated synthetic Python hashlib/hmac reference fixtures')
