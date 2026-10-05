"""Exercise the actual Kitty parser: wide-cell restoration, clipping and parent focus."""
import os,sys,pty,fcntl,termios,struct,subprocess,tempfile,time,select,json,re
from pathlib import Path
sys.path.insert(0,'/usr/lib/kitty')
from kitty.fast_data_types import Screen
with tempfile.TemporaryDirectory(prefix='kugou-layout-') as folder:
    root=Path(folder);app=root/'config/kugou-lite';app.mkdir(parents=True)
    (app/'config.json').write_text(json.dumps({'in_app_notifications':False,'desktop_notifications':False,'large_lyric':True}))
    log=root/'commands'
    node=root/'node';node.write_text('''#!/usr/bin/python
import json,os,sys
focus={'selected':0,'offset':0};section='';saved=None;tick=10
lists=[{'title':'歌单'+str(i),'count':8} for i in range(80)]
def emit(v):print(json.dumps(v),flush=True)
for line in sys.stdin:
 c=line.strip()
 with open(os.environ['LAYOUT_LOG'],'a') as f:f.write(c+'\\n')
 if c=='restore':
  emit({'kind':'state','status':'Playing'})
  emit({'kind':'media','fresh':True,'title':'歌词边界测试','duration':99,'lyrics':[{'start':i*1000,'duration':1000,'text':'测试文字fall moonlight完整歌词 ENDWORD','translation':'紧密中文翻译没有空隙'} for i in range(25)]})
  emit({'kind':'time','seconds':10.2})
 elif c=='nexttrack':
  tick+=1;emit({'kind':'time','seconds':tick+.2})
 elif c.startswith('focus:'):
  a,b=map(int,c[6:].split(':'));focus={'selected':a,'offset':b}
 elif c in ('playlists','recommend','discover'):
  section={'playlists':'','recommend':'recommend','discover':'discover'}[c]
  emit({'kind':'playlists','lists':lists,'page':3,'section':section})
 elif c.startswith('openlist:'):
  saved=dict(focus);emit({'kind':'tracks','tracks':[{'title':'歌曲','artist':'测试'}],'section':section})
 elif c=='back' and saved:
  emit({'kind':'playlists','lists':lists,'page':3,'section':section,**saved})
 emit({'kind':'busy','value':False})
''');node.chmod(0o700)
    screen=Screen(None,40,140,100)
    master,slave=pty.openpty();fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',40,140,0,0))
    env=dict(os.environ,TERM='xterm-kitty',KITTY_WINDOW_ID='smoke',PATH=folder+':'+os.environ['PATH'],XDG_CONFIG_HOME=str(root/'config'),LAYOUT_LOG=str(log))
    p=subprocess.Popen(['./tui/target/debug/kugou-lite'],stdin=slave,stdout=slave,stderr=slave,env=env,start_new_session=True);os.close(slave)
    output=bytearray()
    def drain(duration=.25):
        end=time.monotonic()+duration
        while time.monotonic()<end:
            if select.select([master],[],[],.01)[0]:
                try:data=os.read(master,65536)
                except OSError:break
                output.extend(data)
                buf=screen.test_create_write_buffer();screen.test_commit_write_buffer(data,buf);screen.test_parse_written_data()
    def send(data,duration=.25):os.write(master,data);drain(duration)
    def lines():return [str(screen.line(i)) for i in range(40)]
    def nav():
        text='\n'.join(lines())
        for label in ['主页','推荐','发现','搜索','歌单','账号','播放','队列','设置']:
            assert label in text,(label,text)
    try:
        drain(.4);send(b'?');send(b'1');send(b'\x1b[B'*2);send(b'\r');nav()
        for _ in range(3):
            send(b'\r');nav();send(b'u');send(b'u');nav()
        # Restore large icons for the lyric page, then check the real parser's grid.
        send(b'\r');send(b'\x1b');send(b'\t',.5)
        rows=lines();text='\n'.join(rows);assert '紧密中文翻译没有空隙' in text,text
        compact=[i for i,row in enumerate(rows[:-2]) if '测试文字fall moonlight完整歌词 ENDWORD' in row]
        assert len(compact)>=2,('compact inactive originals missing',text)
        for i in compact:
            assert '紧密中文翻译没有空隙' in rows[i+1],('unit has an internal blank row',i,text)
            assert '紧密中文翻译没有空隙' not in rows[i+2] and '测试文字fall moonlight完整歌词 ENDWORD' not in rows[i+2],('missing separator row',i,text)
        # Inspect actual cells, not str(line): Kitty omits multicell continuation
        # columns from its string representation. Before the fix the first scroll
        # erased the lyric panel's right border at x=100, y=19.
        borders=[(x,y) for y in range(40) for x in range(140) if screen.line(y)[x]=='│' and x>90]
        assert borders,'right panel borders missing before scroll'
        for _ in range(30):
            send(b']',.15)
            for x,y in borders:
                assert screen.line(y)[x]=='│',('border erased during scroll',x,y,screen.line(y)[x], '\n'.join(lines()))
        # Each emitted lyric multicell has an explicit legal footprint inside its panel.
        for y,x,meta,body in re.findall(rb'\x1b\[(\d+);(\d+)H\x1b]66;([^;]+);([^\x1b]*)\x1b\\',output):
            label=body.decode()
            if len(label)==1 and 0xe000<=ord(label)<=0xf8ff:continue
            w=re.search(rb'(?:^|:)w=(\d+)',meta);assert w,(meta,body)
            width=int(w[1])*2;assert 1<=int(w[1])<=7
            assert int(x)-1>=60,(x,body)
            assert int(x)-1+width<=98,(x,width,body)
        # Enter then Esc then Enter opens the same parent row in every section.
        for key in [b'p',b'r',b'd']:
            send(key);send(b'\x1b[B'*45,.4)
            if key in (b'r',b'd'):
                def margin(index):
                    visible=lines();y=next(i for i,row in enumerate(visible) if '歌单'+str(index) in row)
                    assert y-5>=2 and 34-(y+2)>=2,('two-line scroll margin missing',index,y,'\n'.join(visible))
                margin(45)
                send(b'\x1b[A'*20,.4);margin(25)
                send(b'\x1b[B'*54,.4)
                assert any('歌单79' in row for row in lines()),'last item became unreachable'
                send(b'\x1b[A'*34,.4);margin(45)
            send(b'\r');send(b'\x1b');send(b'\r')
            commands=log.read_text().splitlines();opened=[c for c in commands if c.startswith('openlist:')]
            assert opened[-2:]==['openlist:45','openlist:45'],opened
            focuses=[c for c in commands if c.startswith('focus:')]
            assert focuses[-1]==focuses[-2],focuses
            send(b'\x1b')
        send(b'q');p.wait(timeout=3)
        print('Kitty layout smoke: icons, lyrics, scroll borders, two-line recommendation/discovery scroll margins, last item and parent viewport passed')
    finally:
        if p.poll() is None:p.kill();p.wait()
        os.close(master)
