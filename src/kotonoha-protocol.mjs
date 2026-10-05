/** Pure boundary conversion for Kotonoha adapter v1; no UI or transport imports. */
export const ADAPTER_ID='kugou-lite';
export const DEFAULT_ENDPOINT='ws://127.0.0.1:28745/kotonoha/adapter';
export const MAX_MESSAGE_BYTES=4*1024*1024;
export const seconds=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;

export function adapterConfig(raw={}) {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Kotonoha 配置必须是对象');
  const result={enabled:raw.enabled===undefined?false:raw.enabled,endpoint:raw.endpoint===undefined?DEFAULT_ENDPOINT:raw.endpoint,clockMs:raw.clockMs===undefined?1000:raw.clockMs};
  if(typeof result.enabled!=='boolean'||!Number.isInteger(result.clockMs)||result.clockMs<250||result.clockMs>10000)throw new Error('Kotonoha 开关或校准间隔无效');
  let url;try{url=new URL(result.endpoint);}catch{throw new Error('Kotonoha 端点无效');}
  if(typeof result.endpoint!=='string'||result.endpoint.length>2048||!['ws:','wss:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||url.search||url.hash||url.pathname!=='/kotonoha/adapter')throw new Error('Kotonoha 端点必须是无凭据的本机 adapter WebSocket 地址');
  return result;
}
export function catalogId(track) {
  if(!/^[a-f\d]{32}$/i.test(track?.hash??''))throw new Error('歌词适配缺少有效歌曲 hash');
  const audioId=/^\d+$/.test(String(track.audioId))?String(track.audioId):'0';
  return `kugou-${track.hash.toLowerCase()}-${audioId}`;
}
export function protocolTrack(track) {
  return {stableId:catalogId(track),title:String(track.title??''),rawTitle:String(track.title??''),artist:String(track.artist??''),album:String(track.album??''),durationS:seconds(track.duration)};
}
/** Internal absolute milliseconds -> protocol seconds. KRC offsets are already applied. */
export function lyricDocument(rows,track) {
  if(!Array.isArray(rows))throw new Error('歌词文档不是数组');
  if(!rows.length)return null;
  if(rows.length>4096)throw new Error('歌词行数超出协议限制');
  const span=(start,duration)=>{
    if(!Number.isFinite(start)||!Number.isFinite(duration)||duration<0)throw new Error('歌词时间无效');
    // v1 requires nonnegative times; clip spans crossing media origin, never shift twice.
    return {start:Math.max(0,start)/1000,end:Math.max(0,start+duration)/1000};
  };
  let previous=-1,wordTimed=false;
  const lines=rows.map((row,index)=>{
    const time=span(row.start,row.duration);
    if(time.start<previous)throw new Error('歌词行未按时间排序');previous=time.start;
    if(!Array.isArray(row.words)||row.words.length>4096)throw new Error('歌词字词结构无效');
    if(row.words.some(word=>!word||typeof word.text!=='string')||row.translation!==undefined&&typeof row.translation!=='string'||row.lineTimed!==undefined&&typeof row.lineTimed!=='boolean')throw new Error('歌词文本或时间类型无效');
    const text=row.words.map(w=>String(w.text??'')).join('');
    const words=row.lineTimed?[]:row.words.map(word=>({...span(word.start,word.duration),text:String(word.text??'')}));
    if(words.length)wordTimed=true;
    return {index,id:`line-${index}`,...time,text,translation:String(row.translation??''),words};
  });
  const label=String(rows[0].source??'');
  const source=label==='酷狗 KRC'?'kugou':label.startsWith('LRCLIB')?'lrclib':'unknown';
  return {source,sourceName:label||'来源未标注',songId:catalogId(track),timing:wordTimed?'Word':'Line',title:String(track.title??''),artist:String(track.artist??''),album:String(track.album??''),durationS:track.duration>0?seconds(track.duration):null,lines};
}
