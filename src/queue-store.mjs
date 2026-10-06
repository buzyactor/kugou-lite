import {readFile} from 'node:fs/promises';
import {privateWrite} from './login.ts';
import {clean} from './playlist-info.mjs';
import {coverUrl} from './library.mjs';

export const emptyQueues=()=>({entries:[],playingId:null,viewedId:null});
const hash=value=>/^[a-f\d]{32}$/i.test(value??'');
function metadata(track) {
  if(!hash(track.hash)||typeof track.title!=='string'||typeof track.artist!=='string')throw Error('invalid track');
  const row={hash:track.hash,title:clean(track.title),artist:clean(track.artist),albumId:String(track.albumId??'0'),audioId:String(track.audioId??'0'),duration:Math.max(0,Number(track.duration)||0),vip:Boolean(track.vip)};
  if(hash(track.flacHash))row.flacHash=track.flacHash;
  if(coverUrl(track.cover)){
    const url=new URL(track.cover);url.search='';url.hash='';row.cover=url.href.replace(/%7Bsize%7D/gi,'{size}');
  }
  return row;
}
function normalize(snapshot) {
  if(!snapshot||!Array.isArray(snapshot.entries)||snapshot.entries.length>500)throw Error('invalid queues');
  const ids=new Set();let count=0;
  const entries=snapshot.entries.map(entry=>{
    if(!Number.isSafeInteger(entry.id)||entry.id<=0||ids.has(entry.id)||typeof entry.source!=='string'||entry.source.length>4096||typeof entry.title!=='string'||!Array.isArray(entry.tracks)||!entry.tracks.length||!Number.isInteger(entry.index)||entry.index<0||entry.index>=entry.tracks.length)throw Error('invalid queue');
    ids.add(entry.id);count+=entry.tracks.length;if(count>200000)throw Error('too many tracks');
    if(entry.pinned!==undefined&&typeof entry.pinned!=='boolean')throw Error('invalid pin');
    return {id:entry.id,source:entry.source,title:entry.title.replace(/[\x00-\x1f\x7f]/g,''),index:entry.index,tracks:entry.tracks.map(metadata),...(entry.pinned?{pinned:true}:{})};
  });
  for(const key of ['playingId','viewedId'])if(snapshot[key]!==null&&!ids.has(snapshot[key]))throw Error('invalid queue selection');
  return {entries,playingId:snapshot.playingId,viewedId:snapshot.viewedId};
}
export class QueueStore {
  constructor(file,lock=action=>action()){this.file=file;this.lock=lock;}
  async read(){
    try{
      const raw=await readFile(this.file,'utf8');if(Buffer.byteLength(raw)>32*1024*1024)throw Error('too large');
      const data=JSON.parse(raw);
      if(data.version!==1||!data.accounts||typeof data.accounts!=='object'||Array.isArray(data.accounts))throw Error('invalid store');
      const accounts={};
      for(const [id,snapshot] of Object.entries(data.accounts)){
        if(!/^\d+$/.test(id))throw Error('invalid account');accounts[id]=normalize(snapshot);
      }
      return {version:1,accounts};
    }catch(error){if(error.code==='ENOENT')return {version:1,accounts:{}};throw Error('保存的播放列表损坏或无法读取；已保留原文件');}
  }
  async load(userid){return (await this.read()).accounts[String(userid)]??emptyQueues();}
  async save(userid,snapshot){
    if(!/^\d+$/.test(String(userid)))throw Error('播放列表缺少账号编号');
    const sanitized=normalize(snapshot);
    await this.lock(async()=>{
      const data=await this.read();data.accounts[String(userid)]=sanitized;
      const raw=JSON.stringify(data)+'\n';if(Buffer.byteLength(raw)>32*1024*1024)throw Error('播放列表超过保存大小限制');
      await privateWrite(this.file,raw);
    });
  }
}
