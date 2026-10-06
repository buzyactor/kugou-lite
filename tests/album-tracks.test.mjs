import test from 'node:test';
import assert from 'node:assert/strict';
import {albumTracks} from '../src/album-tracks.mjs';
const raw=Array.from({length:65},(_,i)=>({hash:'a'+String(i).padStart(31,'0'),songname:'song'+i,singername:'Artist',album_id:'1',album_audio_id:String(i)}));
test('album API pages remain 30 rows while viewport pages cross API boundaries',async()=>{
 const requests=[];
 const request=async route=>{
  const params=new URL(route,'https://local').searchParams;
  const p=Number(params.get('page')),size=Number(params.get('pagesize'));
  requests.push([p,size]);assert.equal(size,30);
  return {data:{songs:raw.slice((p-1)*size,p*size)}};
 };
 assert.deepEqual((await albumTracks(request,'1',2,20)).map(r=>r.title),raw.slice(20,40).map(r=>r.songname));
 assert.deepEqual(requests,[[1,30],[2,30]]);requests.length=0;
 assert.equal((await albumTracks(request,'1',1,100)).length,65);
 assert.deepEqual(requests,[[1,30],[2,30],[3,30]]);
 assert.equal((await albumTracks(request,'1',4,20)).length,5);
 await assert.rejects(albumTracks(request,'invalid',1,20));
});
