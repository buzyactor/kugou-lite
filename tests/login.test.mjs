import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { login, parseLogin, privateWrite } from '../src/login.ts';
import { localRequest } from '../src/local-api.mjs';

test('502 business codes remain classifiable; other HTTP failures reject', async () => {
  for (const error_code of [130012, 30002]) {
    const request = localRequest('', async () => new Response(JSON.stringify({ status: 0, error_code }), { status: 502 }));
    assert.equal((await request('/youth/vip')).error_code, error_code);
  }
  await assert.rejects(localRequest('', async () => new Response('{}', { status: 502 }))('/user/detail'), /HTTP 502/);
  assert.throws(() => localRequest('secret', fetch, 'https://example.com'));
  await assert.rejects(localRequest()('//example.com'), /路径/);
});
test('QR login saves credentials privately and removes QR artifact', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kugou-login-'));
  const responses = [
    { status: 1, data: { qrcode: 'test-key' } },
    { data: { base64: 'data:image/png;base64,YQ==' } },
    { status: 1, data: { status: 1 } },
    { status: 1, data: { status: 2 } },
    { status: 1, data: { status: 4, userid: 123, token: 'test-token' } },
  ];
  const states = [];
  try {
    await login({ request: async () => responses.shift(), directory: dir, onReady: () => {}, onState: s => states.push(s), intervalMs: 1 });
    assert.deepEqual(states, ['waiting', 'confirm', 'success']);
    assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'account.json'))), { userid: '123', token: 'test-token' });
    assert.equal((await stat(path.join(dir, 'account.json'))).mode & 0o777, 0o600);
    assert.equal((await stat(dir)).mode & 0o777, 0o700);
    await assert.rejects(stat(path.join(dir, 'login.html')), { code: 'ENOENT' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('expired QR leaves previous account intact and cleans QR', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kugou-expire-'));
  const responses = [{ status: 1, data: { qrcode: 'key' } }, { data: { base64: 'data:image/png;base64,YQ==' } }, { status: 1, data: { status: 0 } }];
  try {
    await privateWrite(path.join(dir, 'account.json'), 'previous-account');
    await assert.rejects(login({ request: async () => responses.shift(), directory: dir, onReady: () => {} }), /过期/);
    assert.equal(await readFile(path.join(dir, 'account.json'), 'utf8'), 'previous-account');
    await assert.rejects(stat(path.join(dir, 'login.html')), { code: 'ENOENT' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('login rejects missing token and unknown states', () => {
  assert.throws(() => parseLogin({ status: 1, data: { status: 4, userid: 123 } }), /凭证/);
  assert.throws(() => parseLogin({ status: 1, data: { status: 3 } }), /未知/);
});
test('QR result preserves native provider session t1 for subsequent renewal',()=>{
  const result=parseLogin({status:1,data:{status:4,userid:123,token:'token',t1:'session+/=|native'}});
  assert.equal(result.account.t1,'session+/=|native');
  assert.equal(parseLogin({status:1,data:{status:4,userid:123,token:'token',t1:'bad;token=injection'}}).account.t1,undefined);
});
