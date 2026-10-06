export const qualityOptions = [
  ['flac', 'FLAC 无损'], ['320', 'MP3 高品质 · 320 kbps'], ['128', 'MP3 标准 · 128 kbps'],
  ['high', 'Hi-Res 高解析无损'], ['viper_clear', '蝰蛇超清'], ['viper_atmos', '蝰蛇全景声'],
];
export const qualities = qualityOptions.map(([value])=>value);
export const qualityLabel = value=>qualityOptions.find(([id])=>id===value)?.[1] ?? (value==='mp3'?'MP3':value);
export function qualityFallbacks(value) {
  if (!qualities.includes(value)) throw new Error('不支持的音质');
  if (value==='128') return ['128'];
  if (value==='320') return ['320','128'];
  return [...new Set([value, ...(value.startsWith('viper_')?['high']:[]), 'flac','320','128'])];
}
export const modes = ['sequence','loop','shuffle','single'];
export function nextIndex(index,length,mode,direction=1,automatic=false,random=Math.random) {
  if(length<1||index<0)return null;
  if(automatic&&mode==='single')return index;
  if(mode==='shuffle')return length===1?0:(index+1+Math.floor(random()*(length-1)))%length;
  const next=index+direction;
  if(mode==='loop'||mode==='single')return (next+length)%length;
  return next>=0&&next<length?next:null;
}
