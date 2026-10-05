import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {songRows,cacheCover} from '../src/library.mjs';
import {Discovery,publicPlaylists,ranks} from '../src/discovery.mjs';
import {nextIndex} from '../src/playback-options.mjs';
import {resolveTrack,Player} from '../src/music.mjs';
const hash='a'.repeat(32);

test('playlist display filename is separate from audio quality and artist',()=>{
 const [song]=songRows([{hash,name:'歌手 - 歌曲.mp3',timelen:183000,sqhash:'b'.repeat(32)}]);
 assert.equal(song.title,'歌曲');assert.equal(song.artist,'歌手');assert.equal(song.duration,183);assert.equal(song.flacHash,'b'.repeat(32));
 const [rank]=songRows([{audio_info:{hash_128:hash,hash_flac:'b'.repeat(32),audio_name:'歌手 - 榜单歌.flac',duration:200000,album_audio_id:42},album_info:{sizable_cover:'https://img.kugou.com/{size}/cover.jpg'}}]);
 assert.equal(rank.title,'榜单歌');assert.equal(rank.duration,200);assert.equal(rank.audioId,'42');assert.ok(rank.cover.includes('{size}'));
 assert.equal(songRows([{hash,songname:'Unknown artist song'}])[0].artist,'未知歌手');
});
test('discovery uses account-scoped finite cache and server paging with public collection IDs',async()=>{
 const service=new Discovery();let calls=0;
 const daily=async()=>{calls++;return {data:{song_list:[1,2,3].map(i=>({hash,ori_audio_name:'歌曲'+i,author_name:'歌手',time_length:180}))}};};
 assert.equal((await service.load(daily,'daily',1,2)).length,2);
 assert.equal((await service.load(daily,'daily',2,2))[0].title,'歌曲3');assert.equal(calls,1);
 service.clear();await service.load(daily,'daily',1,2);assert.equal(calls,2);
 const [list]=publicPlaylists({data:{special_list:[{global_collection_id:'collection_3_123_0',specialname:'精选',songcount:8}]}});
 assert.equal(list.publicId,'collection_3_123_0');
 await service.load(async route=>{assert.equal(route,'/playlist/track/all?id=collection_3_123_0&page=2&pagesize=47');return {data:{songs:[]}};},'public',2,47,list.publicId);
 await service.load(async route=>{assert.ok(route.includes('category_id=11292'));return {data:{special_list:[]}};},'hires',1,47);
 assert.equal(ranks({data:{info:[{rankid:1,rankname:'热歌榜'}]}})[0].rankId,'1');
 await assert.rejects(service.load(async()=>({data:{}}),'new',1,20),/格式异常/);
});
test('catalog hydrates actual counts in batches of ten and clears per-account detail cache',async()=>{
 const service=new Discovery();let batches=0;
 const request=async route=>{
  if(route.startsWith('/top/playlist'))return {data:{special_list:Array.from({length:23},(_,i)=>({global_collection_id:'collection_'+i,specialname:'List '+i,songcount:0}))}};
  const ids=new URL(route,'https://local').searchParams.get('ids').split(',');assert.ok(ids.length<=10);batches++;
  return {data:ids.map(id=>({global_collection_id:id,count:101+Number(id.split('_')[1])}))};
 };
 const lists=await service.load(request,'recommended',1,23);
 assert.equal(batches,3);assert.deepEqual(lists.map(r=>r.count),Array.from({length:23},(_,i)=>101+i));
 await service.load(request,'recommended',1,23);assert.equal(batches,3);
 service.clear();await service.load(request,'hires',1,23);assert.equal(batches,6);
 const failed=await new Discovery().load(async route=>{if(route.startsWith('/playlist/detail'))throw new Error('unavailable');return {data:{special_list:[{global_collection_id:'collection_a',specialname:'Usable',songcount:0}]}};},'recommended',1,1);
 assert.equal(failed[0].title,'Usable');assert.equal(failed[0].count,null);
});
test('MPRIS cover is a private readable local PNG URI',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'kugou-art-'));
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGN8AAAAASUVORK5CYII=';
 try{
  const uri=await cacheCover(dir,hash,png);assert.ok(uri.startsWith('file:///'));
  assert.equal((await readFile(new URL(uri))).toString('base64'),png);
  assert.equal((await stat(new URL(uri))).mode&0o777,0o600);
  assert.equal(await cacheCover(dir,'../escape',png),'');
  assert.equal(await cacheCover(dir,hash,Buffer.from('not an image').toString('base64')),'');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('play order end boundaries and manual skip behavior',()=>{
 assert.equal(nextIndex(2,3,'sequence',1,true),null);
 assert.equal(nextIndex(2,3,'loop',1,true),0);
 assert.equal(nextIndex(1,3,'single',1,true),1);
 assert.equal(nextIndex(1,3,'single',1,false),2);
 assert.equal(nextIndex(0,3,'sequence',-1),null);
 assert.equal(nextIndex(0,3,'loop',-1),2);
 assert.equal(nextIndex(1,3,'shuffle',1,true,()=>0),2);
 assert.equal(nextIndex(-1,0,'loop'),null);
});
test('explicit MP3 quality selects original hash; FLAC remains default',async()=>{
 const track={hash,flacHash:'b'.repeat(32),albumId:'1',audioId:'2'};
 await resolveTrack(async route=>{const p=new URL(route,'https://local').searchParams;assert.equal(p.get('quality'),'320');assert.equal(p.get('hash'),hash);return {url:['https://fs.kugou.com/test']};},track,'320');
 const player=new Player(()=>{});const writes=[];
 player.child={stdio:{3:{write:line=>writes.push(JSON.parse(line))}}};
 player.seek(80);player.seek(-10,false);player.seek(NaN);
 assert.deepEqual(writes.map(r=>r.command),[['seek',80,'absolute+exact'],['seek',-10,'relative+exact']]);
 player.child=null;
});
