#!/usr/bin/env python3
"""Build a network-free HTML containing all scripts, CSS and Blob Worker code."""
from pathlib import Path
import base64,sys
root=Path(__file__).resolve().parents[1]
src=root/'standalone/src'
worker='\n;\n'.join((root/p).read_text() for p in ['web/crypto.js','standalone/src/pcap.js','standalone/src/engine.js','standalone/src/worker.js'])
main='\n;\n'.join((src/p).read_text() for p in ['source.js','pool.js','main.js'])
html=(src/'index.html').read_text().replace('@@CSS@@',(src/'style.css').read_text()).replace('@@WORKER@@',base64.b64encode(worker.encode()).decode()).replace('@@MAIN@@',main.replace('</script','<\\/script'))
out=root/'standalone/wpa2-parallel.html'
if '--check' in sys.argv:
    if not out.exists() or out.read_text()!=html:raise SystemExit('Standalone HTML is stale; run python3 tools/build-standalone.py')
    print('PASS standalone HTML matches its sources')
else:
    out.write_text(html)
    print(f'Built {out.relative_to(root)} ({out.stat().st_size} bytes)')
