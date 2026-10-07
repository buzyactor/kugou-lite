import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const routes = {
  '/everyday/recommend': 'everyday_recommend',
  '/top/playlist': 'top_playlist',
  '/top/song': 'top_song',
  '/rank/list': 'rank_list',
  '/rank/audio': 'rank_audio',
  '/playlist/track/all': 'playlist_track_all',
  '/playlist/detail': 'playlist_detail',
  '/rank/info': 'rank_info',
  '/search': 'search',
  '/search/suggest': 'search_suggest',
  '/search/hot': 'search_hot',
  '/artist/detail': 'artist_detail',
  '/artist/audios': 'artist_audios',
  '/artist/albums': 'artist_albums',
  '/artist/honour': 'artist_honour',
  '/album/detail': 'album_detail',
  '/album/songs': 'album_songs',
  '/login/token': 'login_token',
  '/register/dev': 'register_dev',
  '/user/playlist': 'user_playlist',
  '/playlist/track/all/new': 'playlist_track_all_new',
  '/playlist/tracks/add': 'playlist_tracks_add',
  '/playlist/tracks/del': 'playlist_tracks_del',
  '/playlist/add': 'playlist_add',
  '/playlist/update': 'playlist_update',
  '/playlist/tracks/sort': 'playlist_tracks_sort',
  '/search/lyric': 'search_lyric',
  '/lyric': 'lyric',
  '/song/url': 'song_url',
  '/login/qr/key': 'login_qr_key',
  '/login/qr/create': 'login_qr_create',
  '/login/qr/check': 'login_qr_check',
  '/user/detail': 'user_detail',
  '/user/vip/detail': 'user_vip_detail',
  '/youth/listen/song': 'youth_listen_song',
  '/youth/vip': 'youth_vip',
};

export async function unwrapRequest(call) {
  try { return (await call()).body; }
  catch (error) {
    const body = error?.body;
    if ([130012, 30002].includes(body?.error_code)) return body;
    // 不转发上游 message 或 Axios 配置，其中可能包含完整登录参数。
    const code = typeof body?.code === 'string' && /^[A-Z_]+$/.test(body.code) ? body.code : null;
    const business = Number.isInteger(body?.error_code) ? body.error_code : null;
    const failure=new Error(`酷狗接口请求失败${code ? `（${code}）` : business ? `（业务码 ${business}）` : ''}。`);
    failure.businessCode=business;failure.transportCode=code;failure.retryable=business===null&&(['EAI_AGAIN','ENOTFOUND','ECONNRESET','ECONNREFUSED','ETIMEDOUT','ECONNABORTED','EPIPE','ENETUNREACH'].includes(code)||body?.httpStatus>=500);throw failure;
  }
}

// Authentication has one provider for this experiment, independent of music API selection.
export const LOGIN_PROVIDER = 'KuGouMusicApi@1.6.2';
const AUTH_ROUTES = new Set(['/login/token','/login/qr/key','/login/qr/create','/login/qr/check','/register/dev']);
const MANAGEMENT_ROUTES=new Set(['/playlist/add','/playlist/update','/playlist/tracks/sort']);
const clients = new Map();
function apiClient(api) {
  if(clients.has(api))return clients.get(api);
  process.env.platform = 'lite';
  const root = (api==='modern'?['../KuGouMusicApi/']:['../kgcheckin/api/', '../references/kgcheckin/api/'])
    .map(p => fileURLToPath(new URL(p, import.meta.url))).find(p => existsSync(p + 'util/request.js'));
  if(!root)throw new Error(`未找到 ${api==='modern'?'KuGouMusicApi':'kgcheckin/api'}；不会回退登录接口`);
  const require = createRequire(root + 'package.json');
  let createRequest;
  try {
    const axios = require('axios');axios.defaults.timeout = 15000;axios.defaults.maxRedirects = 0;
    ({createRequest} = require(root + 'util/request.js'));
  } catch {throw new Error('所选 API 依赖缺失；不会回退登录接口');}
  const client={require,root,createRequest};clients.set(api,client);return client;
}
export function directRequest(cookie = '', {api = 'legacy', transport} = {}) {
  if(!['legacy','modern'].includes(api))throw new Error('未知 API 版本');
  const auth = Object.fromEntries(cookie.split(';').filter(Boolean).map(pair => {
    const i = pair.indexOf('=');return [pair.slice(0, i).trim(), pair.slice(i + 1).trim()];
  }));
  return async route => {
    const url = new URL(route, 'http://local.invalid');
    const moduleName = routes[url.pathname];
    if(url.origin !== 'http://local.invalid' || !moduleName)throw new Error('不支持的接口');
    const client=apiClient(AUTH_ROUTES.has(url.pathname)||MANAGEMENT_ROUTES.has(url.pathname)?'modern':api);
    const module=client.require(client.root+'module/'+moduleName+'.js');
    const params=Object.fromEntries(url.searchParams);
    if(url.pathname==='/playlist/add'){params.type=Number(params.type??0);params.source=Number(params.source??0);params.is_pri=Number(params.is_pri??0);}
    let timer;
    try {
      return await Promise.race([
        unwrapRequest(()=>module({...params,cookie:{...auth}},options=>{
          // Keep upstream v5 encryption/response decoding; only use the existing HTTPS router.
          const secured=url.pathname==='/login/token'?{...options,baseURL:'https://gateway.kugou.com',headers:{...options.headers,'x-router':'login.user.kugou.com'}}:options;
          return (transport??client.createRequest)(secured);
        })),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('接口等待超过 20 秒；结果未知，请勿自动重试写入操作'),{retryable:true,transportCode:'ETIMEDOUT'})),20000);}),
      ]);
    } finally {clearTimeout(timer);}
  };
}
