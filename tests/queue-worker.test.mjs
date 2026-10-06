import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {cacheCover} from '../src/library.mjs';

async function withWorker(check,options={}){
  const folder=options.QUEUE_TEST_FOLDER??await mkdtemp(join(tmpdir(),'kugou-queue-worker-'));
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
  const close=async()=>{
    if(child.exitCode!==null)return;
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Worker exit timeout'));},2500);
      child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('Worker exit '+code));});
      child.stdin.end();
    });
  };
  try{await check({send,queue,child,folder,close,stderr:()=>stderr});}
  finally{
    child.stdin.end();if(child.exitCode===null)await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');});
    if(!options.QUEUE_TEST_FOLDER)await rm(folder,{recursive:true,force:true});
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

test('worker edits queues without interrupting unrelated playback, resumes edited order and persists names/pins',async()=>withWorker(async({send,queue,close,folder})=>{
 await send('recommend');await send('play:2');await send('queue');
 await send('songmenu:0');const move=await send('songaction:down');assert.ok(!move.some(e=>e.kind==='state'||e.kind==='error'));
 let current=await queue();assert.equal(current.tracks[1].title,'daily0');assert.equal(current.tracks[2].active,true);
 await send('songmenu:1');await send('songaction:remove');current=await queue();assert.equal(current.tracks[1].active,true);assert.equal(current.tracks[1].title,'daily2');
 await send('songmenu:0');const prompt=await send('songaction:rename');const command=prompt.find(e=>e.kind==='text_prompt').command;
 await send(command+JSON.stringify('常听队列'));await send('songmenu:0');await send('songaction:pin');assert.match((await queue()).title,/★ 常听队列/);
 await send('discover');await send('songmenu:2');const inserted=await send('songaction:next');assert.ok(!inserted.some(e=>e.kind==='media'));
 const next=await send('nexttrack');assert.equal(next.find(e=>e.kind==='media'&&e.fresh)?.song,'new2');
 await send('queue');await send('songmenu:2');const removed=await send('songaction:remove');assert.ok(removed.some(e=>e.kind==='state'&&e.status==='Stopped'));
 await close();const saved=JSON.parse(await readFile(join(folder,'play-history.json.queues'),'utf8')).accounts['1'];
 assert.equal(saved.entries[0].title,'常听队列');assert.equal(saved.entries[0].pinned,true);assert.equal(saved.entries[0].tracks.length,4);
}));

test('play-next insertion overrides shuffle and single-repeat once without changing saved play mode',async()=>withWorker(async({send,child})=>{
 for(const mode of ['single','shuffle']){
  await send('recommend');await send('play:0');child.stdin.write('mode:'+mode+'\n');
  await send('discover');await send('songmenu:2');await send('songaction:next');
  const next=await send('autonext');assert.equal(next.find(e=>e.kind==='media'&&e.fresh)?.song,'new2',mode);
  if(mode==='single')assert.equal((await send('autonext')).find(e=>e.kind==='media'&&e.fresh)?.song,'new2','single-repeat resumes after the scheduled next song');
 }
}));

test('favorites support current/queue songs, cross-page batches, membership verification and confirmed removal',async()=>withWorker(async({send,queue})=>{
 await send('pagesize:2');await send('recommend');await send('play:0');const before=await queue();
 await send('favorite:current');let state=await send('openlist:0');assert.match(state.find(e=>e.kind==='actions').title,/已收藏 0\/1/);
 let saved=await send('favoriteapply:add');assert.ok(saved.some(e=>e.kind==='fixture_write'&&e.count===1));assert.ok(saved.some(e=>e.kind==='status'&&/已核对/.test(e.message)));
 assert.equal((await queue()).queueId,before.queueId);
 await send('favorite:0');state=await send('openlist:0');assert.match(state.find(e=>e.kind==='actions').title,/已收藏 1\/1/);
 assert.ok(!state.some(e=>e.kind==='fixture_write'));
 assert.ok(!state.find(e=>e.kind==='actions').actions.some(a=>a.command==='favoriteapply:add'));
 const removed=await send('favoriteapply:remove');assert.ok(removed.some(e=>e.kind==='fixture_write'&&e.action==='remove'&&e.count===1));
 await send('recommend');await send('mark:0');await send('nextpage');await send('mark:1');
 await send('favorite-batch');state=await send('openlist:0');assert.match(state.find(e=>e.kind==='actions').title,/已收藏 0\/2/);
 saved=await send('favoriteapply:add');assert.ok(saved.some(e=>e.kind==='fixture_write'&&e.count===2));
 assert.ok(saved.some(e=>e.kind==='tracks'&&e.page===2));assert.ok(saved.some(e=>e.kind==='marks'&&e.count===0));
}));

test('an unknown favorite write result consumes intent, then a new read sees the actual cloud result',async()=>withWorker(async({send})=>{
 await send('recommend');await send('favorite:0');await send('openlist:0');
 const failed=await send('favoriteapply:add');assert.equal(failed.filter(e=>e.kind==='fixture_write').length,1);assert.ok(failed.some(e=>e.kind==='error'));
 const repeated=await send('favoriteapply:add');assert.ok(repeated.some(e=>e.kind==='error'));assert.ok(!repeated.some(e=>e.kind==='fixture_write'));
 const checked=await send('openlist:0');assert.match(checked.find(e=>e.kind==='actions').title,/已收藏 1\/1/);
 await send('switch:1');assert.ok(!(await send('favoriteapply:remove')).some(e=>e.kind==='fixture_write'));
},{QUEUE_FAVORITE_FAIL:'1'}));

test('playback popup quality apply keeps collection navigation and the playing queue',async()=>withWorker(async({send,queue})=>{
  await send('recommend');await send('play:0');
  const before=await queue();
  const events=await send('qualityapply:viper_atmos');
  assert.equal(events.find(e=>e.kind==='preferences').quality,'viper_atmos');
  assert.ok(events.some(e=>e.kind==='media'&&e.fresh));
  assert.ok(!events.some(e=>e.kind==='playlists'||e.kind==='queue'));
  assert.equal((await queue()).queueId,before.queueId);
  assert.equal((await queue()).queueCount,1);
}));

test('history replay immediately sends the cached cover even without a remote cover URL',async()=>withWorker(async({send,folder})=>{
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGN8AAAAASUVORK5CYII=';
  await cacheCover(folder,'a'+'0'.repeat(31),png);
  await send('recommend');await send('play:0');await send('history');
  const events=await send('play:0');
  const fresh=events.find(e=>e.kind==='media'&&e.fresh);
  assert.equal(fresh.song,'daily0');assert.equal(fresh.png,png);
  assert.ok(events.filter(e=>e.kind==='media').every(e=>e.png===png));
} ,{QUEUE_EXPECT_CACHED_COVER:'1'}));

test('worker saves all queues across restarts by default, isolates accounts and clears only on opted-in exit',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'kugou-worker-restart-')),options={QUEUE_TEST_FOLDER:folder};
  try{
    await withWorker(async({send,queue,close})=>{
      await send('recommend');await send('play:2');await send('discover');await send('play:0');
      assert.equal((await queue()).queueCount,2);
      await send('switch:1');assert.equal((await queue()).queueCount,0);
      await send('recommend');await send('play:1');
      await send('switch:0');assert.equal((await queue()).queueCount,2);
      await close();
    },options);
    await withWorker(async({send,queue,child,close})=>{
      const restored=await queue();assert.equal(restored.queueCount,2);assert.equal(restored.tracks[0].remembered,true);
      assert.ok(!(await send('restore')).some(e=>e.kind==='media'&&e.fresh),'restore must not auto-play');
      await send('queuenext');await send('queueplay:2');assert.equal((await queue()).tracks[2].active,true);
      child.stdin.write('queuepolicy:1\n');await queue();
      await close();
    },options);
    await withWorker(async({send,queue})=>{
      assert.equal((await queue()).queueCount,0,'opted-in exit clears queues');
      await send('switch:1');assert.equal((await queue()).queueCount,1,'other account retains its own queues');
    },options);
    const saved=JSON.parse(await readFile(join(folder,'play-history.json.queues'),'utf8'));
    assert.equal(saved.accounts['1'].entries.length,0);assert.equal(saved.accounts['2'].entries.length,1);
  }finally{await rm(folder,{recursive:true,force:true});}
});

