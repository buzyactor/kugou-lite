import {SortedPlaylists,sortChoices,sortedQueue} from '../src/playlist-sort.mjs';
import {albumTracks,albumBatchSize} from '../src/album-tracks.mjs';
import {Favorites,trackKey,uniqueTracks,memberFiles} from '../src/favorites.mjs';
import {PlaybackRecovery} from '../src/playback-recovery.mjs';
import {QueueHistory} from '../src/queue-history.mjs';
import {QueueStore,emptyQueues} from '../src/queue-store.mjs';
import {PlayHistory} from '../src/play-history.mjs';
import {KotonohaAdapter} from '../src/kotonoha-adapter.mjs';
import {appendFile,mkdir,stat,rename} from 'node:fs/promises';
import {randomInt} from 'node:crypto';
import {NavigationHistory} from '../src/navigation-history.mjs';
import {ArtistCatalog,catalogSearch,searchTypes,artistTabs,profileTabs,albumRows} from '../src/catalog.mjs';
import {UserPlaylists} from '../src/user-playlists.mjs';
import {searchSuggestions,hotSearches} from '../src/search-suggestions.mjs';
import {playlistInfo,mergePlaylistDetail,nextSectionKind,sectionKinds} from '../src/playlist-info.mjs';
import {Device} from '../src/device.mjs';
import {SessionReader,expired,retryRead} from '../src/session-reader.mjs';
import {playlistTracks} from '../src/playlist-access.mjs';
import {qualities,qualityLabel,modes,nextIndex} from '../src/playback-options.mjs';
import {Discovery} from '../src/discovery.mjs';
import {Desktop, Spectrum} from '../src/desktop.mjs';
import { Accounts } from '../src/accounts.mjs';
import { playlists, playlistSongs, songRows, loadLyrics, coverPixels, coverPng, cacheCover, readCachedCover, cachedCoverPixels } from '../src/library.mjs';
import { Player, search, resolvePlayback } from '../src/music.mjs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { directRequest, LOGIN_PROVIDER } from '../src/direct-api.mjs';
import { parseLogin, privateWrite } from '../src/login.ts';
import { credentials, probe } from './vip-probe.mjs';
const directory = fileURLToPath(new URL('../.local/', import.meta.url));
const emit = event => console.log(JSON.stringify(event));
let adapterLogs=Promise.resolve(),pendingAdapterLogs=0,adapterLogFailed=false;
// Owned serial log writes; cap pending records and rotate at 1 MiB. No wire bodies/secrets.
const kotonoha=new KotonohaAdapter({onLog:record=>{
  if(pendingAdapterLogs>=64)return;pendingAdapterLogs++;
  adapterLogs=adapterLogs.then(async()=>{
    await mkdir(directory,{recursive:true,mode:0o700});
    const file=directory+'kotonoha.log';
    try{if((await stat(file)).size>1024*1024)await rename(file,file+'.1');}catch(e){if(e.code!=='ENOENT')throw e;}
    await appendFile(file,JSON.stringify({recordedAt:new Date().toISOString(),...record})+'\n',{mode:0o600});
  }).catch(()=>{if(!adapterLogFailed){adapterLogFailed=true;emit({kind:'status',message:'Kotonoha 诊断日志无法写入；播放不受影响'});}}).finally(()=>pendingAdapterLogs--);
}});
let pageSize=20, pendingSize=null, resizing=false;
let busy = false, closing = false, cancelGeneration=0;
let tracks = [], lists = [], pendingFavorite = null;
const favorites=new Favorites(),markedTracks=new Map();
let songActionContext=null,favoriteState=null,favoriteOrigin=null,plannedNext=null;
const rowMarked=row=>markedTracks.has(trackKey(row));
function visibleSongs(){return view==='queue'?(queueHistory.viewed?.tracks??[]).slice((page-1)*pageSize,page*pageSize):tracks;}
function selectedSong(raw){
 if(raw==='current'){if(!queue[queueIndex])throw new Error('没有当前歌曲');return queue[queueIndex];}
 const index=Number(raw),row=visibleSongs()[index];
 if(!Number.isInteger(index)||index<0||!row?.hash||row.kind&&row.kind!=='song')throw new Error('请选择歌曲');
 return row;
}
function sendMarks(){emit({kind:'marks',count:markedTracks.size,indices:visibleSongs().flatMap((row,i)=>rowMarked(row)?[i]:[])});}
const showActions=(title,actions)=>emit({kind:'actions',title,actions});
function syncEditedQueue(){
 const entry=queueHistory.playing;
 if(entry){queue=entry.tracks;queueIndex=entry.index;}else if(!queueHistory.entries.length){queue=[];queueIndex=-1;}
 desktop.update({...queueState()});
}
function stopRemovedTrack(){
 pendingHistoryTrack=null;pendingAuto=false;generation++;player.stop();position=0;
 desktop.update({track:null,artUrl:'',seconds:0,...queueState()});kotonoha.clearTrack();
 emit({kind:'quality'});emit({kind:'media',lyrics:[],pixels:[],title:''});emit({kind:'time',seconds:0});
}
async function beginFavorite(rows){
 const userid=String((await accounts.current()).userid);
 const chosen=uniqueTracks(rows);if(!chosen.length||chosen.length>100)throw new Error('每次请选择 1–100 首歌曲');
 favoriteOrigin={state:snapshot(),focus:{...focus}};favoriteState=null;
 pendingFavorite={tracks:chosen.map(row=>({...row})),userid};section='';pageTitle=`收藏到歌单 · ${chosen.length} 首`;view='favorite';
 await pageLoad(1);
}
async function finishFavorite(){
 const origin=favoriteOrigin;favoriteOrigin=null;favoriteState=null;pendingFavorite=null;
 if(origin){history.push(origin.state,origin.focus);await goBack();}
 emit({kind:'favorite_done'});sendMarks();
}
async function songMenu(raw){
 const track=selectedSong(raw),userid=String((await accounts.current()).userid);
 const entry=view==='queue'?queueHistory.viewed:null;
 songActionContext={userid,track:{...track},batch:[...markedTracks.values()].map(row=>({...row})),queueId:entry?.id,index:entry?(page-1)*pageSize+Number(raw):null,revision:queueHistory.revision};
 const actions=[['下一首播放（加入当前队列）','next'],['追加到当前队列','append'],['收藏／管理收藏','favorite'],[rowMarked(track)?'取消标记歌曲':'标记歌曲（批量操作）','mark']];
 if(markedTracks.size)actions.push([`收藏已标记 ${markedTracks.size} 首`,'favorite-batch'],['清空标记','clear-marks']);
 if(entry)actions.push(['移除这首队列歌曲','remove'],['上移一首','up'],['下移一首','down'],['重命名队列','rename'],[entry.pinned?'取消固定队列':'固定队列','pin']);
 showActions(track.title,actions.map(([title,action])=>({title,command:'songaction:'+action})));
}

