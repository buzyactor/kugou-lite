export const sortChoices=[
 ['default','歌单默认顺序'],['reverse','默认顺序倒序'],
 ['title-asc','歌名 A → Z'],['title-desc','歌名 Z → A'],
 ['artist-asc','歌手 A → Z'],['artist-desc','歌手 Z → A'],
 ['duration-asc','时长 短 → 长'],['duration-desc','时长 长 → 短'],
 ['vip-first','VIP 歌曲优先'],['shuffle','随机排列'],
];
const collator=new Intl.Collator('zh-CN',{numeric:true,sensitivity:'base'});
export function sortTracks(rows,mode,seed=1) {
 if(!sortChoices.some(([id])=>id===mode))throw new Error('未知的歌单排序方式');
 const result=rows.slice();
 if(mode==='default')return result;
 if(mode==='reverse')return result.reverse();
 if(mode==='shuffle') {
  let state=(seed>>>0)||1;
  const next=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};
  for(let i=result.length-1;i>0;i--){const j=Math.floor(next()*(i+1));[result[i],result[j]]=[result[j],result[i]];}
  return result;
 }
 const desc=mode.endsWith('-desc');
 const field=mode.split('-')[0];
 return result.map((row,index)=>({row,index})).sort((a,b)=>{
  let delta;
  if(mode==='vip-first')delta=Number(Boolean(b.row.vip))-Number(Boolean(a.row.vip));
  else if(field==='duration')delta=(Number(a.row.duration)||0)-(Number(b.row.duration)||0);
  else delta=collator.compare(String(a.row[field]??''),String(b.row[field]??''));
  return (desc?-delta:delta)||a.index-b.index;
 }).map(({row})=>row);
}
// Fetch complete playlists before ordering; a failed/cancelled read never replaces
// the visible page. Cache metadata only, not signed URLs or account credentials.
export class SortedPlaylists {
 #cache=new Map();
 clear(){this.#cache.clear();}
 has(key){return this.#cache.has(key);}
 invalidate(key){this.#cache.delete(key);}
 all(key,mode,seed){
  const entry=this.#cache.get(key);if(!entry)return null;
  if(entry.mode!==mode||entry.seed!==seed){entry.ordered=sortTracks(entry.rows,mode,seed);entry.mode=mode;entry.seed=seed;}
  return entry.ordered;
 }
 async page(key,load,mode,page,size,seed,{cancelled=()=>false,progress=()=>{},expected=0}={}) {
  if(!sortChoices.some(([id])=>id===mode))throw new Error('未知的歌单排序方式');
  if(!this.#cache.has(key)) {
   const rows=[],signatures=new Set();const started=Date.now();
   for(let p=1;;p++) {
    if(cancelled())throw new Error('歌单排序已取消');
    if(p>200||Date.now()-started>120000)throw new Error('歌单过大或读取超时，未改变原有顺序');
    const batch=await load(p,100);
    if(cancelled())throw new Error('歌单排序已取消');
    if(!Array.isArray(batch)||batch.length>100)throw new Error('歌单分页格式异常，未改变原有顺序');
    if(batch.length) {
     const signature=JSON.stringify(batch.map(r=>[r.hash,r.title,r.artist,r.duration]));
     if(signatures.has(signature))throw new Error('歌单接口重复返回同一页，未改变原有顺序');
     signatures.add(signature);rows.push(...batch);progress(rows.length);
    }
    if(batch.length<100) {
     if(rows.length<expected) {if(batch.length)continue;throw new Error('歌单未完整读取，未改变原有顺序，请刷新歌单后重试');}
     break;
    }
   }
   this.#cache.set(key,{rows});
   while(this.#cache.size>4)this.#cache.delete(this.#cache.keys().next().value);
  }
  const rows=this.all(key,mode,seed);
  return rows.slice((page-1)*size,page*size);
 }
}
export function sortedQueue(pageRows,index,allRows,page,size) {
 if(!Number.isInteger(index)||!pageRows[index])throw new Error('请选择有效歌曲');
 return {queue:(allRows??pageRows).map(row=>({...row})),index:allRows?(page-1)*size+index:index};
}
