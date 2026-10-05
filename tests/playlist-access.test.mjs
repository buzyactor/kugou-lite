import test from 'node:test';
import assert from 'node:assert/strict';
import {playlists} from '../src/library.mjs';
import {playlistTracks} from '../src/playlist-access.mjs';
import {unwrapRequest} from '../src/direct-api.mjs';
import {publicPlaylists} from '../src/discovery.mjs';
const failure=()=>Object.assign(new Error('读取失败'),{businessCode:20017});
test('preserve personal and global IDs; collected playlists read global collection',async()=>{
 const [list]=playlists({data:{info:[{listid:99,list_create_gid:'collection_3_123_1',list_create_userid:123,type:1,name:'收藏歌单'}]}});
 assert.equal(list.publicId,'collection_3_123_1');assert.equal(list.ownerId,'123');
 const calls=[];
 await playlistTracks(async route=>{calls.push(route);return {data:{songs:[]}};},list,2,37);
 assert.deepEqual(calls,['/playlist/track/all?id=collection_3_123_1&page=2&pagesize=37']);
});
test('20017 requires authentication instead of retrying another playlist endpoint',async()=>{
 const calls=[];
 await assert.rejects(playlistTracks(async route=>{calls.push(route);throw failure();},{listid:'99',publicId:'collection_3_123_1',type:0},1,20),e=>e.businessCode===20017);
 assert.equal(calls.length,1);assert.ok(calls[0].startsWith('/playlist/track/all/new?'));
});
test('preserve sanitized business code without exposing upstream secrets',async()=>{
 await assert.rejects(unwrapRequest(async()=>{throw {body:{error_code:20017,message:'token=secret'}};}),e=>e.businessCode===20017&&!e.message.includes('secret'));
 assert.equal(publicPlaylists({data:{special_list:[{specialid:123,specialname:'No global id'}]}}).length,0);
});
