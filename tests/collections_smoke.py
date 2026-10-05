"""Collection sections and metadata panels through the real TUI and Kitty parser."""
import os,sys,pty,fcntl,termios,struct,subprocess,tempfile,time,select,json
from pathlib import Path
sys.path.insert(0,'/usr/lib/kitty')
from kitty.fast_data_types import Screen

with tempfile.TemporaryDirectory(prefix='kugou-collections-') as folder:
 root=Path(folder);app=root/'config/kugou-lite';app.mkdir(parents=True)
 os.environ['XDG_CACHE_HOME']=str(root/'cache')
 (app/'config.json').write_text(json.dumps({'in_app_notifications':False,'desktop_notifications':False,'hd':True}))
 node=root/'node';log=root/'commands'
 node.write_text('''#!/usr/bin/python
import os,sys,json
section='';kind='';focus={'selected':0,'offset':0}
png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGN8AAAAASUVORK5CYII='
def emit(v):print(json.dumps(v),flush=True)
def category(number=1):
 common={'section':section,'browseKind':kind,'sectionRoot':True,'page':1 if number==1 else 2}
 if kind in ('daily','new'):
  emit(dict(common,kind='tracks',title='每日推荐歌曲' if kind=='daily' else '新歌速递',tracks=[{'title':'Daylight','artist':'Singer','duration':180,'vip':True,'number':number}],canSort=True))
 else:
  emit(dict(common,kind='playlists',title='精选歌单',lists=[{'title':'歌单'+str(i),'count':None if i==2 else 0 if i==3 else 30,'playCount':None if i==2 else 0 if i==3 else 13580000,'description':'给夜晚的旋律','cover':'https://singerimg.kugou.com/test'+str(i), 'thumbnailPng':png,'thumbnailPixels':[40,60,120]*1024} for i in range(6)],**focus))
for line in sys.stdin:
 c=line.strip()
 with open(os.environ['COLLECTION_LOG'],'a') as f:f.write(c+'\\n')
 if c=='restore':
  emit({'kind':'state','status':'Playing'});emit({'kind':'media','fresh':True,'title':'Playing','duration':99,'lyrics':[{'start':0,'text':'A lyric'}]})
 elif c in ('recommend','discover'):
  section=c;kind='daily' if c=='recommend' else 'new';category()
 elif c=='playlists':
  section='';kind='created';category()
 elif c=='sectiontoggle' and kind in ('created','collected'):
  kind='collected' if kind=='created' else 'created';category()
 elif c=='sectiontoggle':
  a,b=('daily','recommended') if section=='recommend' else ('new','hires');kind=b if kind==a else a;category()
 elif c=='sectionranks':kind='ranks';category()
 elif c=='nextpage':category(28)
 elif c=='prevpage':category()
 elif c.startswith('focus:'):
  a,b=map(int,c[6:].split(':'));focus={'selected':a,'offset':b}
 elif c.startswith('openlist:'):
  info={'title':'夜航歌单','tags':['流行','夜晚'],'description':'这是一份晚间精选简介。','creator':'Editor','count':30}
  emit({'kind':'tracks','view':'browse','section':section,'title':'夜航歌单','collectionKey':'night','collectionInfo':info,'canSort':True,'tracks':[{'title':'Moonlight','artist':'Singer','duration':200}]})
  emit({'kind':'collection_info','collectionKey':'stale','info':{'title':'STALE_METADATA'}})
  emit({'kind':'collection_info','collectionKey':'night','info':dict(info,png=png,pixels=[40,60,120]*1024)})
 elif c=='back':category()
 elif c=='queue':emit({'kind':'queue','tracks':[{'title':'QueuedSong','artist':'Singer','duration':99,'active':True}]})
 emit({'kind':'busy','value':False})
''');node.chmod(0o700)
 screen=Screen(None,40,140,100)
 master,slave=pty.openpty();fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',40,140,0,0))
 env=dict(os.environ,TERM='xterm-kitty',KITTY_WINDOW_ID='smoke',PATH=folder+':'+os.environ['PATH'],XDG_CONFIG_HOME=str(root/'config'),XDG_CACHE_HOME=str(root/'cache'),COLLECTION_LOG=str(log))
 p=subprocess.Popen(['./tui/target/debug/kugou-lite'],stdin=slave,stdout=slave,stderr=slave,env=env,start_new_session=True);os.close(slave)
 output=bytearray()
 def drain(duration=.25):
  end=time.monotonic()+duration
  while time.monotonic()<end:
   if select.select([master],[],[],.01)[0]:
    try:data=os.read(master,65536)
    except OSError:break
    output.extend(data);buf=screen.test_create_write_buffer();screen.test_commit_write_buffer(data,buf);screen.test_parse_written_data()
 def send(data):os.write(master,data);drain()
 def text():return '\n'.join(str(screen.line(i)) for i in range(40))
 def commands():return log.read_text().splitlines()
 try:
  drain(.4);send(b'r');assert '每日推荐歌曲' in text() and 'Daylight' in text(),text()
  send(b'\x1b[C');assert ' 28  ♪' in text(),('second page numbering reset',text())
  send(b'\x1b[D');assert '  1  ♪' in text(),('first page numbering incorrect',text())
  # N button in the banner is clickable; song rows stay paginated independently.
  send(b'\x1b[<0;124;6M');send(b'\x1b[<0;124;6m')
  assert 'sectiontoggle' in commands(),commands()
  assert '给夜晚的旋律' in text(),text()
  assert b'i=47300,' in output and b'i=47305,' in output,'directory covers missing'
  send(b'i');assert '▀' in text(),'block playlist covers missing';send(b'i')
  assert '曲数未知' in text() and '0 首' in text(),'unknown and empty playlist counts must differ'
  for label in ['播放量 1358.0万','播放量 0','播放量未提供']:assert label in text(),(label,text())
  send(b'\x1b[B');send(b'\r')
  for label in ['歌单档案','夜航歌单','#流行','#夜晚','Editor','晚间精选简介','Moonlight']:assert label in text(),(label,text())
  assert 'STALE_METADATA' not in text(),text()
  assert b'a=T' in output,'HD playlist cover was not transmitted'
  # The info panel starts immediately beside the sidebar, before the song list.
  assert screen.line(3)[22]=='╭' and screen.line(4)[57]=='╭',text()
  assert '3:20' in text(),'song duration was clipped by selection marker'
  send(b'\t');send(b'\t');assert '歌单档案' in text(),text()
  send(b'\x1b');send(b'\r')
  assert [c for c in commands() if c.startswith('openlist:')][-2:]==['openlist:1','openlist:1'],commands()
  send(b'b');assert '歌单档案' not in text() and '▶ QueuedSong' in text(),text()
  send(b'p');assert '● 我创建的歌单' in text(),text()
  assert '给夜晚的旋律' in text(),text()
  before=commands().count('sectiontoggle');send(b'n');assert commands().count('sectiontoggle')==before+1 and '● 我收藏的歌单' in text(),text()
  send(b'\r');assert '歌单档案' in text(),text()
  send(b'\x1b');assert '● 我收藏的歌单' in text(),text()
  send(b'd');assert '新歌速递' in text(),text();send(b'n');assert '精选歌单' in text(),text()
  send(b't');assert 'sectionranks' in commands(),commands()
  send(b'\r');assert '歌单档案' in text(),text()
  # Narrow windows hide the extra panel and preserve a usable song list.
  screen.resize(30,80);fcntl.ioctl(master,termios.TIOCSWINSZ,struct.pack('HHHH',30,80,0,0));drain(.4)
  assert '歌单档案' not in '\n'.join(str(screen.line(i)) for i in range(30))
  send(b'q');p.wait(timeout=3);assert p.returncode==0
  print('Collections UI: default songs, N/mouse toggle, own/collected tabs and return, ranks, metadata/HD cover, stale response guard, return selection and narrow layout passed')
 finally:
  if p.poll() is None:p.kill();p.wait()
  os.close(master)
