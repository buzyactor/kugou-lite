import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

async function withWorker(check,options={}){
  const folder=await mkdtemp(join(tmpdir(),'kugou-queue-worker-'));
  const env={...process.env,...options,QUEUE_HISTORY_FILE:join(folder,'play-history.json')};delete env.NODE_TEST_CONTEXT;
  const child=spawn(process.execPath,['--import',new URL('./fixtures/queue-worker-mocks.mjs',import.meta.url).href,'tools/tui-worker.mjs'],{stdio:['pipe','pipe','pipe'],env});
  const events=[];let stderr='',waiter;
  child.stderr.on('data',chunk=>stderr+=chunk);
  createInterface({input:child.stdout}).on('line',line=>{
    const event=JSON.parse(line);events.push(event);
    if(event.kind==='busy'&&event.value===false)waiter?.();
  });
  async function send(command){
    const offset=events.length;
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Worker timeout: '+command+' '+stderr)),2000);
      waiter=()=>{clearTimeout(timer);waiter=null;resolve();};
      child.stdin.write(command+'\n');
    });
    return events.slice(offset);
  }
  const queue=async(command='queue')=>(await send(command)).find(event=>event.kind==='queue');
  try{await check({send,queue,child,stderr:()=>stderr});}
  finally{
    child.stdin.end();if(child.exitCode===null)await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');});
    await rm(folder,{recursive:true,force:true});
  }
}

test('worker exposes high quality menu and accepts higher quality preferences',async()=>withWorker(async({send})=>{
  const menu=(await send('quality')).find(e=>e.kind==='playlists');
  assert.deepEqual(menu.lists.map(row=>row.action),['quality:flac','quality:320','quality:128','quality:high','quality:viper_clear','quality:viper_atmos']);
  for(const quality of ['high','viper_clear','viper_atmos']) {
    const events=await send('quality:'+quality);
    assert.equal(events.find(e=>e.kind==='preferences').quality,quality);
    assert.equal(events.find(e=>e.kind==='playlists').lists.find(row=>row.action==='quality:'+quality).icon,'●');
  }
}));

test('worker retains queues, keeps browsing independent, rolls back failed play, paginates and clears on account switch',{timeout:15000},async()=>withWorker(async({send,queue,child,stderr})=>{
    await send('recommend');const firstPlay=await send('play:0');assert.ok(!firstPlay.some(e=>e.kind==='error'),JSON.stringify(firstPlay));
    const a=await queue();assert.equal(a.queueCount,1);assert.equal(a.tracks[0].title,'daily0');
    await send('recommend');await send('play:2');assert.equal((await queue()).queueCount,1);
    const advanced=(await send('nexttrack')).find(e=>e.kind==='queue');assert.equal(advanced.tracks[3].active,true);
    await send('autonext');assert.equal((await queue()).tracks[4].active,true);
    child.stdin.write('stop\n');assert.equal((await queue()).queueCount,1,'stopping retains history');
    await send('resume');
    await send('discover');
    assert.ok((await send('play:1')).some(e=>e.kind==='error'));
    assert.equal((await queue()).queueCount,1,'failed new playback must not create a ghost queue');
    await send('discover');await send('play:0');
    const b=await queue();assert.equal(b.queueCount,2);assert.match(b.title,/当前播放/);
    const browseEvents=await send('queuenext'),old=browseEvents.find(e=>e.kind==='queue');
    assert.equal(old.queueId,a.queueId);assert.equal(old.tracks[4].remembered,true);
    assert.ok(!browseEvents.some(e=>e.kind==='state'||e.kind==='media'));
    const activated=await send('queueplay:1');
    const activatedPage=activated.find(e=>e.kind==='queue');
    assert.match(activatedPage.title,/当前播放/);assert.equal(activatedPage.resized,true);
    assert.equal(activatedPage.tracks[1].active,true);
    assert.equal((await queue()).queueId,a.queueId);
    await send('queuenext');
    const failed=await send('queueplay:1');assert.ok(failed.some(e=>e.kind==='error'));
    const unchanged=await queue();assert.equal(unchanged.queueId,a.queueId);assert.equal(unchanged.tracks[1].active,true);
    await send('pagesize:2');await send('nextpage');
    const thirdPage=await queue('nextpage');assert.equal(thirdPage.tracks[0].number,5);
    await send('queuenext');
    const removed=await send('queuedelete');assert.ok(!removed.some(e=>e.kind==='state'&&e.status==='Stopped'));
    assert.equal(removed.find(e=>e.kind==='queue').queueCount,1);
    const stopped=await send('queuedelete');assert.ok(stopped.some(e=>e.kind==='state'&&e.status==='Stopped'));
    assert.equal(stopped.find(e=>e.kind==='queue').queueCount,0);
    assert.equal((await queue('queuenext')).tracks.length,0);
    await send('recommend');await send('play:0');await send('switch:0');
    assert.equal((await queue()).queueCount,0);
    assert.equal(stderr(),'');
}));

