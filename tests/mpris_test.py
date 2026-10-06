import contextlib
import importlib.util
import io
import json
import unittest
from types import SimpleNamespace
from pathlib import Path
spec = importlib.util.spec_from_file_location('mpris', Path(__file__).resolve().parents[1] / 'tools/mpris.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class MprisTests(unittest.TestCase):
    def setUp(self):
        self.service = m.Service.__new__(m.Service)
        self.service.state = {'status': 'Stopped', 'volume': 70, 'seconds': 0, 'track': None, 'loaded': False}
        self.signals=[]
        self.service.PropertiesChanged=lambda *args:self.signals.append(args)

    def test_metadata_types_and_no_position_signal(self):
        self.service.update({'track':{'hash':'a'*32,'title':'歌曲','artist':'歌手','duration':120},'status':'Playing','loaded':True})
        props=self.service.GetAll(m.PLAYER)
        self.assertIsInstance(props['Metadata']['mpris:trackid'],m.dbus.ObjectPath)
        self.assertIsInstance(props['Metadata']['mpris:length'],m.dbus.Int64)
        self.assertEqual(props['Metadata']['mpris:length'],120000000)
        self.assertTrue(props['CanPause'])
        self.signals.clear()
        self.service.update({'seconds':10.2})
        self.assertFalse(self.signals)
        self.assertEqual(self.service.Get(m.PLAYER,'Position'),10200000)

    def test_introspection_and_queue_capabilities(self):
        self.assertEqual(self.service.Get(m.ROOT,'DesktopEntry'),'kugou-lite')
        xml=self.service.Introspect('/org/mpris/MediaPlayer2',SimpleNamespace(list_exported_child_objects=lambda _:[]))
        node=m.ET.fromstring(xml)
        interface=node.find("interface[@name='org.mpris.MediaPlayer2.Player']")
        self.assertEqual(interface.find("property[@name='Volume']").get('access'),'readwrite')
        self.service.update({'next':True,'previous':False})
        output=io.StringIO()
        with contextlib.redirect_stdout(output):
            self.service.Next()
            self.service.Previous()
            self.service.update({'busy':True})
            self.service.Next()
        self.assertEqual([json.loads(line)['command'] for line in output.getvalue().splitlines()],['nexttrack'])

    def test_seek_validation_actual_confirmation_and_cover(self):
        self.service.update({'track':{'hash':'a'*32,'title':'歌曲','artist':'歌手','duration':120},'loaded':True,'seekable':True,'seconds':20,'artUrl':'file:///tmp/cover.png'})
        self.assertEqual(self.service.Get(m.PLAYER,'Metadata')['mpris:artUrl'],'file:///tmp/cover.png')
        self.assertTrue(self.service.Get(m.PLAYER,'CanSeek'))
        track=self.service.Get(m.PLAYER,'Metadata')['mpris:trackid']
        output=io.StringIO()
        with contextlib.redirect_stdout(output):
            self.service.SetPosition(track,45000000)
            self.service.SetPosition('/stale',45000000)
            self.service.SetPosition(track,-1)
            self.service.SetPosition(track,121000000)
            self.service.Seek(-10000000)
            self.service.update({'busy':True})
            self.service.SetPosition(track,60000000)
        self.assertEqual([json.loads(line)['command'] for line in output.getvalue().splitlines()],['seekto:'+'a'*32+':45.0','seekby:'+'a'*32+':-10.0'])
        confirmed=[]
        self.service.Seeked=lambda value:confirmed.append(value)
        self.service.update({'seconds':45.2,'seeked':45.2})
        self.assertEqual(confirmed,[45200000])
        self.assertNotIn('seeked',self.service.state)
        self.service.update({'artUrl':''})
        self.assertNotIn('mpris:artUrl',self.service.Get(m.PLAYER,'Metadata'))

    def test_volume_and_controls(self):
        output=io.StringIO()
        with contextlib.redirect_stdout(output):
            self.service.Set(m.PLAYER,'Volume',0.35)
            self.service.PlayPause()
            self.service.Pause()
        commands=[json.loads(line)['command'] for line in output.getvalue().splitlines()]
        self.assertEqual(commands,['volume:35.0','resume','setpause'])
        self.service.update({'volume':35,'status':'Paused'})
        self.assertEqual(self.service.Get(m.PLAYER,'Volume'),0.35)
        self.assertEqual(self.signals[-1][1]['PlaybackStatus'],'Paused')
        with self.assertRaises(m.dbus.exceptions.DBusException):
            self.service.Set(m.PLAYER,'Metadata',{})

if __name__=='__main__':
    unittest.main()
