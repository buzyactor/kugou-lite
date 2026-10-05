import test from 'node:test';
import assert from 'node:assert/strict';
import {playlistInfo,mergePlaylistDetail,nextSectionKind,playlistCount} from '../src/playlist-info.mjs';
import {playlists} from '../src/library.mjs';
import {publicPlaylists} from '../src/discovery.mjs';

test('private and public playlist metadata retains cover, tags, creator and introduction',()=>{
 const row={listid:42,global_collection_id:'collection_42',name:'<b>夜晚</b>',pic:'https://img.kugou.com/{size}/night.jpg',intro:'晚间音乐',tag_list:[{tag_name:'流行'},'夜晚','流行'],list_create_username:'DJ',song_count:90};
 const [privateList]=playlists({data:{info:[row]}});
 const [publicList]=publicPlaylists({data:{special_list:[{...row,specialname:row.name}]}});
 for(const list of [privateList,publicList]){
  assert.equal(list.title,'夜晚');assert.equal(list.cover,row.pic);assert.deepEqual(list.tags,['流行','夜晚']);assert.equal(list.creator,'DJ');assert.equal(list.description,'晚间音乐');
 }
 assert.equal(playlistInfo({intro:'safe\x1b[bad]'}).description.includes('\x1b'),false);
});
test('missing optional detail preserves list metadata and populated detail adds information',()=>{
 const base=playlistInfo({title:'Original',count:90,tags:['Pop'],cover:'https://img.kugou.com/original.jpg'});
 assert.deepEqual(mergePlaylistDetail(base,{data:{info:[]}}),base);
 const merged=mergePlaylistDetail(base,{data:{info:[{intro:'Full introduction',tags:['Chill'],nickname:'Editor'}]}});
 assert.equal(merged.title,'Original');assert.equal(merged.count,90);assert.equal(merged.description,'Full introduction');assert.deepEqual(merged.tags,['Chill']);assert.equal(merged.creator,'Editor');
 const actualShape=mergePlaylistDetail(base,{data:[{name:'Collection',flexible_cover:'https://img.kugou.com/detail.jpg',tags:[{name:'Pop, Chill'}]}]});
 assert.equal(actualShape.title,'Collection');assert.equal(actualShape.cover,'https://img.kugou.com/detail.jpg');assert.deepEqual(actualShape.tags,['Pop','Chill']);
});
test('recommend and discover start with songs and toggle between their two categories',()=>{
 assert.equal(nextSectionKind('recommend','daily'),'recommended');assert.equal(nextSectionKind('recommend','recommended'),'daily');
 assert.equal(nextSectionKind('discover','new'),'hires');assert.equal(nextSectionKind('discover','hires'),'new');assert.equal(nextSectionKind('discover','ranks'),'new');
 assert.equal(nextSectionKind('accounts','daily'),null);
});
test('recommendation counts use nested extra fields and distinguish unknown from empty',()=>{
 const rows=[{global_collection_id:'nested',specialname:'Nested',count:0,extra:{song_count:'73'}},{global_collection_id:'missing',specialname:'Unknown'},{global_collection_id:'empty',specialname:'Empty',song_count:0}];
 const lists=publicPlaylists({data:{special_list:rows}});
 assert.deepEqual(lists.map(r=>r.count),[73,null,0]);
 for(const value of [undefined,null,'',false,-1,NaN,Infinity,'not a number'])assert.equal(playlistCount({song_count:value}),null);
 assert.equal(playlistCount({song_count:12,count:9000}),12,'play/list counts must not override song count');
 assert.equal(playlistInfo({extra:{songcount:54}}).count,54);
 assert.equal(mergePlaylistDetail({count:90},{data:[{song_count:0}]}).count,0,'explicit empty detail is a valid update');
});

test('playlist cover prefers the collection image over uploader avatar and skips empty fields',()=>{
 assert.equal(playlistInfo({cover:'',flexible_cover:'http://c1.kgimg.com/custom/{size}/playlist.jpg',pic:'http://imge.kugou.com/avatar.jpg'}).cover,'http://c1.kgimg.com/custom/{size}/playlist.jpg');
 assert.equal(playlistInfo({flexible_cover:'',imgurl:'http://img.kugou.com/playlist.jpg',pic:'avatar'}).cover,'http://img.kugou.com/playlist.jpg');
});
test('playlist play totals survive detail hydration, preserve zero and stay separate from song counts',()=>{
 const base=playlistInfo({song_count:90,play_count:'196417',total_play_count:'35283026'});
 assert.equal(base.playCount,35283026);assert.equal(base.count,90);
 assert.equal(mergePlaylistDetail(base,{data:[{count:31,heat:0,per_count:0}]}).playCount,35283026);
 assert.equal(mergePlaylistDetail(base,{data:[{play_count:0}]}).playCount,0);
 assert.equal(playlistInfo({extra:{play_count:'12000'}}).playCount,12000);
 assert.equal(playlistInfo(base).playCount,35283026,'cached normalized details preserve plays');
 for(const play_count of [undefined,null,'',false,-1,Infinity,'x'])assert.equal(playlistInfo({play_count}).playCount,null);
 assert.equal(playlists({data:{info:[{listid:1,play_count:42}]}})[0].playCount,42);
 assert.equal(publicPlaylists({data:{special_list:[{global_collection_id:'id',play_count:10000}]}})[0].playCount,10000);
});
