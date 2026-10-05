"""Four search types and artist drill-down through the real TUI + Kitty parser."""
import re,os,sys,json,pty,fcntl,termios,struct,subprocess,tempfile,time,select
from pathlib import Path
sys.path.insert(0,'/usr/lib/kitty')
from kitty.fast_data_types import Screen
with tempfile.TemporaryDirectory(prefix='kugou-catalog-ui-') as folder:
 root=Path(folder);app=root/'config/kugou-lite';app.mkdir(parents=True)
 (app/'config.json').write_text(json.dumps({'rich_search':True,'desktop_notifications':False,'in_app_notifications':False,'hd':True}))
 os.environ['XDG_CACHE_HOME']=str(root/'cache');node=root/'node';log=root/'commands'
 node.write_text('''#!/usr/bin/python
import os,sys,json,copy
png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGN8AAAAASUVORK5CYII='
state=None;history=[];focus={'selected':0,'offset':0}
types=['song','playlist','album','artist'];tabs=['heat','songs','albums']
def emit(v):print(json.dumps(v),flush=True)
def song(title):return {'kind':'song','title':title,'artist':'Artist','duration':200,'vip':True,'share':.25,'number':1}
def push():history.append(copy.deepcopy(dict(state or {},**focus)))
def rows():
 global state
 if state['mode']=='search':
  kind=state['searchType'];state['rows']=[song('Search Song')] if kind=='song' else [{'kind':kind,'title':kind.title()+' '+str(i),'fans':12345,'songs':10,'albums':2,'artist':'Artist','count':2,'date':'2026','creator':'Creator','artistId':str(i),'thumbnailPng':png if kind in ('artist','playlist','album') else '', 'thumbnailPixels':[255,80,40]*1024 if kind in ('artist','playlist','album') else []} for i in range(2)]
 elif state['mode']=='artist':state['rows']=[{'kind':'album','title':'Artist Album','artist':'Artist','date':'2026','count':2,'thumbnailPng':png,'thumbnailPixels':[80,160,200]*1024}] if state['artistTab']=='albums' else [dict(song('Artist Song'+str(i)),number=i+1) for i in range(5)]
 elif state['mode']=='album':state['rows']=[song('Album Song')]
 elif state['mode']=='profile':state['rows']=[]
 state['selected']=0;state['offset']=0
for line in sys.stdin:
 c=line.strip()
 with open(os.environ['CATALOG_LOG'],'a') as f:f.write(c+'\\n')
 if c.startswith('focus:'):
  a,b=map(int,c[6:].split(':'));focus={'selected':a,'offset':b};continue
 if c.startswith('search:'):
  state={'kind':'catalog','mode':'search','searchType':'song','artistTab':'heat','profileTab':1,'query':c[7:],'title':'Search','page':1,'key':'search:test','artist':None};rows();emit(state)
 elif c=='searchtoggle' or c.startswith('searchtype:'):
  state['searchType']=types[(types.index(state['searchType'])+1)%4] if c=='searchtoggle' else c.split(':')[1];rows();emit(state)
 elif c.startswith('openentity:'):
  push();row=state['rows'][int(c.split(':')[1])]
  if row['kind']=='artist':
   info={'name':row['title'],'birthday':'1979-01-18','authentication':'认证歌手','listeners':123456,'fans':1234567,'guardians':201234,'songs':5,'albums':2,'loaded':5,'expected':5,'complete':True,'heatKnown':5,'photos':['a','b'],'photoIndex':0,'png':png,'sections':{label:'\\n'.join(prefix+' LINE '+str(i).zfill(2) for i in range(65)) for label,prefix in [('简介','INTRO'),('基本资料','BASIC'),('演艺经历','CAREER'),('主要作品','WORKS'),('荣誉记录','AWARDS')]}}
   state.update(mode='artist',artist=info,key='artist:test',artistTab='heat',title=row['title']);rows();emit(state);emit({'kind':'catalog_assets','key':'stale','artist':{'name':'STALE_ARTIST'}})
  elif row['kind']=='album':state.update(mode='album',artist=None,key='album:test',title='Album');rows();emit(state)
  else:emit({'kind':'tracks','view':'browse','section':'search','title':'Playlist Songs','page':1,'canSort':True,'tracks':[song('Playlist Song')]})
 elif c=='artisttoggle' or c.startswith('artisttab:'):
  state['artistTab']=tabs[(tabs.index(state['artistTab'])+1)%3] if c=='artisttoggle' else c.split(':')[1];rows();emit(state)
 elif c.startswith('artistphoto:'):
  state['artist']['photoIndex']=(state['artist']['photoIndex']+int(c.split(':')[1]))%2;emit({'kind':'catalog_assets','key':state['key'],'artist':state['artist']})
 elif c=='artistprofile':push();state.update(mode='profile',profileTab=1);rows();emit(state)
 elif c=='profiletoggle' or c.startswith('profiletab:'):
  state['profileTab']=(state['profileTab']+1)%5 if c=='profiletoggle' else int(c.split(':')[1]);rows();emit(state)
 elif c=='back':state=history.pop() if history else None;emit(state if state else {'kind':'home'})
 emit({'kind':'busy','value':False})
''');node.chmod(0o700)
 screen=Screen(None,40,140,100);height=40
 master,slave=pty.openpty();fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',40,140,0,0))
 env=dict(os.environ,TERM='xterm-kitty',KITTY_WINDOW_ID='test',PATH=folder+':'+os.environ['PATH'],XDG_CONFIG_HOME=str(root/'config'),XDG_CACHE_HOME=str(root/'cache'),CATALOG_LOG=str(log))
 p=subprocess.Popen(['./tui/target/debug/kugou-lite'],stdin=slave,stdout=slave,stderr=slave,env=env,start_new_session=True);os.close(slave);output=bytearray()
 def drain(duration=.25):
  end=time.monotonic()+duration
  while time.monotonic()<end:
   if select.select([master],[],[],.01)[0]:
    try:data=os.read(master,65536)
    except OSError:break
    output.extend(data);buf=screen.test_create_write_buffer();screen.test_commit_write_buffer(data,buf);screen.test_parse_written_data()
 def send(data,duration=.25):os.write(master,data);drain(duration)
 def text():return '\n'.join(str(screen.line(i)) for i in range(height))
 def commands():return log.read_text().splitlines()
 try:
  drain(.4);send(b'/');send(b'singer');send(b'\r');assert 'Search Song' in text() and '歌手' in text(),text()
  send(b'n');assert 'Playlist 0' in text(),text();assert b'i=47300,' in output,'search playlist cover missing';send(b'\r');assert 'Playlist Song' in text(),text();send(b'\x1b');assert 'Playlist 0' in text(),text()
  send(b'n');assert 'Album 0' in text(),text();send(b'\r');assert 'Album Song' in text(),text();send(b'\x1b')
  # Click the artist search category.
  y=next(i for i in range(height) if '○ 歌手' in str(screen.line(i)))
  send(f'\x1b[<0;125;{y+1}M'.encode());send(f'\x1b[<0;125;{y+1}m'.encode());assert 'Artist 1' in text(),text()
  assert b'i=47300,' in output and b'i=47301,' in output,'search artist thumbnails missing'
  send(b'i');assert '▀' in text(),'block thumbnails missing';assert b'a=d,d=I,i=47300' in output,'HD thumbnails not cleared'
  send(b'i')
  send(b'\x1b[B');send(b'\r')
  for label in ['歌手影像','Artist 1','1979-01-18','粉丝数','热门单曲','歌手资料 [J]']:assert label in text(),(label,text())
  for removed in ['认证歌手','累计收听人数','乐迷守护','热度占比','25.00%']:assert removed not in text(),(removed,text())
  assert 'STALE_ARTIST' not in text();assert b'a=T,f=100' in output,'artist HD photo missing'
  send(b'.');assert '2 / 2' in text(),text();send(b',');assert '1 / 2' in text(),text()
  send(b'n');assert '● 单曲' in text(),text();send(b'n');assert 'Artist Album' in text(),text();send(b'i');assert '▀' in text(),'artist album block cover missing';send(b'i');send(b'\r');assert 'Album Song' in text(),text();send(b'\x1b');assert '● 专辑' in text(),text()
  send(b'j');assert 'BASIC LINE 00' in text() and '● 基本资料' in text(),text()
  send(b'n');assert 'CAREER LINE 00' in text(),text();send(b'\x1b[6~');assert 'CAREER LINE 00' not in text() and 'CAREER LINE 10' in text(),text()
  send(b'\x1b[C');assert 'WORKS LINE 00' in text(),text();send(b'5');assert 'AWARDS LINE 00' in text(),text()
  send(b'\x1b');assert '● 专辑' in text() and 'Artist Album' in text(),text();send(b'\x1b');assert 'Artist 1' in text(),text();send(b'\r')
  assert [c for c in commands() if c.startswith('openentity:')][-1]=='openentity:1',commands()
  # The square image keeps its ratio across normal/fullscreen-like heights.
  for resized_height in [30,55]:
   screen.resize(resized_height,130);fcntl.ioctl(master,termios.TIOCSWINSZ,struct.pack('HHHH',resized_height,130,0,0));drain(.5)
   placements=re.findall(rb'i=47201,[^;]*c=(\d+),r=(\d+)',output)
   assert placements,'artist image placement missing'
   cols,rows=map(int,placements[-1]);assert cols==rows*2,('artist image stretched',cols,rows)
  height=25;screen.resize(25,80);fcntl.ioctl(master,termios.TIOCSWINSZ,struct.pack('HHHH',25,80,0,0));drain(.4)
  send(b'j');assert 'BASIC LINE 00' in text(),text();send(b'\x1b[6~'*8);assert 'BASIC LINE 64' in text(),'profile bottom unreachable'
  send(b'q');p.wait(timeout=3);assert p.returncode==0
  print('Catalog UI: four search types, playlist/album drill-down, artist split/gallery/stats/heat/tabs, five profiles and scrolling, stale photo guard, Esc selection and narrow layout passed')
 finally:
  if p.poll() is None:p.kill();p.wait()
  os.close(master)
