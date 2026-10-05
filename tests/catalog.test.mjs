import test from 'node:test';import assert from 'node:assert/strict';
import {searchRows,catalogSearch,artistInfo,artistSongs,ArtistCatalog,heatShares,numeric} from '../src/catalog.mjs';
import {songRows} from '../src/library.mjs';
const hash=i=>i.toString(16).padStart(32,'0');
const audio=i=>({hash:hash(i),hash_flac:hash(i+1000),audio_name:'Song'+i,author_name:'Singer',album_id:10,album_audio_id:i,timelength:200000,privilege:10,pay_type:3,playcount:i});
test('four search categories retain safe IDs and normalize the actual upstream shapes',async()=>{
 const artist=searchRows({data:{lists:[{AuthorId:12,AuthorName:'<b>Singer</b>',Avatar:'https://singerimg.kugou.com/a.jpg',FirstFrameImage:'https://singerimg.kugou.com/b.jpg',FansNum:12345,AudioCount:8}]}},'artist')[0];assert.equal(artist.artistId,'12');assert.equal(artist.title,'Singer');assert.equal(artist.photos.length,2);
 const album=searchRows({data:{lists:[{albumid:20,albumname:'Album',img:'https://imge.kugou.com/a.jpg',singer:'Singer',songcount:10,publish_time:'2025'}]}},'album')[0];assert.equal(album.albumId,'20');assert.equal(album.count,10);
 const playlist=searchRows({data:{lists:[{gid:'collection_20',specialname:'List',nickname:'Creator',song_count:42,img:'https://imge.kugou.com/a.jpg'}]}},'playlist')[0];assert.equal(playlist.publicId,'collection_20');assert.equal(playlist.creator,'Creator');assert.equal(playlist.count,42);
 await catalogSearch(async route=>{const url=new URL(route,'http://local');assert.equal(url.searchParams.get('type'),'author');assert.equal(url.searchParams.get('page'),'2');return {data:{lists:[]}};},'Singer','artist',2,30);
 await assert.rejects(catalogSearch(()=>{},'','song',1,30),/无效/);
});
test('artist gallery deduplicates sized photos, long prose preserves line breaks and missing metrics stay unknown',()=>{
 const info=artistInfo({data:{author_id:12,author_name:'Singer',sizable_avatar:'https://singerimg.kugou.com/softhead/{size}/a.jpg',photos:[{url:'https://singerimg.kugou.com/b.jpg'}],birthday:'2000-01-01',fansnums:10,long_intro:[{title:'基本资料',content:'<b>First</b>\\nSecond\nThird\x1b'}]}},{photos:['https://singerimg.kugou.com/softhead/240/a.jpg']});
 assert.equal(info.photos.length,2);assert.equal(info.sections['基本资料'],'First\nSecond\nThird');assert.equal(info.listeners,null);assert.equal(info.guardians,null);assert.equal(info.authentication,'');assert.equal(numeric(false),null);
});
test('album nested base/audio_info and artist flat audio preserve FLAC hashes, full duration and VIP markers',()=>{
 const [track]=songRows([{base:{audio_name:'Album Track',author_name:'Singer',album_id:9,album_audio_id:22},audio_info:{hash:hash(1),hash_flac:hash(2),duration:123000},copyright:{privilege:10},deprecated:{pay_type:3}}]);assert.equal(track.title,'Album Track');assert.equal(track.artist,'Singer');assert.equal(track.albumId,'9');assert.equal(track.audioId,'22');assert.equal(track.duration,123);assert.equal(track.vip,true);assert.equal(track.flacHash,hash(2));
 assert.equal(artistSongs({data:[audio(5)]})[0].heat,5);
});
test('heat share uses all obtained positive measurements and never invents percentages for missing or zero data',()=>{
 assert.deepEqual(heatShares([{heat:1},{heat:3},{heat:0},{heat:null}]).map(r=>r.share),[.25,.75,null,null]);assert.deepEqual(heatShares([{heat:0},{heat:null}]).map(r=>r.share),[null,null]);
});
test('artist catalog reads the complete directory before heat pagination, bounds cache and rejects stale reads',async()=>{
 let calls=0;const catalog=new ArtistCatalog();
 const request=async route=>{calls++;return route.startsWith('/artist/detail')?{data:{author_name:'Singer',author_id:12}}:{total:102,data:route.includes('page=1&')?Array.from({length:100},(_,i)=>audio(i+1)):[audio(101),audio(102)]};};
 const result=await catalog.load(request,'12');assert.equal(result.songs.length,102);assert.equal(result.info.complete,true);assert.equal(result.info.heatKnown,102);assert.ok(Math.abs(result.songs.reduce((s,r)=>s+r.share,0)-1)<1e-10);await catalog.load(request,'12');assert.equal(calls,3);
 catalog.clear();await assert.rejects(catalog.load(request,'12',{},()=>{},()=>true),/取消/);assert.equal(catalog.cache.size,0);
});
test('repeated artist pages are marked partial and incomplete heat figures remain scoped to received songs',async()=>{
 const catalog=new ArtistCatalog();const result=await catalog.load(async route=>route.includes('/detail')?{data:{}}:{total:1000,data:Array.from({length:100},(_,i)=>audio(i+1))},'12');assert.equal(result.info.complete,false);assert.equal(result.songs.length,100);assert.match(result.info.notice,/重复/);
});
