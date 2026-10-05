"""Dedicated/minimal search and unchanged-position cover repaint after resize."""
import os,sys,json,pty,fcntl,termios,struct,subprocess,tempfile,time,select
from pathlib import Path
sys.path.insert(0,'/usr/lib/kitty')
from kitty.fast_data_types import Screen
with tempfile.TemporaryDirectory(prefix='kugou-search-') as folder:
 root=Path(folder);app=root/'config/kugou-lite';app.mkdir(parents=True)
 os.environ['XDG_CACHE_HOME']=str(root/'cache')
 (app/'config.json').write_text(json.dumps({'rich_search':True,'desktop_notifications':False,'in_app_notifications':False,'hd':True}))
 node=root/'node';log=root/'commands'
 node.write_text('''#!/usr/bin/python
import os,sys,json
def emit(v):print(json.dumps(v),flush=True)
for line in sys.stdin:
 c=line.strip()
 with open(os.environ['SEARCH_LOG'],'a') as f:f.write(c+'\\n')
 if c=='restore':
  emit({'kind':'state','status':'Playing'})
  emit({'kind':'media','fresh':True,'title':'Cover Test','artist':'Artist','duration':99,'png':'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGN8AAAAASUVORK5CYII=','lyrics':[{'start':0,'text':'Moonlight'}]})
 elif c=='searchhome':emit({'kind':'search_home','hot':['HotRank'+str(i) for i in range(1,21)]})
 elif c.startswith('suggestions:'):
  q=c[12:];emit({'kind':'suggestions','query':'STALE','items':['STALE_SUGGESTION']});emit({'kind':'suggestions','query':q,'items':[q+' Track'+str(i) for i in range(1,17)]})
 elif c.startswith('search:'):
  emit({'kind':'tracks','view':'search','title':'搜索 · '+c[7:],'page':1,'tracks':[{'title':'Search Result','artist':'Artist','duration':99}]})
 emit({'kind':'busy','value':False})
''');node.chmod(0o700)
 screen=Screen(None,40,140,100)
 master,slave=pty.openpty();fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',40,140,0,0))
 env=dict(os.environ,TERM='xterm-kitty',KITTY_WINDOW_ID='test',PATH=folder+':'+os.environ['PATH'],XDG_CONFIG_HOME=str(root/'config'),XDG_CACHE_HOME=str(root/'cache'),SEARCH_LOG=str(log))
 p=subprocess.Popen(['./tui/target/debug/kugou-lite'],stdin=slave,stdout=slave,stderr=slave,env=env,start_new_session=True);os.close(slave)
 output=bytearray();rows=40
 def drain(duration=.25):
  end=time.monotonic()+duration
  while time.monotonic()<end:
   if select.select([master],[],[],.01)[0]:
    try:data=os.read(master,65536)
    except OSError:break
    output.extend(data);buf=screen.test_create_write_buffer();screen.test_commit_write_buffer(data,buf);screen.test_parse_written_data()
 def send(data,duration=.25):os.write(master,data);drain(duration)
 def text():return '\n'.join(str(screen.line(i)) for i in range(rows))
 def commands():return log.read_text().splitlines()
 try:
  drain(.4);send(b'\t',.4);assert b'a=T,f=100' in output,'initial cover missing'
  assert 'TRACK INFO' not in text() and '音量  70%' not in text(),'redundant under-cover info remained'
  # The cover's position and dimensions remain unchanged at these two sizes.
  for height,width in [(45,160),(40,140),(45,160),(40,140)]:
   before=output.count(b'a=T,f=100');rows=height;screen.resize(height,width)
   fcntl.ioctl(master,termios.TIOCSWINSZ,struct.pack('HHHH',height,width,0,0));drain(.65)
   assert output.count(b'a=T,f=100')>before,('cover was not repainted after resize',height,width)
  send(b'/');assert 'FIND YOUR NEXT TRACK' in text() and '搜索：' not in text(),text()
  assert '搜索灵感' in text() and '酷狗热搜' in text() and '01  HotRank1' in text(),text()
  subtitle_y=next(i for i in range(rows) if 'FIND YOUR NEXT TRACK' in str(screen.line(i)))+1
  subtitle=str(screen.line(subtitle_y))
  send(b'\x1b');assert 'FIND YOUR NEXT TRACK' not in text(),text()
  send(b'/');assert str(screen.line(subtitle_y))!=subtitle,'opening search did not rotate subtitle'
  send(b'moon',.5)
  assert 'moon Track1' in text() and 'moon Track14' in text(),text()
  assert b']66;s=2:w=' in output,'suggestions were not enlarged'
  assert screen.line(11)[139]=='│','enlarged suggestions overwrote border'
  assert 'STALE_SUGGESTION' not in text(),text()
  assert [c for c in commands() if c.startswith('suggestions:')]==['suggestions:moon'],commands()
  send(b'\x1b[B'*16);assert 'moon Track16' in text(),'last suggestion was unreachable'
  rows=25;screen.resize(25,80);fcntl.ioctl(master,termios.TIOCSWINSZ,struct.pack('HHHH',25,80,0,0));drain(.4)
  assert 'moon Track16' in text(),'last suggestion disappeared in narrow search'
  rows=40;screen.resize(40,140);fcntl.ioctl(master,termios.TIOCSWINSZ,struct.pack('HHHH',40,140,0,0));drain(.4)
  send(b'\x1b[B');send(b'\r');assert 'search:moon Track1' in commands(),commands()
  assert 'Search Result' in text() and 'moon Track1' in text(),text()
  send(b'?');send(b'1');send(b'\x1b[B'*5);send(b'\r')
  assert json.loads((app/'config.json').read_text())['rich_search'] is False
  send(b'\x1b');send(b'/');assert '搜索：' in text() and 'FIND YOUR NEXT TRACK' not in text(),text()
  before=len([c for c in commands() if c.startswith('suggestions:')]);send(b'plain',.4)
  assert len([c for c in commands() if c.startswith('suggestions:')])==before,'minimal mode requested suggestions'
  send(b'\r');assert 'search:plain' in commands(),commands()
  send(b'?');send(b'1');send(b'\x1b[B'*5);send(b'\r');send(b'\x1b');send(b'/');send(b'wave',.5)
  send(b'\x1b[B');send(b'\t',.5)
  assert 'suggestions:wave Track1' in commands(),commands()
  y=next(i for i in range(rows) if 'wave Track1 Track2' in str(screen.line(i)))
  send(f'\x1b[<0;40;{y+1}M'.encode());send(f'\x1b[<0;40;{y+1}m'.encode())
  assert 'search:wave Track1 Track2' in commands(),commands()
  send(b'/');y=next(i for i in range(rows) if '03  HotRank3' in str(screen.line(i)))
  send(f'\x1b[<0;95;{y+1}M'.encode());send(f'\x1b[<0;95;{y+1}m'.encode())
  assert 'search:HotRank3' in commands(),'hot search click did not search'
  send(b'q');p.wait(timeout=3);assert p.returncode==0
  print('Search/cover UI: dedicated input, sixteen enlarged/spaced debounced/stale-safe suggestions, empty inspiration/hot ranks, rotating subtitle, selection, minimal setting, four resize repaint cycles and clean cover area passed')
 finally:
  if p.poll() is None:p.kill();p.wait()
  os.close(master)
