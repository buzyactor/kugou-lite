import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {QueueHistory} from '../src/queue-history.mjs';
import {QueueStore,emptyQueues} from '../src/queue-store.mjs';
const rows=id=>Array.from({length:3},(_,i)=>({hash:(id+i).toString(16).padStart(32,'0'),title:'Song '+i,artist:'Artist',audioId:String(i),albumId:'1',duration:120,cover:'https://imge.kugou.com/{size}/x.jpg?token=secret',url:'https://signed-stream',token:'secret',png:'secret',lyrics:['secret']}));

test('all queues, selections and indices survive restart with metadata only and account isolation',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'kugou-queues-')),file=join(folder,'queues.json');
  try{
    const history=new QueueHistory(),store=new QueueStore(file);
    history.commit(rows(1),2,'daily','推荐');history.commit(rows(10),1,'new','新歌');history.next();
    await store.save('1',history.snapshot());await store.save('2',emptyQueues());
    const restored=new QueueHistory();restored.restore(await new QueueStore(file).load('1'));
    assert.equal(restored.entries.length,2);assert.equal(restored.playing.index,1);assert.equal(restored.viewed.title,'推荐');
    restored.commit(rows(10),2,'new','新歌');assert.equal(restored.entries.length,2,'restored source identity must deduplicate');
    assert.deepEqual(await store.load('2'),emptyQueues());
    assert.deepEqual(await store.load('3'),emptyQueues());
    assert.equal((await stat(file)).mode&0o777,0o600);
    assert.ok(!(await readFile(file,'utf8')).includes('secret'));
    assert.equal(restored.entries[0].tracks[0].cover,'https://imge.kugou.com/{size}/x.jpg');
    restored.next();restored.remove();await store.save('1',restored.snapshot());
    assert.equal((await store.load('1')).entries.length,1);
    await store.save('1',emptyQueues());assert.deepEqual(await store.load('1'),emptyQueues());
  }finally{await rm(folder,{recursive:true,force:true});}
});
test('corrupt queue file or invalid selection is preserved and never overwritten',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'kugou-queues-corrupt-')),file=join(folder,'queues.json');
  try{
    await writeFile(file,'broken');const store=new QueueStore(file);
    await assert.rejects(store.load('1'),/保留/);await assert.rejects(store.save('1',emptyQueues()),/保留/);
    assert.equal(await readFile(file,'utf8'),'broken');
    await assert.rejects(store.save('1',{entries:[],playingId:1,viewedId:null}));
  }finally{await rm(folder,{recursive:true,force:true});}
});