test('all finite collections produce one full queue across UI pages and window sizes',{timeout:15000},async()=>withWorker(async({send,queue})=>{
  await send('pagesize:2');
  const sources=[
    ['daily',async()=>send('recommend')],
    ['new',async()=>send('discover')],
    ['recommended',async()=>{await send('recommend');await send('sectiontoggle');await send('openlist:0');}],
    ['hires',async()=>{await send('discover');await send('sectiontoggle');await send('openlist:0');}],
    ['rank',async()=>{await send('discover');await send('sectionranks');await send('openlist:0');}],
    ['personal',async()=>{await send('playlists');await send('openlist:0');}],
    ['collected',async()=>{await send('playlists');await send('sectiontoggle');await send('openlist:0');}],
    ['album',async()=>{await send('search:test');await send('searchtype:album');await send('openentity:0');}],
    ['artist',async()=>{await send('search:test');await send('searchtype:artist');await send('openentity:0');}],
  ];
  for(const [name,open] of sources){
    await open();
    const playing=await send('play:0');assert.ok(!playing.some(e=>e.kind==='error'),name+JSON.stringify(playing));
    const first=await queue();assert.match(first.title,/5 首/,name);
    const count=first.queueCount;
    await open();await send('nextpage');
    const secondPlay=await send('play:0');
    const prefix=['recommended','hires'].includes(name)?'public':name==='collected'?'personal':name;
    assert.equal(secondPlay.find(e=>e.kind==='media'&&e.fresh)?.song,prefix+'2',name+' must play the clicked global index');
    const second=await queue();assert.equal(second.queueId,first.queueId,name);assert.equal(second.queueCount,count,name);
    const last=await queue('nextpage');assert.equal(last.tracks[0].title,prefix+'2',name);
    const tail=await queue('nextpage');assert.equal(tail.tracks.length,1,name);assert.equal(tail.tracks[0].title,prefix+'4',name);
  }
  await send('pagesize:3');await send('recommend');await send('play:0');const before=await queue();
  await send('recommend');await send('nextpage');await send('play:0');
  const after=await queue();assert.equal(after.queueId,before.queueId);assert.equal(after.queueCount,before.queueCount);
  await send('recommend');await send('sort:title-desc');await send('play:0');const sorted=await queue();
  await send('recommend');await send('sort:title-desc');await send('nextpage');
  const selected=await send('play:0');assert.equal(selected.find(e=>e.kind==='media'&&e.fresh)?.song,'daily1');
  const sortedAgain=await queue();assert.equal(sortedAgain.queueId,sorted.queueId);assert.equal(sortedAgain.queueCount,sorted.queueCount);
}));

test('a failed full-collection read leaves the existing playing queue intact',{timeout:15000},async()=>withWorker(async({send,queue})=>{
  await send('recommend');await send('play:0');const first=await queue();
  await send('discover');const failed=await send('play:0');
  assert.ok(failed.some(e=>e.kind==='error'&&/collection read failure/.test(e.message)));
  assert.ok(!failed.some(e=>e.kind==='media'&&e.fresh));
  const unchanged=await queue();assert.equal(unchanged.queueId,first.queueId);assert.equal(unchanged.queueCount,1);
  assert.equal(unchanged.tracks[0].active,true);
},{QUEUE_FAIL_COLLECTION:'new'}));

test('played history lists only started tracks, not queue members or failed plays, and supports replay',{timeout:15000},async()=>withWorker(async({send})=>{
  assert.equal((await send('history')).find(e=>e.kind==='tracks').tracks.length,0);
  await send('recommend');await send('play:0');await send('nexttrack');
  await send('discover');await send('play:1');
  const history=(await send('history')).find(e=>e.kind==='tracks');
  assert.equal(history.view,'history');assert.deepEqual(history.tracks.map(r=>r.title),['daily1','daily0']);
  const replay=await send('play:1');assert.equal(replay.find(e=>e.kind==='media'&&e.fresh)?.song,'daily0');
  const repeated=(await send('history')).find(e=>e.kind==='tracks');assert.deepEqual(repeated.tracks.map(r=>r.title),['daily0','daily1']);
}));
