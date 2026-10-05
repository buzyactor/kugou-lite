import {clean, songRows} from './library.mjs';
import {playlistInfo} from './playlist-info.mjs';
import {searchTracks} from './music.mjs';
export const searchTypes=['song','playlist','album','artist'];
export const artistTabs=['heat','songs','albums'];
export const profileTabs=['简介','基本资料','演艺经历','主要作品','荣誉记录'];
const id=value=>/^\d+$/.test(String(value??''))?String(value):'';
export const numeric=value=>(typeof value==='number'||typeof value==='string'&&value.trim()!=='')&&Number.isFinite(Number(value))&&Number(value)>=0?Number(value):null;
export function prose(value){return String(value??'').replace(/\\n/g,'\n').replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]*>/g,'').replace(/[\x00-\x08\x0b-\x1f\x7f]/g,'').slice(0,100000);}
export function albumRows(rows){
 if(!Array.isArray(rows))throw new Error('专辑列表格式异常');
 return rows.map(r=>({kind:'album',albumId:id(r.album_id??r.albumid),title:clean(r.album_name??r.albumname??r.name),artist:clean(r.author_name??r.singer??r.authors?.map(a=>a.author_name).join(' / ')),cover:clean([r.sizable_cover,r.img,r.imgurl,r.cover].find(v=>typeof v==='string'&&/^https?:/.test(v))),count:numeric(r.song_count??r.songcount??r.audio_count),date:clean(r.publish_date??r.publish_time),description:prose(r.intro).slice(0,4000)})).filter(r=>r.albumId);
}
export function artistRows(rows){
 if(!Array.isArray(rows))throw new Error('歌手列表格式异常');
 return rows.map(r=>({kind:'artist',artistId:id(r.AuthorId??r.author_id??r.singerid),title:clean(r.AuthorName??r.author_name??r.singername),name:clean(r.AuthorName??r.author_name??r.singername),cover:clean(r.Avatar??r.sizable_avatar),photos:[r.Avatar,r.FirstFrameImage].filter(v=>typeof v==='string'&&/^https?:/.test(v)),fans:numeric(r.FansNum??r.fansnums),songs:numeric(r.AudioCount??r.song_count),albums:numeric(r.AlbumCount??r.album_count),heat:numeric(r.Heat)})).filter(r=>r.artistId);
}
export function searchRows(body,type){
 if(type==='song')return searchTracks(body).map(r=>({...r,kind:'song'}));
 const rows=body?.data?.lists;if(!Array.isArray(rows))throw new Error('搜索结果格式异常');
 if(type==='album')return albumRows(rows);
 if(type==='artist')return artistRows(rows);
 if(type==='playlist')return rows.map(r=>({...playlistInfo(r),kind:'playlist',publicId:String(r.gid??r.global_collection_id??''),creator:clean(r.nickname),title:clean(r.specialname??r.name)})).filter(r=>/^[\w-]{1,160}$/.test(r.publicId));
 throw new Error('未知搜索分类');
}
export async function catalogSearch(request,keyword,type,page,size){
 if(!searchTypes.includes(type)||!keyword.trim()||keyword.length>200||!Number.isInteger(page)||page<1||!Number.isInteger(size)||size<1||size>1000)throw new Error('搜索参数无效');
 const params=new URLSearchParams({keywords:keyword,type:{playlist:'special',artist:'author'}[type]??type,page:String(page),pagesize:String(size)});
 return searchRows(await request('/search?'+params),type);
}
export function artistInfo(body,seed={}){
 const raw=body?.data??{};const r=Array.isArray(raw)?raw[0]??{}:raw;
 const photos=[];
 const photo=v=>{if(typeof v==='string'&&/^https?:\/\//.test(v)){const value=clean(v).replace(/(\/softhead\/)\d+(\/)/,'$1{size}$2');if(!photos.includes(value))photos.push(value);}else if(v&&typeof v==='object'){for(const k of ['url','imgurl','pic','image','sizable_avatar','sizable_cover'])photo(v[k]);}};
 for(const v of [r.sizable_avatar,r.avatar,r.cover,r.FirstFrameImage,...(seed.photos??[]),seed.cover])photo(v);
 for(const key of ['photos','photo_list','images','homepage_photos','gallery'])if(Array.isArray(r[key]))r[key].forEach(photo);
 const sections=Object.fromEntries(profileTabs.map(title=>[title,'']));
 for(const item of Array.isArray(r.long_intro)?r.long_intro:[])if(profileTabs.includes(item.title))sections[item.title]=prose(item.content);
 sections['简介'] ||= prose(r.intro??seed.description);
 const auth=r.certification??r.authentication??r.auth_info??r.auth_desc;
 const authentication=clean(typeof auth==='object'?auth?.description??auth?.name:auth);
 return {artistId:id(r.author_id??seed.artistId),name:clean(r.author_name??seed.name??seed.title),birthday:clean(r.birthday),authentication,
  listeners:numeric(r.total_listeners??r.listen_user_count??r.cumulative_listeners),fans:numeric(r.fansnums??r.fans_count??seed.fans),guardians:numeric(r.guardian_count??r.guard_count),
  songs:numeric(r.song_count??seed.songs),albums:numeric(r.album_count??seed.albums),photos:photos.slice(0,100),photoIndex:0,sections,loaded:0,complete:false};
}
export function heatShares(rows){
 const known=rows.filter(r=>r.heat>0);const total=known.reduce((sum,r)=>sum+r.heat,0);
 return rows.map(r=>({...r,share:total>0&&r.heat>0?r.heat/total:null}));
}
export function artistSongs(body){
 const raw=body?.data;if(!Array.isArray(raw))throw new Error('歌手单曲格式异常');
 return raw.flatMap(r=>songRows([r]).map(track=>({...track,kind:'song',heat:numeric(r.heat??r.hot??r.play_count??r.playcount)})));
}
export class ArtistCatalog {
 constructor(){this.cache=new Map();this.epoch=0;}
 clear(){this.cache.clear();this.epoch++;}
 async load(request,artistId,seed={},progress=()=>{},cancelled=()=>false){
  if(!id(artistId))throw new Error('歌手编号无效');
  if(this.cache.has(artistId))return this.cache.get(artistId);
  const epoch=this.epoch;let detail;
  try{detail=await request('/artist/detail?id='+artistId);}catch{detail={};}
  const info=artistInfo(detail,{...seed,artistId}),songs=[],seen=new Set();const started=Date.now();let expected=null,received=0;
  for(let page=1;page<=100;page++){
   if(epoch!==this.epoch||cancelled())throw new Error('歌手读取已取消');
   if(Date.now()-started>120000){info.notice='读取时间已达上限，显示已获取歌曲';break;}
   const body=await request(`/artist/audios?id=${artistId}&sort=hot&page=${page}&pagesize=100`);
   const raw=body.data;if(!Array.isArray(raw))throw new Error('歌手单曲格式异常');
   expected=numeric(body.total??body.total_count)??expected;received+=raw.length;
   let added=0;for(const row of artistSongs(body)){const key=row.hash+'|'+row.audioId;if(!seen.has(key)){seen.add(key);songs.push(row);added++;}}
   progress(songs.length,expected);
   if(!raw.length||raw.length<100||expected!==null&&received>=expected){info.complete=true;break;}
   if(!added){info.notice='接口返回重复分页，显示已获取歌曲';break;}
  }
  if(epoch!==this.epoch||cancelled())throw new Error('歌手读取已取消');
  info.loaded=songs.length;info.expected=expected;if(!info.complete&&!info.notice)info.notice='已达目录读取上限，显示已获取歌曲';
  info.heatKnown=songs.filter(r=>r.heat>0).length;info.heatTotal=songs.reduce((s,r)=>s+(r.heat>0?r.heat:0),0);
  const entry={info,songs:heatShares(songs)};this.cache.set(artistId,entry);while(this.cache.size>2)this.cache.delete(this.cache.keys().next().value);return entry;
 }
}
