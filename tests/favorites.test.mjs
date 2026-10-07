import test from 'node:test';
import assert from 'node:assert/strict';
import {Favorites,uniqueTracks} from '../src/favorites.mjs';
import {favoriteParams} from '../src/library.mjs';
const track=i=>({hash:String(i).padStart(32,'a'),title:'Name,|'+i,artist:'Artist',albumId:'2',audioId:String(i)});
const raw=(i,fileid)=>({hash:track(i).hash,filename:'Artist - Song',mixsongid:String(i),album_id:'2',fileid});
const list={listid:'42',type:0,ownerId:'7',isMine:0,title:'Mine'};
test('membership tolerates missing audio IDs and quality hashes; invalid IDs cannot corrupt batch parameters',async()=>{
 const service=new Favorites(),row=raw(1,'22');delete row.mixsongid;
 const existing=await service.inspect(async()=>({data:{info:[row]}}),'7',list,[track(1)]);
 assert.equal(existing.existing.length,1);assert.equal(existing.missing.length,0);
 const sq=track(2);sq.flacHash=track(1).hash;
 assert.equal((await service.inspect(async()=>({data:{info:[row]}}),'7',list,[sq])).existing.length,1);
 assert.throws(()=>favoriteParams({...track(1),audioId:'1|2'},'42'));
 assert.throws(()=>favoriteParams({...track(1),albumId:'1,2'},'42'));
 assert.equal(uniqueTracks([{...track(1),flacHash:'0'.repeat(32)},{...track(2),flacHash:'0'.repeat(32)}]).length,2);
});
test('favorites inspect all pages, skip already present songs and remove only cloud fileids',async()=>{
 const service=new Favorites(),calls=[];let rows=Array.from({length:31},(_,i)=>raw(i+1,String(500+i)));
 const request=async route=>{
  calls.push(route);const url=new URL(route,'https://local');
  if(url.pathname==='/playlist/track/all/new'){const p=Number(url.searchParams.get('page'));return {data:{info:rows.slice((p-1)*30,p*30)}};}
  if(url.pathname==='/playlist/tracks/add'){
   const data=url.searchParams.get('data');assert.equal(data.split(',').length,1);assert.equal(data.split('|').length,4);
   rows.push(raw(32,'900'));return {status:1};
  }
  if(url.pathname==='/playlist/tracks/del'){
   assert.equal(url.searchParams.get('fileids'),'530,900');rows=rows.filter(r=>!['530','900'].includes(r.fileid));return {status:1};
  }throw Error('unexpected');
 };
 const state=await service.inspect(request,'7',list,[track(31),track(32),track(32)]);
 assert.equal(calls.length,2);assert.equal(state.existing.length,1);assert.equal(state.missing.length,1);
 assert.equal((await service.apply(request,state,'add')).verified,true);
 const updated=await service.inspect(request,'7',list,[track(31),track(32)]);
 assert.equal((await service.apply(request,updated,'remove')).verified,true);
 assert.equal(calls.filter(r=>r.startsWith('/playlist/tracks/')).length,2);
});
test('unwritable collections, unknown membership and missing fileids never mutate; write timeout never retries',async()=>{
 const service=new Favorites();let calls=0;
 const read=async()=>{calls++;return {data:{info:[raw(1,undefined)]}};};
 await assert.rejects(service.inspect(read,'7',{...list,type:1},[track(1)]));assert.equal(calls,0);
 await assert.rejects(service.inspect(read,'8',list,[track(1)]));assert.equal(calls,0);
 const state=await service.inspect(read,'7',list,[track(1)]);
 await assert.rejects(service.apply(read,state,'remove'),/fileid/);assert.equal(calls,1);
 const missing=await service.inspect(async()=>({data:{info:[]}}),'7',list,[track(1)]);
 let writes=0;await assert.rejects(service.apply(async()=>{writes++;throw Error('timeout');},missing,'add'),/timeout/);assert.equal(writes,1);
 await assert.rejects(service.inspect(async()=>({data:{info:'invalid'}}),'7',list,[track(1)]));
});

test('owned directory lists accept is_mine zero or false while rejecting another owner',async()=>{
 const service=new Favorites();
 for(const isMine of [0,'0',false]){
  const state=await service.inspect(async()=>({data:{info:[]}}),'7',{...list,isMine},[track(1)]);
  assert.equal(state.missing.length,1);
  await assert.rejects(service.inspect(()=>{throw Error('must not read');},'8',{...list,isMine},[track(1)]),/自己创建/);
 }
});
