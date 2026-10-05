import { randomUUID } from 'node:crypto';

export function localRequest(cookie = '', fetchImpl = fetch, baseValue = process.env.KUGOU_API_BASE || 'http://127.0.0.1:3000') {
  const base = new URL(baseValue);
  if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
    throw new Error('API 地址必须为 http://127.0.0.1:端口');
  }
  return async route => {
    if (!route.startsWith('/') || route.startsWith('//')) throw new Error('无效 API 路径');
    const url = new URL(route, base);
    if (url.origin !== base.origin) throw new Error('无效 API 来源');
    url.searchParams.set('timestrap', randomUUID());
    let response;
    try {
      response = await fetchImpl(url, { headers: { cookie, 'cache-control': 'no-store' }, redirect: 'error', signal: AbortSignal.timeout(15000) });
    } catch {
      throw new Error('本地 API 不可用或请求超时；如果已发出领取请求，请先查询权益再决定是否重试。');
    }
    let body;
    try { body = await response.json(); }
    catch { throw new Error('API 返回非 JSON'); }
    // 此上游将酷狗业务拒绝映射成 502，保留已知业务码供调用方分类。
    if (!response.ok && !(response.status === 502 && [130012, 30002].includes(body?.error_code))) {
      throw new Error(`API HTTP ${response.status}，请求未完成验证`);
    }
    return body;
  };
}
