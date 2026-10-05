#!/usr/bin/env python3
"""Session-local MPRIS bridge. No credentials or stream URLs cross D-Bus."""
import json
import math
import os
import sys
import xml.etree.ElementTree as ET
import dbus
import dbus.service
from dbus.mainloop.glib import DBusGMainLoop
from gi.repository import GLib

ROOT = 'org.mpris.MediaPlayer2'
PLAYER = ROOT + '.Player'
PROPS = 'org.freedesktop.DBus.Properties'

def command(value):
    print(json.dumps({'command': value}), flush=True)

class Service(dbus.service.Object):
    def __init__(self, bus):
        self.name = dbus.service.BusName(ROOT + '.kugou_lite', bus, do_not_queue=True)
        super().__init__(bus, '/org/mpris/MediaPlayer2')
        self.state = {'status': 'Stopped', 'volume': 70, 'seconds': 0, 'track': None, 'loaded': False}

    def properties(self, interface):
        if interface == ROOT:
            return {'Identity': 'Kugou Lite', 'CanQuit': False, 'CanRaise': False,
                    'HasTrackList': False, 'SupportedUriSchemes': dbus.Array([], signature='s'),
                    'SupportedMimeTypes': dbus.Array([], signature='s')}
        if interface != PLAYER:
            raise dbus.exceptions.DBusException('Unknown interface', name='org.freedesktop.DBus.Error.InvalidArgs')
        s = self.state
        t = s.get('track')
        metadata = dbus.Dictionary({}, signature='sv')
        if t:
            metadata.update({'mpris:trackid': dbus.ObjectPath('/org/mpris/MediaPlayer2/track/t' + t['hash']),
                             'xesam:title': t['title'], 'xesam:artist': dbus.Array([t['artist']], signature='s'),
                             'mpris:length': dbus.Int64(round(t.get('duration', 0) * 1000000))})
        if t and s.get('artUrl'):
            metadata['mpris:artUrl'] = s['artUrl']
        return {'PlaybackStatus': s['status'], 'LoopStatus': s.get('loop','None'), 'Shuffle': s.get('shuffle',False), 'Rate': dbus.Double(1),
                'MinimumRate': dbus.Double(1), 'MaximumRate': dbus.Double(1),
                'Metadata': metadata, 'Volume': dbus.Double(s['volume'] / 100),
                'Position': dbus.Int64(round(s['seconds'] * 1000000)),
                'CanGoNext': s.get('next', False) and not s.get('busy', False), 'CanGoPrevious': s.get('previous', False) and not s.get('busy', False), 'CanPlay': bool(t),
                'CanPause': s['loaded'], 'CanSeek': s['loaded'] and s.get('seekable', False) and not s.get('busy', False), 'CanControl': True}

    @dbus.service.method('org.freedesktop.DBus.Introspectable', in_signature='', out_signature='s', path_keyword='object_path', connection_keyword='connection')
    def Introspect(self, object_path, connection):
        node = ET.fromstring(super().Introspect(object_path, connection))
        definitions = {
            ROOT: {'Identity': 's', 'CanQuit': 'b', 'CanRaise': 'b', 'HasTrackList': 'b',
                   'SupportedUriSchemes': 'as', 'SupportedMimeTypes': 'as'},
            PLAYER: {'LoopStatus': 's', 'Shuffle': 'b', 'PlaybackStatus': 's', 'Rate': 'd', 'MinimumRate': 'd', 'MaximumRate': 'd',
                     'Metadata': 'a{sv}', 'Volume': 'd', 'Position': 'x', 'CanGoNext': 'b',
                     'CanGoPrevious': 'b', 'CanPlay': 'b', 'CanPause': 'b', 'CanSeek': 'b', 'CanControl': 'b'}}
        for name, props in definitions.items():
            interface = next((i for i in node.findall('interface') if i.get('name') == name), None)
            if interface is None:
                interface = ET.SubElement(node, 'interface', name=name)
            for key, signature in props.items():
                ET.SubElement(interface, 'property', name=key, type=signature,
                              access='readwrite' if key in ('Rate', 'Volume', 'LoopStatus', 'Shuffle') else 'read')
        return ET.tostring(node, encoding='unicode')

    @dbus.service.method(PROPS, in_signature='s', out_signature='a{sv}')
    def GetAll(self, interface):
        return self.properties(interface)

    @dbus.service.method(PROPS, in_signature='ss', out_signature='v')
    def Get(self, interface, name):
        props = self.properties(interface)
        if name not in props:
            raise dbus.exceptions.DBusException('Unknown property', name='org.freedesktop.DBus.Error.InvalidArgs')
        return props[name]

    @dbus.service.method(PROPS, in_signature='ssv', out_signature='')
    def Set(self, interface, name, value):
        if interface == PLAYER and name == 'Volume' and math.isfinite(float(value)):
            command('volume:' + str(max(0, min(100, float(value) * 100))))
        elif interface == PLAYER and name == 'LoopStatus' and value in ('None','Track','Playlist'):
            command('mode:' + {'None':'sequence','Track':'single','Playlist':'loop'}[value])
        elif interface == PLAYER and name == 'Shuffle':
            command('mode:' + ('shuffle' if bool(value) else 'sequence'))
        elif interface == PLAYER and name == 'Rate' and float(value) == 1:
            return
        else:
            raise dbus.exceptions.DBusException('Property is not writable', name='org.freedesktop.DBus.Error.PropertyReadOnly')

    @dbus.service.signal(PROPS, signature='sa{sv}as')
    def PropertiesChanged(self, interface, changed, invalidated):
        pass

    @dbus.service.method(PLAYER)
    def PlayPause(self):
        command('pause' if self.state['loaded'] else 'resume')

    @dbus.service.method(PLAYER)
    def Play(self):
        command('resume')

    @dbus.service.method(PLAYER)
    def Pause(self):
        command('setpause')

    @dbus.service.method(PLAYER)
    def Stop(self):
        command('stop')

    @dbus.service.method(PLAYER)
    def Next(self):
        if self.Get(PLAYER, 'CanGoNext'):
            command('nexttrack')

    @dbus.service.method(PLAYER)
    def Previous(self):
        if self.Get(PLAYER, 'CanGoPrevious'):
            command('prevtrack')

    @dbus.service.method(PLAYER, in_signature='x')
    def Seek(self, offset):
        if not self.Get(PLAYER, 'CanSeek'):
            return
        track = self.state['track']
        if self.state['seconds'] + int(offset) / 1000000 > track.get('duration', 0):
            self.Next()
            return
        command('seekby:' + track['hash'] + ':' + str(int(offset) / 1000000))

    @dbus.service.method(PLAYER, in_signature='ox')
    def SetPosition(self, track, position):
        if not self.Get(PLAYER, 'CanSeek'):
            return
        metadata = self.Get(PLAYER, 'Metadata')
        if track != metadata['mpris:trackid'] or position < 0 or position > metadata['mpris:length']:
            return
        command('seekto:' + self.state['track']['hash'] + ':' + str(int(position) / 1000000))

    @dbus.service.signal(PLAYER, signature='x')
    def Seeked(self, position):
        pass

    def update(self, state):
        before = self.properties(PLAYER)
        state = dict(state)
        seeked = state.pop('seeked', None)
        self.state.update(state)
        after = self.properties(PLAYER)
        changed = {k: v for k, v in after.items() if k != 'Position' and v != before[k]}
        if changed:
            self.PropertiesChanged(PLAYER, changed, [])
        if seeked is not None:
            self.Seeked(dbus.Int64(round(seeked * 1000000)))

def main():
    DBusGMainLoop(set_as_default=True)
    service = Service(dbus.SessionBus())
    loop = GLib.MainLoop()
    pending = bytearray()
    def read_input(fd, condition):
        chunk = os.read(fd, 65536)
        if not chunk:
            loop.quit()
            return False
        pending.extend(chunk)
        while b'\n' in pending:
            line, _, rest = pending.partition(b'\n')
            pending[:] = rest
            service.update(json.loads(line))
        return True
    GLib.io_add_watch(sys.stdin.fileno(), GLib.IO_IN | GLib.IO_HUP, read_input)
    print(json.dumps({'ready': True}), flush=True)
    loop.run()

if __name__ == '__main__':
    main()
