import test from 'node:test';import assert from 'node:assert/strict';
import {UserPlaylists,playlistGroup} from '../src/user-playlists.mjs';
test('owned and collected directories are separated before local pagination and cached',async()=>{
 const library=new UserPlaylists();const calls=[];
 const request=async route=>{calls.push(route);return {data:{info:route.includes('page=1&')?Array.from({length:100},(_,i)=>({listid:i+1,name:'List'+i,type:1,list_create_userid:'other'})):Array.from({length:5},(_,i)=>({listid:101+i,name:'Mine'+i,type:0,list_create_userid:'me'}))}};};
 const mine=await library.page(request,'me','created',1,3);assert.deepEqual(mine.map(r=>r.title),['Mine0','Mine1','Mine2']);
 assert.deepEqual((await library.page(request,'me','created',2,3)).map(r=>r.title),['Mine3','Mine4']);
 assert.equal((await library.page(request,'me','collected',2,30)).length,30);assert.equal(calls.length,2);
 library.clear();await library.page(request,'me','created',1,3);assert.equal(calls.length,4);
 assert.equal(playlistGroup({type:'1',ownerId:'me'},'me'),'collected');assert.equal(playlistGroup({type:0,ownerId:'other'},'me'),'collected');
});
test('failed, repeated and invalidated directory reads do not cache partial results',async()=>{
 const library=new UserPlaylists();const rows=Array.from({length:100},(_,i)=>({listid:i+1}));
 await assert.rejects(library.page(async()=>({data:{info:rows}}),'me','created',1,20),/重复/);assert.equal(library.rows,null);
 await assert.rejects(library.page(async()=>{library.clear();return {data:{info:[]}};},'me','created',1,20),/取消/);assert.equal(library.rows,null);
});
