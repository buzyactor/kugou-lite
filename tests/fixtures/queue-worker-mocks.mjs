// Exercise the real worker command loop with no account, API or audio side effects.
import {registerHooks} from 'node:module';
const sources={
  'accounts.mjs':`export class Accounts {
    async current(){return {userid:'1'};} async read(){return {accounts:[]};}
    async summary(){return [];} async select(){} async remove(){return true;}
  }`,
  'session-reader.mjs':`export const expired=()=>false; export const retryRead=async(request,route)=>request(route);
    export class SessionReader {async maintain(){} async request(){throw Error('Unexpected API read');}}`,
  'direct-api.mjs':`export const LOGIN_PROVIDER='mock'; export const directRequest=()=>async()=>{throw Error('Unexpected API call');};`,
  'desktop.mjs':`export class Desktop {update(){} close(){}} export class Spectrum {start(){} stop(){}}`,
  'discovery.mjs':`export class Discovery {
    clear(){} async load(request,kind,page,size){
      return Array.from({length:5},(_,i)=>({hash:(kind==='daily'?'a':'b')+String(i).padStart(31,'0'),title:kind+i,artist:'Artist',duration:120,audioId:String(i),albumId:'1'})).slice((page-1)*size,page*size);
    }
  }`,
  'music.mjs':`export const search=async()=>[];export const searchTracks=()=>[];
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
    if(name==='library.mjs')return {format:'module',shortCircuit:true,source:
      `export * from ${JSON.stringify(url+'?original')};
       export const loadLyrics=async()=>[];export const coverPixels=async()=>[];export const coverPng=async()=>'';export const cacheCover=async()=>'';`};
  }
  return nextLoad(url,context);
}});
