import test from 'node:test';
import assert from 'node:assert/strict';
import {PlaybackRecovery} from '../src/playback-recovery.mjs';
const queue=length=>Array.from({length},(_,i)=>({hash:String(i),audioId:String(i),albumId:'1'}));

test('error recovery respects sequence end and does not repeat failed resources in other modes',()=>{
 for(const mode of ['sequence','loop','single','shuffle']){
  const recovery=new PlaybackRecovery(),tracks=queue(3);
  assert.equal(recovery.next(tracks,0,mode),1);
  assert.equal(recovery.next(tracks,1,mode),2);
  assert.equal(recovery.next(tracks,2,mode),null);
 }
 const recovery=new PlaybackRecovery(),tracks=queue(3);
 assert.equal(recovery.next(tracks,2,'sequence'),null);
 recovery.reset();assert.equal(recovery.next(tracks,2,'loop'),0);
});

test('duplicate resources are not retried and a new queue or successful playback resets failure history',()=>{
 const recovery=new PlaybackRecovery(),tracks=queue(3);tracks.splice(1,0,{...tracks[0]});
 assert.equal(recovery.next(tracks,0,'loop'),2);
 assert.equal(recovery.next(tracks,2,'loop'),3);
 assert.equal(recovery.next(tracks,3,'loop'),null);
 recovery.reset();assert.equal(recovery.next(tracks,0,'loop'),2);
 assert.equal(recovery.next(queue(3),2,'loop'),0);
});

test('unavailable network is bounded by consecutive attempts and elapsed time',()=>{
 const recovery=new PlaybackRecovery(),tracks=queue(50);
 for(let i=0;i<9;i++)assert.equal(recovery.next(tracks,i,'loop'),i+1);
 assert.equal(recovery.next(tracks,9,'loop'),null);
 let now=0;const timed=new PlaybackRecovery({now:()=>now});
 assert.equal(timed.next(tracks,0,'loop'),1);now=120000;
 assert.equal(timed.next(tracks,1,'loop'),null);
});
