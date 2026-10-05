import {clean} from './library.mjs';
export function searchSuggestions(body,limit=16){
 const seen=new Set(),result=[];
 for(const group of Array.isArray(body?.data)?body.data:[]){
  if(group.LableName==='MV')continue;
  for(const row of Array.isArray(group.RecordDatas)?group.RecordDatas:[]){
   const text=clean(row.HintInfo??row.Name).trim().slice(0,100);
   if(text&&!seen.has(text)){seen.add(text);result.push(text);if(result.length>=limit)return result;}
  }
 }
 return result;
}

export function hotSearches(body,limit=20){
 const groups=body?.data?.list;
 const group=Array.isArray(groups)?groups.find(g=>g.name==='热搜榜')??groups[0]:null;
 const seen=new Set();return (Array.isArray(group?.keywords)?group.keywords:[]).map(r=>clean(r.keyword).trim().slice(0,100)).filter(text=>text&&!seen.has(text)&&seen.add(text)).slice(0,limit);
}
