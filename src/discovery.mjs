import {clean,songRows,playlistSongs} from './library.mjs';
import {playlistInfo,mergePlaylistDetail} from './playlist-info.mjs';

export const hubs = {
  recommend: [
    {title:'每日推荐歌曲',description:'根据酷狗账号生成的每日歌曲推荐',action:'daily',icon:'♪'},
    {title:'推荐歌单',description:'酷狗精选歌单，发现下一首喜欢的歌',action:'recommended',icon:'♡'},
  ],
  discover: [
    {title:'新歌速递',description:'最近上架的新音乐',action:'new',icon:'✦'},
    {title:'排行榜',description:'打开榜单，浏览热门歌曲',action:'ranks',icon:'≡'},
    {title:'Hi-Res 精选歌单',description:'无损主题歌单；实际音质仍以播放检测为准',action:'hires',icon:'◇'},
  ],
};
export function publicPlaylists(body) {
  const rows=body?.data?.special_list;
  if(!Array.isArray(rows))throw new Error('推荐歌单格式异常');
  return rows.map(r=>({...playlistInfo(r),title:clean(r.specialname??r.name),
    publicId:String(r.global_collection_id??r.list_create_gid??r.gid??r.extra?.global_collection_id??''),description:clean(r.intro??r.recommend_reason??''),icon:'≡'}))
    .filter(r=>/^[\w-]{1,160}$/.test(r.publicId));
}
export function ranks(body) {
  const rows=body?.data?.info;
  if(!Array.isArray(rows))throw new Error('排行榜格式异常');
  return rows.map(r=>({...playlistInfo(r),title:clean(r.rankname??r.name),rankId:String(r.rankid),icon:'≡',description:clean(r.intro??r.update_frequency??'')})).filter(r=>/^\d+$/.test(r.rankId));
}
// Daily recommendations and rank directory are finite lists, paginated locally.
export class Discovery {
  constructor(){this.cache=new Map();this.details=new Map();this.epoch=0;}
  clear(){this.cache.clear();this.details.clear();this.epoch++;}
  async catalog(request,rows) {
    const epoch=this.epoch;
    const missing=rows.filter(r=>!this.details.has(r.publicId));
    // The live endpoint rejects 20 IDs with 20010; batches of 10 are accepted.
    for(let start=0;start<missing.length;start+=10){
      if(epoch!==this.epoch)return rows;
      const batch=missing.slice(start,start+10);
      try{
        const body=await request('/playlist/detail?ids='+batch.map(r=>encodeURIComponent(r.publicId)).join(','));
        const items=Array.isArray(body?.data)?body.data:body?.data?.info;
        if(epoch!==this.epoch)return rows;
        if(Array.isArray(items))for(const item of items){
          const id=String(item.global_collection_id??item.list_create_gid??'');
          if(batch.some(r=>r.publicId===id))this.details.set(id,playlistInfo(item));
        }
        while(this.details.size>200)this.details.delete(this.details.keys().next().value);
      }catch{break; /* Keep the directory usable; don't repeat a failing batch across the page. */}
    }
    return rows.map(row=>{
      const detail=this.details.get(row.publicId);
      return detail?mergePlaylistDetail(row,{data:[detail]}):{...row,count:row.count===0?null:row.count};
    });
  }
  async load(request,kind,page,size,id='') {
    const slice=rows=>rows.slice((page-1)*size,page*size);
    if(kind==='daily'||kind==='ranks') {
      if(!this.cache.has(kind)) {
        const response=await request(kind==='daily'?'/everyday/recommend':'/rank/list');
        this.cache.set(kind,kind==='daily'?songRows(response?.data?.song_list):ranks(response));
      }
      return slice(this.cache.get(kind));
    }
    const paging=`page=${page}&pagesize=${size}`;
    if(kind==='recommended'||kind==='hires')return this.catalog(request,publicPlaylists(await request(`/top/playlist?category_id=${kind==='hires'?11292:0}&withsong=0&${paging}`)));
    if(kind==='new')return songRows((await request('/top/song?'+paging))?.data);
    if(kind==='rank')return songRows((await request(`/rank/audio?rankid=${encodeURIComponent(id)}&${paging}`))?.data?.songlist);
    if(kind==='public')return playlistSongs(await request(`/playlist/track/all?id=${encodeURIComponent(id)}&${paging}`));
    throw new Error('未知发现栏目');
  }
}
