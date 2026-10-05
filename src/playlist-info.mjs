export const clean = value => String(value ?? '').replace(/<[^>]*>/g,'').replace(/[\x00-\x1f\x7f]/g,'');

export function playlistCount(row={}) {
 const extra=row.extra??{};
 const values=[row.song_count,row.songcount,extra.song_count,extra.songcount,row.track_count,extra.track_count,row.count];
 const counts=values.filter(v=>typeof v==='number'||typeof v==='string'&&v.trim()!=='').map(Number).filter(v=>Number.isSafeInteger(v)&&v>=0);
 // Some directory responses put a zero placeholder at the top level while
 // the actual collection size lives in extra. Missing is different from empty.
 return counts.find(v=>v>0)??(counts.includes(0)?0:null);
}

export function playlistInfo(row={}) {
 const plays=[row.playCount,row.total_play_count,row.play_count,row.extra?.total_play_count,row.extra?.play_count]
  .filter(v=>typeof v==='number'||typeof v==='string'&&v.trim()!=='').map(Number)
  .find(v=>Number.isSafeInteger(v)&&v>=0)??null;
 const rawTags=row.tags??row.tag_list??row.tag??[];
 const tags=(Array.isArray(rawTags)?rawTags:[rawTags]).flatMap(v=>String((typeof v==='object'?v?.name??v?.tag_name??v?.tag:v)??'').split(/[,，|\r\n]/)).map(v=>clean(v).trim()).filter(Boolean);
 return {title:clean(row.title??row.name??row.specialname??row.rankname),
  cover:clean([row.cover,row.flexible_cover,row.imgurl,row.sizable_cover,row.list_cover,row.image_url,row.img,row.image,row.pic].find(v=>typeof v==='string'&&/^https?:\/\//i.test(v.trim()))),
  description:clean(row.description??row.intro??row.desc??row.list_intro??row.summary).slice(0,4000),
  tags:[...new Set(tags)].slice(0,12),creator:clean(row.creator??row.nickname??row.list_create_username??row.username),
  count:playlistCount(row),playCount:plays};
}
export function mergePlaylistDetail(base,body) {
 const data=body?.data;const rows=data?.info??data?.list??data?.lists??data;
 const row=Array.isArray(rows)?rows[0]:rows;
 if(!row||typeof row!=='object')return base;
 const extra=playlistInfo(row);
 return {...base,...Object.fromEntries(Object.entries(extra).filter(([key,v])=>['count','playCount'].includes(key)?v!==null:Array.isArray(v)?v.length:v))};
}
export const sectionKinds={recommend:['daily','recommended'],discover:['new','hires']};
export function nextSectionKind(section,kind) {
 const pair=sectionKinds[section];
 return pair?pair[kind===pair[0]?1:0]:null;
}