let queue=[],queueIndex=-1,playbackStatus='Stopped',position=0,preferredQuality='flac',playMode='sequence',pendingAuto=false;
const queueHistory=new QueueHistory();
let queueOwner=null,savedQueueRevision=0,clearQueuesOnExit=false,autoSkipErrors=true,exitTask=null;
const recovery=new PlaybackRecovery();let recoveryStart=0,recoveryPlaybackGeneration=0,pendingFailure=null;
const queueState=()=>({next:nextIndex(queueIndex,queue.length,playMode)!==null,previous:nextIndex(queueIndex,queue.length,playMode,-1)!==null});
const sendPreferences=()=>{emit({kind:'preferences',quality:preferredQuality,mode:playMode});desktop.update({...queueState(),loop:playMode==='single'?'Track':playMode==='loop'?'Playlist':'None',shuffle:playMode==='shuffle'});};
let view = 'search', keyword = '', page = 1, playlistId = null, generation = 0;
let numberOffset=0,queueFocus=null;
let sortMode='default',sortSeed=1;
const sortedPlaylists=new SortedPlaylists();
const canSort=()=>view==='playlist'||view==='browse'&&!['recommended','hires','ranks'].includes(browseKind);
const sortKey=()=>JSON.stringify(view==='playlist'?[view,playlistId?.listid,playlistId?.publicId]:[view,browseKind,browseId]);
const sortInfo=()=>({canSort:canSort(),sortMode,sortLabel:sortChoices.find(([id])=>id===sortMode)?.[1]??'默认顺序'});
function sortLoader() {
 const context={view,list:structuredClone(playlistId),kind:browseKind,id:browseId};
 const publicCollection=section==='search';
 const request=route=>publicCollection?publicRead(route):session.request(route);
 return (p,size)=>context.view==='playlist'?playlistTracks(request,context.list,p,size):discovery.load(request,context.kind,p,size,context.id);
}
async function collectionPage(next,mode=sortMode,seed=sortSeed) {
 const key=sortKey(),revision=cancelGeneration;
 return sortedPlaylists.page(key,sortLoader(),mode,next,pageSize,seed,{expected:(view==='playlist'||browseKind==='public')?Number(playlistId?.count)||0:0,cancelled:()=>closing||revision!==cancelGeneration||sortKey()!==key,progress:count=>emit({kind:'status',message:`正在读取完整歌单：${count} 首`})});
}
async function playbackCollection(){
 if(canSort()){
  await collectionPage(page);
  return {rows:sortedPlaylists.all(sortKey(),sortMode,sortSeed),source:sortKey(),title:pageTitle};
 }
 if(view==='catalog'&&catalogMode==='artist'&&artistTab!=='albums'){
  const entry=artistCatalog.cache.get(artistId);
  if(!entry)throw new Error('歌手目录已失效，请刷新后重试');
  return {rows:entry.songs,source:JSON.stringify(['artist',artistId]),title:pageTitle+(entry.info.complete?'':' · 已获取歌曲')};
 }
 if(view==='catalog'&&catalogMode==='album'){
  const key=JSON.stringify(['album',albumId]),id=albumId,revision=cancelGeneration;
  await sortedPlaylists.page(key,(p,size)=>albumTracks(publicRead,id,p,size),
   'default',page,pageSize,1,{batchSize:albumBatchSize,expected:Number(collectionInfo?.count)||0,cancelled:()=>closing||revision!==cancelGeneration||albumId!==id,
    progress:count=>emit({kind:'status',message:`正在读取完整专辑：${count} 首`})});
  return {rows:sortedPlaylists.all(key,'default',1),source:key,title:pageTitle};
 }
 // Search results are open-ended pages, rather than a finite song collection.
 return {rows:null,source:JSON.stringify([view,keyword,page]),title:pageTitle+` · 第 ${page} 页`};
}
const accounts = new Accounts(directory);
const queueStore=new QueueStore(directory+'queues.json',action=>accounts.withLock(action));
async function saveQueues(clear=false){
  if(!queueOwner||(!clear&&queueHistory.revision===savedQueueRevision))return;
  const revision=queueHistory.revision;
  try{await queueStore.save(queueOwner,clear?emptyQueues():queueHistory.snapshot());savedQueueRevision=revision;}
  catch{emit({kind:'status',message:'播放列表无法保存；原文件已保留，播放仍可继续'});}
}
async function restoreQueues(){
  let userid;try{userid=(await accounts.current()).userid;}catch{return;}
  if(queueOwner===userid)return;
  queueOwner=userid;
  try{queueHistory.restore(await queueStore.load(userid));savedQueueRevision=queueHistory.revision;
    queue=queueHistory.playing?.tracks??[];queueIndex=queueHistory.playing?.index??-1;
  }catch{queueHistory.clear();queue=[];queueIndex=-1;emit({kind:'status',message:'保存的播放列表无法恢复；原文件已保留'});}
}
const playedHistory=new PlayHistory(directory+'play-history.json',action=>accounts.withLock(action));
let pendingHistoryTrack=null,historyWrites=Promise.resolve();
const discovery=new Discovery();
const userPlaylists=new UserPlaylists();
const artistCatalog=new ArtistCatalog();
let thumbnailSequence=0,currentThumbnailKey=0;
let catalogMode='',searchType='song',artistTab='heat',profileTab=1,artistId='',artistProfile=null,albumId='',catalogKey='',catalogEpoch=0;
const publicRead=route=>retryRead(directRequest(),route);
function sendCatalog(restored={}){
 currentThumbnailKey=++thumbnailSequence;
 emit({thumbnailKey:currentThumbnailKey,kind:'catalog',mode:catalogMode,searchType,artistTab,profileTab,artist:artistProfile,collectionInfo,collectionKey,key:catalogKey,query:keyword,page,title:pageTitle,resized:resizing,...restored,
 rows:tracks.map((r,i)=>({...r,marked:rowMarked(r),number:(page-1)*pageSize+i+1}))});
 if(catalogMode==='search'&&['artist','playlist','album'].includes(searchType)||catalogMode==='artist'&&artistTab==='albums')void rowThumbnails(tracks,currentThumbnailKey);
}
const thumbnailCache=new Map();
let thumbnailEpoch=0;
async function rowThumbnails(rows,thumbnailKey){
 const epoch=++thumbnailEpoch,currentView=view,currentPage=page;
 const live=()=>!closing&&epoch===thumbnailEpoch&&currentThumbnailKey===thumbnailKey&&view===currentView&&page===currentPage;
 let cursor=0;
 await Promise.allSettled(Array.from({length:3},async()=>{
  while(live()&&cursor<rows.length){
   const rowIndex=cursor++,row=rows[rowIndex];if(!row.cover)continue;
   let assets=thumbnailCache.get(row.cover);
   if(!assets){const [png,pixels]=await Promise.all([coverPng(row.cover,96),coverPixels(row.cover)]);assets={thumbnailPng:png,thumbnailPixels:pixels};if(png||pixels.length){thumbnailCache.set(row.cover,assets);while(thumbnailCache.size>48)thumbnailCache.delete(thumbnailCache.keys().next().value);}}
   if(live()){Object.assign(row,assets);emit({kind:'catalog_thumbnail',thumbnailKey,page:currentPage,rowIndex,cover:row.cover,...assets});}
  }
 }));
}
async function artistPhoto(){
 const epoch=catalogEpoch,key=catalogKey,info=artistProfile,index=info?.photoIndex??0,url=info?.photos?.[index];
 if(!info)return;info.png='';info.pixels=[];info.photoUnavailable=false;emit({kind:'catalog_assets',key,artist:info});
 if(!url)return;
 const live=()=>!closing&&epoch===catalogEpoch&&key===catalogKey&&artistProfile===info&&info.photoIndex===index;
 await Promise.allSettled([
  coverPng(url).then(png=>{if(live()){info.png=png;emit({kind:'catalog_assets',key,artist:info});}}),
  coverPixels(url).then(pixels=>{if(live()){info.pixels=pixels;emit({kind:'catalog_assets',key,artist:info});}})
 ]);
 if(live()&&!info.png&&!info.pixels.length){info.photoUnavailable=true;emit({kind:'catalog_assets',key,artist:info});}
}
async function catalogPage(next){
 const revision=cancelGeneration;const params=`page=${next}&pagesize=${pageSize}`;let rows;
 if(catalogMode==='profile'){tracks=[];sendCatalog();return;}
 if(catalogMode==='search')rows=await catalogSearch(publicRead,keyword,searchType,next,pageSize);
 else if(catalogMode==='artist'){
  if(artistTab==='albums')rows=albumRows((await publicRead(`/artist/albums?id=${artistId}&sort=hot&${params}`)).data);
  else {
   let entry=artistCatalog.cache.get(artistId);
   if(!entry){const revision=cancelGeneration;entry=await artistCatalog.load(publicRead,artistId,artistProfile??{},count=>emit({kind:'status',message:`正在读取歌手全部单曲：${count} 首`}),()=>closing||revision!==cancelGeneration);}
   if(!artistProfile){artistProfile=structuredClone(entry.info);void artistPhoto();}
   rows=entry.songs.slice((next-1)*pageSize,next*pageSize);
  }
 }else if(catalogMode==='album')rows=await albumTracks(publicRead,albumId,next,pageSize);
 else return;
 if(closing||revision!==cancelGeneration)throw new Error('读取已取消');
 if(!rows.length&&next>1){emit({kind:'status',message:'已经是最后一页'});return;}
 tracks=rows;page=next;numberOffset=(page-1)*pageSize;sendCatalog();
}
async function openEntity(index){
 const row=tracks[index];if(!row)throw new Error('请选择搜索结果');
 const revision=cancelGeneration;
 const commit=()=>{if(closing||revision!==cancelGeneration)throw new Error('读取已取消');catalogEpoch++;collectionEpoch++;collectionInfo=null;collectionKey='';};
 if(row.kind==='artist'){
  const revision=cancelGeneration;const entry=await artistCatalog.load(publicRead,row.artistId,row,count=>emit({kind:'status',message:`正在读取歌手全部单曲：${count} 首`}),()=>closing||revision!==cancelGeneration);
  commit();artistId=row.artistId;artistProfile=structuredClone(entry.info);artistTab='heat';catalogMode='artist';catalogKey='artist:'+artistId;pageTitle=artistProfile.name;view='catalog';section='';
  await catalogPage(1);void artistPhoto();return;
 }
 if(row.kind==='album'){
  const rows=await albumTracks(publicRead,row.albumId,1,pageSize);
  commit();albumId=row.albumId;artistProfile=null;catalogMode='album';catalogKey='album:'+albumId;view='catalog';section='';pageTitle=row.title;
  collectionKey=catalogKey;collectionInfo={...playlistInfo(row),title:row.title,creator:row.artist};
  tracks=rows;page=1;numberOffset=0;sendCatalog();void enrichCollection();return;
 }
 if(row.kind==='playlist'){
  const rows=await playlistTracks(publicRead,row,1,pageSize);
  commit();artistProfile=null;playlistId={...row};view='browse';section='search';browseKind='public';browseId=row.publicId;pageTitle=row.title;sortMode='default';sortSeed=1;
  collectionKey=sortKey();collectionInfo=playlistInfo(row);tracks=rows;page=1;numberOffset=0;sendTracks();void enrichCollection();return;
 }
 throw new Error('该结果不可打开');
}

