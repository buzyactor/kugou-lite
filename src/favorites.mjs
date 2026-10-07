import {songRows,favoriteParams} from './library.mjs';
import {playlistGroup} from './user-playlists.mjs';
export const trackKey=row=>Number(row.audioId)>0?'audio:'+row.audioId:'hash:'+String(row.hash).toLowerCase();
const trackKeys=row=>[...(Number(row.audioId)>0?['audio:'+row.audioId]:[]),...[row.hash,row.flacHash].filter(h=>/^[a-f\d]{32}$/i.test(h??'')&&!/^0{32}$/.test(h)).map(h=>'hash:'+h.toLowerCase())];
export function uniqueTracks(rows){
 const seen=new Set();return rows.filter(row=>{const keys=trackKeys(row),known=keys.some(key=>seen.has(key));keys.forEach(key=>seen.add(key));return !known;});
}
export function memberFiles(state,row){return [...new Set(trackKeys(row).flatMap(key=>state.members.get(key)??[]))];}
export class Favorites {
 async inspect(request,userid,list,tracks){
  // Live owned lists have type=0 and the current ownerId, yet is_mine=0.
  // That flag is not an ownership predicate for this directory endpoint.
  if(playlistGroup(list,userid)!=='created'||!/^\d+$/.test(String(list.listid)))throw new Error('只能编辑自己创建的歌单');
  const wanted=uniqueTracks(tracks);if(!wanted.length||wanted.length>100)throw new Error('每次请选择 1–100 首歌曲');
  const members=new Map(),seen=new Set(),started=Date.now();
  for(let p=1;;p++){
   if(p>667||Date.now()-started>120000)throw new Error('收藏状态读取超限，请重试');
   const body=await request(`/playlist/track/all/new?listid=${list.listid}&page=${p}&pagesize=30`);
   const raw=body?.data?.info??body?.data?.songs??body?.info;
   if(!Array.isArray(raw)||raw.length>30)throw new Error('收藏状态分页格式异常');
   const signature=JSON.stringify(raw.map(row=>[row.fileid,row.hash,row.audio_info?.hash,row.mixsongid]));
   if(raw.length&&seen.has(signature))throw new Error('收藏状态接口重复分页');seen.add(signature);
   for(const row of raw){
    const track=songRows([row])[0];if(!track)throw new Error('歌单含无法识别的歌曲，收藏状态未确认');
    for(const key of trackKeys(track)){const files=members.get(key)??[];files.push(String(row.fileid??''));members.set(key,files);}
   }
   if(raw.length<30)break;
  }
  const existing=wanted.filter(row=>memberFiles({members},row).length),missing=wanted.filter(row=>!memberFiles({members},row).length);
  return {userid:String(userid),list:{...list},tracks:wanted,existing,missing,members};
 }
 async apply(request,state,action){
  if(!['add','remove'].includes(action))throw new Error('未知收藏操作');
  let route;
  if(action==='add'){
   if(!state.missing.length)throw new Error('这些歌曲已经收藏');
   const data=state.missing.map(row=>favoriteParams(row,String(state.list.listid)).get('data')).join(',');
   route='/playlist/tracks/add?'+new URLSearchParams({listid:state.list.listid,data});
  }else{
   const ids=[...new Set(state.existing.flatMap(row=>memberFiles(state,row)))];
   if(!ids.length||ids.some(id=>!/^\d+$/.test(id)||!Number.isSafeInteger(Number(id))||Number(id)<=0))throw new Error('缺少有效歌单 fileid，不能移除');
   route='/playlist/tracks/del?'+new URLSearchParams({listid:state.list.listid,fileids:ids.join(',')});
  }
  // One mutation only. A timeout has an unknown outcome; callers must inspect
  // the cloud list again before offering another action.
  const result=await request(route);
  if(result?.status!==1)throw new Error('收藏操作结果未确认，请重新读取目标歌单');
  try{
   const checked=await this.inspect(request,state.userid,state.list,state.tracks);
   const verified=action==='add'?checked.missing.length===0:checked.existing.length===0;
   return {verified,action,count:action==='add'?state.missing.length:state.existing.length};
  }catch{return {verified:false,action,count:action==='add'?state.missing.length:state.existing.length};}
 }
}
