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
  snapshot(){return {entries:this.entries.map(({id,source,title,tracks,index,pinned})=>({id,source,title,tracks:structuredClone(tracks),index,...(pinned?{pinned:true}:{})})),playingId:this.playingId,viewedId:this.viewedId};}
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
  edit(id,action,index){
    const entry=this.entries.find(e=>e.id===id);
    if(!entry)throw new Error('队列已失效');
    if(action==='pin'){
      entry.pinned=!entry.pinned;
      this.entries.sort((a,b)=>Number(Boolean(b.pinned))-Number(Boolean(a.pinned))||a.id-b.id);
    }else if(action==='rename'){
      const title=String(index).replace(/[\x00-\x1f\x7f]/g,'').trim();
      if(!title||Array.from(title).length>80)throw new Error('队列名称需要 1–80 个字');
      entry.title=title;
    }else{
      if(!Number.isInteger(index)||!entry.tracks[index])throw new Error('请选择有效队列曲目');
      if(action==='remove'){
        if(entry.tracks.length===1){const removedCurrent=id===this.playingId;this.viewedId=id;return {...this.remove(),removedCurrent};}
        entry.tracks.splice(index,1);
        const removedCurrent=id===this.playingId&&index===entry.index;
        if(index<entry.index)entry.index--;
        entry.index=Math.min(entry.index,entry.tracks.length-1);
        this.changed(entry);return {entry,removedCurrent};
      }
      const target=index+(action==='up'?-1:action==='down'?1:0);
      if(target===index)throw new Error('未知队列操作');
      if(target<0||target>=entry.tracks.length)return {entry};
      [entry.tracks[index],entry.tracks[target]]=[entry.tracks[target],entry.tracks[index]];
      if(entry.index===index)entry.index=target;else if(entry.index===target)entry.index=index;
      this.changed(entry);return {entry,target};
    }
    this.revision++;return {entry};
  }
  changed(entry){
    entry.source='edited:'+entry.id;
    entry.signature=JSON.stringify([entry.source,entry.tracks.map(row=>[row.hash,row.audioId,row.albumId])]);
    this.revision++;
  }
  insert(rows,mode='append'){
    if(!rows.length)throw new Error('请选择歌曲');
    let entry=this.playing??this.viewed;
    if(!entry){
      entry={id:++this.sequence,title:'手动队列',source:'manual',tracks:[],index:0};this.entries.push(entry);this.viewedId=entry.id;
    }
    const at=mode==='next'&&entry.tracks.length?entry.index+1:entry.tracks.length;
    entry.tracks.splice(at,0,...rows.map(row=>({...row})));this.changed(entry);
    return entry;
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
