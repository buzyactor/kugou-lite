import test from 'node:test';
import assert from 'node:assert/strict';
import { unwrapRequest, directRequest } from '../src/direct-api.mjs';
import { vipSnapshot } from '../tools/vip-probe.mjs';
import {createRequire} from 'node:module';

test('direct response preserves business limits without exposing request errors', async () => {
  for (const error_code of [130012, 30002]) {
    const body = { status: 0, error_code };
    assert.deepEqual(await unwrapRequest(async () => { throw { body }; }), body);
  }
  await assert.rejects(unwrapRequest(async () => { throw { body: { code: 'EAI_AGAIN', msg: 'secret-token' } }; }), error => error.message.includes('EAI_AGAIN') && !error.message.includes('secret-token'));
});
test('VIP summary distinguishes product and explicit active flag', () => {
  const values = vipSnapshot({ status: 1, data: { busi_vip: [
    { product_type: 'svip', is_vip: 0, vip_end_time: '2026-10-01', token: 'secret' },
    { product_type: 'tvip', is_vip: 1, vip_end_time: '2026-10-05' },
    { product_type: 'other', vip_end_time: '2099-01-01' },
  ] } });
  assert.equal(values.find(v => v.type === 'svip').active, false);
  assert.equal(values.find(v => v.type === 'tvip').active, true);
  assert.equal(values.find(v => v.type === 'other').active, null);
  assert.ok(!JSON.stringify(values).includes('secret'));
});
test('direct adapter rejects routes outside the allowlist before requesting', async () => {
  const request = directRequest();
  await assert.rejects(request('https://example.com/user/detail'), /不支持/);
  await assert.rejects(request('/user/delete'), /不支持/);
});
test('QR and renewal use native modern modules even when music API is legacy, without fallback',async()=>{
  const require=createRequire(import.meta.url),calls=[];
  const request=directRequest('userid=1; token=test; t1=session; KUGOU_API_GUID=guid; KUGOU_API_MAC=02:00:00:00:00:01; KUGOU_API_DEV=KugouLite',{api:'legacy',transport:async options=>{
    calls.push(options);return {body:{status:1,data:{status:1}},cookie:[]};
  }});
  await request('/login/qr/key');await request('/login/qr/check?key=synthetic');await request('/login/token');
  assert.equal(calls[0].url,'/v2/qrcode');assert.equal(calls[1].params.dev,'KugouLite');
  assert.equal(calls[2].url,'/v5/login_by_token');assert.equal(calls[2].baseURL,'https://gateway.kugou.com');assert.equal(calls[2].headers['x-router'],'login.user.kugou.com');
  assert.notEqual(calls[2].data.t1,0);assert.notEqual(calls[2].data.t2,0);
  assert.ok(require.cache[require.resolve('../KuGouMusicApi/module/login_token.js')]);
  assert.equal(require.cache[require.resolve('../kgcheckin/api/module/login_token.js')],undefined);
  let attempts=0;
  await assert.rejects(directRequest('',{transport:async()=>{attempts++;throw {body:{code:'ECONNRESET'}};}})('/login/token'));
  assert.equal(attempts,1,'rotating requests are never retried through another provider');
});

test('playlist creation uses modern module with numeric creation flags and never retries writes',async()=>{
 const calls=[],request=directRequest('userid=1; token=fixture',{transport:async options=>{calls.push(options);return {body:{status:1}};}});
 await request('/playlist/add?name=Test&type=0&source=0&is_pri=1&list_create_userid=1&list_create_listid=0');
 assert.equal(calls.length,1);assert.equal(calls[0].data.type,0);assert.equal(calls[0].data.source,0);assert.equal(calls[0].data.is_pri,1);
 assert.equal(calls[0].url,'/cloudlist.service/v5/add_list');
});

test('native encrypted cloud modules receive versions and positions without falling back to legacy',async()=>{
 const require=createRequire(import.meta.url),util=require('../KuGouMusicApi/util/index.js'),original=util.createCloudRequest,calls=[];
 const paths=['../KuGouMusicApi/module/playlist_tracks_sort.js','../KuGouMusicApi/module/playlist_update.js'];
 try{
  util.createCloudRequest=async options=>{calls.push(options);return {body:{status:1}};};
  const request=directRequest('userid=1; token=fixture');
  await request('/playlist/tracks/sort?listid=1&list_ver=7&data=12|60,15|59');
  await request('/playlist/update?listid=1&total_ver=9&name=New&sort=2&tags=Pop&intro=Keep&pic=custom/original.jpg');
  assert.equal(calls[0].url,'/v1/modify_song_sort');assert.equal(calls[0].data.list_ver,7);
  assert.deepEqual(calls[0].data.data,[{fileid:12,sort:60},{fileid:15,sort:59}]);
  assert.equal(calls[1].url,'/v1/modify_list');assert.equal(calls[1].data.total_ver,9);assert.equal(calls[1].data.intro,'Keep');
  assert.ok(paths.every(path=>require.cache[require.resolve(path)]));
 }finally{util.createCloudRequest=original;for(const path of paths)delete require.cache[require.resolve(path)];}
});
