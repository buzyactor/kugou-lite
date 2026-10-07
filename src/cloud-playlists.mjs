import {playlists,songRows} from './library.mjs';
import {playlistGroup} from './user-playlists.mjs';
import {Favorites,uniqueTracks,memberFiles} from './favorites.mjs';
const id=value=>/^\d+$/.test(String(value))&&Number.isSafeInteger(Number(value))&&Number(value)>0;
const version=value=>value!==undefined&&value!==null&&String(value).trim()!==''&&Number.isSafeInteger(Number(value))&&Number(value)>=0;
const check=current=>{if(!current())throw new Error('歌单操作已取消');};
export function playlistName(value){
 const name=String(value).trim();
 if(!name||Array.from(name).length>80||/[\x00-\x1f\x7f]/.test(name))throw new Error('歌单名称需为1–80字，不能包含控制字符');
 return name;
}
export function requireOwned(list,userid){
 if(!list||!id(list.listid)||Number(list.type)!==0||!list.ownerId||String(list.ownerId)!==String(userid)||playlistGroup(list,userid)!=='created')throw new Error('只能编辑自己创建的歌单');
}
export async function ownedDirectory(read,userid){
 const rows=[],seen=new Set();let totalVer;
 for(let page=1;page<=100;page++){
  const body=await read(`/user/playlist?page=${page}&pagesize=100`),batch=playlists(body);
  const raw=body?.data?.info??body?.data?.lists??body?.info;
  const ver=body?.data?.total_ver??body?.total_ver;
  if(version(ver)){if(totalVer!==undefined&&Number(ver)!==totalVer)throw new Error('歌单目录已变化，请重新操作');totalVer=Number(ver);}
  let added=0;
  for(const row of batch){if(seen.has(row.listid))continue;seen.add(row.listid);added++;if(playlistGroup(row,userid)==='created')rows.push({...row,raw:raw.find(r=>String(r.listid)===row.listid)});}
  if(raw.length<100)return {rows,totalVer};
  if(!added)throw new Error('歌单目录重复分页，未继续写入');
 }
 throw new Error('歌单目录读取超限');
}
async function freshList(read,userid,list){
 requireOwned(list,userid);
 const directory=await ownedDirectory(read,userid),current=directory.rows.find(r=>r.listid===String(list.listid));
 requireOwned(current,userid);return {list:current,totalVer:directory.totalVer};
}
export async function ownedSongs(read,userid,list){
 requireOwned(list,userid);const rows=[],seen=new Set();let listVer,count;
 for(let page=1;page<=667;page++){
  const body=await read(`/playlist/track/all/new?listid=${list.listid}&page=${page}&pagesize=30`);
  const raw=body?.data?.info??body?.data?.songs??body?.info,ver=body?.data?.list_ver??body?.list_ver;
  if(!Array.isArray(raw)||raw.length>30)throw new Error('歌单歌曲格式异常');
  if(version(ver)){if(listVer!==undefined&&Number(ver)!==listVer)throw new Error('歌单歌曲已变化，请重新操作');listVer=Number(ver);}
  const declared=body?.data?.count??body?.count;
  if(version(declared)){if(count!==undefined&&Number(declared)!==count)throw new Error('歌单歌曲已变化，请重新操作');count=Number(declared);}
  for(const item of raw){
   const track=songRows([item])[0];
   if(!track||!id(item.fileid)||seen.has(String(item.fileid)))throw new Error('歌单含无效或重复fileid，未继续写入');
   seen.add(String(item.fileid));rows.push({track,fileid:String(item.fileid),sort:item.sort});
  }
  if(raw.length<30){if(count!==undefined&&rows.length!==count)throw new Error('歌单歌曲未完整读取');return {rows,listVer};}
 }
 throw new Error('歌单歌曲读取超限');
}
export function reorderSongs(snapshot,tracks,position){
 if(!version(snapshot.listVer))throw new Error('缺少歌单版本，不能调整位置');
 const rows=snapshot.rows,sorts=rows.map(r=>Number(r.sort));
 if(rows.some(r=>!version(r.sort))||new Set(sorts).size!==rows.length)throw new Error('歌单排序号无效，不能调整位置');
 const direction=sorts.length>1?Math.sign(sorts[1]-sorts[0]):1;
 if(sorts.some((v,i)=>i&&Math.sign(v-sorts[i-1])!==direction))throw new Error('歌单云端顺序不明确，请刷新后重试');
 // Match the same catalog identities as favorites, while retaining all source file IDs.
 const selected=rows.filter(row=>tracks.some(track=>uniqueTracks([track,row.track]).length===1));
 if(!selected.length||tracks.some(track=>!selected.some(row=>uniqueTracks([track,row.track]).length===1)))throw new Error('选中歌曲已不在此歌单，请刷新后重试');
 const ids=new Set(selected.map(r=>r.fileid)),remaining=rows.filter(row=>!ids.has(row.fileid));
 if(!/^[1-9]\d*$/.test(String(position))||Number(position)>remaining.length+1)throw new Error(`位置编号须为1–${remaining.length+1}（移动后第一首的位置）`);
 const ordered=remaining.slice();ordered.splice(Number(position)-1,0,...selected);
 return {ordered,changed:ordered.flatMap((row,index)=>rows[index].fileid!==row.fileid?[[row.fileid,sorts[index]]]:[]),position:Number(position),count:selected.length};
}
export class CloudPlaylists {
 favorites=new Favorites();
 async create(read,write,userid,value,current=()=>true){
  const name=playlistName(value),before=await ownedDirectory(read,userid);check(current);
  const result=await write('/playlist/add?'+new URLSearchParams({name,type:'0',source:'0',list_create_userid:String(userid),list_create_listid:'0'}));
  if(result?.status!==1)throw new Error('创建结果未确认，请刷新目录，勿直接重试');
  try{const after=await ownedDirectory(read,userid),known=new Set(before.rows.map(r=>r.listid)),created=after.rows.filter(r=>!known.has(r.listid)&&r.title===name);return {verified:created.length===1,list:created[0],name};}catch{return {verified:false,name};}
 }
 async rename(read,write,userid,list,value,current=()=>true){
  const name=playlistName(value),fresh=await freshList(read,userid,list),raw=fresh.list.raw;
  if(!version(fresh.totalVer)||!version(raw?.sort)||raw.tags===undefined||typeof raw.intro!=='string')throw new Error('歌单资料不完整，不能安全修改名称');
  const tags=Array.isArray(raw.tags)?raw.tags.map(tag=>typeof tag==='string'?tag:tag?.name??tag?.tag_name??'').join(','):String(raw.tags);
  check(current);const result=await write('/playlist/update?'+new URLSearchParams({listid:list.listid,type:'0',total_ver:String(fresh.totalVer),name,sort:String(raw.sort),tags,intro:raw.intro,...(raw.pic?{pic:String(raw.pic)}:{})}));
  if(result?.status!==1)throw new Error('改名结果未确认，请刷新目录');
  try{return {verified:(await freshList(read,userid,list)).list.title===name,name};}catch{return {verified:false,name};}
 }
 async prepareTransfer(read,userid,source,target,tracks,operation){
  if(!['copy','move'].includes(operation))throw new Error('未知歌单操作');
  const targetList=(await freshList(read,userid,target)).list,wanted=uniqueTracks(tracks);
  const targetState=await this.favorites.inspect(read,userid,targetList,wanted);
  let sourceState=null;
  if(operation==='move'){
   const sourceList=(await freshList(read,userid,source)).list;
   if(String(source.listid)===String(target.listid))throw new Error('原歌单和目标歌单不能相同');
   sourceState=await this.favorites.inspect(read,userid,sourceList,wanted);
   if(sourceState.missing.length||sourceState.existing.some(row=>memberFiles(sourceState,row).some(file=>!id(file))))throw new Error('原歌单歌曲或fileid已变化，请刷新后重试');
  }
  return {userid:String(userid),source:sourceState?.list,target:targetList,tracks:wanted,operation,missing:targetState.missing.length};
 }
 async transfer(read,write,state,current=()=>true){
  const fresh=await this.prepareTransfer(read,state.userid,state.source,state.target,state.tracks,state.operation);check(current);
  let targetState=await this.favorites.inspect(read,state.userid,fresh.target,state.tracks);
  if(targetState.missing.length){
   check(current);const added=await this.favorites.apply(async route=>route.startsWith('/playlist/tracks/add?')?write(route):read(route),targetState,'add');
   if(!added.verified)throw new Error('目标歌单添加尚未核对，原歌单已保留；请重新读取两边歌单');
  }
  if(state.operation==='move'){
   check(current);
   // Re-read both after adding. Delete only while every selected song still exists in the target.
   targetState=await this.favorites.inspect(read,state.userid,fresh.target,state.tracks);
   if(targetState.missing.length)throw new Error('目标歌单缺少歌曲，原歌单已保留');
   const source=await this.favorites.inspect(read,state.userid,fresh.source,state.tracks);check(current);
   if(source.missing.length)throw new Error('原歌单已变化，未继续删除，请重新读取');
   const removed=await this.favorites.apply(async route=>route.startsWith('/playlist/tracks/del?')?write(route):read(route),source,'remove');
   return {verified:removed.verified,count:state.tracks.length,sourceCount:removed.totalCount};
  }
  return {verified:true,count:state.tracks.length};
 }
 async reorder(read,write,userid,list,tracks,position,current=()=>true){
  const fresh=await freshList(read,userid,list),snapshot=await ownedSongs(read,userid,fresh.list),plan=reorderSongs(snapshot,tracks,position);check(current);
  if(!plan.changed.length)return {verified:true,count:plan.count,position:plan.position};
  const result=await write('/playlist/tracks/sort?'+new URLSearchParams({listid:list.listid,type:'0',list_ver:String(snapshot.listVer),data:plan.changed.map(([file,sort])=>file+'|'+sort).join(',')}));
  if(result?.status!==1)throw new Error('位置调整结果未确认，请刷新歌单');
  try{const after=await ownedSongs(read,userid,fresh.list);return {verified:JSON.stringify(after.rows.map(r=>r.fileid))===JSON.stringify(plan.ordered.map(r=>r.fileid)),count:plan.count,position:plan.position};}catch{return {verified:false,count:plan.count,position:plan.position};}
 }
}
