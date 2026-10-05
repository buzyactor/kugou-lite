import {SortedPlaylists,sortChoices,sortedQueue} from '../src/playlist-sort.mjs';
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
import {qualities,modes,nextIndex} from '../src/playback-options.mjs';
import {Discovery} from '../src/discovery.mjs';
import {Desktop, Spectrum} from '../src/desktop.mjs';
import { Accounts } from '../src/accounts.mjs';
import { playlists, playlistSongs, songRows, loadLyrics, coverPixels, coverPng, favoriteParams, cacheCover } from '../src/library.mjs';
import { Player, search, resolveTrack, inspectAudio, requireLossless } from '../src/music.mjs';
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
let queue=[],queueIndex=-1,playbackStatus='Stopped',position=0,preferredQuality='flac',playMode='sequence',pendingAuto=false;
const queueState=()=>({next:nextIndex(queueIndex,queue.length,playMode)!==null,previous:nextIndex(queueIndex,queue.length,playMode,-1)!==null});
const sendPreferences=()=>{emit({kind:'preferences',quality:preferredQuality,mode:playMode});desktop.update({...queueState(),loop:playMode==='single'?'Track':playMode==='loop'?'Playlist':'None',shuffle:playMode==='shuffle'});};
let view = 'search', keyword = '', page = 1, playlistId = null, generation = 0;
let numberOffset=0;
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
 const key=sortKey();
 return sortedPlaylists.page(key,sortLoader(),mode,next,pageSize,seed,{expected:(view==='playlist'||browseKind==='public')?Number(playlistId?.count)||0:0,cancelled:()=>closing||sortKey()!==key,progress:count=>emit({kind:'status',message:`正在读取完整歌单：${count} 首`})});
}
const accounts = new Accounts(directory);
const discovery=new Discovery();
const userPlaylists=new UserPlaylists();
const artistCatalog=new ArtistCatalog();
let thumbnailSequence=0,currentThumbnailKey=0;
let catalogMode='',searchType='song',artistTab='heat',profileTab=1,artistId='',artistProfile=null,albumId='',catalogKey='',catalogEpoch=0;
const publicRead=route=>retryRead(directRequest(),route);
function sendCatalog(restored={}){
 currentThumbnailKey=++thumbnailSequence;
 emit({thumbnailKey:currentThumbnailKey,kind:'catalog',mode:catalogMode,searchType,artistTab,profileTab,artist:artistProfile,collectionInfo,collectionKey,key:catalogKey,query:keyword,page,title:pageTitle,resized:resizing,...restored,
 rows:tracks.map((r,i)=>({...r,number:(page-1)*pageSize+i+1}))});
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
 }else if(catalogMode==='album')rows=songRows((await publicRead(`/album/songs?id=${albumId}&${params}`)).data?.songs).map(r=>({...r,kind:'song'}));
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
  const rows=songRows((await publicRead(`/album/songs?id=${row.albumId}&page=1&pagesize=${pageSize}`)).data?.songs).map(r=>({...r,kind:'song'}));
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
const sendTracks = (focus={}) => emit({...focus,...sortInfo(),...sectionInfo(),kind:'tracks', page, view, section,title:pageTitle, resized:resizing, tracks:tracks.map(({title,artist,vip,duration},i)=>({title,artist,vip,duration,number:numberOffset+i+1}))});
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
  if(view==='queue')return pageLoad(page);
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
  if(view==='queue'){const rows=queue.slice((next-1)*pageSize,next*pageSize);if(!rows.length&&next>1)return;page=next;emit({kind:'queue',page,resized:resizing,title:'当前播放队列',tracks:rows.map((r,i)=>({...r,number:(page-1)*pageSize+i+1,active:(page-1)*pageSize+i===queueIndex}))});return;}
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
  onTime:seconds=>{position=seconds;kotonoha.observeTime(seconds);emit({kind:'time',seconds});desktop.update({seconds});},
  onState:status=>{playbackStatus=status;kotonoha.observeState(status);emit({kind:'state',status});desktop.update({status,loaded:status!=='Stopped',...(status==='Stopped'?{seconds:0}:{})});if(status==='Playing')spectrum.start();else spectrum.stop();}
});
process.on('exit', () => {kotonoha.close();player.stop();spectrum.stop();desktop.close();});
async function closeWorker() { if(!closing){closing=true;cancelGeneration++;generation++;player.stop();kotonoha.close();spectrum.stop();desktop.close();}await adapterLogs;if(!busy)process.exit(0); }
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
  if(command==='resize') {if(view==='search'&&!keyword)return;if(['search','playlist','playlists','favorite','browse','queue','catalog'].includes(view))return pageLoad(1);return;}
  if(command==='recommend'||command==='discover')return openHub(command);
  if(command==='sectiontoggle'&&view==='playlists'&&!section){browseKind=browseKind==='created'?'collected':'created';pageTitle=browseKind==='created'?'我创建的歌单':'我收藏的歌单';return pageLoad(1);}
  if(command==='sectiontoggle'&&section)return openHub(section,nextSectionKind(section,browseKind));
  if(command==='sectionranks'&&section==='discover')return openHub(section,'ranks');
  if(command==='back')return goBack();
  if(command==='refresh'&&view==='catalog'){if(catalogMode==='artist'&&artistProfile){const old=artistProfile;artistCatalog.clear();const entry=await artistCatalog.load(publicRead,artistId,old);artistProfile=structuredClone(entry.info);artistProfile.photoIndex=Math.min(old.photoIndex??0,Math.max(0,artistProfile.photos.length-1));await catalogPage(1);void artistPhoto();return;}return catalogPage(1);}
  if(command==='refresh'&&canSort()){sortedPlaylists.invalidate(sortKey());discovery.clear();return pageLoad(1);}
  if(command==='refresh'&&view==='playlists'&&!section){userPlaylists.clear();return pageLoad(1);}
  if(command==='refresh'&&section){discovery.clear();return view==='hub'?openHub(section):pageLoad(1);}
  if(command==='queue'){view='queue';section='';pageTitle='当前播放队列';return pageLoad(1);}
  if(command==='quality'){
    view='options';section='';page=1;pageTitle='选择播放音质';
    lists=qualities.map((q,i)=>({title:['FLAC 无损','MP3 高品质 · 320 kbps','MP3 标准 · 128 kbps'][i],description:q===preferredQuality?'当前请求档位':'选择后立即应用到当前歌曲',action:'quality:'+q,icon:q===preferredQuality?'●':'○'}));
    return listEvent();
  }
  if(command.startsWith('quality:')){
    const chosen=command.slice(8);if(!qualities.includes(chosen))return;
    preferredQuality=chosen;sendPreferences();
    if(player.child&&queue[queueIndex])await playTrack(queue[queueIndex],playbackStatus==='Paused',position);
    return run('quality');
  }
  if(command.startsWith('queueplay:')){
    const index=(page-1)*pageSize+Number(command.slice(10));
    if(Number.isInteger(index)&&queue[index]){queueIndex=index;return playTrack(queue[index]);}return;
  }
  if(command==='restore') {await restore();try{await session.maintain();}catch{/* No saved account yet. */}return;}
  if(command==='maintain') {try{await session.maintain();}catch{/* Background failure must not remove an account. */}return;}
  if(command==='accounts') {section='';view='accounts';pendingFavorite=null;return sendAccounts();}
  if(command.startsWith('deleteaccount:')) {
    const wasActive=await accounts.remove(command.slice(14));
    if(wasActive){history.clear();sortedPlaylists.clear();discovery.clear();userPlaylists.clear();section='';player.stop();pendingAuto=false;queue=[];queueIndex=-1;generation++;tracks=[];lists=[];pendingFavorite=null;desktop.update({track:null,artUrl:'',...queueState()});kotonoha.clearTrack();emit({kind:'media',lyrics:[],pixels:[],title:''});}
    view='accounts';await restore();await sendAccounts();emit({kind:'status',message:'已删除本机保存的账号'});return;
  }
  if(command.startsWith('switch:')) {
    await accounts.select(Number(command.slice(7)));history.clear();sortedPlaylists.clear();discovery.clear();userPlaylists.clear();section='';player.stop();pendingAuto=false;queue=[];queueIndex=-1;desktop.update({track:null,artUrl:'',...queueState()});kotonoha.clearTrack();generation++;tracks=[];lists=[];pendingFavorite=null;view='accounts';
    emit({kind:'media',lyrics:[],pixels:[],title:''});await restore();return sendAccounts();
  }
  if(command==='nextpage'||command==='prevpage') return pageLoad(command==='nextpage'?page+1:Math.max(1,page-1));
  if(command==='playlists'){section='';browseKind='created';pageTitle='我创建的歌单';view='playlists';return pageLoad(1);}
  if(command.startsWith('favorite:')) {
    const track=tracks[Number(command.slice(9))];if(!track) throw new Error('请选择歌曲');
    pendingFavorite={...track};section='';pageTitle='收藏到歌单';view='favorite';return pageLoad(1);
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
      if(!pendingFavorite) throw new Error('待收藏曲目已失效');
      const track=pendingFavorite;pendingFavorite=null; // 发送失败也不自动重试
      const result=await directRequest(await accountCookie())('/playlist/tracks/add?'+favoriteParams(track,list.listid));
      if(result.status!==1) throw new Error('收藏结果未确认，请打开歌单核对');
      sortedPlaylists.clear();userPlaylists.clear();
      emit({kind:'status',message:'收藏请求已接受，请打开 '+list.title+' 核对'});
      section='';browseKind='created';pageTitle='我创建的歌单';view='playlists';listEvent();return;
    }
    playlistId={...list};pageTitle=list.title;view='playlist';collectionKey=sortKey();collectionInfo=playlistInfo(list);collectionEpoch++;
    await pageLoad(1);void enrichCollection();return;
  }
  if (command.startsWith('search:')) { keyword=command.slice(7);searchType='song';catalogMode='search';artistProfile=null;catalogKey='search:'+keyword;section='';pageTitle='搜索 · '+keyword;view='catalog';catalogEpoch++;return catalogPage(1); }
  if(command==='resume' && queue[queueIndex]) return playTrack(queue[queueIndex]);
  if(command==='nexttrack'||command==='prevtrack'||command==='autonext') {
    const oldIndex=queueIndex;
    const index=nextIndex(queueIndex,queue.length,playMode,command==='prevtrack'?-1:1,command==='autonext');
    if(index===null||!queue[index])return;
    const previousStatus=playbackStatus;
    queueIndex=index;
    if(previousStatus==='Stopped'&&command!=='autonext') {
      generation++;emit({kind:'quality'});
      desktop.update({track:queue[index],artUrl:'',seconds:0,...queueState()});
      emit({kind:'media',fresh:true,title:queue[index].artist+' - '+queue[index].title,lyrics:[],pixels:[]});
      return;
    }
    try {return await playTrack(queue[index],previousStatus==='Paused');}catch(error){queueIndex=oldIndex;throw error;}
  }
  if (command.startsWith('play:')) {
    pendingAuto=false;
    const index = Number(command.slice(5));
    if (!Number.isInteger(index) || !tracks[index]) throw new Error('请先搜索并选择歌曲');
    const previousQueue=queue,previousIndex=queueIndex;
    const selected=sortedQueue(tracks,index,canSort()?sortedPlaylists.all(sortKey(),sortMode,sortSeed):null,page,pageSize);
    queue=selected.queue;queueIndex=selected.index;
    try{return await playTrack(queue[index]);}catch(error){queue=previousQueue;queueIndex=previousIndex;throw error;}
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
        await accounts.save({...identity,...result.account,loginProvider:LOGIN_PROVIDER});
        // Keep the freshly scanned credential; renew only when due or confirmed rejected.
        if(loginRevision!==cancelGeneration)return;
        history.clear();sortedPlaylists.clear();discovery.clear();userPlaylists.clear();section='';
        player.stop();pendingAuto=false;queue=[];queueIndex=-1;desktop.update({track:null,artUrl:'',...queueState()});kotonoha.clearTrack();generation++;tracks=[];lists=[];pendingFavorite=null;view='accounts';
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
async function playTrack(track,paused=false,start=0) {
    const revision=++generation;
    const url = await resolveTrack(route=>session.request(route), track,preferredQuality);
    emit({kind:'status',message:'正在检查真实音频编码 · '+preferredQuality});
    const quality=await inspectAudio(url);
    if(preferredQuality==='flac')requireLossless(quality);
    if(revision!==generation||closing)return;
    emit({kind:'quality',...quality});
    player.play(url,paused,start);desktop.update({track:(({hash,title,artist,duration})=>({hash,title,artist,duration}))(track),artUrl:'',seconds:start,...queueState()});
    const playInstance=kotonoha.beginTrack(track);
    emit({kind:'media',fresh:true,seconds:start,song:track.title,artist:track.artist,duration:track.duration,lyrics:[],pixels:[],title:track.artist+' - '+track.title});
    const publicCollection=section==='search';
 const request=route=>publicCollection?publicRead(route):session.request(route);
    const asset={kind:'media',song:track.title,artist:track.artist,duration:track.duration,title:track.artist+' - '+track.title,lyrics:[],pixels:[],png:''};
    const update=(key,value)=>{if(revision!==generation||closing)return;asset[key]=value;if(key==='lyrics')kotonoha.setLyrics(playInstance,value,track);emit({...asset});};
    void loadLyrics(request,track).then(value=>update('lyrics',value)).catch(()=>update('lyrics',[]));
    void coverPixels(track.cover).then(value=>update('pixels',value)).catch(()=>{});
    void coverPng(track.cover).then(async value=>{
      if(revision!==generation||closing)return;
      update('png',value);
      const artUrl=await cacheCover(directory,track.hash,value);
      if(revision===generation&&!closing&&artUrl)desktop.update({artUrl});
    }).catch(()=>{});
    emit({ kind: 'status', message: '正在载入 ' + track.title });
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
  if(line.startsWith('preferences:')){const [,quality,mode]=line.split(':');if(qualities.includes(quality))preferredQuality=quality;if(modes.includes(mode))playMode=mode;sendPreferences();return;}
  if(line==='order'){playMode=modes[(modes.indexOf(playMode)+1)%modes.length];sendPreferences();return;}
  if(line.startsWith('mode:')){const mode=line.slice(5);if(modes.includes(mode)){playMode=mode;sendPreferences();}return;}
  if(line==='maintain'&&busy)return;
  if(line==='autonext'&&busy){pendingAuto=true;return;}
  if(line.startsWith('pagesize:')){const size=Number(line.slice(9));if(Number.isInteger(size)&&size>=1&&size<=1000&&size!==pageSize){pendingSize=size;if(!busy)return dispatch('resize');}return;}
  if(line==='resize'){if(pendingSize===null)return;pageSize=pendingSize;pendingSize=null;}
  if(line.trim()==='cancel'){cancelGeneration++;return;}
  if(line==='home'){cancelGeneration++;catalogEpoch++;collectionEpoch++;collectionInfo=null;collectionKey='';history.clear();view='search';keyword='';section='';tracks=[];lists=[];return;}
  if(line.startsWith('volume:')) {const value=Number(line.slice(7));if(Number.isFinite(value)){player.setVolume(value);emit({kind:'volume',value:player.volume});desktop.update({volume:player.volume});}return;}
  if (line.trim() === 'pause') { if(player.child)player.pause();else if(queue[queueIndex])return dispatch('resume');return; }
  if (line.trim() === 'stop') { pendingAuto=false;generation++;player.stop(); emit({ kind: 'status', message: '已停止播放' }); return; }
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
    if(['accounts','playlists','recommend','discover','quality','queue','sectiontoggle','sectionranks'].includes(line)||line.startsWith('search:')||line.startsWith('openlist:')||line.startsWith('openentity:')||line==='artistprofile') {history.push(snapshot(),focus);focus={selected:0,offset:0};}
    if(['accounts','playlists','recommend','discover','quality','queue','login'].includes(line)||['search:','switch:','deleteaccount:'].some(prefix=>line.startsWith(prefix))){collectionEpoch++;catalogEpoch++;collectionInfo=null;collectionKey='';}
    await run(line.trim());
  }
  catch (error) { if(/读取已取消/.test(error.message))return;emit({ kind: 'clear_qr' }); if(expired(error))emit({kind:'auth_required',message:'服务端仍拒绝当前凭证。账号已保留；稍后可重试，续期受保护间隔限制，按 L 可重新扫码。'});else emit({ kind: 'error', message: error.message }); }
  finally { resizing=false;busy = false;desktop.update({busy:false,...queueState()}); emit({ kind: 'busy', value: false }); if(closing)await closeWorker();else if(pendingAuto){pendingAuto=false;void dispatch('autonext');}else if(pendingSize!==null)void dispatch('resize'); }
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
