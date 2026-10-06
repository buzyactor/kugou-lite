import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,stat,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {PlayHistory} from '../src/play-history.mjs';
const track=i=>({hash:i.toString(16).padStart(32,'0'),audioId:String(i),albumId:'1',title:'Song '+i,artist:'Artist',duration:120,vip:true,cover:'https://singerimg.kugou.com/cover.png?token=secret',url:'https://secret-stream',token:'secret'});

test('played history persists per account, recent repeats move to the front and stored metadata excludes secrets',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'kugou-history-')),file=join(folder,'history.json');
  try{
    const history=new PlayHistory(file);
    await Promise.all([history.record('1',track(1),1),history.record('1',track(2),2)]);
    await history.record('2',track(3),3);await history.record('1',track(1),4);
    const restarted=new PlayHistory(file);
    assert.deepEqual((await restarted.list('1')).map(r=>r.title),['Song 1','Song 2']);
    assert.deepEqual((await restarted.list('2')).map(r=>r.title),['Song 3']);
    assert.deepEqual(await restarted.list('3'),[]);
    assert.equal((await restarted.list('1'))[0].playedAt,4);
    assert.ok(!(await readFile(file,'utf8')).includes('secret'));
    assert.equal((await stat(file)).mode&0o777,0o600);
    const seeded={version:1,accounts:{'1':Array.from({length:500},(_,i)=>({...track(i+1),playedAt:i}))}};
    await writeFile(file,JSON.stringify(seeded));await restarted.record('1',track(501));
    assert.equal((await restarted.list('1')).length,500);assert.equal((await restarted.list('1')).at(-1).title,'Song 499');
  }finally{await rm(folder,{recursive:true,force:true});}
});
test('corrupt history is preserved and never silently overwritten',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'kugou-history-')),file=join(folder,'history.json');
  try{
    await writeFile(file,'broken');const history=new PlayHistory(file);
    await assert.rejects(history.record('1',track(1)),/保留原文件/);
    assert.equal(await readFile(file,'utf8'),'broken');
  }finally{await rm(folder,{recursive:true,force:true});}
});
