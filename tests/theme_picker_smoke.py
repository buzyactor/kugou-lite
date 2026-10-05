"""Real input: named theme menu, transient preview, keyboard and mouse commit."""
import os,pty,fcntl,termios,struct,subprocess,tempfile,time,select,json,re
from pathlib import Path
with tempfile.TemporaryDirectory(prefix='kugou-theme-picker-') as folder:
    root=Path(folder);app=root/'config/kugou-lite';app.mkdir(parents=True)
    (app/'config.json').write_text(json.dumps({'desktop_notifications':False,'in_app_notifications':False}))
    node=root/'node';node.write_text('''#!/usr/bin/python
import json,sys,threading,time
def volumes():
 while True:
  time.sleep(.4);print(json.dumps({'kind':'volume','value':71}),flush=True)
threading.Thread(target=volumes,daemon=True).start()
for line in sys.stdin:pass
''');node.chmod(0o700)
    master,slave=pty.openpty();fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',40,140,0,0))
    env=dict(os.environ,TERM='xterm-kitty',KITTY_WINDOW_ID='test',PATH=folder+':'+os.environ['PATH'],XDG_CONFIG_HOME=str(root/'config'))
    p=subprocess.Popen(['./tui/target/debug/kugou-lite'],stdin=slave,stdout=slave,stderr=slave,env=env,start_new_session=True);os.close(slave)
    output=bytearray()
    def drain(duration=.25):
        end=time.monotonic()+duration
        while time.monotonic()<end:
            if select.select([master],[],[],.01)[0]:
                try:output.extend(os.read(master,65536))
                except OSError:break
    def send(data):os.write(master,data);drain()
    def theme():return json.loads((app/'theme.json').read_text())['id']
    def clean(data):return re.sub(rb'\x1b\[[0-?]*[ -/]*[@-~]',b'',bytes(data))
    try:
        drain(.5);original=theme();assert len(list((app/'themes').glob('*.json')))==23
        send(b'?');send(b'1');send(b'\x1b[B'*4);send(b'\r')
        assert '选择主题'.encode() in clean(output),'picker did not open'
        send(b'\x1b[B');drain(.6)
        assert theme()==original,'background volume save committed preview'
        send(b'\x1b');assert theme()==original,'Esc failed to cancel'
        send(b' ');send(b'\x1b[F');send(b'\r')
        assert theme()=='monochrome','End/Enter did not commit last theme'
        send(b'\r')
        # Row 15 is Ocean Abyss; selecting previews, Apply commits.
        send(b'\x1b[<0;40;24M');send(b'\x1b[<0;40;24m')
        assert theme()=='monochrome','mouse row preview saved too early'
        send(b'\x1b[<0;36;34M');send(b'\x1b[<0;36;34m')
        assert theme()=='ocean-abyss','mouse Apply failed'
        send(b'q');p.wait(timeout=3);assert p.returncode==0
        print('Theme picker smoke: 23 named files, menu, preview without persistence, Esc cancel, Space open, End/Enter and mouse Apply passed')
    finally:
        if p.poll() is None:p.kill();p.wait()
        os.close(master)
