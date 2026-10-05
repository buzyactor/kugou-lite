import re,os,pty,subprocess,fcntl,termios,struct,time,select,tempfile,json,pathlib
with tempfile.TemporaryDirectory(prefix='kugou-ui-smoke-') as folder:
 log=pathlib.Path(folder)/'commands'
 node=pathlib.Path(folder)/'node'
 node.write_text('''#!/usr/bin/python
import json,sys,os
for line in sys.stdin:
 command=line.strip()
 with open(os.environ['KUGOU_SMOKE_LOG'],'a') as f:f.write(command+'\\n')
 if command=='restore':
  for event in [
   {'kind':'account','label':'测试账号'},
   {'kind':'state','status':'Playing'},
   {'kind':'quality','codec':'flac','sampleRate':44100,'bits':16},
   {'kind':'media','fresh':True,'title':'Artist - Song','song':'Song','artist':'Artist','duration':180,'lyrics':[{'start':i*1000,'duration':1000,'translation':'Translated '+str(i),'words':[{'text':'Line '+str(i),'start':i*1000,'duration':1000}]} for i in range(40)]},
   {'kind':'time','seconds':10},
   {'kind':'spectrum','bars':[150]*16}]: print(json.dumps(event),flush=True)
 elif command=='accounts':
  print(json.dumps({'kind':'accounts','accounts':[{'index':0,'userid':'123','label':'Account One','active':True}]}),flush=True)
  print(json.dumps({'kind':'busy','value':False}),flush=True)
 elif command=='login':
  print(json.dumps({'kind':'qr','url':'https://example.com/qr-test'}),flush=True)
  print(json.dumps({'kind':'busy','value':True}),flush=True)
 elif command=='cancel':
  print(json.dumps({'kind':'busy','value':False}),flush=True)
 elif command.startswith('deleteaccount:'):
  print(json.dumps({'kind':'accounts','accounts':[]}),flush=True)
  print(json.dumps({'kind':'busy','value':False}),flush=True)
 elif command in ['nexttrack','prevtrack','recommend']:
  print(json.dumps({'kind':'busy','value':False}),flush=True)
''')
 node.chmod(0o700)
 master,slave=pty.openpty();fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',40,140,0,0))
 env=dict(os.environ,TERM='xterm-kitty',KITTY_WINDOW_ID='smoke',PATH=folder+':'+os.environ['PATH'],KUGOU_SMOKE_LOG=str(log),XDG_CONFIG_HOME=folder+"/config")
 p=subprocess.Popen(['./tui/target/debug/kugou-lite'],stdin=slave,stdout=slave,stderr=slave,env=env,start_new_session=True);os.close(slave)
 output=bytearray()
 def drain(seconds=.2):
  end=time.monotonic()+seconds
  while time.monotonic()<end:
   if select.select([master],[],[],.03)[0]:
    try:output.extend(os.read(master,65536))
    except OSError:break
 def send(data):os.write(master,data);drain()
 try:
  drain(.5);send(b'\t')
  cadence_start=len(output);drain(1.0)
  frame_count=output[cadence_start:].count(b'\x1b[?2026h')
  assert frame_count>=40,('playback cadence too low',frame_count)
  send(b'\x1b[<0;42;38M');send(b'\x1b[<32;101;38M');send(b'\x1b[<0;101;38m')
  send(b'\x1b[<0;5;39M');send(b'\x1b[<0;5;39m')
  send(b'\x1b[<0;8;39M');send(b'\x1b[<0;8;39m')
  send(b'\x1b[<65;75;10M')
  send(b'?')
  send(b'2');send(b'\x1b[B'*5);send(b'\r')
  send(b'\x1b[B');send(b'\x1b[C')
  send(b'\x1b[A');send(b'\r')
  adapter_commands=[json.loads(c[9:]) for c in log.read_text().splitlines() if c.startswith('kotonoha:')]
  assert adapter_commands[0]['enabled'] is False,adapter_commands
  assert adapter_commands[-3]['enabled'] is True and adapter_commands[-2]['clockMs']==1250 and adapter_commands[-1]['enabled'] is False,adapter_commands
  config=json.loads((pathlib.Path(folder)/'config/kugou-lite/config.json').read_text())
  assert config['kotonoha_enabled'] is False and config['kotonoha_clock_ms']==1250,config
  send(b' ')
  send(b'r')
  assert 'recommend' in log.read_text().splitlines(),log.read_text()
  send(b'?')
  send(b'\x1b')
  send(b'a')
  idle_start=len(output);drain(1.2)
  assert b'\x1b]66;' not in output[idle_start:],'idle icons are repainted'
  send(b'l');send(b'\x1b')
  restored=len(output);drain(.2)
  # Re-enter/cancel another QR and verify the account row is restored by its diff.
  send(b'l');before=len(output);send(b'\x1b')
  clean_back=re.sub(rb'\x1b\[[0-?]*[ -/]*[@-~]',b'',bytes(output[before:]))
  assert b'Account One' in clean_back,'Esc failed to return to accounts'
  send(b'\x1b[3~');send(b'\x1b')
  assert not any(c.startswith('deleteaccount:') for c in log.read_text().splitlines()),'cancelled delete reached worker'
  send(b'\x1b[3~');send(b'y')
  send(b'h')
  send(b'q');p.wait(timeout=3);drain()
  commands=log.read_text().splitlines()
  assert any(c.startswith('seekpercent:') for c in commands),commands
  assert 'pause' in commands,commands
  assert 'nexttrack' in commands,commands
  assert commands.count('deleteaccount:123')==1,commands
  assert 'home' in commands,commands
  assert b'\x1b]66;s=2:w=2;' in output,'missing scaled icons'
  assert re.search(rb'\x1b]66;s=2:w=[1-7];Line',output),'missing bounded scaled lyrics'
  assert b'\x1b]66;s=2:n=3:d=4:' not in output,'inactive lyrics should use compact native cells'
  assert b'\x1b]66;s=2:n=5:d=8:' not in output,'inactive translations should be compact'
  assert b'Translated 10' in output,'footer translation missing'
  clean=re.sub(rb'\x1b\[[0-?]*[ -/]*[@-~]',b'',bytes(output))
  assert '设置与快捷键'.encode() in clean,'settings panel not rendered: '+clean[-400:].decode(errors='replace')
  assert p.returncode==0,p.returncode
  print('PTY smoke: Kotonoha startup/toggle/interval persistence, playback frame cadence, stable icons, QR Esc return, delete cancel/confirm, home shortcut, playback mouse, clean exit passed')
 finally:
  if p.poll() is None:p.kill();p.wait()
  os.close(master)
