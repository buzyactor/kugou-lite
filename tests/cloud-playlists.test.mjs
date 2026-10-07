import test from 'node:test';
import assert from 'node:assert/strict';
import {CloudPlaylists,ownedSongs,reorderSongs} from '../src/cloud-playlists.mjs';
const track=i=>({hash:String(i).padStart(32,'a'),title:'Song'+i,artist:'Artist',audioId:String(i),albumId:'2'});
const raw=i=>({hash:track(i).hash,filename:'Artist - Song'+i,mixsongid:String(i),album_id:'2',fileid:String(100+i),sort:70-i*2});
function fixture(options={}){
 const source={listid:'1',ownerId:'7',type:0,title:'Source'},target={...source,listid:'2',title:'Target'};
 const lists=[{listid:1,name:'Source',list_create_userid:7,type:0,sort:3,tags:'华语,流行',intro:'Keep intro',pic:'custom/original.jpg'},{listid:2,name:'Target',list_create_userid:7,type:0}];
 const songs=new Map([['1',[raw(1),raw(2),raw(3),raw(4)]],['2',[]]]),writes=[];
 let totalVer=5,listVer=6;
 const read=async route=>{
  const url=new URL(route,'https://local'),id=url.searchParams.get('listid');
  if(url.pathname==='/user/playlist')return {data:{total_ver:totalVer,info:lists.map(r=>({...r,count:songs.get(String(r.listid))?.length??0}))}};
  if(url.pathname==='/playlist/track/all/new'){
   const rows=songs.get(id)??[],page=Number(url.searchParams.get('page')),size=Number(url.searchParams.get('pagesize'));
   return {data:{list_ver:listVer,count:rows.length,info:rows.slice((page-1)*size,page*size).map(r=>({...r}))}};
  }throw Error('Unexpected read');
 };
 const write=async route=>{
  writes.push(route);const url=new URL(route,'https://local'),id=url.searchParams.get('listid');
  if(url.pathname==='/playlist/add'){lists.push({listid:3,name:url.searchParams.get('name'),type:0,list_create_userid:7});totalVer++;}
  if(url.pathname==='/playlist/update'){
   assert.equal(url.searchParams.get('intro'),'Keep intro');assert.equal(url.searchParams.get('tags'),'华语,流行');assert.equal(url.searchParams.get('sort'),'3');assert.equal(url.searchParams.get('pic'),'custom/original.jpg');
   lists[0].name=url.searchParams.get('name');totalVer++;
  }
  if(url.pathname==='/playlist/tracks/add'){
   if(!options.ignoreAdd){const add=url.searchParams.get('data').split(',').map((data,i)=>{const [filename,hash,album_id,mixsongid]=data.split('|');return {filename,hash,album_id,mixsongid,fileid:String(500+i)};});songs.set(id,songs.get(id).concat(add));}
   if(options.timeoutAdd)throw Error('Unknown add timeout');
  }
  if(url.pathname==='/playlist/tracks/del'){
   const ids=url.searchParams.get('fileids').split(',');songs.set(id,songs.get(id).filter(r=>!ids.includes(r.fileid)));
   if(options.timeoutDelete)throw Error('Unknown delete timeout');
  }
  if(url.pathname==='/playlist/tracks/sort'){
   assert.equal(url.searchParams.get('list_ver'),'6');
   for(const pair of url.searchParams.get('data').split(',')){const [file,sort]=pair.split('|');songs.get(id).find(r=>r.fileid===file).sort=Number(sort);}
   songs.get(id).sort((a,b)=>b.sort-a.sort);listVer++;
  }
  return {status:1};
 };
 return {source,target,read,write,writes,songs,lists};
}
test('create and rename write once and verify while preserving other list metadata',async()=>{
 const f=fixture(),service=new CloudPlaylists();
 assert.equal((await service.create(f.read,f.write,'7','New list')).verified,true);
 assert.equal((await service.rename(f.read,f.write,'7',f.source,'Renamed')).verified,true);
 assert.equal(f.writes.length,2);
 await assert.rejects(service.create(f.read,f.write,'7','\ninvalid\x00'),/名称/);
 await assert.rejects(service.rename(f.read,f.write,'8',f.source,'Other'),/自己创建/);
 assert.equal(f.writes.length,2);
});
test('batch move verifies destination before deleting source file IDs; copy retains source and deduplicates',async()=>{
 const f=fixture(),service=new CloudPlaylists();
 const copy=await service.prepareTransfer(f.read,'7',null,f.target,[track(1),track(1)],'copy');
 assert.equal((await service.transfer(f.read,f.write,copy)).verified,true);
 assert.equal(f.songs.get('1').length,4);assert.equal(f.songs.get('2').length,1);
 const move=await service.prepareTransfer(f.read,'7',f.source,f.target,[track(1),track(2)],'move');
 assert.equal((await service.transfer(f.read,f.write,move)).verified,true);
 assert.deepEqual(f.songs.get('1').map(r=>r.fileid),['103','104']);assert.equal(f.songs.get('2').length,2);
 assert.deepEqual(f.writes.map(r=>new URL(r,'https://local').pathname),['/playlist/tracks/add','/playlist/tracks/add','/playlist/tracks/del']);
 assert.equal(new URL(f.writes[2],'https://local').searchParams.get('fileids'),'101,102');
});
test('unverified destination or unknown add timeout never deletes source; unknown delete is not retried',async()=>{
 for(const options of [{ignoreAdd:true},{timeoutAdd:true},{timeoutDelete:true}]){
  const f=fixture(options),service=new CloudPlaylists(),state=await service.prepareTransfer(f.read,'7',f.source,f.target,[track(1)],'move');
  await assert.rejects(service.transfer(f.read,f.write,state));
  assert.equal(f.writes.filter(r=>r.startsWith('/playlist/tracks/add')).length,1);
  assert.equal(f.writes.filter(r=>r.startsWith('/playlist/tracks/del')).length,options.timeoutDelete?1:0);
  if(!options.timeoutDelete)assert.equal(f.songs.get('1').length,4);
 }
});
test('same-list move, missing source, other-owner target and cancellation do not mutate',async()=>{
 const f=fixture(),service=new CloudPlaylists();
 await assert.rejects(service.prepareTransfer(f.read,'7',f.source,f.source,[track(1)],'move'),/不能相同/);
 await assert.rejects(service.prepareTransfer(f.read,'7',f.source,f.target,[track(99)],'move'),/原歌单/);
 await assert.rejects(service.prepareTransfer(f.read,'8',null,f.target,[track(1)],'copy'),/自己创建/);
 const state=await service.prepareTransfer(f.read,'7',f.source,f.target,[track(1)],'move');
 await assert.rejects(service.transfer(f.read,f.write,state,()=>false),/取消/);assert.equal(f.writes.length,0);
});
test('numbered reorder preserves descending slots, batch order and verifies cloud result',async()=>{
 const f=fixture(),service=new CloudPlaylists();
 const result=await service.reorder(f.read,f.write,'7',f.source,[track(1),track(2)],'3');
 assert.equal(result.verified,true);assert.equal(result.count,2);
 assert.deepEqual(f.songs.get('1').map(r=>r.fileid),['103','104','101','102']);
 assert.deepEqual(f.songs.get('1').map(r=>r.sort),[68,66,64,62]);assert.equal(f.writes.length,1);
});
test('out-of-range positions, missing versions, unstable pages and invalid sort values never write',async()=>{
 const f=fixture(),service=new CloudPlaylists();
 for(const position of ['0','5','-1','1.5','2x'])await assert.rejects(service.reorder(f.read,f.write,'7',f.source,[track(1)],position),/位置编号/);
 const snapshot=await ownedSongs(f.read,'7',f.source);
 assert.throws(()=>reorderSongs({...snapshot,listVer:undefined},[track(1)],'1'),/版本/);
 assert.throws(()=>reorderSongs({...snapshot,rows:snapshot.rows.map(row=>({...row,sort:0}))},[track(1)],'2'),/排序号/);
 assert.equal(f.writes.length,0);
 let page=0;await assert.rejects(ownedSongs(async()=>({data:{list_ver:++page,count:31,info:page===1?Array.from({length:30},(_,i)=>raw(i+1)):[raw(31)]}}),'7',f.source),/已变化/);
});

test('numbered moves across API page boundaries preserve all songs and numeric slots',async()=>{
 const f=fixture(),service=new CloudPlaylists();f.songs.set('1',Array.from({length:35},(_,i)=>({...raw(i+1),sort:100-i*2})));
 const result=await service.reorder(f.read,f.write,'7',f.source,[track(1)],'35');
 assert.equal(result.verified,true);assert.equal(f.songs.get('1').length,35);
 assert.equal(f.songs.get('1').at(-1).fileid,'101');
 assert.deepEqual(f.songs.get('1').map(r=>r.sort),Array.from({length:35},(_,i)=>100-i*2));
});
