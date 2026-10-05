import test from 'node:test';
import assert from 'node:assert/strict';
import {SessionReader} from '../src/session-reader.mjs';
const expired=()=>Object.assign(new Error('expired'),{businessCode:20017});
function store(){const data={active:'1',accounts:[{userid:'1',token:'old',username:'One',tokenUpdatedAt:Date.now()},{userid:'2',token:'other'}]};return {data,read:async()=>structuredClone(data),current:async()=>({...data.accounts.find(a=>a.userid===data.active)}),update:async change=>change(data)};}
test('20017 refreshes once, persists only matching account, retries read with new token',async()=>{
 const accounts=store(),calls=[];
 const reader=new SessionReader(accounts,token=>async route=>{
  calls.push([token,route]);
  if(route==='/login/token')return {status:1,data:{userid:1,token:'new'}};
  if(token==='old')throw expired();return {data:{info:[]}};
 },a=>a.token,()=>{},async()=>{});
 assert.deepEqual(await reader.request('/user/playlist?page=1'),{data:{info:[]}});
 assert.deepEqual(calls,[['old','/user/playlist?page=1'],['old','/user/playlist?page=1'],['old','/login/token'],['new','/user/playlist?page=1']]);
 assert.equal(accounts.data.accounts[0].token,'new');assert.equal(accounts.data.accounts[0].username,'One');assert.equal(accounts.data.accounts[1].token,'other');
});
test('failed refresh preserves account and stops repeated attempts, never retries writes',async()=>{
 const accounts=store();let refreshes=0;
 const reader=new SessionReader(accounts,()=>async route=>{if(route==='/login/token')refreshes++;throw expired();},a=>a.token,()=>{},async()=>{});
 for(let i=0;i<2;i++)await assert.rejects(reader.request('/user/playlist'),e=>e.businessCode===20017);
 assert.equal(refreshes,1);assert.equal(accounts.data.accounts[0].token,'old');
 await assert.rejects(reader.request('/playlist/tracks/add?listid=1'));assert.equal(refreshes,1);
});
test('mismatched refresh identity cannot replace an account',async()=>{
 const accounts=store();const reader=new SessionReader(accounts,()=>async route=>{if(route==='/login/token')return {status:1,data:{userid:2,token:'different'}};throw expired();},a=>a.token,()=>{},async()=>{});
 await assert.rejects(reader.request('/user/playlist'),e=>e.businessCode===20017);assert.equal(accounts.data.accounts[0].token,'old');
});
test('proactive renewal is saved across restart with t1 and device information',async()=>{
 const accounts=store();Object.assign(accounts.data.accounts[0],{tokenUpdatedAt:0,dfid:'stable',KUGOU_API_GUID:'guid'});
 const calls=[];
 const factory=token=>async route=>{calls.push([token,route]);return route==='/login/token'?{status:1,data:{userid:1,token:'new',t1:'saved-t1+/=',vip_token:'vip'}}:{status:1};};
 const first=new SessionReader(accounts,factory,a=>a.token,()=>{},async()=>{});
 await first.request('/song/url?hash=test');
 assert.equal(accounts.data.accounts[0].t1,'saved-t1+/=');assert.equal(accounts.data.accounts[0].dfid,'stable');
 await new SessionReader(accounts,factory,a=>a.token).request('/user/playlist');
 assert.equal(calls.filter(([,r])=>r==='/login/token').length,1);
});
test('concurrent expired reads share one renewal and do not duplicate rotation',async()=>{
 const accounts=store();let count=0;
 const reader=new SessionReader(accounts,token=>async route=>{
  if(route==='/login/token'){count++;await new Promise(r=>setTimeout(r,10));return {status:1,data:{userid:1,token:'new'}};}
  if(token==='old')throw expired();return {status:1};
 },a=>a.token,()=>{},async()=>{});
 await Promise.all([reader.request('/user/playlist'),reader.request('/user/detail')]);
 assert.equal(count,1);
});
test('transport retry keeps the account, writes remain single-shot, cooldown survives restart',async()=>{
 const accounts=store();let attempts=0;
 const transient=()=>Object.assign(new Error('network'),{retryable:true});
 const factory=()=>async route=>{attempts++;if(route==='/login/token'||attempts<3)throw transient();return {status:1};};
 const reader=new SessionReader(accounts,factory,a=>a.token,()=>{},async()=>{});
 await reader.request('/user/detail');assert.equal(attempts,3);assert.equal(accounts.data.accounts[0].token,'old');
 assert.equal(await reader.maintain(true),false);
 const after=attempts;
 await new SessionReader(accounts,factory,a=>a.token).maintain(true);assert.equal(attempts,after);
 attempts=0;await assert.rejects(reader.request('/playlist/tracks/add'));assert.equal(attempts,1);
});
test('stale request reuses a token another window saved',async()=>{
 const accounts=store();let rotations=0;
 const reader=new SessionReader(accounts,token=>async route=>{
  if(route==='/login/token'){rotations++;return {};}
  if(token==='old'){accounts.data.accounts[0].token='other-window';throw expired();}
  return {status:1};
 },a=>a.token,()=>{},async()=>{});
 assert.deepEqual(await reader.request('/user/playlist'),{status:1});assert.equal(rotations,0);
});
test('temporary 20017 rechecks same credential without rotation and records success',async()=>{
 const accounts=store();let reads=0,rotations=0;
 const reader=new SessionReader(accounts,()=>async route=>{
  if(route==='/login/token'){rotations++;throw new Error('unnecessary rotation');}
  if(++reads===1)throw expired();return {status:1};
 },a=>a.token,()=>{},async ms=>assert.equal(ms,1000));
 assert.deepEqual(await reader.request('/user/playlist'),{status:1});
 assert.equal(reads,2);assert.equal(rotations,0);assert.equal(accounts.data.accounts[0].token,'old');
 assert.ok(accounts.data.accounts[0].lastReadSuccessAt>0);assert.equal(accounts.data.accounts[0].lastAuthRejectedAt,undefined);
});
test('account switch during rejection delay never reads or renews the newly selected account',async()=>{
 const accounts=store();let calls=0;
 const reader=new SessionReader(accounts,()=>async()=>{calls++;throw expired();},a=>a.token,()=>{},async()=>{accounts.data.active='2';});
 await assert.rejects(reader.request('/user/playlist'),/账号已切换/);assert.equal(calls,1);
});
test('confirmed rejection records safe time and code, renewal preserves QR login time',async()=>{
 const accounts=store();accounts.data.accounts[0].loggedInAt=123;
 const reader=new SessionReader(accounts,token=>async route=>{
  if(route==='/login/token')return {status:1,data:{userid:1,token:'new'}};
  if(token==='old')throw expired();return {status:1};
 },a=>a.token,()=>{},async()=>{});
 await reader.request('/user/detail');const account=accounts.data.accounts[0];
 assert.equal(account.loggedInAt,123);assert.equal(account.lastAuthRejectedCode,20017);
 assert.ok(account.lastAuthRejectedAt>0);assert.ok(account.lastReadSuccessAt>0);
});