const device=new Device(directory,route=>directRequest()(route));
const session=new SessionReader(accounts,directRequest,credentials,message=>emit({kind:'status',message}));
let section='',browseKind='',browseId='',pageTitle='歌曲';
let collectionInfo=null,collectionKey='',collectionEpoch=0;
const sectionInfo=()=>({browseKind,collectionInfo,collectionKey,sectionRoot:view==='browse'&&['daily','recommended','new','hires','ranks'].includes(browseKind)||view==='playlists'&&['created','collected'].includes(browseKind)});
const listEvent=(focus={})=>{currentThumbnailKey=++thumbnailSequence;emit({...focus,...sectionInfo(),thumbnailKey:currentThumbnailKey,kind:'playlists',page,lists,resized:resizing,section,title:pageTitle,selectFavorite:view==='favorite'});if(lists.some(r=>!r.action))void rowThumbnails(lists,currentThumbnailKey);};
async function openHub(name,kind=sectionKinds[name][0]){
 section=name;view='browse';browseKind=kind;browseId='';playlistId=null;page=1;sortMode='default';sortSeed=1;
 collectionInfo=null;collectionKey='';collectionEpoch++;
 pageTitle={daily:'每日推荐歌曲',recommended:'推荐歌单',new:'新歌速递',hires:'Hi-Res 精选歌单',ranks:'音乐排行榜'}[kind];
 return pageLoad(1);
}
const sendTracks = (focus={}) => emit({...focus,...sortInfo(),...sectionInfo(),kind:'tracks', page, view, section,title:pageTitle, resized:resizing, tracks:tracks.map((r,i)=>({title:r.title,artist:r.artist,vip:r.vip,duration:r.duration,marked:rowMarked(r),number:numberOffset+i+1}))});
async function enrichCollection(epoch=collectionEpoch) {
 const key=collectionKey;let info={...collectionInfo};
 const live=()=>!closing&&epoch===collectionEpoch&&key===collectionKey;
 try {
  const route=view==='catalog'&&catalogMode==='album'?'/album/detail?id='+encodeURIComponent(albumId):playlistId?.publicId?'/playlist/detail?ids='+encodeURIComponent(playlistId.publicId):playlistId?.rankId?'/rank/info?rankid='+encodeURIComponent(playlistId.rankId):null;
  if(route)info=mergePlaylistDetail(info,await ((view==='catalog'&&catalogMode==='album'||section==='search')?publicRead(route):session.request(route)));
 }catch{info.detailsUnavailable=true;}
 if(!live())return;
 collectionInfo=info;emit({kind:'collection_info',collectionKey:key,info});
 if(info.cover)await Promise.allSettled([
  coverPixels(info.cover).then(pixels=>{if(live()){collectionInfo.pixels=pixels;emit({kind:'collection_info',collectionKey:key,info:collectionInfo});}}),
  coverPng(info.cover).then(png=>{if(live()){collectionInfo.png=png;emit({kind:'collection_info',collectionKey:key,info:collectionInfo});}})
 ]);
}
const history=new NavigationHistory();
let focus={selected:0,offset:0};
function snapshot(){return structuredClone({view,keyword,page,pageSize,playlistId,section,browseKind,browseId,pageTitle,tracks,lists,pendingFavorite,sortMode,sortSeed,numberOffset,catalogMode,searchType,artistTab,profileTab,artistId,albumId,catalogKey,artistProfile:artistProfile?{...artistProfile,png:'',pixels:[]}:null,collectionKey,collectionInfo:collectionInfo?{...collectionInfo,png:'',pixels:[]}:null});}
async function goBack(){
  const previous=history.pop();
  if(!previous||(previous.view==='search'&&!previous.keyword)) {emit({kind:'home'});return;}
  ({view,keyword,page,pageSize,playlistId,section,browseKind,browseId,pageTitle,tracks,lists,pendingFavorite,sortMode,sortSeed,numberOffset,collectionInfo,collectionKey,catalogMode,searchType,artistTab,profileTab,artistId,albumId,catalogKey,artistProfile}=previous);collectionEpoch++;catalogEpoch++;
  if(collectionInfo)void enrichCollection();
  if(view==='catalog'){sendCatalog({selected:previous.selected,offset:previous.offset});if(artistProfile)void artistPhoto();return;}
  if(view==='accounts')return sendAccounts();
  if(view==='queue'){queueFocus=previous.selected??0;return pageLoad(page);}
  if(view==='history')return pageLoad(page);
  const restored={selected:previous.selected,offset:previous.offset};
  if(['hub','options','playlists','favorite'].includes(view)||view==='browse'&&['recommended','hires','ranks'].includes(browseKind))return listEvent(restored);
  sendTracks(restored);
}
let syncingNames=false;
async function syncNames() {
  if(syncingNames)return;syncingNames=true;
  try {
    const saved=await accounts.read();
    for(const account of saved.accounts) {
      if(closing)break;
      if(account.username)continue;
      try {
        const response=account.userid===saved.active?await session.request('/user/detail'):await retryRead(directRequest(credentials(account)),'/user/detail');
        if(typeof response?.data?.nickname==='string')await accounts.setName(account.userid,response.data.nickname);
      }catch{/* Offline accounts remain selectable. */}
    }
    const summary=await accounts.summary();
    emit({kind:'account_names',accounts:summary});
    const active=summary.find(a=>a.active);if(active)emit({kind:'account',label:active.label});
  } finally {syncingNames=false;}
}
async function sendAccounts() { emit({kind:'accounts',accounts:await accounts.summary()});void syncNames().catch(()=>{}); }
async function restore() {
  await restoreQueues();
  const summary = await accounts.summary();
  const active = summary.find(a=>a.active);
  if(active) { await accounts.update(()=>{}); emit({kind:'account',label:active.label});emit({kind:'status',message:'已恢复保存账号，无需重复扫码；登录状态会自动维护'}); }
  else {emit({kind:'account',label:'未登录'});emit({kind:'status',message:'没有保存的账号，请按 L 登录'});}
  void syncNames().catch(()=>{});
}
async function pageLoad(next) {
  if(view==='catalog')return catalogPage(next);
  let rows;
  if(view==='hub'||view==='options')return;
  if(view==='history'){
    await historyWrites;
    const rows=await playedHistory.list((await accounts.current()).userid);
    page=Math.max(1,Math.min(next,Math.ceil(rows.length/pageSize)||1));
    tracks=rows.slice((page-1)*pageSize,page*pageSize);numberOffset=(page-1)*pageSize;
    pageTitle=`已播放历史 · ${rows.length} 首`;sendTracks();return;
  }
  if(view==='queue'){
    const entry=queueHistory.viewed,items=entry?.tracks??[];
    next=Math.max(1,Math.min(next,Math.ceil(items.length/pageSize)||1));
    const rows=items.slice((next-1)*pageSize,next*pageSize);page=next;
    const ordinal=queueHistory.entries.findIndex(item=>item.id===entry?.id)+1;
    emit({kind:'queue',page,resized:resizing,queueId:entry?.id??null,queueCount:queueHistory.entries.length,
      title:entry?`队列 ${ordinal}/${queueHistory.entries.length} · ${entry.pinned?'★ ':''}${entry.title} · ${items.length} 首${entry.id===queueHistory.playingId?(playbackStatus==='Stopped'?' · 当前队列':' · 当前播放'):''}`:'队列历史为空',
      ...(queueFocus!==null?{selected:queueFocus}:{}),tracks:rows.map((r,i)=>({...r,marked:rowMarked(r),number:(page-1)*pageSize+i+1,active:playbackStatus!=='Stopped'&&entry.id===queueHistory.playingId&&(page-1)*pageSize+i===queueIndex,remembered:(page-1)*pageSize+i===entry.index}))});queueFocus=null;return;
  }
  const publicCollection=section==='search';
 const request=route=>publicCollection?publicRead(route):session.request(route);
  if(view==='browse') {
    rows=canSort()&&(sortMode!=='default'||sortedPlaylists.has(sortKey()))?await collectionPage(next):await discovery.load(request,browseKind,next,pageSize,browseId);
    if(!rows.length&&next>1){emit({kind:'status',message:'已经是最后一页'});return;}
    page=next;
    if(['recommended','hires','ranks'].includes(browseKind)){lists=rows;listEvent();return;}
    tracks=rows;numberOffset=(page-1)*pageSize;sendTracks();return;
  }
  if(view==='search') rows=await search(request,keyword,next,pageSize);
  else if(view==='playlist') rows=sortMode!=='default'||sortedPlaylists.has(sortKey())?await collectionPage(next):await playlistTracks(request,playlistId,next,pageSize);
  else if(view==='playlists'||view==='favorite') {
    rows=await userPlaylists.page(request,(await accounts.current()).userid,view==='favorite'?'created':browseKind,next,pageSize);
    if(!rows.length&&next>1) {emit({kind:'status',message:'已经是最后一页'});return;}
    lists=rows;page=next;listEvent();return;
  } else return;
  if(!rows.length&&next>1){emit({kind:'status',message:'已经是最后一页'});return;}
  tracks=rows;page=next;numberOffset=(page-1)*pageSize;sendTracks();
}
const spectrum=new Spectrum(emit);
const desktop=new Desktop(command=>void dispatch(command),emit);
const player = new Player(message => emit({ kind: 'status', message }), {
  onBitRate:value=>emit({kind:'bitrate',value}),
  onSeek:seconds=>{desktop.update({seconds,seeked:seconds});kotonoha.observeSeek(seconds);},
  onDuration:seconds=>kotonoha.observeDuration(seconds),
  onSeekable:seekable=>desktop.update({seekable}),
  onEnded:()=>void dispatch('autonext'),
  onFailure:error=>{if(!error.playbackFatal&&autoSkipErrors&&recoveryPlaybackGeneration===generation){pendingFailure={generation,queue,index:queueIndex};if(!busy)void dispatch('playbackfailure');}},
  onTime:seconds=>{if(recoveryPlaybackGeneration===generation&&seconds-recoveryStart>=5)recovery.reset();position=seconds;kotonoha.observeTime(seconds);emit({kind:'time',seconds});desktop.update({seconds});},
  onState:status=>{playbackStatus=status;kotonoha.observeState(status);emit({kind:'state',status});desktop.update({status,loaded:status!=='Stopped',...(status==='Stopped'?{seconds:0}:{})});if(status==='Playing'){
    spectrum.start();
    const started=pendingHistoryTrack;pendingHistoryTrack=null;
    if(started)historyWrites=historyWrites.then(()=>playedHistory.record(started.userid,started.track)).catch(()=>emit({kind:'status',message:'播放历史无法保存；播放仍可继续'}));
  }else spectrum.stop();}
});
process.on('exit', () => {kotonoha.close();player.stop();spectrum.stop();desktop.close();});
async function closeWorker() {
  if(!closing){closing=true;pendingHistoryTrack=null;cancelGeneration++;generation++;player.stop();kotonoha.close();spectrum.stop();desktop.close();}
  if(busy)return;
  if(!exitTask)exitTask=(async()=>{await saveQueues(clearQueuesOnExit);await Promise.all([adapterLogs,historyWrites]);process.exit(0);})();
  await exitTask;
}
process.on('SIGTERM', closeWorker);
async function run(command) {
  if(command.startsWith('sort:')) {
    if(!canSort())throw new Error('请先进入一个歌单');
    const mode=command.slice(5);if(!sortChoices.some(([id])=>id===mode))throw new Error('未知排序方式');
    const seed=mode==='shuffle'?randomInt(1,4294967295):sortSeed;const key=sortKey();
    emit({kind:'status',message:'正在准备完整歌单排序…'});
    let rows;
    try {rows=await collectionPage(1,mode,seed);}catch(error){if(key!==sortKey()||closing)return;throw error;}
    if(key!==sortKey()||closing)return;sortMode=mode;sortSeed=seed;page=1;numberOffset=0;tracks=rows;sendTracks();return;
  }
  if(command==='searchtoggle'&&view==='catalog'&&catalogMode==='search')return run('searchtype:'+searchTypes[(searchTypes.indexOf(searchType)+1)%searchTypes.length]);
  if(command.startsWith('searchtype:')&&view==='catalog'&&catalogMode==='search'){
    const chosen=command.slice(11);if(!searchTypes.includes(chosen))return;const previous=searchType;searchType=chosen;try{return await catalogPage(1);}catch(error){searchType=previous;throw error;}
  }
  if(command==='artisttoggle'&&view==='catalog'&&catalogMode==='artist')return run('artisttab:'+artistTabs[(artistTabs.indexOf(artistTab)+1)%artistTabs.length]);
  if(command.startsWith('artisttab:')&&view==='catalog'&&catalogMode==='artist'){
    const chosen=command.slice(10);if(!artistTabs.includes(chosen))return;const previous=artistTab;artistTab=chosen;try{return await catalogPage(1);}catch(error){artistTab=previous;throw error;}
  }
  if(command==='artistprofile'&&view==='catalog'&&catalogMode==='artist'){
    catalogMode='profile';profileTab=1;pageTitle=artistProfile.name+' · 歌手资料';return catalogPage(1);
  }
  if(command.startsWith('profiletab:')&&view==='catalog'&&catalogMode==='profile'){
    const chosen=Number(command.slice(11));if(!Number.isInteger(chosen)||chosen<0||chosen>=profileTabs.length)return;profileTab=chosen;return catalogPage(1);
  }
  if(command==='profiletoggle'&&view==='catalog'&&catalogMode==='profile')return run('profiletab:'+((profileTab+1)%profileTabs.length));
  if(command.startsWith('artistphoto:')&&view==='catalog'&&catalogMode==='artist'){
    const amount=Number(command.slice(12)),len=artistProfile.photos.length;if(!len||!Number.isFinite(amount))return;artistProfile.photoIndex=(artistProfile.photoIndex+amount+len)%len;void artistPhoto();return;
  }
  if(command.startsWith('openentity:')&&view==='catalog')return openEntity(Number(command.slice(11)));
  if(command==='resize') {if(view==='search'&&!keyword)return;if(['search','playlist','playlists','favorite','browse','queue','catalog','history'].includes(view))return pageLoad(1);return;}
  if(command==='recommend'||command==='discover')return openHub(command);
  if(command==='sectiontoggle'&&view==='playlists'&&!section){browseKind=browseKind==='created'?'collected':'created';pageTitle=browseKind==='created'?'我创建的歌单':'我收藏的歌单';return pageLoad(1);}
  if(command==='sectiontoggle'&&section)return openHub(section,nextSectionKind(section,browseKind));
  if(command==='sectionranks'&&section==='discover')return openHub(section,'ranks');
  if(command==='back'){songActionContext=null;if(view==='favorite')return finishFavorite();favoriteState=null;favoriteOrigin=null;return goBack();}
  if(command==='refresh'&&view==='catalog'){if(catalogMode==='artist'&&artistProfile){const old=artistProfile;artistCatalog.clear();const entry=await artistCatalog.load(publicRead,artistId,old);artistProfile=structuredClone(entry.info);artistProfile.photoIndex=Math.min(old.photoIndex??0,Math.max(0,artistProfile.photos.length-1));await catalogPage(1);void artistPhoto();return;}return catalogPage(1);}
  if(command==='refresh'&&canSort()){sortedPlaylists.invalidate(sortKey());discovery.clear();return pageLoad(1);}
  if(command==='refresh'&&view==='playlists'&&!section){userPlaylists.clear();return pageLoad(1);}
  if(command==='refresh'&&section){discovery.clear();return view==='hub'?openHub(section):pageLoad(1);}
  if(command==='queue'){queueHistory.open();view='queue';section='';return pageLoad(1);}
  if(command==='history'){view='history';section='';collectionInfo=null;collectionKey='';pendingFavorite=null;return pageLoad(1);}
  if(command==='queuenext'&&view==='queue'){queueHistory.next();return pageLoad(1);}
  if(command==='queuedelete'&&view==='queue'){
    const removed=queueHistory.remove();
    if(removed?.wasPlaying){
      pendingHistoryTrack=null;pendingAuto=false;generation++;player.stop();queue=[];queueIndex=-1;position=0;
      desktop.update({track:null,artUrl:'',seconds:0,...queueState()});kotonoha.clearTrack();
      emit({kind:'quality'});emit({kind:'media',lyrics:[],pixels:[],title:''});emit({kind:'time',seconds:0});
    }
    if(removed)emit({kind:'status',message:'已删除队列：'+removed.entry.title});
    return pageLoad(1);
  }
  if(command==='quality'){
    view='options';section='';page=1;pageTitle='选择播放音质';
    lists=qualities.map(q=>({title:qualityLabel(q),description:q===preferredQuality?'当前请求档位':'选择后立即应用到当前歌曲',action:'quality:'+q,icon:q===preferredQuality?'●':'○'}));
    return listEvent();
  }
  if(command.startsWith('quality:')||command.startsWith('qualityapply:')){
    const stay=command.startsWith('qualityapply:');
    const chosen=command.slice(stay?13:8);if(!qualities.includes(chosen))return;
    preferredQuality=chosen;sendPreferences();
    if(player.child&&queue[queueIndex]){
      const previousIndex=queueIndex;
      try{await playFromQueue(queueIndex,playbackStatus==='Paused',position);}
      catch(error){queueIndex=previousIndex;throw error;}
    }
    if(!stay)return run('quality');
    return;
  }
  if(command.startsWith('queueplay:')){
    const index=(page-1)*pageSize+Number(command.slice(10));
    const entry=queueHistory.viewed;
    if(Number.isInteger(index)&&entry?.tracks[index]){
      const previousQueue=queue,previousIndex=queueIndex;
      plannedNext=null;pendingAuto=false;queue=entry.tracks;queueIndex=index;
      try{if(await playFromQueue(index))queueHistory.activate(entry.id,queueIndex);else{queue=previousQueue;queueIndex=previousIndex;}}
      catch(error){queue=previousQueue;queueIndex=previousIndex;throw error;}
    }return;
  }
  if(command==='restore') {await restore();try{await session.maintain();}catch{/* No saved account yet. */}return;}
  if(command==='maintain') {try{await session.maintain();}catch{/* Background failure must not remove an account. */}return;}
  if(command==='accounts') {section='';view='accounts';pendingFavorite=null;return sendAccounts();}
  if(command.startsWith('deleteaccount:')) {
    await saveQueues();
    const wasActive=await accounts.remove(command.slice(14));
    if(wasActive){history.clear();sortedPlaylists.clear();discovery.clear();userPlaylists.clear();section='';player.stop();pendingHistoryTrack=null;pendingAuto=false;queue=[];queueIndex=-1;queueHistory.clear();queueOwner=null;plannedNext=null;markedTracks.clear();emit({kind:'marks',count:0,indices:[]});favoriteState=null;favoriteOrigin=null;songActionContext=null;generation++;tracks=[];lists=[];pendingFavorite=null;desktop.update({track:null,artUrl:'',...queueState()});kotonoha.clearTrack();emit({kind:'media',lyrics:[],pixels:[],title:''});}
    view='accounts';await restore();await sendAccounts();emit({kind:'status',message:'已删除本机保存的账号'});return;
  }
  if(command.startsWith('switch:')) {
    await saveQueues();
    await accounts.select(Number(command.slice(7)));history.clear();sortedPlaylists.clear();discovery.clear();userPlaylists.clear();section='';player.stop();pendingHistoryTrack=null;pendingAuto=false;queue=[];queueIndex=-1;queueHistory.clear();queueOwner=null;plannedNext=null;markedTracks.clear();emit({kind:'marks',count:0,indices:[]});favoriteState=null;favoriteOrigin=null;songActionContext=null;desktop.update({track:null,artUrl:'',...queueState()});kotonoha.clearTrack();generation++;tracks=[];lists=[];pendingFavorite=null;view='accounts';
    emit({kind:'media',lyrics:[],pixels:[],title:''});await restore();return sendAccounts();
  }
  if(command==='nextpage'||command==='prevpage') return pageLoad(command==='nextpage'?page+1:Math.max(1,page-1));
  if(command==='playlists'){section='';browseKind='created';pageTitle='我创建的歌单';view='playlists';return pageLoad(1);}
  if(command.startsWith('songmenu:'))return songMenu(command.slice(9));
  if(command.startsWith('mark:')){
    const row=selectedSong(command.slice(5)),key=trackKey(row);
    if(markedTracks.has(key))markedTracks.delete(key);else{if(markedTracks.size>=100)throw new Error('批量选择最多100首');markedTracks.set(key,{...row});}
    sendMarks();return;
  }
  if(command.startsWith('songaction:')){
    const context=songActionContext;songActionContext=null;
    if(!context||context.userid!==String((await accounts.current()).userid))throw new Error('歌曲操作已失效，请重新打开菜单');
    const action=command.slice(11);
    if(action==='favorite'||action==='favorite-batch')return beginFavorite(action==='favorite'?[context.track]:context.batch);
    if(action==='mark'){const key=trackKey(context.track);if(markedTracks.has(key))markedTracks.delete(key);else{if(markedTracks.size>=100)throw new Error('批量选择最多100首');markedTracks.set(key,context.track);}sendMarks();return;}
    if(action==='clear-marks'){markedTracks.clear();sendMarks();return;}
    if(action==='next'||action==='append'){
      const entry=queueHistory.insert([context.track],action);syncEditedQueue();
      if(action==='next')plannedNext={id:entry.id,track:entry.tracks[entry.index+1]};
      emit({kind:'status',message:`已${action==='next'?'安排下一首':'追加'}：${context.track.title} · ${entry.title}`});
      if(view==='queue'){resizing=true;await pageLoad(page);}return;
    }
    const entry=queueHistory.entries.find(e=>e.id===context.queueId);
    if(!entry||context.revision!==queueHistory.revision)throw new Error('队列已变化，请重新打开菜单');
    if(action==='rename'){emit({kind:'text_prompt',title:'重命名队列（1–80字）',value:entry.title,command:`queuerename:${entry.id}:`});return;}
    const result=queueHistory.edit(entry.id,action,context.index);
    if(result.removedCurrent)stopRemovedTrack();syncEditedQueue();
    if(result.wasPlaying){queue=[];queueIndex=-1;}
    const selected=result.target??Math.max(0,Math.min(context.index??0,(result.entry?.tracks.length??1)-1));
    queueFocus=selected%pageSize;resizing=true;await pageLoad(Math.floor(selected/pageSize)+1);
    emit({kind:'status',message:action==='remove'?'已移除队列歌曲'+(result.removedCurrent?'，当前播放已停止':''):'队列已更新'});return;
  }
  if(command.startsWith('queuerename:')){
    const rest=command.slice(12),at=rest.indexOf(':'),id=Number(rest.slice(0,at));
    queueHistory.edit(id,'rename',JSON.parse(rest.slice(at+1)));resizing=true;await pageLoad(page);return;
  }
  if(command==='favorite-batch')return beginFavorite([...markedTracks.values()]);
  if(command.startsWith('favorite:'))return beginFavorite([selectedSong(command.slice(9))]);
  if(command.startsWith('favoriteapply:')){
    const state=favoriteState;favoriteState=null;
    if(!state||state.userid!==String((await accounts.current()).userid))throw new Error('收藏状态已失效，请重新选择歌单');
    const result=await favorites.apply(directRequest(await accountCookie()),state,command.slice(14));
    sortedPlaylists.clear();userPlaylists.clear();
    markedTracks.clear();await finishFavorite();
    emit({kind:'status',message:`${result.verified?'已核对':'请求已接受，仍需打开歌单核对'}：${result.action==='add'?'添加':'移除'} ${result.count} 首 · ${state.list.title}`});return;
  }
  if(command.startsWith('openlist:')) {
    const list=lists[Number(command.slice(9))];if(!list) throw new Error('请选择歌单');
    sortMode='default';sortSeed=1;
    if(view==='options')return run(list.action);
    if(view==='hub'||view==='browse') {
      playlistId={...list};
      browseKind=list.action??(list.rankId?'rank':'public');browseId=list.rankId??list.publicId??'';
      pageTitle=list.title;view='browse';collectionKey=sortKey();collectionInfo=playlistInfo(list);collectionEpoch++;
      await pageLoad(1);void enrichCollection();return;
    }
    if(view==='favorite') {
      if(!pendingFavorite||pendingFavorite.userid!==String((await accounts.current()).userid))throw new Error('待收藏歌曲已失效');
      emit({kind:'status',message:'正在读取目标歌单的收藏状态…'});
      favoriteState=null;
      const revision=cancelGeneration;
      const state=await favorites.inspect(async route=>{
        if(closing||revision!==cancelGeneration||view!=='favorite')throw new Error('读取已取消');
        const result=await session.request(route);
        if(closing||revision!==cancelGeneration||view!=='favorite')throw new Error('读取已取消');return result;
      },pendingFavorite.userid,list,pendingFavorite.tracks);
      favoriteState=state;
      const actions=[];
      if(state.missing.length)actions.push({title:`添加未收藏的 ${state.missing.length} 首`,command:'favoriteapply:add'});
      if(state.existing.length&&state.existing.every(row=>memberFiles(state,row).every(id=>/^\d+$/.test(id)&&Number(id)>0&&Number.isSafeInteger(Number(id)))))actions.push({title:`确认从此歌单移除已收藏的 ${state.existing.length} 首`,command:'favoriteapply:remove'});
      showActions(`${list.title} · 已收藏 ${state.existing.length}/${state.tracks.length} 首`,actions);return;
    }
    playlistId={...list};pageTitle=list.title;view='playlist';collectionKey=sortKey();collectionInfo=playlistInfo(list);collectionEpoch++;
    await pageLoad(1);void enrichCollection();return;
  }
  if (command.startsWith('search:')) { keyword=command.slice(7);searchType='song';catalogMode='search';artistProfile=null;catalogKey='search:'+keyword;section='';pageTitle='搜索 · '+keyword;view='catalog';catalogEpoch++;return catalogPage(1); }
  if(command==='playbackfailure'){
    const failure=pendingFailure;pendingFailure=null;
    if(!autoSkipErrors||!queue[queueIndex]||!failure||failure.generation!==generation||failure.queue!==queue||failure.index!==queueIndex)return;
    pendingHistoryTrack=null;
    const next=recovery.next(queue,queueIndex,playMode);
    if(next===null){stopRemovedTrack();emit({kind:'error',message:'没有可继续尝试的歌曲或连续播放失败已达上限，已停止自动跳过'});return;}
    emit({kind:'status',message:'播放失败，正在自动尝试下一首'});
    try{await playFromQueue(next,false,0,false);queueHistory.update(queueIndex);}
    catch(error){stopRemovedTrack();throw error;}return;
  }
  if(command==='resume' && queue[queueIndex]) return playFromQueue(queueIndex);
  if(command==='nexttrack'||command==='prevtrack'||command==='autonext') {
    const oldIndex=queueIndex;
    const planned=command!=='prevtrack'&&queueHistory.playingId===plannedNext?.id?queue.indexOf(plannedNext.track):-1;
    const index=planned>=0?planned:nextIndex(queueIndex,queue.length,playMode,command==='prevtrack'?-1:1,command==='autonext');
    if(index===null||!queue[index])return;
    const previousStatus=playbackStatus;
    queueIndex=index;
    if(previousStatus==='Stopped'&&command!=='autonext') {
      if(planned>=0)plannedNext=null;generation++;emit({kind:'quality'});
      desktop.update({track:queue[index],artUrl:'',seconds:0,...queueState()});
      emit({kind:'media',fresh:true,title:queue[index].artist+' - '+queue[index].title,lyrics:[],pixels:[]});
      return;
    }
    try {const result=await playFromQueue(index,previousStatus==='Paused',0,command!=='autonext');if(result&&planned>=0)plannedNext=null;return result;}catch(error){queueIndex=oldIndex;throw error;}
  }
  if (command.startsWith('play:')) {
    plannedNext=null;pendingAuto=false;
    const index = Number(command.slice(5));
    if (!Number.isInteger(index) || !tracks[index]) throw new Error('请先搜索并选择歌曲');
    const revision=cancelGeneration,chosen=tracks[index];
    const collection=view==='history'?{rows:await playedHistory.list((await accounts.current()).userid),source:'played-history',title:'已播放历史'}:await playbackCollection();
    if(closing||revision!==cancelGeneration)throw new Error('读取已取消');
    const previousQueue=queue,previousIndex=queueIndex;
    const selected=sortedQueue(tracks,index,collection.rows,page,pageSize);
    if(collection.rows){
      const matches=row=>row?.hash===chosen.hash&&String(row?.audioId??'')===String(chosen.audioId??'');
      if(!matches(selected.queue[selected.index]))selected.index=selected.queue.findIndex(matches);
      if(selected.index<0)throw new Error('选中歌曲已不在当前集合，请刷新后重试');
    }
    queue=selected.queue;queueIndex=selected.index;
    const source=JSON.stringify([collection.source,canSort()?sortMode:'default',canSort()?sortSeed:1]);
    try{
      if(await playFromQueue(queueIndex))queueHistory.commit(queue,queueIndex,source,collection.title);
      else{queue=previousQueue;queueIndex=previousIndex;}
    }catch(error){queue=previousQueue;queueIndex=previousIndex;throw error;}
    return;
  }
  if (command === 'login') {
    const loginRevision=cancelGeneration;
    let identity={};
    emit({kind:'status',message:'正在准备 KuGouMusicApi 登录与稳定设备标识…'});
    try{identity=await device.get();}catch{throw new Error('KuGouMusicApi 设备准备未完成，请稍后按 L 重试；不会切回旧登录接口');}
    if(loginRevision!==cancelGeneration)return;
    const cookie=Object.entries(identity).filter(([key])=>key==='dfid'||key.startsWith('KUGOU_API_')).map(([key,value])=>`${key}=${value}`).join('; ');
    const direct=directRequest(cookie);
    const request=route=>retryRead(direct,route,message=>emit({kind:'status',message}));
    const response = await request('/login/qr/key');
    if(loginRevision!==cancelGeneration)return;
    const key = response?.data?.qrcode;
    if (response.status !== 1 || typeof key !== 'string' || !key) throw new Error('获取二维码失败');
    emit({ kind: 'qr', url: `https://h5.kugou.com/apps/loginQRCode/html/index.html?qrcode=${encodeURIComponent(key)}` });
    const deadline = Date.now() + 120000;
    let state;
    while (Date.now() < deadline) {
      if(loginRevision!==cancelGeneration)return;
      let reply;
      try{reply=await request(`/login/qr/check?key=${encodeURIComponent(key)}`);}
      catch(error){if(error.retryable){if(loginRevision!==cancelGeneration)return;emit({kind:'status',message:'网络中断，二维码仍保留，等待恢复…'});await delay(3000);continue;}throw error;}
      const result = parseLogin(reply);
      if(loginRevision!==cancelGeneration)return;
      if (result.state !== state) emit({ kind: 'status', message: { waiting: '等待扫码', confirm: '请在手机确认登录', success: '正在保存登录状态', expired: '二维码已过期' }[result.state] });
      state = result.state;
      if (state === 'expired') throw new Error('二维码过期，请按 L 重新生成');
      if (result.account) {
        await saveQueues();
        await accounts.save({...identity,...result.account,loginProvider:LOGIN_PROVIDER});
        // Keep the freshly scanned credential; renew only when due or confirmed rejected.
        if(loginRevision!==cancelGeneration)return;
        history.clear();sortedPlaylists.clear();discovery.clear();userPlaylists.clear();section='';
        player.stop();pendingHistoryTrack=null;pendingAuto=false;queue=[];queueIndex=-1;queueHistory.clear();queueOwner=null;plannedNext=null;markedTracks.clear();emit({kind:'marks',count:0,indices:[]});favoriteState=null;favoriteOrigin=null;songActionContext=null;desktop.update({track:null,artUrl:'',...queueState()});kotonoha.clearTrack();generation++;tracks=[];lists=[];pendingFavorite=null;view='accounts';
        emit({kind:'media',lyrics:[],pixels:[],title:''});
        await restore();
        emit({ kind: 'clear_qr' });
        await sendAccounts();
        emit({ kind: 'status', message: '登录成功，凭证已保存；按 V 查看会员权益' });
        return;
      }
      await delay(3000);
    }
    throw new Error('等待扫码超时，按 L 重试');
  }
  if (command === 'status' || command === 'claim') return inspect(command === 'claim');
  throw new Error('未知操作');
}
async function playFromQueue(index,paused=false,start=0,reset=true){
 const original=queue,revision=cancelGeneration;
 if(reset)recovery.reset();
 let candidate=index;
 for(;;){
  if(closing||revision!==cancelGeneration||queue!==original)throw new Error('播放请求已取消');
  queueIndex=candidate;recoveryStart=start;
  const attemptGeneration=generation+1;
  try{return await playTrack(queue[candidate],paused,start);}
  catch(error){
   if(generation!==attemptGeneration)throw new Error('播放请求已取消');
   if(!autoSkipErrors||expired(error)||error.playbackFatal||closing||revision!==cancelGeneration||queue!==original||/取消/.test(error.message))throw error;
   const next=recovery.next(queue,candidate,playMode);
   if(next===null)throw new Error(error.message+'（自动跳过已停止：到达队尾、无可用歌曲或连续失败上限）');
   emit({kind:'status',message:`${queue[candidate].title} 播放失败，自动下一首：${queue[next].title}`});
   candidate=next;start=0;
  }
 }
}
async function playTrack(track,paused=false,start=0) {
    const revision=++generation,cancelRevision=cancelGeneration;
    const {url,info:quality,resolved,requested}=await resolvePlayback(route=>session.request(route),track,preferredQuality,{
      isCurrent:()=>revision===generation&&cancelRevision===cancelGeneration&&!closing,
      onAttempt:q=>emit({kind:'status',message:'正在获取并检查音频 · '+qualityLabel(q)}),
    });
    if(resolved!==requested)emit({kind:'status',message:qualityLabel(requested)+' 不可用，已回退至 '+qualityLabel(resolved)});
    const cached=await readCachedCover(directory,track.hash);
    const userid=(await accounts.current()).userid;
    if(revision!==generation||cancelRevision!==cancelGeneration||closing)return;
    emit({kind:'quality',...quality});
    pendingHistoryTrack={userid,track:{...track}};
    pendingFailure=null;recoveryPlaybackGeneration=revision;
    player.play(url,paused,start);desktop.update({track:(({hash,title,artist,duration})=>({hash,title,artist,duration}))(track),artUrl:cached.artUrl,seconds:start,...queueState()});
    const playInstance=kotonoha.beginTrack(track);
    emit({kind:'media',fresh:true,seconds:start,song:track.title,artist:track.artist,duration:track.duration,lyrics:[],pixels:[],png:cached.png,title:track.artist+' - '+track.title});
    const publicCollection=section==='search';
 const request=route=>publicCollection?publicRead(route):session.request(route);
    const asset={kind:'media',song:track.title,artist:track.artist,duration:track.duration,title:track.artist+' - '+track.title,lyrics:[],pixels:[],png:cached.png};
    const update=(key,value)=>{if(revision!==generation||closing)return;asset[key]=value;if(key==='lyrics')kotonoha.setLyrics(playInstance,value,track);emit({...asset});};
    void loadLyrics(request,track).then(value=>update('lyrics',value)).catch(()=>update('lyrics',[]));
    void (cached.png?cachedCoverPixels(cached.png):coverPixels(track.cover)).then(value=>update('pixels',value)).catch(()=>{});
    if(!cached.png)void coverPng(track.cover).then(async value=>{
      if(revision!==generation||closing)return;
      update('png',value);
      const artUrl=await cacheCover(directory,track.hash,value);
      if(revision===generation&&!closing&&artUrl)desktop.update({artUrl});
    }).catch(()=>{});
    emit({ kind: 'status', message: '正在载入 ' + track.title });
    return true;
}
async function accountCookie() { return credentials(await accounts.current()); }
async function inspect(claim) {
  const account=await accounts.current();
  emit({ kind: 'status', message: claim ? '正在进行一次听歌活动领取，请勿重复操作' : '正在查询概念 VIP 权益' });
  const result = await probe({ request: route=>session.request(route), claim });
  await privateWrite(directory + 'vip-latest.json', JSON.stringify({ recordedAt: new Date().toISOString(), ...result }, null, 2) + '\n');
  emit({ kind: 'result', result });
}
async function dispatch(line) {
  if(closing)return;
  if(line.startsWith('kotonoha:')){try{kotonoha.configure(JSON.parse(line.slice(9)));}catch{emit({kind:'error',message:'Kotonoha 配置无效；播放器仍可使用'});}return;}
  if(line==='searchhome'){void loadSearchHome();return;}
  if(line.startsWith('suggestions:')){suggestWanted=line.slice(12).trim().slice(0,100);if(!suggestRunning)void suggestLoop();return;}
  if(line.startsWith('errorskip:')){const value=line.slice(10);if(['0','1'].includes(value)){autoSkipErrors=value==='1';recovery.reset();pendingFailure=null;}return;}
  if(line.startsWith('queuepolicy:')){const value=line.slice(12);if(['0','1'].includes(value))clearQueuesOnExit=value==='1';return;}
  if(line.startsWith('preferences:')){const [,quality,mode]=line.split(':');if(qualities.includes(quality))preferredQuality=quality;if(modes.includes(mode))playMode=mode;sendPreferences();return;}
  if(line==='order'){playMode=modes[(modes.indexOf(playMode)+1)%modes.length];sendPreferences();return;}
  if(line.startsWith('mode:')){const mode=line.slice(5);if(modes.includes(mode)){playMode=mode;sendPreferences();}return;}
  if(line==='maintain'&&busy)return;
  if(line==='playbackfailure'&&busy)return;
  if(line==='autonext'&&busy){pendingAuto=true;return;}
  if(line.startsWith('pagesize:')){const size=Number(line.slice(9));if(Number.isInteger(size)&&size>=1&&size<=1000&&size!==pageSize){pendingSize=size;if(!busy)return dispatch('resize');}return;}
  if(line==='resize'){if(pendingSize===null)return;pageSize=pendingSize;pendingSize=null;}
  if(line.trim()==='cancel'){pendingFailure=null;recovery.reset();cancelGeneration++;return;}
  if(line==='home'){favoriteState=null;favoriteOrigin=null;pendingFavorite=null;songActionContext=null;cancelGeneration++;catalogEpoch++;collectionEpoch++;collectionInfo=null;collectionKey='';history.clear();view='search';keyword='';section='';tracks=[];lists=[];return;}
  if(line.startsWith('volume:')) {const value=Number(line.slice(7));if(Number.isFinite(value)){player.setVolume(value);emit({kind:'volume',value:player.volume});desktop.update({volume:player.volume});}return;}
  if (line.trim() === 'pause') { if(player.child)player.pause();else if(queue[queueIndex])return dispatch('resume');return; }
  if (line.trim() === 'stop') { pendingFailure=null;recovery.reset();pendingHistoryTrack=null;pendingAuto=false;generation++;player.stop(); emit({ kind: 'status', message: '已停止播放' }); return; }
  if(line.startsWith('seekpercent:')){const ratio=Number(line.slice(12));const track=queue[queueIndex];if(!busy&&player.child&&track?.duration>0&&Number.isFinite(ratio))player.seek(Math.max(0,Math.min(1,ratio))*track.duration,true);return;}
  if(line.startsWith('seekrelative:')){if(!busy)player.seek(Number(line.slice(13)),false);return;}
  if(line.startsWith('seekto:')||line.startsWith('seekby:')) {
    const [mode,hash,raw]=line.split(':');const seconds=Number(raw);
    if(!busy&&player.child&&queue[queueIndex]?.hash===hash&&Number.isFinite(seconds)) {
      if(mode==='seekby')player.seek(seconds,false);
      else if(seconds>=0&&seconds<=queue[queueIndex].duration)player.seek(seconds,true);
    }
    return;
  }
  if(line==='setpause'){player.setPaused(true);return;}
  if(line==='resume'&&player.child){player.setPaused(false);return;}
  if(line.startsWith('focus:')) {const [selected,offset]=line.slice(6).split(':').map(Number);if(Number.isSafeInteger(selected)&&selected>=0&&Number.isSafeInteger(offset)&&offset>=0)focus={selected,offset};return;}
  if (busy) return;
  busy = true;desktop.update({busy:true});
  emit({ kind: 'busy', value: true });
  try {
    resizing=line==='resize';
    if(['accounts','playlists','recommend','discover','quality','queue','history','sectiontoggle','sectionranks'].includes(line)||line.startsWith('search:')||line.startsWith('openlist:')&&view!=='favorite'||line.startsWith('openentity:')||line==='artistprofile') {history.push(snapshot(),focus);focus={selected:0,offset:0};}
    if(['accounts','playlists','recommend','discover','quality','queue','history','login'].includes(line)||['search:','switch:','deleteaccount:'].some(prefix=>line.startsWith(prefix))){collectionEpoch++;catalogEpoch++;collectionInfo=null;collectionKey='';}
    await restoreQueues();
    await run(line.trim());
    if(view==='queue'&&['queueplay:','nexttrack','prevtrack','autonext','resume','playbackfailure'].some(command=>line.startsWith(command))){
      queueHistory.update(queueIndex);resizing=true;await pageLoad(page);
    }
  }
  catch (error) { if(/读取已取消|播放请求已取消/.test(error.message))return;emit({ kind: 'clear_qr' }); if(expired(error))emit({kind:'auth_required',message:'服务端仍拒绝当前凭证。账号已保留；稍后可重试，续期受保护间隔限制，按 L 可重新扫码。'});else emit({ kind: 'error', message: error.message }); }
  finally { queueHistory.update(queueIndex);await saveQueues();resizing=false;busy = false;desktop.update({busy:false,...queueState()}); emit({ kind: 'busy', value: false }); if(closing)await closeWorker();else if(pendingFailure){void dispatch('playbackfailure');}else if(pendingAuto){pendingAuto=false;void dispatch('autonext');}else if(pendingSize!==null)void dispatch('resize'); }
}
let suggestWanted='',suggestRunning=false;
async function suggestLoop(){
 suggestRunning=true;
 try{while(suggestWanted&&!closing){
  const query=suggestWanted;suggestWanted='';
  try{const body=await directRequest()('/search/suggest?keywords='+encodeURIComponent(query)+'&musicTipCount=16&albumTipCount=6&correctTipCount=6');
   if(!suggestWanted&&!closing)emit({kind:'suggestions',query,items:searchSuggestions(body)});
  }catch{if(!suggestWanted&&!closing)emit({kind:'suggestions',query,items:[],unavailable:true});}
 }}finally{suggestRunning=false;}
}
createInterface({input:process.stdin}).on('line',line=>void dispatch(line));

const maintenance=setInterval(()=>{if(!closing&&!busy)void dispatch('maintain');},15*60*1000);maintenance.unref();
process.stdin.on('end', closeWorker);

let hotCache=null,hotAt=0,hotRunning=false;
async function loadSearchHome(){
 if(hotCache&&Date.now()-hotAt<600000){emit({kind:'search_home',hot:hotCache});return;}
 if(hotRunning)return;hotRunning=true;
 try{hotCache=hotSearches(await directRequest()('/search/hot'));hotAt=Date.now();emit({kind:'search_home',hot:hotCache});}
 catch{emit({kind:'search_home',hot:[],unavailable:true});}
 finally{hotRunning=false;}
}
