#!/usr/bin/env python3
"""Small copy/literal delta for private development transfers, not an OTA format."""
import gzip,hashlib,pathlib,struct,sys

def make(old,new):
    index={}
    for i in range(0,len(old)-15,4):
        k=old[i:i+16]
        if k not in index:index[k]=i
    out=bytearray(b'C3DELTA1'+hashlib.sha256(old).digest()+hashlib.sha256(new).digest())
    literal=bytearray();i=0
    def flush():
        if literal:out.extend(b'A'+struct.pack('<I',len(literal))+literal);literal.clear()
    while i<len(new):
        pos=index.get(new[i:i+16]) if i+16<=len(new) else None
        if pos is None:literal.append(new[i]);i+=1;continue
        n=16
        while i+n<len(new) and pos+n<len(old) and new[i+n]==old[pos+n]:n+=1
        flush();out.extend(b'C'+struct.pack('<II',pos,n));i+=n
    flush();return gzip.compress(out)

def apply(old,patch):
    p=gzip.decompress(patch)
    if p[:8]!=b'C3DELTA1' or p[8:40]!=hashlib.sha256(old).digest():raise ValueError('Wrong base firmware')
    out=bytearray();at=72
    while at<len(p):
        op=p[at:at+1];at+=1
        if op==b'C':
            pos,n=struct.unpack_from('<II',p,at);at+=8
            if pos+n>len(old):raise ValueError('Copy outside base')
            out.extend(old[pos:pos+n])
        elif op==b'A':
            n,=struct.unpack_from('<I',p,at);at+=4
            if at+n>len(p):raise ValueError('Truncated literal')
            out.extend(p[at:at+n]);at+=n
        else:raise ValueError('Invalid opcode')
    if hashlib.sha256(out).digest()!=p[40:72]:raise ValueError('Target SHA256 mismatch')
    return out

if __name__=='__main__':
    action,base,source,dest=sys.argv[1:]
    old=pathlib.Path(base).read_bytes();data=pathlib.Path(source).read_bytes()
    result=make(old,data) if action=='make' else apply(old,data) if action=='apply' else None
    if result is None:raise ValueError('Use make or apply')
    pathlib.Path(dest).write_bytes(result)
