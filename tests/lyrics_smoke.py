"""Real Kitty protocol output: word seams, wrapping, animated rows and scaling switch."""
import fcntl, json, os, pathlib, pty, re, select, struct, subprocess, tempfile, termios, time

with tempfile.TemporaryDirectory(prefix='kugou-lyrics-') as folder:
    root = pathlib.Path(folder)
    app = root / 'config' / 'kugou-lite'
    app.mkdir(parents=True)
    (app / 'config.json').write_text(json.dumps({'scale_lyrics':True,'large_lyric':True,'translation':True}))
    lyrics = [dict(start=i*1000,duration=1000,translation='Translated line '+str(i),words=[
        dict(text='Line'+str(i)+' ',start=i*1000-1000,duration=1000),
        dict(text='f',start=i*1000,duration=500),
        dict(text='all moonlight a/b-c this is a longer lyric that needs wrapping ENDWORD',start=i*1000+500,duration=500)
    ]) for i in range(30)]
    for i,line in enumerate(lyrics):
        if i not in (10,11):line['words']=line['words'][:1]
    (root / 'events.json').write_text(json.dumps([
        {'kind':'state','status':'Playing'},
        {'kind':'media','fresh':True,'title':'Lyric Smoke','duration':60,'lyrics':lyrics},
        {'kind':'time','seconds':10.05},
        {'kind':'bitrate','value':512345}
    ]))
    # Give each lyric state a distinct test color via the real theme file path.
    setup_env=dict(os.environ,XDG_CONFIG_HOME=str(root/'config'))
    subprocess.run(['./tui/target/debug/kugou-lite','--export-theme',str(root/'theme-export.json')],env=setup_env,check=True,capture_output=True)
    theme=json.loads((root/'theme-export.json').read_text())
    theme['lyrics'].update(completed='#ff6600',past='#778899',word='#ffff00',pending='#ff00ff',upcoming='#00ffff')
    (app/'theme.json').write_text(json.dumps(theme))
    node = root / 'node'
    node.write_text('''#!/usr/bin/python
import json,os,sys
for line in sys.stdin:
 command=line.strip()
 if command=='restore':
  for event in json.load(open(os.environ['LYRIC_EVENTS'])): print(json.dumps(event),flush=True)
 elif command=='nexttrack':
  print(json.dumps({'kind':'time','seconds':11.05}),flush=True)
  print(json.dumps({'kind':'busy','value':False}),flush=True)
''')
    node.chmod(0o700)
    master,slave=pty.openpty()
    fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',40,140,0,0))
    env=dict(os.environ,TERM='xterm-kitty',KITTY_WINDOW_ID='smoke',XDG_CONFIG_HOME=str(root/'config'),PATH=folder+':'+os.environ['PATH'],LYRIC_EVENTS=str(root/'events.json'))
    env.pop('NO_COLOR',None)
    process=subprocess.Popen(['./tui/target/debug/kugou-lite'],stdin=slave,stdout=slave,stderr=slave,env=env,start_new_session=True)
    os.close(slave)
    output=bytearray()
    def drain(seconds):
        end=time.monotonic()+seconds
        while time.monotonic()<end:
            if select.select([master],[],[],.01)[0]:
                try: output.extend(os.read(master,65536))
                except OSError: break
    def send(keys,seconds=.2):
        os.write(master,keys);drain(seconds)
    try:
        drain(.4); send(b'\t',.5)
        payloads=re.findall(rb'\x1b]66;[^;]+;([^\x1b]*)\x1b\\',output)
        assert b'fall' in payloads,'English word split during karaoke'
        assert b'a/b-c' in payloads,'punctuation split a connected English word into scaled blocks'
        assert b'512 kbps' in output,'live bitrate not shown in status bar'
        assert b'ENDWORD' in payloads,'long lyric tail was clipped'
        for sequence in [b'38;2;255;102;0m',b'38;2;119;136;153m',b'38;2;255;255;0m',b'38;2;255;0;255m',b'38;2;0;255;255m']:
            assert re.search(re.escape(sequence[:-1])+rb'[;m]',output),('missing lyric state color',sequence)
        assert b'\x1b7\x1b[1m' in output,'scaled lyrics are not bold'
        start=len(output);send(b']',.6)
        positions=[int(y) for y in re.findall(rb'\x1b\[(\d+);\d+H\x1b]66;[^;]+;Line11\x1b\\',output[start:])]
        assert len(set(positions))>=3,('scroll jumped instead of animating',positions)
        assert all(abs(a-b)<=2 for a,b in zip(positions,positions[1:])),positions
        send(b'?');send(b'2');send(b'\x1b[B'*4,.3);send(b'\r')
        assert json.loads((app/'config.json').read_text())['scale_lyrics'] is False,'settings scaling switch did not persist'
        send(b'4');send(b'\x1b[B');send(b'\x1b[1;2B')
        saved=json.loads((app/'config.json').read_text())
        assert saved['status_items'][:2]==['song','controls'],'status order not persisted'
        send(b'\r')
        assert 'controls' not in json.loads((app/'config.json').read_text())['status_items'],'status visibility not persisted'
        send(b'\x1b',.5);start=len(output);drain(.2)
        assert b'\x1b]66;s=2:n=' not in output[start:],'disabled scaling still renders fractional lyrics'
        send(b'q');process.wait(timeout=3)
        assert process.returncode==0
        print('Lyrics PTY: complete words, wrapped tail, bold, intermediate scroll positions and persistent scaling switch passed')
    finally:
        if process.poll() is None:process.kill();process.wait()
        os.close(master)
