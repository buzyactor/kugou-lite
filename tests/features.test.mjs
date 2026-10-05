import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {parseKrc,parseLrc,loadLyrics,selectExternalLyrics} from '../src/library.mjs';
import {resolveTrack,inspectAudio,requireLossless,Player} from '../src/music.mjs';
import {Accounts} from '../src/accounts.mjs';

test('KRC translation payload attaches without inventing missing translation',()=>{
 const payload=Buffer.from(JSON.stringify({content:[{type:1,lyricContent:[['','你好']]}]})).toString('base64');
 assert.equal(parseKrc(`[language:${payload}]\n[100,200]<0,200,0>Hello`)[0].translation,'你好');
 assert.equal(parseKrc('[language:broken]\n[100,200]<0,200,0>Hello')[0].translation,undefined);
});
test('external lyrics require matching title artist and duration; no account headers',async()=>{
 const track={title:'Hello',artist:'Singer',duration:120,hash:'a'.repeat(32),audioId:'1'};
 const wrong={trackName:'Hello',artistName:'Other',duration:120,syncedLyrics:'[00:01]Wrong'};
 const valid={...wrong,artistName:'Singer',syncedLyrics:'[00:01.25]Hello'};
 assert.equal(selectExternalLyrics([wrong],track),null);
 const lines=await loadLyrics(async()=>({candidates:[]}),track,async(url,options)=>{
  assert.ok(url.startsWith('https://lrclib.net/api/search?'));assert.ok(!JSON.stringify(options.headers).toLowerCase().includes('cookie'));
  return {ok:true,json:async()=>[wrong,valid]};
 });
 assert.equal(lines[0].start,1250);assert.equal(lines[0].lineTimed,true);assert.equal(lines[0].source,'LRCLIB · 行同步');
});
test('FLAC request uses SQ hash and never asks for MP3',async()=>{
 await resolveTrack(async route=>{const p=new URL(route,'http://localhost').searchParams;assert.equal(p.get('quality'),'flac');assert.equal(p.get('hash'),'b'.repeat(32));return {url:['https://fs.kugou.com/stream.mp3']};},{hash:'a'.repeat(32),flacHash:'b'.repeat(32),albumId:'1',audioId:'2'});
 assert.throws(()=>requireLossless({codec:'mp3'}),/不满足/);
});
test('actual codec verification ignores misleading filename suffix',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'kugou-codec-'));
 try{
  const file=path.join(dir,'misleading.mp3');
  assert.equal(spawnSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=duration=0.2','-c:a','flac','-f','flac',file]).status,0);
  const info=await inspectAudio(file);assert.equal(info.codec,'flac');assert.equal(requireLossless(info).codec,'flac');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('username survives login refresh, concurrent writes and restart',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'kugou-name-'));
 try{
  const store=new Accounts(dir);await store.save({userid:'12345',token:'first'});
  await Promise.all([store.setName('12345','用户甲'),store.save({userid:'67890',token:'second'})]);
  await store.save({userid:'12345',token:'new'});
  const result=await new Accounts(dir).summary();assert.equal(result[0].username,'用户甲');assert.ok(result[0].label.includes('用户甲'));
  assert.ok(!JSON.stringify(result).includes('token'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('volume clamps values and writes mpv property command',()=>{
 const player=new Player(()=>{});const writes=[];
 player.child={stdio:{3:{write:text=>writes.push(JSON.parse(text))}}};
 player.setVolume(110);assert.equal(player.volume,100);assert.deepEqual(writes[0].command,['set_property','volume',100]);
 player.setVolume(-10);assert.equal(player.volume,0);player.child=null;
});
