import { mkdir, chmod, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

type Account = { userid: string; token: string; vip_token?: string; dfid?: string; t1?: string; username?: string };
type Reply = { status?: number; data?: { qrcode?: string; status?: number; userid?: string | number; token?: string; vip_token?: string; dfid?: string; t1?: string; nickname?: string; base64?: string } };
type Request = (route: string) => Promise<Reply>;

export const validSessionValue = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._~+/=|\-]{1,4096}$/.test(value);

export function parseLogin(reply: Reply): { state: 'waiting' | 'confirm' | 'expired' | 'success'; account?: Account } {
  if (reply.status !== 1) throw new Error('二维码状态请求失败');
  switch (reply.data?.status) {
    case 0: return { state: 'expired' };
    case 1: return { state: 'waiting' };
    case 2: return { state: 'confirm' };
    case 4: {
      const { userid, token } = reply.data;
      if (!/^\d+$/.test(String(userid)) || typeof token !== 'string' || !/^[A-Za-z0-9._~-]+$/.test(token)) throw new Error('登录结果缺少有效凭证');
      const account: Account = { userid: String(userid), token };
      for(const key of ['vip_token','dfid'] as const) {const value=reply.data[key];if(typeof value==='string'&&/^[A-Za-z0-9._~-]+$/.test(value))account[key]=value;}
      if(validSessionValue(reply.data.t1))account.t1=reply.data.t1;
      if(typeof reply.data.nickname==='string')account.username=reply.data.nickname.replace(/[\x00-\x1f\x7f]/g,'').trim().slice(0,80);
      return { state: 'success', account };
    }
    default: throw new Error('未知二维码状态，请重新登录');
  }
}

export async function privateWrite(file: string, content: string) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await chmod(path.dirname(file), 0o700);
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { mode: 0o600, flag: 'wx' });
    await rename(temporary, file);
  } finally { await rm(temporary, { force: true }); }
}

export async function login({ request, directory, onReady, onState = () => {}, timeoutMs = 120000, intervalMs = 3000, accountExtras = {} }: {
  request: Request; directory: string; onReady: (file: string) => void;
  onState?: (state: string) => void; timeoutMs?: number; intervalMs?: number; accountExtras?: Record<string, string>;
}) {
  const qrFile = path.join(directory, 'login.html');
  const keyReply = await request('/login/qr/key');
  const key = keyReply.data?.qrcode;
  if (keyReply.status !== 1 || typeof key !== 'string' || !key) throw new Error('获取二维码失败');
  const qrReply = await request(`/login/qr/create?key=${encodeURIComponent(key)}&qrimg=1`);
  const image = qrReply.data?.base64;
  if (typeof image !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image)) throw new Error('二维码图片无效');
  try {
    await privateWrite(qrFile, `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Kugou Lite 登录</title><style>body{font:18px system-ui;background:#101725;color:#edf3ff;text-align:center;padding:60px}img{width:300px;background:white;padding:16px;border-radius:16px}p{color:#aabbd0}</style><h1>登录 Kugou Lite</h1><img src="${image}" alt="登录二维码"><p>使用酷狗音乐 APP 扫码，并在手机上确认登录。</p><p>二维码约两分钟有效，登录结果请查看终端。</p></html>`);
    onReady(qrFile);
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const result = parseLogin(await request(`/login/qr/check?key=${encodeURIComponent(key)}`));
      onState(result.state);
      if (result.state === 'expired') throw new Error('二维码已过期，请重新运行 npm run login');
      if (result.account) {
        await privateWrite(path.join(directory, 'account.json'), JSON.stringify({ ...accountExtras, ...result.account }) + '\n');
        return;
      }
      await delay(intervalMs);
    }
    throw new Error('等待扫码超时，请重新运行 npm run login');
  } finally { await rm(qrFile, { force: true }); }
}
