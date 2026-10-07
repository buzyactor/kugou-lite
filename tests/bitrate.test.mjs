import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {Player} from '../src/music.mjs';

test('mpv emits live packet bitrate and clears it on stop', {timeout:12000}, async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'kugou-bitrate-'));
 const rates=[];let player;
 try {
  const file=path.join(directory,'tone.flac');
  assert.equal(spawnSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=6','-c:a','flac',file]).status,0);
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('mpv did not report audio-bitrate')),8000);
   player=new Player(message=>{if(/禁止|失败|无法/.test(message)){clearTimeout(timer);reject(new Error(message));}},
    {silent:true,onBitRate:value=>{rates.push(value);if(Number.isFinite(value)&&value>0){clearTimeout(timer);resolve();}}});
   player.play(file);
  });
  assert.ok(rates.some(value=>Number.isFinite(value)&&value>0));
  player.stop();assert.equal(rates.at(-1),null);
 }finally{player?.stop();await rm(directory,{recursive:true,force:true});}
});

test('real mpv reports invalid media once; manual stop and normal EOF do not report failures', {timeout:12000},async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'kugou-player-failure-'));
 const failures=[];let player;
 try{
  const invalid=path.join(directory,'invalid.flac');await writeFile(invalid,'invalid audio');
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('mpv failure callback missing')),4000);
   player=new Player(()=>{},{silent:true,onFailure:error=>{failures.push(error);clearTimeout(timer);resolve();}});
   player.play(invalid);
  });
  await new Promise(resolve=>setTimeout(resolve,50));
  assert.deepEqual(failures,[{playbackFatal:false}]);
  const valid=path.join(directory,'tone.flac');
  assert.equal(spawnSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=0.25','-c:a','flac',valid]).status,0);
  player.play(valid);player.stop();await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal(failures.length,1);
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('normal mpv EOF missing')),4000);
   player.onEnded=()=>{clearTimeout(timer);resolve();};player.play(valid);
  });
  assert.equal(failures.length,1);
 }finally{player?.stop();await rm(directory,{recursive:true,force:true});}
});
