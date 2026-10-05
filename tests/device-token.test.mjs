import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {Device} from '../src/device.mjs';
import {refreshLite} from '../src/token-refresh.mjs';
import {credentials} from '../tools/vip-probe.mjs';
const require=createRequire(import.meta.url);
const crypto=require('../kgcheckin/api/util/crypto.js');
test('device survives registration network failure and application restart',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'kugou-device-'));const calls=[];
 try{
  const first=await new Device(dir,async route=>{calls.push(route);throw new Error('network');}).get();
  const next=await new Device(dir,async route=>{calls.push(route);return {status:1,data:{dfid:'registered'}};}).get();
  assert.equal(first.KUGOU_API_GUID,next.KUGOU_API_GUID);assert.equal(first.KUGOU_API_MID,next.KUGOU_API_MID);assert.equal(first.KUGOU_API_MAC,next.KUGOU_API_MAC);assert.equal(calls[0],calls[1]);
  const restart=await new Device(dir,()=>{throw new Error('must not register twice');}).get();assert.deepEqual(restart,next);
  const cookie=credentials({...next,userid:'1',token:'token',t1:'session+/='});assert.ok(cookie.includes('KUGOU_API_GUID='+next.KUGOU_API_GUID));assert.ok(cookie.includes('t1=session+/='));assert.ok(cookie.includes('KUGOU_API_MAC='));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('v5 renewal includes encrypted stable device and session fields, decrypts returned token',async()=>{
 const cookie={userid:'1',token:'old',dfid:'dfid',t1:'session',KUGOU_API_GUID:'guid',KUGOU_API_DEV:'KugouLite',KUGOU_API_MAC:'02:00:00:00:00:01'};
 const reply=await refreshLite({cookie},async options=>{
  assert.equal(options.url,'/v5/login_by_token');assert.ok(options.baseURL.startsWith('https:'));
  const now=options.data.clienttime_ms;
  assert.equal(crypto.cryptoAesDecrypt(options.data.t1,'5e4ef500e9597fe004bd09a46d8add98','04bd09a46d8add98'),`session|${now}`);
  assert.equal(crypto.cryptoAesDecrypt(options.data.t2,'fd14b35e3f81af3817a20ae7adae7020','17a20ae7adae7020'),`guid|0f607264fc6318a92b9e13c65db7cd3c|02:00:00:00:00:01|KugouLite|${now}`);
  return {body:{status:1,data:{token:'new',userid:1,t1:'returned'}}};
 },crypto);
 assert.equal(reply.body.data.token,'new');assert.equal(reply.body.data.t1,'returned');
});
test('v5 secure response unpacks rotated token and t1',async()=>{
 let key;
 const helpers={...crypto,cryptoAesEncrypt:(data,options)=>{const result=crypto.cryptoAesEncrypt(data,options);if(!options)key=result.key;return result;}};
 const reply=await refreshLite({cookie:{userid:'1',token:'old',KUGOU_API_GUID:'guid',KUGOU_API_DEV:'KugouLite',KUGOU_API_MAC:'02:00:00:00:00:01'}},async()=>({body:{status:1,data:{userid:1,secu_params:crypto.cryptoAesEncrypt({token:'rotated',t1:'new-session'},{key}).str}}}),helpers);
 assert.equal(reply.body.data.token,'rotated');assert.equal(reply.body.data.t1,'new-session');
});
