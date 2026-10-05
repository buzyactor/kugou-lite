import test from 'node:test';
import assert from 'node:assert/strict';
import {KotonohaAdapter} from '../src/kotonoha-adapter.mjs';
import {lyricDocument,adapterConfig,catalogId} from '../src/kotonoha-protocol.mjs';
import {parseKrc,parseLrc} from '../src/library.mjs';

const track={hash:'a'.repeat(32),audioId:'123',title:'Example',artist:'Singer',duration:180,album:'Album'};
const rows=()=>parseKrc('[1000,1200]<0,400,0>Hello<400,800,0> world').map(r=>({...r,source:'酷狗 KRC',translation:'你好世界'}));
class Socket extends EventTarget {
  constructor(){super();this.readyState=0;this.bufferedAmount=0;this.messages=[];}
  open(){this.readyState=1;this.dispatchEvent(new Event('open'));}
  send(raw){if(this.readyState!==1)throw new Error('closed');this.messages.push(JSON.parse(raw));}
  close(){this.readyState=3;this.dispatchEvent(new Event('close'));}
}
class Scheduler {
  time=0;id=0;timers=new Map();
  set=(fn,delay)=>{const id=++this.id;this.timers.set(id,{fn,at:this.time+delay});return id;};
  clear=id=>this.timers.delete(id);
  advance(ms){const end=this.time+ms;for(;;){const entry=[...this.timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!entry||entry[1].at>end)break;this.time=entry[1].at;this.timers.delete(entry[0]);entry[1].fn();}this.time=end;}
}
function setup(){
  const scheduler=new Scheduler(),sockets=[],logs=[];
  const adapter=new KotonohaAdapter({playerId:'test-player',socketFactory:()=>{const s=new Socket();sockets.push(s);return s;},onLog:v=>logs.push(v),setTimer:scheduler.set,clearTimer:scheduler.clear,monotonic:()=>scheduler.time,now:()=>new Date(scheduler.time).toISOString()});
  return {adapter,sockets,logs,scheduler,enable:()=>{adapter.configure({enabled:true});sockets.at(-1).open();return sockets.at(-1);}};
}
test('milliseconds, true word spans, translation and already-applied offset become seconds',()=>{
  const document=lyricDocument(rows(),track);
  assert.equal(document.timing,'Word');assert.equal(document.source,'kugou');assert.equal(document.songId,catalogId(track));
  assert.deepEqual(document.lines[0],{index:0,id:'line-0',start:1,end:2.2,text:'Hello world',translation:'你好世界',words:[{start:1,end:1.4,text:'Hello'},{start:1.4,end:2.2,text:' world'}]});
  const offset=lyricDocument(parseKrc('[offset:250]\n[1000,1000]<0,300,0>hi'),track);
  assert.equal(offset.lines[0].start,1.25);assert.equal(offset.lines[0].words[0].start,1.25);
  const negative=lyricDocument(parseKrc('[offset:-1250]\n[1000,1000]<0,500,0>hi'),track);
  assert.equal(negative.lines[0].start,0);assert.equal(negative.lines[0].end,.75);assert.equal(negative.lines[0].words[0].end,.25);
});
test('line-only lyrics retain full text without manufactured precise words; malformed document omitted',()=>{
  const lrc=parseLrc('[00:01.25]Line one\n[00:04.00]Line two').map(r=>({...r,source:'LRCLIB · 行同步'}));
  const doc=lyricDocument(lrc,{...track,duration:0});assert.equal(doc.durationS,null);assert.equal(doc.timing,'Line');assert.equal(doc.source,'lrclib');assert.deepEqual(doc.lines[0].words,[]);assert.equal(doc.lines[0].text,'Line one');assert.equal(doc.lines[0].end,4);
  const {adapter,enable}=setup(),socket=enable(),instance=adapter.beginTrack(track);
  adapter.setLyrics(instance,[{start:NaN,duration:100,words:[]}],track);
  assert.equal(socket.messages.at(-1).lyrics,null);
});
test('switch publishes no-lyrics snapshot first, late previous lyrics cannot replace current track',()=>{
  const {adapter,enable}=setup(),socket=enable();
  const old=adapter.beginTrack(track);adapter.observeState('Playing');adapter.observeTime(12);
  const next={...track,hash:'b'.repeat(32)},current=adapter.beginTrack(next);
  assert.equal(socket.messages.at(-1).type,'snapshot');assert.equal(socket.messages.at(-1).lyrics,null);assert.equal(socket.messages.at(-1).playback.positionS,null);assert.equal(socket.messages.at(-1).playback.durationS,null);
  const count=socket.messages.length;assert.equal(adapter.setLyrics(old,rows(),track),false);assert.equal(socket.messages.length,count);
  adapter.setLyrics(current,rows(),next);assert.equal(socket.messages.at(-1).lyrics.lines[0].text,'Hello world');assert.equal(socket.messages.at(-1).playback.track.stableId,catalogId(next));
});
test('pause, resume, confirmed seek and stop calibrate immediately using backend observations',()=>{
  const {adapter,enable,scheduler}=setup(),socket=enable();adapter.beginTrack(track);adapter.observeTime(12.25);adapter.observeState('Paused');
  assert.equal(socket.messages.at(-1).status,'Paused');assert.equal(socket.messages.at(-1).positionS,12.25);
  adapter.observeState('Playing');assert.equal(socket.messages.at(-1).status,'Playing');
  adapter.observeSeek(45.125);assert.equal(socket.messages.at(-1).positionS,45.125);
  scheduler.advance(1000);assert.equal(socket.messages.at(-1).positionS,45.125,'clock does not count timer ticks as position');
  adapter.observeState('Stopped');assert.equal(socket.messages.at(-1).status,'Stopped');assert.equal(socket.messages.at(-1).positionS,null);
});
test('sequences share one connection space; reconnect sends current full snapshot without old clock queue',()=>{
  const {adapter,enable,sockets,scheduler}=setup(),first=enable(),instance=adapter.beginTrack(track);adapter.setLyrics(instance,rows(),track);adapter.observeState('Playing');adapter.observeTime(20);
  for(let i=0;i<first.messages.length;i++)assert.equal(first.messages[i].sequence,i);
  assert.equal(first.messages.at(-1).trackRef,`kugou-lite:test-player:${catalogId(track)}`);
  first.close();adapter.observeTime(33);adapter.observeState('Paused');adapter.observeSeek(50);
  scheduler.advance(500);const second=sockets.at(-1);second.open();
  assert.equal(second.messages.length,1);assert.equal(second.messages[0].sequence,0);assert.equal(second.messages[0].type,'snapshot');assert.equal(second.messages[0].playback.positionS,50);assert.equal(second.messages[0].playback.status,'Paused');assert.equal(second.messages[0].lyrics.lines.length,1);
  scheduler.advance(1000);assert.equal(second.messages.at(-1).sequence,1);assert.equal(second.messages.at(-1).trackRef,`kugou-lite:test-player:${catalogId(track)}`);
});
test('same song repeats and single-loop replays keep catalog identity but reject earlier play-instance lyrics',()=>{
  const {adapter,enable}=setup(),socket=enable(),one=adapter.beginTrack(track);adapter.setLyrics(one,rows(),track);
  const two=adapter.beginTrack(track);assert.equal(socket.messages.at(-1).lyrics,null);assert.equal(adapter.setLyrics(one,rows(),track),false);assert.equal(adapter.setLyrics(two,rows(),track),true);
  adapter.observeSeek(0);assert.equal(socket.messages.at(-1).trackRef,`kugou-lite:test-player:${catalogId(track)}`);assert.equal(socket.messages.at(-1).positionS,0);
});
test('disabled makes no connection; offline timeouts/backoff do not throw or queue updates; close cancels tasks',()=>{
  const {adapter,sockets,scheduler}=setup();adapter.beginTrack(track);adapter.observeTime(1);assert.equal(sockets.length,0);
  adapter.configure({enabled:true});scheduler.advance(3000);assert.equal(sockets[0].readyState,3);scheduler.advance(500);assert.equal(sockets.length,2);
  scheduler.advance(3000);scheduler.advance(999);assert.equal(sockets.length,2);scheduler.advance(1);assert.equal(sockets.length,3);
  for(let i=0;i<100;i++)adapter.observeTime(i);assert.equal(sockets.at(-1).messages.length,0);
  adapter.close();adapter.close();scheduler.advance(120000);assert.equal(sockets.length,3);assert.equal(scheduler.timers.size,0);
});
test('slow receiver gets latest snapshot, write failures reconnect, peer input never controls playback',()=>{
  const {adapter,enable,scheduler,sockets,logs}=setup(),first=enable();first.bufferedAmount=300000;
  adapter.beginTrack(track);adapter.beginTrack({...track,hash:'b'.repeat(32)});adapter.observeTime(4);
  first.bufferedAmount=0;scheduler.advance(25);assert.equal(first.messages.at(-1).playback.track.stableId,catalogId({...track,hash:'b'.repeat(32)}));
  first.dispatchEvent(new MessageEvent('message',{data:'secret-token'}));assert.ok(!JSON.stringify(logs).includes('secret-token'));
  scheduler.advance(500);const second=sockets.at(-1);second.open();second.bufferedAmount=300000;scheduler.advance(6000);assert.equal(second.readyState,3);
  adapter.close();
});
test('state loss does not publish invented playing positions and configuration stays loopback-only',()=>{
  const {adapter,enable,scheduler}=setup(),socket=enable();adapter.beginTrack(track);adapter.observeState('Playing');adapter.observeTime(1);
  scheduler.advance(4000);const count=socket.messages.length;scheduler.advance(10000);assert.equal(socket.messages.length,count);
  for(const endpoint of ['ws://example.com/kotonoha/adapter','ws://user:token@127.0.0.1/kotonoha/adapter','ws://127.0.0.1/kotonoha/adapter?token=secret','http://127.0.0.1/kotonoha/adapter'])assert.throws(()=>adapterConfig({endpoint}));
  for(const clockMs of [0,249,10001,NaN,'1000'])assert.throws(()=>adapterConfig({clockMs}));
  assert.equal(adapterConfig({endpoint:'ws://[::1]:28745/kotonoha/adapter'}).enabled,false);adapter.close();
});
test('backend duration corrects snapshot and document without changing catalog identity',()=>{
 const {adapter,enable}=setup(),socket=enable(),instance=adapter.beginTrack(track);
 adapter.observeDuration(181.75);adapter.setLyrics(instance,rows(),track);
 const message=socket.messages.at(-1);assert.equal(message.playback.durationS,181.75);assert.equal(message.playback.track.durationS,181.75);assert.equal(message.lyrics.durationS,181.75);assert.equal(message.playback.track.stableId,catalogId(track));
 adapter.observeDuration(182);assert.equal(socket.messages.at(-1).lyrics.durationS,182);adapter.close();
});
test('send exception recovers with snapshot, oversized documents fall back to lyrics null',()=>{
 const {adapter,enable,sockets,scheduler}=setup(),socket=enable();socket.send=()=>{throw new Error('secret-request');};
 const instance=adapter.beginTrack(track);assert.equal(socket.readyState,3);scheduler.advance(500);
 const next=sockets.at(-1);next.open();assert.equal(next.messages[0].type,'snapshot');
 adapter.setLyrics(instance,[{...rows()[0],words:[{start:0,duration:1,text:'A'.repeat(4*1024*1024)}]}],track);
 scheduler.advance(1000);assert.equal(next.messages.at(-1).type,'snapshot');assert.equal(next.messages.at(-1).lyrics,null);adapter.close();
 for(const config of [[],null,{enabled:null},{clockMs:null},{endpoint:null}])assert.throws(()=>adapterConfig(config));
});
