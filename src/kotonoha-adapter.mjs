import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {ADAPTER_ID,MAX_MESSAGE_BYTES,adapterConfig,protocolTrack,lyricDocument,seconds} from './kotonoha-protocol.mjs';

/** Own a nonblocking, latest-state-only WebSocket publisher. No player commands are accepted. */
export class KotonohaAdapter {
  constructor({socketFactory=url=>new WebSocket(url),playerId=`kugou-lite-${process.pid}-${randomUUID()}`,onLog=()=>{},now=()=>new Date().toISOString(),monotonic=()=>performance.now(),setTimer=setTimeout,clearTimer=clearTimeout,connectTimeoutMs=3000,sendTimeoutMs=5000}={}) {
    Object.assign(this,{socketFactory,playerId,onLog,now,monotonic,setTimer,clearTimer,connectTimeoutMs,sendTimeoutMs});
    this.config=adapterConfig();this.socket=null;this.timer=null;this.connectTimer=null;this.drainTimer=null;this.connectedAt=null;this.epoch=0;this.attempt=0;this.sequence=0;this.closed=false;
    this.track=null;this.document=null;this.status='Stopped';this.position=null;this.duration=null;this.sampleAt=now();this.playInstance=0;
    this.dirty=true;this.clockPending=false;this.needsCalibration=false;this.sampleMono=null;this.blockedSince=null;this.failureLogs=new Map();
  }
  log(event,detail={}) {if(this.config.enabled||event==='disabled')this.onLog({event,...detail});}
  configure(raw) {
    const config=adapterConfig(raw);
    if(this.closed||JSON.stringify(config)===JSON.stringify(this.config))return;
    this.disconnect();this.config=config;this.attempt=0;this.dirty=true;
    this.log(config.enabled?'enabled':'disabled');
    if(config.enabled)this.connect();
  }
  beginTrack(track) {
    this.track=protocolTrack(track);this.duration=null;this.document=null;
    this.status='Unknown';this.position=null;this.sampleMono=null;this.sampleAt=this.now();this.playInstance++;
    this.log('track',{instance:this.playInstance,stableId:this.track.stableId});
    this.dirty=true;this.flush();return this.playInstance;
  }
  setLyrics(instance,rows,track) {
    if(instance!==this.playInstance||!this.track||protocolTrack(track).stableId!==this.track.stableId)return false;
    let document;
    try{document=lyricDocument(rows,track);}catch{this.log('invalid-document',{instance});document=null;}
    if(document&&this.duration>0)document={...document,durationS:this.duration};
    if(JSON.stringify(document)===JSON.stringify(this.document))return true;
    this.document=document;this.dirty=true;
    this.log('document',{instance,lines:document?.lines.length??0,source:document?.source??null});this.flush();return true;
  }
  clearTrack() {
    this.playInstance++;this.track=null;this.document=null;this.status='Stopped';this.position=null;this.duration=null;this.sampleAt=this.now();this.dirty=true;this.flush();
  }
  observeTime(value) {
    const previous=this.position;this.position=seconds(value);this.sampleAt=this.now();this.sampleMono=this.monotonic();
    if(this.needsCalibration||previous===null||this.status==='Paused'&&previous!==this.position){this.needsCalibration=false;this.clockPending=true;this.flush();}
  }
  observeDuration(value) {
    const duration=seconds(value);if(duration===null||duration===this.duration)return;
    this.duration=duration;if(this.track)this.track={...this.track,durationS:duration};if(this.document&&duration>0)this.document={...this.document,durationS:duration};this.dirty=true;this.flush();
  }
  observeState(status) {
    if(!['Playing','Paused','Stopped','Unknown'].includes(status))return;
    if(status==='Stopped')this.position=null;
    if(status===this.status&&!this.dirty)return;
    this.status=status;this.sampleAt=this.now();this.needsCalibration=status==='Paused'||status==='Playing';this.clockPending=true;this.flush();
  }
  observeSeek(value) {this.observeTime(value);this.clockPending=true;this.flush();}
  envelope(type) {return {protocol:'kotonoha.adapter',version:1,type,adapter:ADAPTER_ID,sequence:this.sequence++,capturedAt:this.sampleAt};}
  snapshot() {
    return {...this.envelope('snapshot'),playback:{playerId:this.playerId,status:this.status,positionS:this.position,durationS:this.duration,track:this.track},lyrics:this.document};
  }
  clock() {return {...this.envelope('clock'),trackRef:this.track?`${ADAPTER_ID}:${this.playerId}:${this.track.stableId}`:null,positionS:this.position,status:this.status};}
  schedule(callback,ms) {this.timer=this.setTimer(()=>{this.timer=null;callback();},ms);this.timer?.unref?.();}
  connect() {
    if(this.closed||!this.config.enabled||this.socket)return;
    const epoch=++this.epoch;let socket;
    try{socket=this.socketFactory(this.config.endpoint);}catch{this.failed(epoch,'connect');return;}
    this.socket=socket;
    const current=()=>epoch===this.epoch&&!this.closed&&this.socket===socket;
    this.connectTimer=this.setTimer(()=>{if(current())this.failed(epoch,'connect-timeout');},this.connectTimeoutMs);this.connectTimer?.unref?.();
    socket.addEventListener('open',()=>{
      if(!current())return;
      this.clearTimer(this.connectTimer);this.connectTimer=null;this.connectedAt=this.monotonic();this.sequence=0;this.dirty=true;this.blockedSince=null;
      this.log('connected');this.flush();this.tick();
    });
    socket.addEventListener('close',()=>{if(current())this.failed(epoch,'disconnected');});
    socket.addEventListener('error',()=>{if(current())this.failed(epoch,'transport-error');});
    // v1 has no acknowledgements/resync/control frames. Never execute peer input.
    socket.addEventListener('message',()=>{if(current())this.failed(epoch,'unexpected-peer-message');});
  }
  tick() {
    if(!this.socket||this.socket.readyState!==1||this.closed)return;
    this.schedule(()=>{
      // Do not invent movement or republish stale Playing positions when backend samples cease.
      if(this.status!=='Playing'||this.position!==null&&this.sampleMono!==null&&this.monotonic()-this.sampleMono<Math.max(5000,this.config.clockMs*3))this.clockPending=true;
      this.flush();this.tick();
    },this.config.clockMs);
  }
  flush() {
    if(this.closed||!this.config.enabled||!this.socket||this.socket.readyState!==1)return;
    // At most one frame in the native send buffer; all subsequent observations coalesce.
    if(this.socket.bufferedAmount>0){
      this.blockedSince??=this.monotonic();
      if(this.monotonic()-this.blockedSince>=this.sendTimeoutMs)this.failed(this.epoch,'send-timeout');
      else if(this.drainTimer===null){this.drainTimer=this.setTimer(()=>{this.drainTimer=null;this.flush();},25);this.drainTimer?.unref?.();}
      return;
    }
    this.clearTimer(this.drainTimer);this.drainTimer=null;
    this.blockedSince=null;
    if(!this.dirty&&!this.clockPending)return;
    const message=this.dirty?this.snapshot():this.clock();
    const raw=JSON.stringify(message);
    if(Buffer.byteLength(raw)>MAX_MESSAGE_BYTES){
      this.document=null;this.log('message-too-large');this.dirty=true;return;
    }
    try{this.socket.send(raw);this.dirty=false;this.clockPending=false;}
    catch{this.failed(this.epoch,'send-error');}
  }
  failed(epoch,reason) {
    if(epoch!==this.epoch||this.closed)return;
    const now=this.monotonic();
    if(now-(this.failureLogs.get(reason)??-Infinity)>=60000){this.log(reason);this.failureLogs.set(reason,now);}
    if(this.connectedAt!==null&&now-this.connectedAt>=30000)this.attempt=0;
    this.disconnect();
    if(this.config.enabled)this.schedule(()=>this.connect(),Math.min(30000,500*2**Math.min(this.attempt++,6)));
  }
  disconnect() {
    this.epoch++;this.clearTimer(this.timer);this.clearTimer(this.connectTimer);this.clearTimer(this.drainTimer);this.timer=null;this.connectTimer=null;this.drainTimer=null;this.connectedAt=null;
    const socket=this.socket;this.socket=null;this.blockedSince=null;
    try{socket?.close();}catch{/* Native WebSocket may already be closing after a failed handshake. */}
  }
  close() {if(this.closed)return;this.closed=true;this.disconnect();}
}
