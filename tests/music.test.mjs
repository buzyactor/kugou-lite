import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { searchTracks, playableUrl, resolveTrack, classifyPlayback, decodeAudio, Player } from '../src/music.mjs';

test('VIP selection uses explicit flags and filters invalid hashes', () => {
  const tracks = searchTracks({data:{lists:[
    {FileHash:'a'.repeat(32),AlbumPrivilege:10,PayType:3,Duration:240,SongName:'<em>Song</em>'},
    {FileHash:'b'.repeat(32),AlbumPrivilege:10,PayType:2},
    {FileHash:'bad',AlbumPrivilege:10,PayType:3},
  ]}});
  assert.equal(tracks.length,2); assert.equal(tracks[0].vip,true); assert.equal(tracks[1].vip,false); assert.equal(tracks[0].title,'Song');
});
test('full audio evidence rejects previews and cannot infer VIP from free tracks', () => {
  assert.equal(classifyPlayback({duration:240,vip:true},60).fullLength,false);
  assert.equal(classifyPlayback({duration:240,vip:true},239.9).verdict,'vip_full_audio_decoded');
  assert.equal(classifyPlayback({duration:0,vip:true},240).fullLength,false);
  assert.equal(classifyPlayback({duration:240,vip:false},240).verdict,'full_audio_decoded_not_vip_proof');
});
test('resolution never requests free_part and rejects unsafe or preview URL', async () => {
  await resolveTrack(async route => { assert.ok(!route.includes('free_part')); return {url:['https://fs.kugou.com/test.mp3']}; }, {hash:'a'.repeat(32),albumId:'1',audioId:'2'});
  for (const url of ['file:///etc/passwd','https://example.com/a','https://kugou.com.evil.com/a']) assert.throws(()=>playableUrl({url:[url]}));
  assert.throws(()=>playableUrl({url:['https://fs.kugou.com/a'],is_free_part:1}));
});
test('real ffmpeg decodes complete local audio', {timeout:15000}, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kugou-decode-'));
  try {
    const file = path.join(dir, 'tone.wav');
    assert.equal(spawnSync('ffmpeg', ['-v','error','-f','lavfi','-i','sine=frequency=440:duration=4',file]).status, 0);
    assert.ok(Math.abs(await decodeAudio(file) - 4) < 0.1);
  } finally { await rm(dir, {recursive:true,force:true}); }
});
test('mpv loads, pauses, seeks and stops via IPC', {timeout:15000}, async t => {
  const dir=await mkdtemp(path.join(tmpdir(),'kugou-audio-'));
  let player;
  try {
    const file=path.join(dir,'tone.wav');
    const generated=spawnSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=4',file]);
    assert.equal(generated.status,0);
    assert.ok(Math.abs(await decodeAudio(file)-4)<0.1);
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('mpv IPC timeout')),7000);
      player=new Player(message=>{
        if(message.includes('环境禁止')) { clearTimeout(timer);t.skip('沙箱拒绝 mpv IPC 写入 EPERM，需要本机验证');resolve();return; }
        if(message==='已载入音频，开始播放') player.pause();
        if(message==='已暂停') player.seek(2);
        if(message.includes('失败')||message.includes('无法')) {clearTimeout(timer);reject(new Error(message));}
      }, {silent:true,onSeek:seconds=>{try{assert.ok(Math.abs(seconds-2)<0.3);clearTimeout(timer);resolve();}catch(error){clearTimeout(timer);reject(error);}}});
      player.play(file);
    });
    player.stop(); assert.equal(player.child,null);
  } finally {player?.stop();await rm(dir,{recursive:true,force:true});}
});
