// Exercise the real worker command loop with no account, API or audio side effects.
import {registerHooks} from 'node:module';
const sources={
  'accounts.mjs':`export class Accounts {
    userid=process.env.QUEUE_USERID||'1';
    async current(){return {userid:this.userid,token:'fixture'};} async read(){return {accounts:[]};}
    async summary(){return [];} async select(index){this.userid=String(index+1);} async remove(){return true;}
    async withLock(action){return action();}
  }`,
  'session-reader.mjs':`export const expired=error=>error.businessCode===20017; export const retryRead=async(request,route)=>request(route);
    export class SessionReader {async maintain(){} async request(route){return globalThis.queueFavoriteRequest(route);}}`,
  'direct-api.mjs':`export const LOGIN_PROVIDER='mock';
    const favorites=new Map();let fileId=100;
    globalThis.queueFavoriteRequest=async route=>{
      const url=new URL(route,'https://mock'),listid=url.searchParams.get('listid');
      const rows=favorites.get(listid)||[];
      if(url.pathname==='/playlist/track/all/new'){
        const p=Number(url.searchParams.get('page')),size=Number(url.searchParams.get('pagesize'));
        return {data:{info:rows.slice((p-1)*size,p*size)}};
      }
      if(url.pathname==='/playlist/tracks/add'){
        const incoming=url.searchParams.get('data').split(',').map(s=>{const [name,hash,album_id,mixsongid]=s.split('|');return {filename:name,hash,album_id,mixsongid,fileid:String(++fileId)};});
        favorites.set(listid,rows.concat(incoming));
        console.log(JSON.stringify({kind:'fixture_write',action:'add',count:incoming.length}));
        if(process.env.QUEUE_FAVORITE_FAIL)throw Error('Synthetic unknown write outcome');
        return {status:1};
      }
      if(url.pathname==='/playlist/tracks/del'){
        const ids=url.searchParams.get('fileids').split(',');favorites.set(listid,rows.filter(r=>!ids.includes(r.fileid)));
        console.log(JSON.stringify({kind:'fixture_write',action:'remove',count:ids.length}));return {status:1};
      }
      throw Error('Unexpected favorite API read');
    };
    export const directRequest=()=>async route=>{
    const url=new URL(route,'https://mock');
    if(url.pathname==='/album/songs'){
      const page=Number(url.searchParams.get('page')),size=Number(url.searchParams.get('pagesize'));
      if(size>30)throw Object.assign(Error('Album pagination rejected'),{businessCode:20010});
      return {data:{songs:Array.from({length:Number(process.env.QUEUE_ALBUM_COUNT)||5},(_,i)=>({hash:'c'+String(i).padStart(31,'0'),songname:'album'+i,singername:'Artist',time_length:120,album_audio_id:String(i),album_id:'1'})).slice((page-1)*size,page*size)}};
    }
    return globalThis.queueFavoriteRequest(route);
  };`,
  'user-playlists.mjs':`export class UserPlaylists {clear(){} async page(request,id,kind){return [{title:kind+' list',listid:'1',publicId:kind,type:kind==='collected'?1:0,isMine:0,ownerId:String(id),count:5}];}}`,
  'playlist-access.mjs':`export const playlistTracks=async(request,list,page,size)=>Array.from({length:5},(_,i)=>({hash:'d'+String(i).padStart(31,'0'),title:'personal'+i,artist:'Artist',duration:120,audioId:String(i),albumId:'1'})).slice((page-1)*size,page*size);`,
  'desktop.mjs':`export class Desktop {update(){} close(){}} export class Spectrum {start(){} stop(){}}`,
  'discovery.mjs':`export class Discovery {
    clear(){} async load(request,kind,page,size){
      if(['recommended','hires','ranks'].includes(kind))return [{title:kind,publicId:kind==='ranks'?'':kind,rankId:kind==='ranks'?'1':undefined,count:5}];
      if(kind==='public'&&process.env.QUEUE_REJECT_LARGE_PUBLIC==='1'&&size>30)throw Object.assign(Error('Public pagination rejected'),{businessCode:20010});
      const failing=kind===process.env.QUEUE_FAIL_COLLECTION;
      if(failing&&size===100&&page===2)throw Error('Synthetic collection read failure');
      return Array.from({length:failing?205:Number(process.env.QUEUE_UI_COUNT)||5},(_,i)=>({hash:(kind==='daily'?'a':'b')+String(i).padStart(31,'0'),title:kind+i,artist:'Artist',duration:120,audioId:String(i),albumId:'1'})).slice((page-1)*size,page*size);
    }
  }`,
  'music.mjs':`export const search=async()=>[];
    export const searchTracks=body=>(body.data?.lists??[]).map(r=>({hash:r.FileHash,title:r.SongName,artist:r.SingerName,duration:r.Duration,audioId:String(r.MixSongID),albumId:String(r.AlbumID)}));
    export const resolveTrack=async(request,track)=>{if(process.env.QUEUE_RESOLVE_DELAY)await new Promise(resolve=>setTimeout(resolve,60));if(process.env.QUEUE_AUTH_FAIL)throw Object.assign(Error('Synthetic authentication failure'),{businessCode:20017});if(process.env.QUEUE_ALL_FAIL||track.title==='new1')throw Error('Synthetic playback failure');return track.hash;};
    export const resolvePlayback=async(request,track,preferred)=>({url:await resolveTrack(request,track),info:{codec:'flac'},requested:preferred,resolved:preferred});
    export const inspectAudio=async()=>({codec:'flac'});export const requireLossless=()=>{};
    export class Player {
      constructor(onEvent,options){this.options=options;this.child=null;}
      play(url){const child=this.child={};this.options.onState('Playing');if(process.env.QUEUE_RUNTIME_FAIL&&url.startsWith('a'))setTimeout(()=>{if(this.child!==child)return;this.child=null;this.options.onState('Stopped');this.options.onFailure({playbackFatal:false});},30);} stop(){this.child=null;this.options.onState('Stopped');}
      setVolume(){} pause(){} setPaused(){} seek(){}
    }`,
};
registerHooks({load(url,context,nextLoad){
  const parsed=new URL(url),name=parsed.pathname.split('/').at(-1);
  if(parsed.pathname.includes('/src/')&&!parsed.search){
    if(name==='user-playlists.mjs')return {format:'module',shortCircuit:true,source:`export {playlistGroup} from ${JSON.stringify(url+'?original')};`+sources[name]};
    if(sources[name])return {format:'module',source:sources[name],shortCircuit:true};
    if(name==='play-history.mjs')return {format:'module',shortCircuit:true,source:
      `import {PlayHistory as Original} from ${JSON.stringify(url+'?original')};
       export class PlayHistory extends Original {constructor(file,lock){if(!process.env.QUEUE_HISTORY_FILE)throw Error('Missing isolated history file');super(process.env.QUEUE_HISTORY_FILE,lock);}}`};
    if(name==='queue-store.mjs')return {format:'module',shortCircuit:true,source:
      `export * from ${JSON.stringify(url+'?original')};
       import {QueueStore as Original} from ${JSON.stringify(url+'?original')};
       export class QueueStore extends Original {constructor(file,lock){if(!process.env.QUEUE_HISTORY_FILE)throw Error('Missing isolated queues file');super(process.env.QUEUE_HISTORY_FILE+'.queues',lock);}}`};
    if(name==='catalog.mjs')return {format:'module',shortCircuit:true,source:
      `export * from ${JSON.stringify(url+'?original')};
       export const catalogSearch=async(request,query,type)=>type==='album'?[{kind:'album',albumId:'1',title:'Album',count:Number(process.env.QUEUE_ALBUM_COUNT)||5}]:type==='artist'?[{kind:'artist',artistId:'1',title:'Artist'}]:[];
       export class ArtistCatalog {
         cache=new Map();clear(){this.cache.clear();}
         async load(request,id){const entry={info:{name:'Artist',complete:true,photos:[]},songs:Array.from({length:5},(_,i)=>({kind:'song',hash:'e'+String(i).padStart(31,'0'),title:'artist'+i,artist:'Artist',duration:120,audioId:String(i),albumId:'1'}))};this.cache.set(id,entry);return entry;}
       }`};
    if(name==='library.mjs')return {format:'module',shortCircuit:true,source:
      `export * from ${JSON.stringify(url+'?original')};
       import {readCachedCover as originalReadCachedCover} from ${JSON.stringify(url+'?original')};
       import {dirname} from 'node:path';
       export const readCachedCover=async(directory,hash)=>originalReadCachedCover(dirname(process.env.QUEUE_HISTORY_FILE),hash);
       export const cachedCoverPixels=async()=>[];
       export const loadLyrics=async()=>[];export const coverPixels=async()=>[];export const coverPng=async()=>{if(process.env.QUEUE_EXPECT_CACHED_COVER)throw Error('Unexpected cover network load');return '';};export const cacheCover=async()=>'';`};
  }
  return nextLoad(url,context);
}});
