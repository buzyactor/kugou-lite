import {playlistSongs} from './library.mjs';
const valid=id=>typeof id==='string'&&/^[\w-]{1,160}$/.test(id);
export function collectionId(row) {
  return [row.global_collection_id,row.list_create_gid,row.gid,row.extra?.global_collection_id].map(v=>String(v??'')).find(valid)||'';
}
export async function playlistTracks(request,list,page,size) {
  const gid=list.publicId||collectionId(list);
  const personal=String(list.listid??'');
  const shared=list.type===1||list.type==='1'||list.collected===true;
  const query=`page=${page}&pagesize=${size}`;
  const publicRoute=valid(gid)?`/playlist/track/all?id=${encodeURIComponent(gid)}&${query}`:null;
  const privateRoute=/^\d+$/.test(personal)?`/playlist/track/all/new?listid=${personal}&${query}`:null;
  const routes=shared||!privateRoute?[publicRoute,privateRoute]:[privateRoute,publicRoute];
  const candidates=[...new Set(routes.filter(Boolean))];
  if(!candidates.length)throw new Error('歌单缺少可用编号，请刷新歌单列表');
  // Authentication errors must be refreshed/re-authenticated, not retried anonymously.
  const response=await request(candidates[0]);
  if(Number(response?.error_code)===20017){const error=new Error('歌单登录凭证已失效（20017）');error.businessCode=20017;throw error;}
  return playlistSongs(response);
}
