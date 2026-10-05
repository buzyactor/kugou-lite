"""Input paths for sorting every entered playlist; no API or account calls."""
import os,pty,fcntl,termios,struct,subprocess,tempfile,time,select,json,re
from pathlib import Path
with tempfile.TemporaryDirectory(prefix='kugou-sort-ui-') as folder:
 root=Path(folder);app=root/'config/kugou-lite';app.mkdir(parents=True)
 (app/'config.json').write_text(json.dumps({'desktop_notifications':False,'in_app_notifications':False}))
 node=root/'node';log=root/'commands'
 node.write_text('''#!/usr/bin/python
import json,sys,os
section='';mode='default'
def emit(v):print(json.dumps(v),flush=True)
def songs():
 rows=[{'title':'Beta','artist':'Second','duration':120},{'title':'Alpha','artist':'First','duration':90}]
 if mode=='title-asc':rows.reverse()
 emit({'kind':'tracks','view':'playlist' if not section else 'browse','section':section,'title':'Entered playlist','tracks':rows,'canSort':True,'sortMode':mode,'sortLabel':'歌名 A → Z' if mode=='title-asc' else '默认顺序'})
for line in sys.stdin:
 c=line.strip()
 with open(os.environ['SORT_LOG'],'a') as f:f.write(c+'\\n')
 if c in ('playlists','recommend','discover'):
  section={'playlists':'','recommend':'recommend','discover':'discover'}[c];mode='default';emit({'kind':'playlists','section':section,'lists':[{'title':'List','count':2}]})
 elif c.startswith('openlist:'):songs()
 elif c.startswith('sort:'):mode=c[5:];songs()
 emit({'kind':'busy','value':False})
''');node.chmod(0o700)
 master,slave=pty.openpty();fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',40,140,0,0))
 env=dict(os.environ,TERM='xterm-kitty',KITTY_WINDOW_ID='test',PATH=folder+':'+os.environ['PATH'],XDG_CONFIG_HOME=str(root/'config'),SORT_LOG=str(log))
 p=subprocess.Popen(['./tui/target/debug/kugou-lite'],stdin=slave,stdout=slave,stderr=slave,env=env,start_new_session=True);os.close(slave)
 output=bytearray()
 def drain(seconds=.2):
  end=time.monotonic()+seconds
  while time.monotonic()<end:
   if select.select([master],[],[],.01)[0]:
    try:output.extend(os.read(master,65536))
    except OSError:break
 def send(data):os.write(master,data);drain()
 def commands():return log.read_text().splitlines()
 try:
  drain(.4)
  for i,key in enumerate([b'p',b'r',b'd']):
   send(key);send(b'\r')
   before=len([c for c in commands() if c.startswith('sort:')])
   send(b'\x1b[<0;112;4M');send(b'\x1b[<0;112;4m')
   assert '歌单排序'.encode() in re.sub(rb'\x1b\[[0-?]*[ -/]*[@-~]',b'',bytes(output)),'sort button failed'
   send(b'\x1b');assert len([c for c in commands() if c.startswith('sort:')])==before,'cancel sent request'
   send(b'z')
   if i==1:
    send(b'\x1b[<0;50;17M');send(b'\x1b[<0;50;17m')
   else:send(b'\x1b[B'*2);send(b'\r')
   assert [c for c in commands() if c.startswith('sort:')][-1]=='sort:title-asc',commands()
   assert len([c for c in commands() if c.startswith('sort:')])==before+1
   send(b'\r');assert commands()[-1]=='play:0',commands()
  send(b'q');p.wait(timeout=3)
  print('Playlist sort UI: private/recommend/discover buttons, Z menu, Esc cancellation, mouse and keyboard selection, sorted playback index passed')
 finally:
  if p.poll() is None:p.kill();p.wait()
  os.close(master)