test('worker retains queues, keeps browsing independent, rolls back failed play, paginates and restores on account switch',{timeout:15000},async()=>withWorker(async({send,queue,child,stderr})=>{
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
    assert.equal((await queue()).queueCount,1,'same account restores its saved queue');
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

test('album playback reads 30-row API pages and preserves one 65-song queue across viewport sizes',async()=>withWorker(async({send,queue})=>{
 await send('pagesize:40');await send('search:test');await send('searchtype:album');
 const opened=await send('openentity:0');assert.ok(!opened.some(e=>e.kind==='error'),JSON.stringify(opened));
 assert.equal(opened.find(e=>e.kind==='catalog').rows.length,40);
 const play=await send('play:39');assert.equal(play.find(e=>e.kind==='media'&&e.fresh)?.song,'album39');
 const first=await queue();assert.match(first.title,/65 首/);
 await send('search:test');await send('searchtype:album');await send('openentity:0');await send('nextpage');
 const next=await send('play:24');assert.equal(next.find(e=>e.kind==='media'&&e.fresh)?.song,'album64');
 assert.equal((await queue()).queueId,first.queueId);assert.equal((await queue()).queueCount,1);
},{QUEUE_ALBUM_COUNT:'65'}));

test('a public playlist rejecting large full-queue reads still plays across pages in one queue',async()=>withWorker(async({send,queue})=>{
 await send('recommend');await send('sectiontoggle');await send('openlist:0');
 const firstPlay=await send('play:0');assert.equal(firstPlay.find(e=>e.kind==='media'&&e.fresh)?.song,'public0');
 const first=await queue();assert.match(first.title,/65 首/);
 await send('recommend');await send('sectiontoggle');await send('openlist:0');await send('nextpage');
 const nextPlay=await send('play:0');assert.equal(nextPlay.find(e=>e.kind==='media'&&e.fresh)?.song,'public20');
 assert.equal((await queue()).queueId,first.queueId);assert.equal((await queue()).queueCount,1);
},{QUEUE_UI_COUNT:'65',QUEUE_REJECT_LARGE_PUBLIC:'1'}));

test('played history lists only started tracks, not queue members or failed plays, and supports replay',{timeout:15000},async()=>withWorker(async({send})=>{
  assert.equal((await send('history')).find(e=>e.kind==='tracks').tracks.length,0);
  await send('recommend');await send('play:0');await send('nexttrack');
  await send('discover');await send('play:1');
  const history=(await send('history')).find(e=>e.kind==='tracks');
  assert.equal(history.view,'history');assert.deepEqual(history.tracks.map(r=>r.title),['daily1','daily0']);
  const replay=await send('play:1');assert.equal(replay.find(e=>e.kind==='media'&&e.fresh)?.song,'daily0');
  const repeated=(await send('history')).find(e=>e.kind==='tracks');assert.deepEqual(repeated.tracks.map(r=>r.title),['daily0','daily1']);
}));
