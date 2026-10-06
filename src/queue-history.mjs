// Keep catalogue metadata, never resolved playback URLs.
export class QueueHistory {
  entries=[];
  playingId=null;
  viewedId=null;
  sequence=0;
  revision=0;
  clear(){this.revision++;this.entries=[];this.playingId=null;this.viewedId=null;}
  get playing(){return this.entries.find(entry=>entry.id===this.playingId)??null;}
  get viewed(){return this.entries.find(entry=>entry.id===this.viewedId)??null;}
  update(index){if(this.playing&&this.playing.index!==index){this.playing.index=index;this.revision++;}}
  snapshot(){return {entries:this.entries.map(({id,source,title,tracks,index})=>({id,source,title,tracks:structuredClone(tracks),index})),playingId:this.playingId,viewedId:this.viewedId};}
  restore(snapshot){
    this.revision=0;
    this.entries=structuredClone(snapshot.entries).map(entry=>({...entry,signature:JSON.stringify([entry.source,entry.tracks.map(row=>[row.hash,row.audioId,row.albumId])])}));
    this.playingId=this.entries.some(e=>e.id===snapshot.playingId)?snapshot.playingId:null;
    this.viewedId=this.entries.some(e=>e.id===snapshot.viewedId)?snapshot.viewedId:this.playingId??this.entries[0]?.id??null;
    this.sequence=Math.max(0,...this.entries.map(e=>e.id));
  }
  // Commit only after the worker successfully starts playback.
  commit(rows,index,source,title){
    const signature=JSON.stringify([source,rows.map(row=>[row.hash,row.audioId,row.albumId])]);
    let entry=this.playing;
    if(!entry||entry.signature!==signature){
      entry={id:++this.sequence,signature,source,title,tracks:rows.map(row=>({...row})),index};
      this.entries.push(entry);
    }
    this.revision++;entry.index=index;
    this.playingId=entry.id;this.viewedId=entry.id;
    return entry;
  }
  open(){if(this.playing&&this.viewedId!==this.playingId){this.viewedId=this.playingId;this.revision++;}return this.viewed;}
  next(){
    if(!this.entries.length)return null;
    const index=this.entries.findIndex(entry=>entry.id===this.viewedId);
    this.revision++;this.viewedId=this.entries[(index+1)%this.entries.length].id;
    return this.viewed;
  }
  activate(id,index){
    const entry=this.entries.find(entry=>entry.id===id);
    if(!entry||!Number.isInteger(index)||!entry.tracks[index])throw new Error('队列曲目已失效');
    this.revision++;entry.index=index;this.playingId=id;this.viewedId=id;
  }
  remove(){
    const index=this.entries.findIndex(entry=>entry.id===this.viewedId);
    if(index<0)return null;
    this.revision++;const [entry]=this.entries.splice(index,1);
    const wasPlaying=entry.id===this.playingId;
    if(wasPlaying)this.playingId=null;
    this.viewedId=this.entries[Math.min(index,this.entries.length-1)]?.id??null;
    return {entry,wasPlaying};
  }
}
