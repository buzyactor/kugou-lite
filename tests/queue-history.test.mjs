import test from 'node:test';
import assert from 'node:assert/strict';
import {QueueHistory} from '../src/queue-history.mjs';
const rows=id=>[{hash:id,title:id,artist:'Artist',audioId:id,albumId:'1'},{hash:id+'2',title:id+'2'}];
test('edits retain the current song through moves and insertion, mark current removal and persist names/pins',()=>{
 const history=new QueueHistory(),first=history.commit(rows('A'),1,'A','A');
 history.edit(first.id,'up',1);assert.equal(first.index,0);assert.equal(first.tracks[0].title,'A2');
 history.insert(rows('B'),'next');assert.equal(first.index,0);assert.deepEqual(first.tracks.map(r=>r.title),['A2','B','B2','A']);
 history.edit(first.id,'down',0);assert.equal(first.index,1);assert.equal(first.tracks[1].title,'A2');
 assert.equal(history.edit(first.id,'remove',0).removedCurrent,false);assert.equal(first.index,0);
 assert.equal(history.edit(first.id,'remove',0).removedCurrent,true);
 history.edit(first.id,'rename','常听');history.edit(first.id,'pin');
 const snapshot=history.snapshot(),restored=new QueueHistory();restored.restore(snapshot);
 assert.equal(restored.viewed.title,'常听');assert.equal(restored.viewed.pinned,true);
 assert.throws(()=>history.edit(first.id,'rename','  '));
 const manual=new QueueHistory();manual.insert(rows('C'));assert.equal(manual.playing,null);assert.equal(manual.viewed.tracks.length,2);
 manual.activate(manual.viewed.id,0);manual.edit(manual.viewed.id,'remove',1);
 const result=manual.edit(manual.viewed.id,'remove',0);assert.equal(result.wasPlaying,true);assert.equal(result.removedCurrent,true);assert.equal(manual.entries.length,0);
});

test('another source retains the old queue; selecting a song in the active queue does not duplicate it',()=>{
  const history=new QueueHistory(),a=rows('A');
  const first=history.commit(a,0,'first','Playlist A');
  a[0].title='mutated';
  history.update(1);
  history.commit(rows('B'),0,'second','Playlist B');
  assert.equal(history.entries.length,2);
  assert.equal(first.tracks[0].title,'A');assert.equal(first.index,1);
  history.commit(rows('B'),1,'second','Playlist B');
  assert.equal(history.entries.length,2);assert.equal(history.playing.index,1);
  history.commit(rows('B').reverse(),0,'second','Playlist B reversed');
  assert.equal(history.entries.length,3,'changed ordering creates a separate queue');
});
test('browsing wraps without changing playback; Enter activation resumes that queue and its index',()=>{
  const history=new QueueHistory();
  const first=history.commit(rows('A'),1,'A','A');
  const second=history.commit(rows('B'),0,'B','B');
  assert.equal(history.next().id,first.id);
  assert.equal(history.playing.id,second.id);
  history.update(1);assert.equal(first.index,1);assert.equal(second.index,1);
  history.activate(first.id,0);assert.equal(history.playing.id,first.id);
  assert.equal(history.open().id,first.id);
  assert.equal(history.next().id,second.id);
  assert.equal(history.next().id,first.id);
  assert.throws(()=>history.activate(first.id,100),/失效/);
});
test('deleting an inactive queue preserves playback; deleting the playing and final queues leaves no dangling identity',()=>{
  const history=new QueueHistory();
  history.commit(rows('A'),0,'A','A');
  const playing=history.commit(rows('B'),1,'B','B');
  history.next();assert.equal(history.remove().wasPlaying,false);
  assert.equal(history.playing.id,playing.id);
  assert.equal(history.remove().wasPlaying,true);
  assert.equal(history.playing,null);assert.equal(history.viewed,null);
  assert.equal(history.next(),null);assert.equal(history.remove(),null);
  history.commit(rows('C'),0,'C','C');history.clear();
  assert.deepEqual(history.entries,[]);assert.equal(history.open(),null);
});
