import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Accounts} from '../src/accounts.mjs';

test('explicit reset clears corrupt/legacy credentials and derived data without migration, preserves settings/dependencies',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'kugou-reset-'));
  try {
    for(const name of ['accounts.json','account.json','accounts.json.interrupted.tmp','account.json.bak','device.json','vip-baseline.json','vip-latest.json','playback-latest.json','kotonoha.log','queues.json','play-history.json'])await writeFile(path.join(directory,name),'corrupt-old-data');
    for(const name of ['covers','api-runtime'])await mkdir(path.join(directory,name));
    await writeFile(path.join(directory,'covers','cover.png'),'cached');
    await writeFile(path.join(directory,'ui.json'),'settings');
    const accounts=new Accounts(directory);await accounts.clear();
    assert.deepEqual(await accounts.read(),{version:1,active:null,accounts:[]});
    await assert.rejects(accounts.current(),/没有已保存账号/);
    for(const name of ['account.json','accounts.json.interrupted.tmp','account.json.bak','device.json','vip-baseline.json','vip-latest.json','playback-latest.json','covers','kotonoha.log','accounts.lock','queues.json','play-history.json'])await assert.rejects(stat(path.join(directory,name)),{code:'ENOENT'});
    assert.equal(await readFile(path.join(directory,'ui.json'),'utf8'),'settings');assert.ok((await stat(path.join(directory,'api-runtime'))).isDirectory());
    assert.equal((await stat(path.join(directory,'accounts.json'))).mode&0o777,0o600);
    await accounts.save({userid:'123',token:'new',t1:'new-session',loginProvider:'KuGouMusicApi@1.6.2'});
    assert.equal((await accounts.current()).loginProvider,'KuGouMusicApi@1.6.2');assert.equal((await accounts.current()).t1,'new-session');
  } finally {await rm(directory,{recursive:true,force:true});}
});
