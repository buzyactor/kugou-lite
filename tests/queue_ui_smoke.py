"""Real TUI + real worker loop; API/account/audio dependencies are mocked."""
import os, pty, fcntl, termios, struct, subprocess, tempfile, time, select, shutil
import json, base64
import sys
from pathlib import Path
sys.path.insert(0, '/usr/lib/kitty')
from kitty.fast_data_types import Screen

with tempfile.TemporaryDirectory(prefix='kugou-queue-ui-') as folder:
    root = Path(folder)
    config = root / 'config/kugou-lite'
    config.mkdir(parents=True)
    covers=root/'covers';covers.mkdir()
    (covers/('a'+'0'*31+'.png')).write_bytes(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGN8AAAAASUVORK5CYII='))
    (config / 'config.json').write_text(json.dumps({'desktop_notifications': False, 'in_app_notifications': False, 'mode': 'sequence'}))
    node = root / 'node'
    fixture = Path('tests/fixtures/queue-worker-mocks.mjs').resolve()
    node.write_text('#!/usr/bin/python\nimport os,sys\nos.execv(' + repr(shutil.which('node'))
                    + ', [' + repr(shutil.which('node')) + ', "--import", ' + repr(str(fixture))
                    + '] + sys.argv[1:])\n')
    node.chmod(0o700)
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 160, 0, 0))
    env = dict(os.environ, TERM='xterm-kitty', KITTY_WINDOW_ID='queue-test',
               PATH=str(root) + ':' + os.environ['PATH'], XDG_CONFIG_HOME=str(root / 'config'), QUEUE_UI_COUNT='45', QUEUE_HISTORY_FILE=str(root / 'play-history.json'))
    process = subprocess.Popen(['./tui/target/debug/kugou-lite'], stdin=slave,
                               stdout=slave, stderr=slave, env=env, start_new_session=True)
    os.close(slave)
    output = bytearray()
    screen = Screen(None, 40, 160, 100)

    def drain(seconds=.3):
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            if select.select([master], [], [], .02)[0]:
                try:
                    data = os.read(master, 65536)
                    output.extend(data)
                    buffer = screen.test_create_write_buffer()
                    screen.test_commit_write_buffer(data, buffer)
                    screen.test_parse_written_data()
                except OSError:
                    break

    def send(data):
        os.write(master, data)
        drain()

    def contains(text):
        return text in '\n'.join(str(screen.line(i)) for i in range(40))

    try:
        drain(.6)
        send(b'r'); send(b'\r'); send(b'b')
        assert contains('队列 1/1'), 'first queue missing'
        assert contains('N 切换队列'), 'queue controls missing'
        assert contains('45 首'), 'queue omitted songs from later pages'
        send(b'r'); send(b'\x1b[C'); send(b'\r'); send(b'b')
        assert contains('队列 1/1'), 'second UI page created a separate queue'
        assert contains('45 首'), 'second-page queue is incomplete'
        send(b'd'); send(b'\r'); send(b'b')
        assert contains('队列 2/2'), 'second queue missing'
        before = len(output)
        send(b'n')
        assert b'daily0' in output[before:], 'N did not switch to retained queue'
        send(b'\x1b[3~')
        assert contains('已删除队列：每日推荐歌曲'), 'Delete did not remove viewed queue'
        send(b'\x1b[3~')
        assert contains('队列历史为空'), 'final deletion did not render empty state'
        send(b'n'); send(b'\x1b[3~')  # Empty history is harmless.
        send(b'e')
        assert contains('已播放历史 · 3 首'), 'history did not retain actually played songs'
        assert contains('daily0') and contains('new0'), 'played songs missing from history'
        send(b'\x1b[B' * 2)
        before=len(output)
        send(b'\r')
        assert b'a=T,f=100,t=d,i=47201' in output[before:], 'history replay did not render the cached playback cover'
        send(b'e')
        assert contains('daily0'), 'history replay failed'
        sidebar_row=next(i for i in range(40) if '历史' in str(screen.line(i))[:22])
        send(f'\x1b[<0;10;{sidebar_row+1}M'.encode())
        send(f'\x1b[<0;10;{sidebar_row+1}m'.encode())
        assert contains('已播放历史'), 'sidebar history click failed'
        send(b'u')
        assert contains('历史') and contains('设置'), 'top navigation clipped the new history item or settings'
        send(b's')
        assert all(contains(label) for label in ['Hi-Res', '蝰蛇超清', '蝰蛇全景声']), 'higher quality menu missing'
        send(b'\x1b[B' * 3); send(b'\r')
        send(b'\t')
        assert contains('音质 [S]'), 'playback quality button missing'
        send(b's')
        assert contains('切换音质'), 'S left the playback page instead of showing popup'
        assert all(contains(label) for label in ['FLAC 无损', '320 kbps', '128 kbps', 'Hi-Res', '蝰蛇超清', '蝰蛇全景声'])
        assert contains('当前请求：Hi-Res') and contains('实际播放：FLAC'), 'preferred/actual quality not distinguished'
        send(b'\x1b[F'); send(b'\r')
        assert contains('音质 [S]') and not contains('切换音质'), 'selection did not return to playback'
        assert json.loads((config / 'config.json').read_text())['quality'] == 'viper_atmos'
        lines=[str(screen.line(i)) for i in range(40)]
        y=next(i for i,line in enumerate(lines) if '音质 [S]' in line)
        # Screen strings use code points; calculate terminal cells before the button.
        prefix=lines[y].split('音质 [S]')[0]
        x=sum(2 if ord(c)>0x2e80 else 1 for c in prefix)
        send(f'\x1b[<0;{x+1};{y+1}M'.encode())
        assert contains('切换音质'), 'playback quality button click failed'
        send(b'\x1b')
        assert not contains('切换音质'), 'Esc did not close popup'
        assert json.loads((config / 'config.json').read_text())['quality'] == 'viper_atmos'
        send(b's')
        lines=[str(screen.line(i)) for i in range(40)]
        y=next(i for i,line in enumerate(lines) if '蝰蛇超清' in line)
        prefix=lines[y].split('蝰蛇超清')[0]
        x=sum(2 if ord(c)>0x2e80 else 1 for c in prefix)
        send(f'\x1b[<0;{x+1};{y+1}M'.encode())
        assert contains('音质 [S]') and not contains('切换音质'), 'popup mouse selection failed'
        assert json.loads((config / 'config.json').read_text())['clear_queues_on_exit'] is False
        send(b'?');send(b'3')
        assert contains('离开时清除播放列表'), 'exit queue option missing from playback settings'
        send(b'\x1b[B'*4);send(b'\r')
        assert json.loads((config / 'config.json').read_text())['clear_queues_on_exit'] is True
        assert contains('播放失败自动下一首'), 'error skip setting missing'
        assert json.loads((config / 'config.json').read_text())['auto_skip_errors'] is True
        send(b'\x1b[B');send(b'\r')
        assert json.loads((config / 'config.json').read_text())['auto_skip_errors'] is False
        send(b'\r')
        assert json.loads((config / 'config.json').read_text())['auto_skip_errors'] is True
        send(b'q'); process.wait(timeout=3)
        assert process.returncode == 0
        assert json.loads((config / 'config.json').read_text())['quality'] == 'viper_clear', 'selected quality not persisted'
        assert json.loads((root/'play-history.json.queues').read_text())['accounts']['1']['entries'] == [], 'Q exit did not clear queues after enabling the option'
        assert len(json.loads((root/'play-history.json').read_text())['accounts']['1']) == 3, 'clearing queues removed played history'
        print('Queue UI: real worker + TUI create/retain, N switching, Delete inactive/playing/final, empty state and clean exit passed')
    finally:
        if process.poll() is None:
            process.kill(); process.wait()
        os.close(master)
