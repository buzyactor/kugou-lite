import {qualities, qualityFallbacks} from './playback-options.mjs';
import { spawn } from 'node:child_process';

export function searchTracks(body) {
  const rows = body?.data?.lists;
  if (!Array.isArray(rows)) throw new Error('搜索接口格式不符合预期');
  return rows.map(row => ({
    title: String(row.SongName || row.FileName || '未知歌曲').replace(/<[^>]*>/g, '').replace(/[\x00-\x1f\x7f]/g, ''),
    artist: String(row.SingerName || '未知歌手').replace(/<[^>]*>/g, '').replace(/[\x00-\x1f\x7f]/g, ''),
    flacHash: String(row.SQFileHash || row.SQ?.Hash || row.sq?.hash || ''),
    cover: String(row.Image || row.Cover || row.trans_param?.union_cover || ''),
    hash: String(row.FileHash || ''), albumId: String(row.AlbumID || '0'),
    audioId: String(row.MixSongID || '0'), duration: Number(row.Duration || 0),
    vip: Number(row.AlbumPrivilege ?? row.Privilege) === 10 && Number(row.PayType) === 3,
  })).filter(row => /^[a-f\d]{32}$/i.test(row.hash));
}
export async function search(request, keywords, page = 1, pageSize = 20) {
  if (!keywords.trim() || keywords.length > 200) throw new Error('请输入 1–200 字的搜索词');
  if (!Number.isInteger(page) || page < 1) throw new Error('页码无效');
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw new Error('每页数量无效');
  return searchTracks(await request(`/search?keywords=${encodeURIComponent(keywords)}&pagesize=${pageSize}&page=${page}`));
}
export function playableUrl(body) {
  const data = body?.data && !body.url ? body.data : body;
  const raw = Array.isArray(data?.url) ? data.url[0] : data?.url;
  let url;
  try { url = new URL(raw); } catch { throw Object.assign(new Error('未取得播放地址，可能无权限或该曲目不可用'), {qualityUnavailable:true}); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('播放地址格式不支持');
  // 仅允许酷狗返回的媒体 CDN；不向媒体请求附加账号 cookie。
  if (!/(^|\.)kugou\.(com|net)$/i.test(url.hostname)) throw new Error('尚未支持此音频 CDN 域名');
  if (Number(data?.is_free_part ?? data?.free_part ?? 0) !== 0) throw Object.assign(new Error('接口返回试听片段，不能作为完整播放验证'), {qualityUnavailable:true});
  return url.href;
}
export async function resolveTrack(request, track, quality = 'flac') {
  if(!qualities.includes(quality))throw new Error('不支持的音质');
  const params = new URLSearchParams({ hash: quality === 'flac' && /^[a-f\d]{32}$/i.test(track.flacHash || '') ? track.flacHash : track.hash, album_id: track.albumId, album_audio_id: track.audioId, quality });
  // 不传 free_part=0：上游以字符串真值判断，该参数必须省略。
  return playableUrl(await request(`/song/url?${params}`));
}
export function classifyPlayback(track, decodedSeconds) {
  const tolerance = Math.max(3, track.duration * 0.02);
  const full = Number.isFinite(track.duration) && track.duration > 0 && Number.isFinite(decodedSeconds) && decodedSeconds > 0 && Math.abs(decodedSeconds - track.duration) <= tolerance;
  return { expectedSeconds: track.duration, decodedSeconds, fullLength: full,
    vipMarked: track.vip, verdict: full ? (track.vip ? 'vip_full_audio_decoded' : 'full_audio_decoded_not_vip_proof') : 'duration_mismatch_or_unknown' };
}
export function decodeAudio(url, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-nostdin', '-v', 'error', '-xerror', '-rw_timeout', '15000000', '-i', url,
      '-map', '0:a:0', '-vn', '-progress', 'pipe:1', '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let seconds = 0, pending = '', settled = false;
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error('完整音频验证超时')); }, timeoutMs);
    function finish(error) {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) reject(error); else resolve(seconds);
    }
    child.stdout.on('data', chunk => {
      pending += chunk.toString();
      const lines = pending.split('\n'); pending = lines.pop();
      for (const line of lines) if (line.startsWith('out_time_us=')) {
        const value = Number(line.slice(12)) / 1e6;
        if (Number.isFinite(value)) seconds = Math.max(seconds, value);
      }
    });
    child.on('error', () => finish(new Error('无法启动 ffmpeg，请先安装')));
    child.on('exit', code => finish(code === 0 ? null : new Error('音频下载或解码失败，尚未证明完整播放')));
  });
}
export class Player {
  constructor(onEvent, { silent = false, onTime = () => {}, onDuration = () => {}, onState = () => {}, onSeek = () => {}, onSeekable = () => {}, onEnded = () => {}, onFailure = () => {}, onBitRate = () => {}, volume = 70 } = {}) { this.onFailure=onFailure;this.onDuration=onDuration;this.onBitRate=onBitRate;this.onEnded=onEnded;this.onSeek=onSeek;this.onSeekable=onSeekable;this.onState=onState; this.volume = volume; this.onTime = onTime; this.onEvent = onEvent; this.child = null; this.silent = silent; }
  seek(seconds, absolute = true) {
    if(!Number.isFinite(seconds)||!this.child)return;
    this.seekPending=true;
    this.child.stdio[3]?.write(JSON.stringify({command:['seek',seconds,absolute?'absolute+exact':'relative+exact']})+'\n');
  }
  stop() { this.onBitRate(null);this.seekPending=false;this.onSeekable(false);if (this.child) { this.child.kill('SIGKILL'); this.child = null; } this.onState('Stopped'); }
  pause() { this.child?.stdio[3]?.write('{"command":["cycle","pause"]}\n'); }
  setPaused(value) { this.child?.stdio[3]?.write(JSON.stringify({command:['set_property','pause',value]})+'\n'); }
  setVolume(value) { this.volume=Math.max(0,Math.min(100,Math.round(value)));this.child?.stdio[3]?.write(JSON.stringify({command:['set_property','volume',this.volume]})+'\n'); }
  play(url, paused = false, start = 0) {
    this.stop();
    const child = spawn('mpv', ['--no-config', '--start='+Math.max(0,start), '--pause='+(paused?'yes':'no'), '--audio-client-name=Kugou Lite', '--volume-max=100', '--volume='+this.volume, '--terminal=yes', '--no-input-terminal', '--msg-level=all=no,ipc=error', '--vid=no', '--input-ipc-client=fd://3', '--playlist=-', ...(this.silent ? ['--ao=null'] : [])], { stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
    this.child = child;
    this.seekPending=start>0;
    let pending = '', ipcDenied = false, ended = false, failed = false, notified=false;
    const failure=fatal=>{if(notified)return;notified=true;this.onFailure({playbackFatal:fatal});};
    const detectFailure = chunk => {
      if (chunk.toString().includes('Operation not permitted')) {
        ipcDenied = true;
        this.onEvent('当前环境禁止播放器 IPC，无法控制播放');
      }
    };
    child.stdout.on('data', detectFailure);
    child.stderr.on('data', detectFailure);
    child.stdio[3].on('error', () => {});
    child.stdin.on('error', () => {});
    child.stdin.end(url + '\n');
    child.stdio[3].on('data', chunk => {
      pending += chunk.toString();
      const lines = pending.split('\n'); pending = lines.pop();
      for (const line of lines) {
        let value; try { value = JSON.parse(line); } catch { continue; }
        if (this.child !== child) continue;
        if (value.event === 'file-loaded') {
          this.onEvent('已载入音频，开始播放');this.onState(paused?'Paused':'Playing');
          child.stdio[3].write('{"command":["observe_property",1,"pause"]}\n{"command":["observe_property",2,"time-pos"]}\n{"command":["observe_property",3,"seekable"]}\n{"command":["observe_property",4,"audio-bitrate"]}\n{"command":["observe_property",5,"duration"]}\n');
        }
        if(value.event==='property-change'&&value.name==='audio-bitrate')this.onBitRate(Number.isFinite(value.data)&&value.data>0?value.data:null);
        if(value.event==='property-change'&&value.name==='duration'&&Number.isFinite(value.data)&&value.data>=0)this.onDuration(value.data);
        if(value.event==='property-change'&&value.name==='seekable')this.onSeekable(value.data===true);
        if(value.event==='playback-restart'&&this.seekPending) {
          this.seekPending=false;
          child.stdio[3].write(JSON.stringify({command:['get_property','time-pos'],request_id:7301})+'\n');
        }
        if(value.request_id===7301&&value.error==='success'&&Number.isFinite(value.data)) {this.onTime(value.data);this.onSeek(value.data);}
        if(value.request_id===7302&&value.error==='success'&&Number.isFinite(value.data))this.onTime(value.data);
        if (value.event === 'property-change' && value.name === 'time-pos' && typeof value.data === 'number') this.onTime(value.data);
        if (value.event === 'property-change' && value.name === 'pause') {this.onEvent(value.data ? '已暂停' : '播放中');this.onState(value.data ? 'Paused' : 'Playing');child.stdio[3].write('{"command":["get_property","time-pos"],"request_id":7302}\n');}
        if(value.event==='end-file'&&value.reason==='eof')ended=true;
        if (value.event === 'end-file' && value.reason === 'error') {failed=true;this.onEvent('播放失败，请检查音频权限和网络');}
      }
    });
    child.on('error', () => {if(this.child!==child)return;this.child=null;this.onBitRate(null);this.onState('Stopped');this.onEvent('无法启动 mpv，请先安装');failure(true);});
    child.on('exit', (code,signal) => { if (this.child === child) { this.child = null; this.onBitRate(null);this.onState('Stopped'); if (!ipcDenied) this.onEvent(code ? '播放器异常退出' : '播放结束');if(ended&&code===0)this.onEnded();else if(failed||code||signal||ipcDenied)failure(ipcDenied); } });
  }
}

// Check the decoder's codec, never infer quality from a URL suffix.
export function inspectAudio(url, timeoutMs = 20000) {
  return new Promise((resolve,reject)=>{
    const child=spawn('ffprobe',['-v','error','-rw_timeout','15000000','-select_streams','a:0','-show_entries','stream=codec_name,sample_rate,bits_per_raw_sample,bit_rate','-of','json',url],{stdio:['ignore','pipe','ignore']});
    let output='',settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);};
    const timer=setTimeout(()=>{child.kill('SIGKILL');finish(new Error('音频格式检查超时'));},timeoutMs);
    child.stdout.on('data',chunk=>{output+=chunk;if(output.length>65536)child.kill('SIGKILL');});
    child.on('error',()=>finish(Object.assign(new Error('需要 ffprobe 检查真实音质'),{playbackFatal:true})));
    child.on('close',code=>{
      if(code!==0)return finish(new Error('无法读取音频格式'));
      try {const info=JSON.parse(output).streams?.[0];if(!info?.codec_name)throw Error();finish(null,{codec:info.codec_name,sampleRate:Number(info.sample_rate)||null,bits:Number(info.bits_per_raw_sample)||null,bitRate:Number(info.bit_rate)||null});}
      catch{finish(new Error('音频格式信息无效'));}
    });
  });
}
export function requireLossless(info) {
  if(!['flac','alac','wavpack','ape'].includes(info.codec)) throw new Error(`服务端返回 ${info.codec}，不满足无损要求，已停止播放`);
  return info;
}

