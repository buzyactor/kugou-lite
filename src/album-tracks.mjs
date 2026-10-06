import {songRows} from './library.mjs';

// The album endpoint rejects pagesize=100 with 20010. API pages must stay
// independent of the terminal's row capacity, otherwise page offsets shift.
export const albumBatchSize=30;
export async function albumTracks(request,id,page,size){
 if(!/^\d+$/.test(String(id))||!Number.isInteger(page)||page<1||!Number.isInteger(size)||size<1||size>1000)throw new Error('专辑分页参数无效');
 const start=(page-1)*size,end=start+size,rows=[];
 for(let p=Math.floor(start/albumBatchSize)+1;p<=Math.ceil(end/albumBatchSize);p++){
  const body=await request(`/album/songs?id=${id}&page=${p}&pagesize=${albumBatchSize}`);
  const batch=songRows(body?.data?.songs).map(row=>({...row,kind:'song'}));
  const offset=(p-1)*albumBatchSize;
  rows.push(...batch.slice(Math.max(0,start-offset),Math.min(batch.length,end-offset)));
  if(batch.length<albumBatchSize)break;
 }
 return rows;
}
