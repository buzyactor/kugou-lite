import {playlists} from './library.mjs';
export function playlistGroup(list,userid){
 if(Number(list.type)===1)return 'collected';
 if(list.ownerId&&userid&&list.ownerId!==String(userid))return 'collected';
 return 'created';
}
// Filter the complete cloud directory before slicing; mixed server pages would
// otherwise leave sparse pages and hide collections after an empty first page.
export class UserPlaylists {
 constructor(){this.rows=null;this.epoch=0;this.userid='';}
 clear(){this.rows=null;this.epoch++;}
 async page(request,userid,kind,page,size){
  if(this.userid!==String(userid)){this.clear();this.userid=String(userid);}
  if(!this.rows){
   const epoch=this.epoch,all=[],seen=new Set();let complete=false;
   for(let p=1;p<=100;p++){
    const rows=playlists(await request(`/user/playlist?page=${p}&pagesize=100`));
    if(epoch!==this.epoch)throw new Error('歌单读取已取消');
    let added=0;
    for(const row of rows){const key=row.listid+'|'+row.publicId;if(!seen.has(key)){seen.add(key);all.push(row);added++;}}
    if(rows.length<100){complete=true;break;}
    if(!added)throw new Error('歌单接口重复返回同一页，请刷新重试');
   }
   if(!complete)throw new Error('歌单目录超过读取上限，未显示不完整结果');
   this.rows=all;
  }
  return this.rows.filter(r=>playlistGroup(r,userid)===kind).slice((page-1)*size,page*size);
 }
}
