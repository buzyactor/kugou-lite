import { Accounts } from '../src/accounts.mjs';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { localRequest } from '../src/local-api.mjs';
import { directRequest } from '../src/direct-api.mjs';
import { privateWrite, validSessionValue } from '../src/login.ts';
import { fileURLToPath } from 'node:url';

export function credentials(value) {
  if (!value || !/^\d+$/.test(String(value.userid)) ||
      typeof value.token !== 'string' || !/^[A-Za-z0-9._~-]+$/.test(value.token)) {
    throw new Error('凭证格式错误：需要 userid 和 token；请勿在聊天中发送 token。');
  }
  const extra=['dfid','vip_token','KUGOU_API_GUID','KUGOU_API_MID','KUGOU_API_DEV','KUGOU_API_MAC'].filter(key=>typeof value[key]==='string'&&(key==='KUGOU_API_MAC'?/^(?:[A-Fa-f0-9]{2}:){5}[A-Fa-f0-9]{2}$/:/^[A-Za-z0-9._~-]+$/).test(value[key])).map(key=>`${key}=${value[key]}`);
  if(validSessionValue(value.t1))extra.push(`t1=${value.t1}`);
  return [`token=${value.token}`,`userid=${value.userid}`,...extra].join('; ');
}

export function summarizeClaim(body) {
  if (body?.status === 1) return 'accepted';
  if (body?.error_code === 130012) return 'already_claimed';
  if (body?.error_code === 30002) return 'daily_limit';
  return 'rejected';
}

export function vipSnapshot(body) {
  if (body?.status !== 1 || !Array.isArray(body.data?.busi_vip)) {
    throw new Error('会员详情不可用，无法验证权益。');
  }
  // 输出白名单，避免将会员接口的 token、昵称等写入报告。
  return body.data.busi_vip.map(item => ({
    type: String(item.product_type ?? item.busi_type ?? item.vip_type ?? 'unknown'),
    active: item.is_vip === 1 ? true : item.is_vip === 0 ? false : null,
    expires: String(item.vip_end_time ?? 'unknown'),
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

export async function probe({ request, claim = false, reward = 'listen' }) {
  if (!['listen', 'ad'].includes(reward)) throw new Error('reward 必须为 listen 或 ad');
  const user = await request('/user/detail');
  if (user?.data?.nickname == null) throw new Error('登录校验失败或登录已失效。');
  const before = vipSnapshot(await request('/user/vip/detail'));
  if (!claim) return { mode: 'read_only', before, verdict: 'not_tested' };
  const response = await request(reward === 'listen' ? '/youth/listen/song' : '/youth/vip');
  const state = summarizeClaim(response);
  // 不自动重试领取；网络超时可能发生在服务端已发放之后。
  const after = vipSnapshot(await request('/user/vip/detail'));
  const changed = JSON.stringify(before) !== JSON.stringify(after);
  return {
    mode: 'claim_once', reward, claim: state,
    errorCode: typeof response?.error_code === 'number' ? response.error_code : null,
    before, after, entitlementChanged: changed,
    // 变化可能来自其他设备领取、业务类型变化或异步到账，需要核对 APP。
    verdict: state === 'accepted' && changed ? 'changed_needs_app_confirmation' :
      state === 'accepted' ? 'accepted_but_unverified' : state,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('KUGOU_AUTH_FILE=.local/account.json npm run vip:probe -- [--claim] [--direct] [--reward=listen|ad]\n默认只读。--claim 会进行一次真实领取上报；ad 为广告播放上报。');
    return;
  }
  if (args.some(arg => !['--claim', '--direct', '--reward=listen', '--reward=ad'].includes(arg))) {
    throw new Error('未知参数，请使用 --help。');
  }
  const authFile = process.env.KUGOU_AUTH_FILE || fileURLToPath(new URL('../.local/account.json', import.meta.url));
  if (!authFile) throw new Error('缺少 KUGOU_AUTH_FILE；尚未执行真实账号测试。');
  let auth;
  try { auth = process.env.KUGOU_AUTH_FILE ? JSON.parse(readFileSync(authFile, 'utf8')) : await new Accounts(fileURLToPath(new URL('../.local/', import.meta.url))).current(); }
  catch { throw new Error('凭证文件不可读或不是有效 JSON。'); }
  const cookie = credentials(auth);
  const request = args.includes('--direct') ? directRequest(cookie) : localRequest(cookie);
  const result = await probe({ request, claim: args.includes('--claim'),
    reward: args.includes('--reward=ad') ? 'ad' : 'listen' });
  const report = { recordedAt: new Date().toISOString(), ...result };
  const reportFile = fileURLToPath(new URL('../.local/vip-latest.json', import.meta.url));
  await privateWrite(reportFile, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (result.mode === 'claim_once' && !['already_claimed', 'daily_limit'].includes(result.verdict)) {
    process.exitCode = result.claim === 'rejected' ? 1 : 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
