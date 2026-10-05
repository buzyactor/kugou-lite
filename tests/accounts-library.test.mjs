import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Accounts } from '../src/accounts.mjs';
import { parseKrc, favoriteParams, playlistSongs, playlists, coverUrl } from '../src/library.mjs';
import { search } from '../src/music.mjs';

test('migrate legacy, persist multi-account selection across restart, refresh without duplication', async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'kugou-accounts-'));
 try {
  await writeFile(path.join(dir,'account.json'),JSON.stringify({userid:'12345',token:'old'}));
  const store=new Accounts(dir);await store.update(()=>{});
  await store.save({userid:'67890',token:'second'});
  await store.select(0);
  assert.equal((await new Accounts(dir).current()).userid,'12345');
  await store.save({userid:'12345',token:'refreshed'});
  assert.equal((await store.read()).accounts.length,2);
  assert.equal((await store.current()).token,'refreshed');
  assert.ok(!JSON.stringify(await store.summary()).includes('refreshed'));
  assert.equal((await stat(path.join(dir,'accounts.json'))).mode&0o777,0o600);
  await assert.rejects(store.select(9));
  assert.equal((await store.current()).userid,'12345');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('corrupt account store is never silently overwritten',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'kugou-corrupt-'));
 try {
  await writeFile(path.join(dir,'accounts.json'),'broken');
  await assert.rejects(new Accounts(dir).save({userid:'1',token:'abc'}),/损坏/);
  assert.equal(await readFile(path.join(dir,'accounts.json'),'utf8'),'broken');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('a fresh scan resets diagnostic history and its login time survives restart',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'kugou-login-time-'));
 try{
  const store=new Accounts(dir);await store.save({userid:'1',token:'old',dfid:'device'});
  await store.update(data=>Object.assign(data.accounts[0],{loggedInAt:1,lastReadSuccessAt:2,lastAuthRejectedAt:3,lastAuthRejectedCode:20017}));
  const before=Date.now();await store.save({userid:'1',token:'new'});
  const account=await new Accounts(dir).current();
  assert.ok(account.loggedInAt>=before);assert.equal(account.lastReadSuccessAt,0);assert.equal(account.lastAuthRejectedAt,0);assert.equal(account.lastAuthRejectedCode,null);assert.equal(account.dfid,'device');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('search sends explicit page and rejects invalid page',async()=>{
 await search(async route=>{assert.ok(route.includes('page=3'));return {data:{lists:[]}};},'晴天',3);
 await assert.rejects(search(()=>{},'晴天',0));
});
test('KRC preserves absolute word timing and removes metadata',()=>{
 const rows=parseKrc('[ti:test]\n[1000,600]<0,200,0>你<200,400,0>好');
 assert.deepEqual(rows,[{start:1000,duration:600,words:[{start:1000,duration:200,text:'你'},{start:1200,duration:400,text:'好'}]}]);
});
test('cloud playlist normalization and favorite delimiter protection',()=>{
 assert.equal(playlists({data:{info:[{listid:2,name:'我的歌单',count:3}]}})[0].listid,'2');
 const rows=playlistSongs({data:{info:[{hash:'a'.repeat(32),name:'歌手 - 歌曲',timelen:180000,album_id:1,mixsongid:2}]}});
 assert.equal(rows[0].duration,180);
 const params=favoriteParams({...rows[0],title:'song,|test'},'2');
 assert.equal(params.get('data').split('|').length,4);
 assert.ok(!params.get('data').includes(','));
});
test('delete by identity preserves other accounts, selects a survivor, and cannot resurrect legacy login',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'kugou-delete-'));
 try{
  const store=new Accounts(dir);
  await store.save({userid:'1',token:'one',dfid:'device',t1:'session'});
  await store.save({userid:'2',token:'two'});
  await store.save({userid:'3',token:'three'});
  await writeFile(path.join(dir,'account.json'),JSON.stringify({userid:'2',token:'two'}));
  assert.equal(await store.remove('2'),false);assert.equal((await store.current()).userid,'3');
  await assert.rejects(stat(path.join(dir,'account.json')),{code:'ENOENT'});
  assert.equal(await store.remove('3'),true);assert.equal((await new Accounts(dir).current()).userid,'1');
  assert.equal((await store.current()).dfid,'device');
  await store.remove('1');assert.deepEqual(await store.summary(),[]);await assert.rejects(store.current(),/没有已保存/);
  await assert.rejects(store.remove('9'),/不存在/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('a stale pre-owner lock from an interrupted run is recovered',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'kugou-lock-'));
 try{
  const {mkdir,utimes}=await import('node:fs/promises');
  const lock=path.join(dir,'accounts.lock');await mkdir(lock);await utimes(lock,new Date(0),new Date(0));
  const store=new Accounts(dir);await store.save({userid:'1',token:'saved'});assert.equal((await store.current()).token,'saved');await assert.rejects(stat(lock),{code:'ENOENT'});
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('cover URLs accept Kugou image CDN while rejecting unrelated, credentialed and malformed URLs',()=>{
 assert.equal(coverUrl('http://c1.kgimg.com/custom/{size}/x.jpg').href,'http://c1.kgimg.com/custom/600/x.jpg');
 assert.equal(coverUrl('https://imge.kugou.com/{size}/x.jpg',200).href,'https://imge.kugou.com/200/x.jpg');
 for(const raw of ['garbage','https://kgimg.com.evil.com/a','https://evilkgimg.com/a','file:///tmp/a','https://user:secret@c1.kgimg.com/a'])assert.equal(coverUrl(raw),null);
});
