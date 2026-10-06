"""Exercise real CLI file operations without starting the account worker."""
import json, os, pathlib, subprocess, tempfile

binary = pathlib.Path('tui/target/debug/kugou-lite').resolve()
with tempfile.TemporaryDirectory(prefix='kugou-config-') as folder:
    root = pathlib.Path(folder)
    env = dict(os.environ, XDG_CONFIG_HOME=str(root / 'xdg'))
    app = root / 'xdg' / 'kugou-lite'
    def run(*args, ok=True):
        result = subprocess.run([str(binary), *map(str, args)], env=env, capture_output=True, timeout=5)
        assert (result.returncode == 0) == ok, result.stderr.decode()
        return result
    run('--export-config', root / 'export.json')
    config = json.loads((root / 'export.json').read_text())
    assert config == json.loads((app / 'config.json').read_text())
    assert 'theme' not in config
    presets = list((app / 'themes').glob('*.json'))
    assert len(presets) == 23
    for path in presets:
        theme = json.loads(path.read_text())
        assert path.name == theme['name'] + '.json'
        assert len(theme['colors']) == 8
        assert len(theme['panels']) == 9
        assert all(k in theme['lyrics'] for k in ['completed','past','word','pending','upcoming'])
        assert all(k in theme['progress'] for k in ['track','played','thumb'])
    config['volume'] = 42
    config['kotonoha_enabled'] = True
    config['kotonoha_endpoint'] = 'ws://127.0.0.1:28746/kotonoha/adapter'
    config['kotonoha_clock_ms'] = 750
    config['lyric_align'] = 2
    (root / 'import.json').write_text(json.dumps(config))
    run('--import-config', root / 'import.json')
    assert json.loads((app / 'config.json').read_text())['volume'] == 42
    for quality in ['high', 'viper_clear', 'viper_atmos', 'flac', '320', '128']:
        config['quality'] = quality
        (root / 'import.json').write_text(json.dumps(config))
        run('--import-config', root / 'import.json')
        run('--export-config', root / 'export.json')
        assert json.loads((root / 'export.json').read_text())['quality'] == quality
    for key in ['kotonoha_enabled','kotonoha_endpoint','kotonoha_clock_ms']:
        assert json.loads((app / 'config.json').read_text())[key] == config[key]
    before = (app / 'config.json').read_bytes()
    (root / 'invalid.json').write_text('{"volume":101}')
    run('--import-config', root / 'invalid.json', ok=False)
    assert (app / 'config.json').read_bytes() == before
    run('--export-theme', root / 'theme-export.json')
    theme = json.loads((root / 'theme-export.json').read_text())
    theme.update(id='my-night', name='My Night')
    theme['colors']['accent'] = '#abcdef'
    theme['status']['bitrate'] = '#123456'
    theme['progress']['thumb'] = '#fedcba'
    theme['footer']['background'] = '#010203'
    theme['footer']['translation'] = '#aaccee'
    theme['lyrics']['word'] = '#fabcde'
    theme['panels']['accounts']['background'] = '#001122'
    (root / 'theme-import.json').write_text(json.dumps(theme))
    run('--import-theme', root / 'theme-import.json', '--export-theme', root / 'roundtrip.json')
    assert json.loads((root / 'roundtrip.json').read_text()) == theme
    assert json.loads((app / 'themes' / 'My Night.json').read_text()) == theme
    run('--export-config', root / 'again.json')
    assert json.loads((app / 'theme.json').read_text()) == theme, 'config operation replaced active theme'
    previous_theme = (app / 'theme.json').read_bytes()
    theme['colors']['accent'] = '#xyzxyz'
    (root / 'theme-bad.json').write_text(json.dumps(theme))
    run('--import-theme', root / 'theme-bad.json', ok=False)
    assert (app / 'theme.json').read_bytes() == previous_theme
    run('--config', root / 'other.json', '--import-config', root / 'import.json')
    assert json.loads((root / 'other.json').read_text()) == config
    assert (app / 'config.json').read_bytes() == before
    theme['colors']['accent'] = '#abcdef'
    theme['progress']['thumb'] = 'red'
    (root/'theme-bad-role.json').write_text(json.dumps(theme))
    run('--import-theme',root/'theme-bad-role.json',ok=False)
    assert (app/'theme.json').read_bytes() == previous_theme
    run('--import-theme', ok=False)
    run('--unknown', ok=False)
print('Config smoke: JSON roundtrip, 23 named presets, custom themes, validation, preserved files and --config passed')
