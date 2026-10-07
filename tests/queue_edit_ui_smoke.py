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
               PATH=str(root) + ':' + os.environ['PATH'], XDG_CONFIG_HOME=str(root / 'config'), QUEUE_UI_COUNT='45', QUEUE_CLOUD_PLAYLISTS='1', QUEUE_CLOUD_COUNT='40', QUEUE_HISTORY_FILE=str(root / 'play-history.json'))
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

    def click_text(text, menu=False):
        lines=[str(screen.line(i)) for i in range(40)]
        y=next(i for i,line in enumerate(lines) if text in line)
        prefix=lines[y].split(text)[0]
        x=79 if menu else sum(2 if ord(c)>0x2e80 else 1 for c in prefix)
        send(f'\x1b[<0;{x+1};{y+1}M'.encode())

    try:
        drain(.6)
        send(b'r');send(b'\r')
        assert contains('歌曲操作 [K]') and contains('收藏 [F]'), 'playback actions missing'
        click_text('歌曲操作 [K]')
        assert contains('下一首播放') and contains('追加到当前队列'), 'mouse menu failed'
        send(b'\x1b');assert not contains('下一首播放'), 'Esc failed to close song menu'
        send(b'k');send(b'\x1b[B');send(b'\r');send(b'b')
        assert contains('46 首'), 'append did not preserve queue'
        send(b'k');send(b'\x1b[F');send(b'\r')
        assert contains('★'), 'pin missing'
        send(b'k');send(b'\x1b[F');send(b'\x1b[A');send(b'\r')
        assert contains('重命名队列'), 'rename prompt missing'
        send(b'\x1b[3~');send(b'Evening');send(b'\r')
        assert contains('★ Evening'), 'renamed pinned queue missing'
        send(b'k');click_text('下移一首')
        assert contains('队列已更新'), 'queue move mouse action failed'
        send(b'k');click_text('移除这首队列歌曲')
        assert contains('当前播放已停止') and contains('45 首'), 'current-song removal did not stop and retain other songs'
        send(b'r');send(b'\r');send(b'f')
        assert contains('收藏到歌单'), 'playback F missing'
        send(b'\r');assert contains('已收藏 0/1 首'), 'unknown favorite state'
        assert contains('添加未收藏的 1 首'), 'add action missing'
        send(b'\r');assert contains('已核对') and contains('收藏 [F]'), 'favorite add did not verify and return to playback'
        send(b'f');send(b'\r')
        assert contains('已收藏 1/1 首') and contains('确认从此歌单移除'), 'existing membership not shown'
        send(b'\x1b');send(b'\x1b')
        assert contains('收藏 [F]'), 'cancel did not return to playback'
        send(b'f');send(b'\r');send(b'\r')
        assert contains('已核对') and contains('移除 1 首'), 'favorite removal not verified'
        send(b'r');send(b'm');send(b'\x1b[C');send(b'm');send(b'f');send(b'\r')
        assert contains('已收藏 0/2 首'), 'cross-page batch selection lost'
        send(b'\r')
        assert contains('添加 2 首') and contains('第 2 页'), 'batch add or original page restoration failed'
        send(b'p');send(b'c')
        assert contains('新建歌单（1–80字）'), 'C creation prompt missing'
        send(b'New cloud');send(b'\r')
        assert contains('已核对：创建歌单 New cloud'), 'creation not verified'
        send(b'k');click_text('重命名歌单', menu=True)
        send(b'\x1b[3~');send(b'My cloud');send(b'\r')
        assert contains('My cloud') and contains('已核对：歌单改名'), 'rename not verified'
        send(b'\r');send(b'k');click_text('输入编号调整歌单位置', menu=True)
        assert contains('移动到歌单编号'), 'position prompt missing: '+ '\n'.join(str(screen.line(i)) for i in range(40))
        send(b'4');send(b'\r')
        assert contains('已核对：移动 1 首到第 4 位'), 'numbered position did not apply: '+ '\n'.join(str(screen.line(i)) for i in range(40))
        send(b'k');click_text('复制到另一个歌单', menu=True)
        send(b'\x1b[B');send(b'\r')
        assert contains('确认复制'), 'copy confirmation missing'
        send(b'\r')
        assert contains('已核对：复制 1 首'), 'copy not verified'
        send(b'm');send(b'\x1b[C');send(b'm');send(b'k')
        click_text('移动已标记 2 首到歌单', menu=True)
        send(b'\x1b[B');send(b'\r')
        assert contains('确认移动（核对目标后从原歌单移除）'), 'move confirmation missing'
        send(b'\r')
        assert contains('已核对：移动 2 首'), 'batch move did not verify and return'
        send(b'g');assert contains('My cloud'), 'own playlist refresh failed'
        send(b'p');send(b'k');click_text('新建歌单', menu=True);send(b'\x1b')
        assert not contains('新建歌单（1–80字）'), 'creation Esc cancellation failed'
        send(b'b');send(b'k')
        send(b'q');process.wait(timeout=3)
        saved=json.loads((root/'play-history.json.queues').read_text())['accounts']['1']
        assert any(e['title']=='Evening' and e.get('pinned') for e in saved['entries']), 'name/pin did not persist'
        assert process.returncode == 0
        print('Queue editing and favorites UI: mouse/keyboard menu, append, move, removal, rename/pin persistence, current-song F, cloud membership, cancel, confirmed removal and cross-page batch, cloud create/rename/copy/move/numbered position passed')
    finally:
        if process.poll() is None:
            process.terminate()
            try: process.wait(timeout=3)
            except subprocess.TimeoutExpired: process.kill();process.wait()
        os.close(master)
