// A failure chain visits each resource once, independently of shuffle/single
// repeat. Bound requests when an entire queue or the network is unavailable.
export class PlaybackRecovery {
 constructor({limit=10,timeout=120000,now=Date.now}={}){this.limit=limit;this.timeout=timeout;this.now=now;this.reset();}
 reset(){this.queue=null;this.failed=new Set();this.count=0;this.started=null;}
 key(track){return JSON.stringify([track.hash,track.audioId,track.albumId]);}
 next(queue,index,mode){
  if(this.queue!==queue){this.reset();this.queue=queue;}
  if(!queue[index])return null;
  this.started??=this.now();this.count++;this.failed.add(this.key(queue[index]));
  if(this.count>=this.limit||this.now()-this.started>=this.timeout)return null;
  for(let step=1;step<queue.length;step++){
   const raw=index+step;if(mode==='sequence'&&raw>=queue.length)return null;
   const candidate=raw%queue.length;
   if(!this.failed.has(this.key(queue[candidate])))return candidate;
  }
  return null;
 }
}
