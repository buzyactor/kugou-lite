import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';

test('worker retains queues, keeps browsing independent, rolls back failed play, paginates and clears on account switch',{timeout:15000},async()=>{
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
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
  try{
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
    assert.equal(stderr,'');
  }finally{
    child.stdin.end();if(child.exitCode===null)await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');});
  }
});
