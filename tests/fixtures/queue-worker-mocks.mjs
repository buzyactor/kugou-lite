// Exercise the real worker command loop with no account, API or audio side effects.
import {registerHooks} from 'node:module';
const sources={
  'accounts.mjs':`export class Accounts {
    async current(){return {userid:'1'};} async read(){return {accounts:[]};}
    async summary(){return [];} async select(){} async remove(){return true;}
    async withLock(action){return action();}
  }`,
  'session-reader.mjs':`export const expired=()=>false; export const retryRead=async(request,route)=>request(route);
    export class SessionReader {async maintain(){} async request(){throw Error('Unexpected API read');}}`,
  'direct-api.mjs':`export const LOGIN_PROVIDER='mock'; export const directRequest=()=>async route=>{
    const url=new URL(route,'https://mock');
    if(url.pathname==='/album/songs'){
      const page=Number(url.searchParams.get('page')),size=Number(url.searchParams.get('pagesize'));
      return {data:{songs:Array.from({length:5},(_,i)=>({hash:'c'+String(i).padStart(31,'0'),songname:'album'+i,singername:'Artist',time_length:120,album_audio_id:String(i),album_id:'1'})).slice((page-1)*size,page*size)}};
    }
    throw Error('Unexpected API call');
  };`,
  'user-playlists.mjs':`export class UserPlaylists {clear(){} async page(request,id,kind){return [{title:kind+' list',listid:'1',publicId:kind,type:kind==='collected'?1:0,count:5}];}}`,
  'playlist-access.mjs':`export const playlistTracks=async(request,list,page,size)=>Array.from({length:5},(_,i)=>({hash:'d'+String(i).padStart(31,'0'),title:'personal'+i,artist:'Artist',duration:120,audioId:String(i),albumId:'1'})).slice((page-1)*size,page*size);`,
  'desktop.mjs':`export class Desktop {update(){} close(){}} export class Spectrum {start(){} stop(){}}`,
  'discovery.mjs':`export class Discovery {
    clear(){} async load(request,kind,page,size){
      if(['recommended','hires','ranks'].includes(kind))return [{title:kind,publicId:kind==='ranks'?'':kind,rankId:kind==='ranks'?'1':undefined,count:5}];
      const failing=kind===process.env.QUEUE_FAIL_COLLECTION;
      if(failing&&size===100&&page===2)throw Error('Synthetic collection read failure');
      return Array.from({length:failing?205:Number(process.env.QUEUE_UI_COUNT)||5},(_,i)=>({hash:(kind==='daily'?'a':'b')+String(i).padStart(31,'0'),title:kind+i,artist:'Artist',duration:120,audioId:String(i),albumId:'1'})).slice((page-1)*size,page*size);
    }
  }`,
  'music.mjs':`export const search=async()=>[];
    export const searchTracks=body=>(body.data?.lists??[]).map(r=>({hash:r.FileHash,title:r.SongName,artist:r.SingerName,duration:r.Duration,audioId:String(r.MixSongID),albumId:String(r.AlbumID)}));
    export const resolveTrack=async(request,track)=>{if(track.title==='new1')throw Error('Synthetic playback failure');return track.hash;};
    export const inspectAudio=async()=>({codec:'flac'});export const requireLossless=()=>{};
    export class Player {
      constructor(onEvent,options){this.options=options;this.child=null;}
      play(url){this.child={};this.options.onState('Playing');} stop(){this.child=null;this.options.onState('Stopped');}
      setVolume(){} pause(){} setPaused(){} seek(){}
    }`,
};
registerHooks({load(url,context,nextLoad){
  const parsed=new URL(url),name=parsed.pathname.split('/').at(-1);
  if(parsed.pathname.includes('/src/')&&!parsed.search){
    if(sources[name])return {format:'module',source:sources[name],shortCircuit:true};
    if(name==='play-history.mjs')return {format:'module',shortCircuit:true,source:
      `import {PlayHistory as Original} from ${JSON.stringify(url+'?original')};
       export class PlayHistory extends Original {constructor(file,lock){if(!process.env.QUEUE_HISTORY_FILE)throw Error('Missing isolated history file');super(process.env.QUEUE_HISTORY_FILE,lock);}}`};
    if(name==='catalog.mjs')return {format:'module',shortCircuit:true,source:
      `export * from ${JSON.stringify(url+'?original')};
       export const catalogSearch=async(request,query,type)=>type==='album'?[{kind:'album',albumId:'1',title:'Album',count:5}]:type==='artist'?[{kind:'artist',artistId:'1',title:'Artist'}]:[];
       export class ArtistCatalog {
         cache=new Map();clear(){this.cache.clear();}
         async load(request,id){const entry={info:{name:'Artist',complete:true,photos:[]},songs:Array.from({length:5},(_,i)=>({kind:'song',hash:'e'+String(i).padStart(31,'0'),title:'artist'+i,artist:'Artist',duration:120,audioId:String(i),albumId:'1'}))};this.cache.set(id,entry);return entry;}
       }`};
    if(name==='library.mjs')return {format:'module',shortCircuit:true,source:
      `export * from ${JSON.stringify(url+'?original')};
       export const loadLyrics=async()=>[];export const coverPixels=async()=>[];export const coverPng=async()=>'';export const cacheCover=async()=>'';`};
  }
  return nextLoad(url,context);
}});
