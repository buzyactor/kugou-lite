"""PTY + fake libnotify: no account/API requests and no real desktop spam."""
import re, os, pty, subprocess, fcntl, termios, struct, time, select, tempfile, json
from pathlib import Path
with tempfile.TemporaryDirectory(prefix='kugou-notifications-') as folder:
    root=Path(folder);log=root/'sent.jsonl'
    node=root/'node'
    node.write_text('''#!/usr/bin/python
import sys,json
for line in sys.stdin:
 c=line.strip()
 if c=='restore':
  for _ in range(2): print(json.dumps({'kind':'error','message':'通知失败测试'}),flush=True)
 elif c in ('nexttrack','prevtrack'):
  print(json.dumps({'kind':'media','fresh':True,'song':c,'artist':'Artist','title':c,'lyrics':[]}),flush=True)
  print(json.dumps({'kind':'busy','value':False}),flush=True)
''')
    notify=root/'notify-send'
    notify.write_text('''#!/usr/bin/python
import os,json,sys
with open(os.environ['NOTICE_LOG'],'a') as f:f.write(json.dumps(sys.argv[1:])+'\\n')
print('321')
''')
    node.chmod(0o700);notify.chmod(0o700)
    master,slave=pty.openpty();fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',40,140,0,0))
    env=dict(os.environ,PATH=folder+':'+os.environ['PATH'],XDG_CONFIG_HOME=folder+'/config',NOTICE_LOG=str(log),TERM='xterm-kitty',KITTY_WINDOW_ID='test')
    p=subprocess.Popen(['./tui/target/debug/kugou-lite'],stdin=slave,stdout=slave,stderr=slave,env=env,start_new_session=True);os.close(slave)
    output=bytearray()
    def drain(duration=.25):
        end=time.monotonic()+duration
        while time.monotonic()<end:
            if select.select([master],[],[],.03)[0]:
                try:output.extend(os.read(master,65536))
                except OSError:break
    def send(data):os.write(master,data);drain()
    def sent():return [json.loads(s) for s in log.read_text().splitlines()]
    try:
        drain(.5);assert len(sent())==1,'duplicate error delivered twice'
        args=sent()[0]
        icon=Path(args[args.index('--icon')+1]).resolve()
        assert icon==Path('复古终端像素狼头音乐图标.png').resolve(),args
        assert icon.read_bytes()==Path('复古终端像素狼头音乐图标.png').read_bytes()
        assert '--hint=string:desktop-entry:kugou-lite' in args,args
        assert '通知失败测试'.encode() in re.sub(rb'\x1b\[[0-?]*[ -/]*[@-~]',b'',bytes(output)),'in-app notification missing'
        # Right-top notification is clickable; verify title/body does not redraw.
        send(b'\x1b[<0;135;5M');send(b'\x1b[<0;135;5m')
        send(b']');send(b'[')
        deliveries=sent();assert len(deliveries)==3,deliveries
        assert '--replace-id' in deliveries[-1] and '321' in deliveries[-1],deliveries
        send(b'?');send(b'6');assert '通知显示时间'.encode() in re.sub(rb'\x1b\[[0-?]*[ -/]*[@-~]',b'',bytes(output))
        send(b'\x1b[B');send(b'\r') # desktop off
        config=json.loads((root/'config/kugou-lite/config.json').read_text())
        assert config['desktop_notifications'] is False,config
        send(b'\x1b');send(b']');assert len(sent())==3,'desktop off still sends'
        send(b'?');send(b'6');send(b'\x1b[6~') # wrap page-down -> appearance
        before=len(output);send(b'\x1b[5~') # page-up -> notifications
        assert '通知显示时间'.encode() in re.sub(rb'\x1b\[[0-?]*[ -/]*[@-~]',b'',bytes(output[before:])),'page-up wrap skips notifications'
        send(b'q');p.wait(timeout=3)
        theme=json.loads((root/'config/kugou-lite/theme.json').read_text())
        assert set(theme['notifications'])=={'background','text','info','success','warning','error'}
        print('Notifications smoke: dedup, toasts, desktop replacement, settings, disable, page wrap and theme passed')
    finally:
        if p.poll() is None:p.kill();p.wait()
        os.close(master)
