import test from 'node:test';
import assert from 'node:assert/strict';
import {SortedPlaylists,sortTracks,sortedQueue,sortChoices} from '../src/playlist-sort.mjs';
import {playlistTracks} from '../src/playlist-access.mjs';
import {Discovery} from '../src/discovery.mjs';
const rows=Array.from({length:205},(_,i)=>({hash:String(i).padStart(32,'0'),title:`Song ${204-i}`,artist:`Artist ${i%3}`,duration:i+1,vip:i%2===0}));
test('whole-playlist ordering precedes pagination and cache preserves every page and original order',async()=>{
 const sorted=new SortedPlaylists();let calls=0;
 const load=async(p,size)=>{calls++;return rows.slice((p-1)*size,p*size);};
 const first=await sorted.page('personal',load,'title-asc',1,30,1);
 assert.equal(calls,3);assert.equal(first[0].title,'Song 0');assert.equal(first[29].title,'Song 29');
 const third=await sorted.page('personal',load,'title-asc',3,30,1);assert.equal(third[0].title,'Song 60');assert.equal(calls,3);
 const q=sortedQueue(third,5,sorted.all('personal','title-asc',1),3,30);
 assert.equal(q.index,65);assert.equal(q.queue.length,205);assert.equal(q.queue[q.index].title,third[5].title);
 assert.equal((await sorted.page('personal',load,'default',1,30,1))[0].title,'Song 204');
 assert.equal(rows[0].title,'Song 204');
});
test('all sorting modes are stable, deterministic across shuffled pages and do not mutate source rows',()=>{
 assert.equal(sortChoices.length,10);
 const sample=[{title:'Z',artist:'B',duration:20,vip:false},{title:'A',artist:'A',duration:30,vip:true},{title:'A',artist:'C',duration:10,vip:false}];
 const expected={'default':[0,1,2],reverse:[2,1,0],'title-asc':[1,2,0],'title-desc':[0,1,2],'artist-asc':[1,0,2],'artist-desc':[2,0,1],'duration-asc':[2,0,1],'duration-desc':[1,0,2],'vip-first':[1,0,2]};
 for(const [mode,indices] of Object.entries(expected))assert.deepEqual(sortTracks(sample,mode),indices.map(i=>sample[i]),mode);
 assert.deepEqual(sortTracks(rows,'shuffle',77),sortTracks(rows,'shuffle',77));
 assert.notDeepEqual(sortTracks(rows,'shuffle',77),sortTracks(rows,'shuffle',78));
 assert.deepEqual(new Set(sortTracks(rows,'shuffle',77)),new Set(rows));
 assert.throws(()=>sortTracks(rows,'bad'));
});
test('private, collected and public discovery playlists all feed the same complete sorter',async()=>{
 const raw=rows.map(r=>({hash:r.hash,songname:r.title,singername:r.artist,time_length:r.duration}));
 const requested=[];
 const request=async route=>{requested.push(route);const params=new URL('https://local'+route).searchParams;const page=Number(params.get('page')),size=Number(params.get('pagesize'));return {data:{info:raw.slice((page-1)*size,page*size)}};};
 const sorted=new SortedPlaylists();
 for(const [key,list] of [['private',{listid:'42'}],['collected',{listid:'42',publicId:'global-id',collected:true}]]) {
  const first=await sorted.page(key,(p,size)=>playlistTracks(request,list,p,size),'title-asc',1,20,1);
  assert.equal(first[0].title,'Song 0');
 }
 const discovery=new Discovery();
 const first=await sorted.page('recommended-public',(p,size)=>discovery.load(request,'public',p,size,'global-id'),'title-asc',1,20,1);
 assert.equal(first[0].title,'Song 0');assert.equal(requested.length,9);
 assert(requested.some(route=>route.startsWith('/playlist/track/all/new?listid=42')));
 assert(requested.some(route=>route.startsWith('/playlist/track/all?id=global-id')));
});
test('failed, cancelled, repeated or incomplete page reads never install a partial sorted collection',async()=>{
 for(const kind of ['error','cancel','repeat','incomplete']) {
  const sorted=new SortedPlaylists();let calls=0;
  const load=async()=>{calls++;if(kind==='error'&&calls===2)throw new Error('offline');if(kind==='incomplete')return [];return rows.slice(0,100);};
  await assert.rejects(sorted.page(kind,load,'title-asc',1,20,1,{cancelled:()=>kind==='cancel'&&calls===1,expected:kind==='incomplete'?205:0}));
  assert.equal(sorted.has(kind),false,kind);
 }
 const sorted=new SortedPlaylists();await sorted.page('one',async()=>rows.slice(0,5),'default',1,20,1);sorted.invalidate('one');assert(!sorted.has('one'));sorted.clear();
});
