import {mkdir,writeFile,readdir,unlink,rename,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import { spawn } from 'node:child_process';
import { searchTracks } from './music.mjs';
import {clean,playlistInfo} from './playlist-info.mjs';
export {clean};
export function playlists(body) {
  const rows = body?.data?.info ?? body?.data?.lists ?? body?.info;
  if(!Array.isArray(rows)) throw new Error('歌单列表格式异常');
  return rows.map(r=>({...playlistInfo(r),listid:String(r.listid??''),publicId:String(r.global_collection_id??r.list_create_gid??r.gid??''),type:r.type,isMine:r.is_mine,ownerId:String(r.list_create_userid??'')})).filter(r=>/^\d+$/.test(r.listid)||/^[\w-]{1,160}$/.test(r.publicId));
}
// Cloud playlists store display filenames independently of the selected stream codec.
export function songRows(rows) {
  if(!Array.isArray(rows))throw new Error('歌曲列表格式异常');
  return searchTracks({data:{lists:rows.map(r=>{
    const raw=clean(r.songname??r.base?.audio_name??r.ori_audio_name??r.audio_info?.audio_name??r.audio_info?.songname??r.audio_info?.filename??r.name??r.filename??r.audio_name).replace(/\.(mp3|flac|wav|m4a|aac|ape|ogg|wma)$/i,'').trim();
    const explicit=clean(r.singername??r.base?.author_name??r.author_name??r.audio_info?.author_name??r.audio_info?.singername??r.authors?.map(a=>a.author_name).filter(Boolean).join(' / '));
    const artist=explicit||(raw.includes(' - ')?raw.split(' - ')[0]:'未知歌手');
    const title=raw.startsWith(artist+' - ')?raw.slice(artist.length+3):raw;
    return {
      SQFileHash:r.sqhash??r.flac_hash??r.hash_flac??r.audio_info?.hash_flac,
      FileHash:r.hash??r.audio_info?.hash??r.audio_info?.hash_128, SongName:title, SingerName:artist||'未知歌手',
      AlbumID:r.album_id??r.base?.album_id??r.albuminfo?.id??r.album_info?.album_id,
      MixSongID:r.mixsongid??r.base?.album_audio_id??r.album_audio_id??r.audio_id??r.audio_info?.album_audio_id,
      Duration:r.time_length??Number(r.timelen??r.timelength??r.duration??r.audio_info?.timelength??r.audio_info?.duration??r.audio_info?.duration_128??0)/1000,
      AlbumPrivilege:r.privilege??r.copyright?.privilege??r.privilege_download?.privilege, PayType:r.pay_type??r.deprecated?.pay_type??r.download?.[0]?.pay_type,
      Image:r.cover??r.sizable_cover??r.album_sizable_cover??r.albuminfo?.cover??r.album_info?.sizable_cover??r.album_info?.cover??r.trans_param?.union_cover,
    };
  })}});
}
export function playlistSongs(body) {
  return songRows(body?.data?.info??body?.data?.songs??body?.info);
}
export async function cacheCover(directory,hash,png) {
  if(!/^[a-f\d]{32}$/i.test(hash)||!png)return '';
  const bytes=Buffer.from(png,'base64');
  if(bytes.length>2*1024*1024||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return '';
  const dir=join(directory,'covers');await mkdir(dir,{recursive:true,mode:0o700});
  const file=join(dir,hash+'.png'),temporary=join(dir,randomUUID()+'.tmp');
  try{await writeFile(temporary,bytes,{mode:0o600});await rename(temporary,file);}finally{await unlink(temporary).catch(()=>{});}
  // Covers are disposable, bounded local assets; never expose signed audio URLs.
  const files=(await readdir(dir)).filter(f=>/^[a-f\d]{32}\.png$/i.test(f)&&f!==hash+'.png');
  await Promise.all(files.slice(0,Math.max(0,files.length-63)).map(f=>unlink(join(dir,f)).catch(()=>{})));
  return pathToFileURL(file).href;
}
export async function readCachedCover(directory,hash) {
  if(!/^[a-f\d]{32}$/i.test(hash))return {png:'',artUrl:''};
  const file=join(directory,'covers',hash+'.png');
  let handle;
  try{
    handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
    const info=await handle.stat();
    if(!info.isFile()||info.size>2*1024*1024)return {png:'',artUrl:''};
    const bytes=await handle.readFile();
    if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {png:'',artUrl:''};
    return {png:bytes.toString('base64'),artUrl:pathToFileURL(file).href};
  }catch{return {png:'',artUrl:''};}
  finally{await handle?.close().catch(()=>{});}
}
export function parseKrc(text) {
  const result=[];
  const offset=Number(text.match(/\[offset:([+-]?\d+)\]/)?.[1]??0);
  for(const line of text.split(/\r?\n/)) {
    const match=line.match(/^\[(\d+),(\d+)\](.*)$/); if(!match) continue;
    const start=Number(match[1])+offset;
    const words=Array.from(match[3].matchAll(/<(\d+),(\d+),\d+>([^<]*)/g), m=>({start:start+Number(m[1]),duration:Number(m[2]),text:clean(m[3])}));
    if(words.length) result.push({start,duration:Number(match[2]),words});
    else result.push({start,duration:Number(match[2]),lineTimed:true,words:[{start,duration:Number(match[2]),text:clean(match[3])}]});
  }
  try {
    const encoded=text.match(/\[language:([^\]]+)\]/)?.[1];
    const sections=JSON.parse(Buffer.from(encoded??'', 'base64').toString()).content;
    const candidates=sections.map(s=>(s.lyricContent??[]).map(row=>clean(Array.isArray(row)?row.join(''):row)))
      .filter(rows=>rows.length===result.length);
    const score=rows=>(rows.join('').match(/[\u4e00-\u9fff]/g)??[]).length-(rows.join('').match(/[\u3040-\u30ff]/g)??[]).length*2;
    candidates.sort((a,b)=>score(b)-score(a));
    const chosen=candidates.find(rows=>score(rows)>0&&rows.some((line,i)=>line!==result[i].words.map(w=>w.text).join('')));
    if(chosen)result.forEach((line,i)=>{if(chosen[i])line.translation=chosen[i];});
  } catch { /* Missing/malformed translations must not discard original lyrics. */ }
  return result.sort((a,b)=>a.start-b.start);
}
export function parseLrc(text) {
  const rows=[];
  for(const line of text.split(/\r?\n/)) {
    const stamps=Array.from(line.matchAll(/\[(\d+):(\d{2})(?:[.:](\d{1,3}))?\]/g));
    const content=clean(line.replace(/\[[^\]]*\]/g,''));
    for(const m of stamps)rows.push({start:Number(m[1])*60000+Number(m[2])*1000+Number((m[3]??'').padEnd(3,'0')),text:content});
  }
  rows.sort((a,b)=>a.start-b.start);
  return rows.map((row,i)=>({start:row.start,duration:Math.max(0,(rows[i+1]?.start??row.start+5000)-row.start),lineTimed:true,words:[{start:row.start,duration:0,text:row.text}]}));
}
const normalized=value=>clean(value).normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]/gu,'');
export function selectExternalLyrics(records,track) {
  if(!Array.isArray(records)||!(track.duration>0))return null;
  return records.find(r=>normalized(r.trackName)===normalized(track.title)&&normalized(r.artistName)===normalized(track.artist)&&Math.abs(Number(r.duration)-track.duration)<=3&&r.syncedLyrics)||null;
}
export async function loadLyrics(request, track, fetchImpl=fetch) {
  let best=[];
  try {
    const response=await request(`/search/lyric?hash=${track.hash}&album_audio_id=${track.audioId}`);
    const candidates=response?.candidates??response?.data?.candidates??[];
    for(const candidate of candidates.slice(0,3)) {
      const params=new URLSearchParams({id:String(candidate.id),accesskey:candidate.accesskey,fmt:'krc',decode:'1'});
      try {
        const body=await request('/lyric?'+params);
        const lines=parseKrc(body.decodeContent??'');
        if(!lines.some(l=>l.words.some(w=>w.text.trim())))continue;
        if(track.duration>0&&lines.at(-1).start>track.duration*1000+10000)continue;
        if(!best.length)best=lines;
        if(lines.some(l=>l.translation)){best=lines;break;}
      }catch{}
    }
  }catch{}
  if(best.length)return best.map(l=>({...l,source:'酷狗 KRC'}));
  // This third-party request contains only song metadata, never account cookies.
  const params=new URLSearchParams({track_name:track.title,artist_name:track.artist});
  const response=await fetchImpl('https://lrclib.net/api/search?'+params,{signal:AbortSignal.timeout(10000),redirect:'error',headers:{'User-Agent':'KugouLite/0.1 (TUI lyrics client)'}});
  if(!response.ok)return [];
  const record=selectExternalLyrics(await response.json(),track);
  return record?parseLrc(record.syncedLyrics).map(l=>({...l,source:'LRCLIB · 行同步'})):[];
}
export function favoriteParams(track, listid) {
  if(!/^\d+$/.test(listid)) throw new Error('歌单编号无效');
  if(!/^[a-f\d]{32}$/i.test(track.hash??'')||/^0{32}$/.test(track.hash)||![track.albumId??'0',track.audioId??'0'].every(id=>/^\d+$/.test(String(id))&&Number.isSafeInteger(Number(id))))throw new Error('歌曲收藏参数无效');
  // 上游用逗号分隔多曲、竖线分隔字段，避免歌名改变解析边界。
  const name=clean(track.artist+' - '+track.title).replace(/[,|]/g,' ');
  return new URLSearchParams({listid,data:[name,track.hash,track.albumId??'0',track.audioId??'0'].join('|')});
}
export function coverUrl(raw,size=600) {
  try {
    const url=new URL(String(raw).trim().replace(/\{size\}|%7Bsize%7D/gi,String(size)));
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||!/(^|\.)(kugou\.(com|net)|kgimg\.com)$/i.test(url.hostname))return null;
    return url;
  }catch{return null;}
}
export async function coverPixels(raw) {
  if(!raw) return [];
  const url=coverUrl(raw,200);
  if(!url) return [];
  return decodeCoverPixels(url.href);
}
export function cachedCoverPixels(png) {
  const bytes=Buffer.from(png,'base64');
  if(bytes.length>2*1024*1024||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return Promise.resolve([]);
  return decodeCoverPixels('pipe:0',bytes);
}
function decodeCoverPixels(input,bytes) {
  return new Promise((resolve)=>{
    const child=spawn('ffmpeg',['-nostdin','-v','error','-rw_timeout','8000000','-i',input,'-vf','scale=32:32','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{stdio:[bytes?'pipe':'ignore','pipe','ignore']});
    if(bytes){child.stdin.on('error',()=>{});child.stdin.end(bytes);}
    let data=Buffer.alloc(0);const timer=setTimeout(()=>child.kill('SIGKILL'),10000);
    child.stdout.on('data',chunk=>{data=Buffer.concat([data,chunk]);if(data.length>3072) child.kill('SIGKILL');});
    child.on('error',()=>{clearTimeout(timer);resolve([]);});
    child.on('close',code=>{clearTimeout(timer);resolve(code===0&&data.length===3072?Array.from(data):[]);});
  });
}

export async function coverPng(raw,size=600) {
  if(!Number.isInteger(size)||size<32||size>600)return "";
  if(!raw)return '';
  const url=coverUrl(raw,size);
  if(!url)return '';
  return new Promise(resolve=>{
    const child=spawn('ffmpeg',['-nostdin','-v','error','-rw_timeout','8000000','-i',url.href,'-vf',`scale=${size}:${size}:force_original_aspect_ratio=decrease`,'-frames:v','1','-f','image2pipe','-c:v','png','pipe:1'],{stdio:['ignore','pipe','ignore']});
    let chunks=[],bytes=0;const timer=setTimeout(()=>child.kill('SIGKILL'),12000);
    child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>2*1024*1024)child.kill('SIGKILL');else chunks.push(chunk);});
    child.on('error',()=>{clearTimeout(timer);resolve('');});
    child.on('close',code=>{clearTimeout(timer);resolve(code===0?Buffer.concat(chunks).toString('base64'):'');});
  });
}