// Retry only unavailable quality tiers. Transport, authentication and unsafe URL errors stay visible.
export async function resolvePlayback(request, track, preferred = 'flac', {
  inspect = inspectAudio, onAttempt = () => {}, isCurrent = () => true,
} = {}) {
  let lastError, mp3Backup;
  for (const quality of qualityFallbacks(preferred)) {
    if (!isCurrent()) throw new Error('播放请求已取消');
    onAttempt(quality);
    try {
      const url = await resolveTrack(request, track, quality);
      if (!isCurrent()) throw new Error('播放请求已取消');
      const info = await inspect(url);
      if (!isCurrent()) throw new Error('播放请求已取消');
      if (['flac','high'].includes(quality) && !['flac','alac','wavpack','ape'].includes(info.codec)) {
        if (info.codec==='mp3') mp3Backup={url,info,requested:preferred,resolved:'mp3'};
        throw Object.assign(new Error('所选无损档位未返回无损音频'), {qualityUnavailable:true});
      }
      return {url, info, requested:preferred, resolved:quality};
    } catch (error) {
      if (!isCurrent()) throw new Error('播放请求已取消');
      if (!error.qualityUnavailable) throw error;
      lastError = error;
    }
  }
  if (mp3Backup) return mp3Backup;
  throw lastError;
}
