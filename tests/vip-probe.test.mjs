import test from 'node:test';
import assert from 'node:assert/strict';
import { probe, credentials, vipSnapshot } from '../tools/vip-probe.mjs';

const vip = expires => ({ status: 1, data: { busi_vip: [{ vip_type: 1, vip_end_time: expires, token: 'secret' }] } });
function mock(responses) {
  const calls = [];
  return { calls, request: async route => {
    calls.push(route);
    const next = responses.shift();
    if (next instanceof Error) throw next;
    assert.ok(next, 'unexpected extra request');
    return next;
  } };
}
test('read-only does not issue reward requests and redacts extra fields', async () => {
  const io = mock([{ data: { nickname: 'private' } }, vip('2026-10-04')]);
  const result = await probe(io);
  assert.equal(result.verdict, 'not_tested');
  assert.deepEqual(io.calls, ['/user/detail', '/user/vip/detail']);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});
test('accepted response without entitlement change is not success', async () => {
  const io = mock([{ data: { nickname: 'x' } }, vip('2026-10-04'), { status: 1 }, vip('2026-10-04')]);
  assert.equal((await probe({ ...io, claim: true })).verdict, 'accepted_but_unverified');
});
test('changed entitlement still requires app confirmation', async () => {
  const io = mock([{ data: { nickname: 'x' } }, vip('2026-10-04'), { status: 1 }, vip('2026-10-05')]);
  assert.equal((await probe({ ...io, claim: true })).verdict, 'changed_needs_app_confirmation');
});
test('already claimed and daily limit stop without repeated claims', async () => {
  for (const [error_code, expected] of [[130012, 'already_claimed'], [30002, 'daily_limit']]) {
    const io = mock([{ data: { nickname: 'x' } }, vip('2026-10-04'), { error_code }, vip('2026-10-04')]);
    assert.equal((await probe({ ...io, claim: true })).verdict, expected);
    assert.equal(io.calls.length, 4);
  }
});
test('invalid login stops before any reward request', async () => {
  const io = mock([{ status: 0 }]);
  await assert.rejects(probe({ ...io, claim: true }), /登录/);
  assert.equal(io.calls.length, 1);
});
test('claim timeout is not retried', async () => {
  const io = mock([{ data: { nickname: 'x' } }, vip('2026-10-04'), new Error('timeout')]);
  await assert.rejects(probe({ ...io, claim: true }), /timeout/);
  assert.equal(io.calls.length, 3);
});
test('credentials reject cookie injection and VIP failures do not look successful', () => {
  assert.throws(() => credentials({ userid: 123, token: 'x; userid=456' }));
  assert.throws(() => vipSnapshot({ status: 0 }));
});
