export const qualities = ['flac','320','128'];
export const modes = ['sequence','loop','shuffle','single'];
export function nextIndex(index,length,mode,direction=1,automatic=false,random=Math.random) {
  if(length<1||index<0)return null;
  if(automatic&&mode==='single')return index;
  if(mode==='shuffle')return length===1?0:(index+1+Math.floor(random()*(length-1)))%length;
  const next=index+direction;
  if(mode==='loop'||mode==='single')return (next+length)%length;
  return next>=0&&next<length?next:null;
}
