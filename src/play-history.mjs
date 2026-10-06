import {readFile} from 'node:fs/promises';
import {privateWrite} from './login.ts';
import {clean} from './playlist-info.mjs';

export class PlayHistory {
  pending=Promise.resolve();
  constructor(file,lock=action=>action()){this.file=file;this.lock=lock;}
  async read(){
    try{
      const data=JSON.parse(await readFile(this.file,'utf8'));
      if(data.version!==1||!data.accounts||Array.isArray(data.accounts)||typeof data.accounts!=='object'||
         !Object.entries(data.accounts).every(([id,rows])=>/^\d+$/.test(id)&&Array.isArray(rows)&&rows.every(r=>/^[a-f\d]{32}$/i.test(r.hash)&&typeof r.title==='string'&&typeof r.artist==='string'&&Number.isFinite(r.playedAt))))throw Error('invalid');
      return data;
    }catch(error){
      if(error.code==='ENOENT')return {version:1,accounts:{}};
      throw Error('播放历史损坏或无法读取；已保留原文件');
    }
  }
  async list(userid){await this.pending.catch(()=>{});return structuredClone((await this.read()).accounts[String(userid)]??[]);}
  record(userid,track,playedAt=Date.now()){
    const task=this.pending.catch(()=>{}).then(()=>this.lock(async()=>{
      if(!/^\d+$/.test(String(userid))||!/^[a-f\d]{32}$/i.test(track.hash))throw Error('播放历史缺少有效歌曲或账号编号');
      const data=await this.read();
      const row={hash:track.hash,title:clean(track.title),artist:clean(track.artist),albumId:String(track.albumId??'0'),audioId:String(track.audioId??'0'),
        duration:Number(track.duration)||0,vip:Boolean(track.vip),playedAt};
      if(/^[a-f\d]{32}$/i.test(track.flacHash??''))row.flacHash=track.flacHash;
      try{const cover=new URL(track.cover);if(['http:','https:'].includes(cover.protocol)&&!cover.username&&!cover.password&&/(^|\.)(kugou\.(com|net)|kgimg\.com)$/i.test(cover.hostname)){cover.search='';cover.hash='';row.cover=cover.href.replace(/%7Bsize%7D/gi,'{size}');}}catch{}
      // Store catalogue fields only; never store stream URLs, credentials or API replies.
      const previous=data.accounts[String(userid)]??[];
      data.accounts[String(userid)]=[row,...previous.filter(r=>r.hash!==row.hash||r.audioId!==row.audioId)].slice(0,500);
      await privateWrite(this.file,JSON.stringify(data)+'\n');
    }));
    this.pending=task;return task;
  }
}
