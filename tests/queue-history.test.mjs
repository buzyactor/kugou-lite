import test from 'node:test';
import assert from 'node:assert/strict';
import {QueueHistory} from '../src/queue-history.mjs';
const rows=id=>[{hash:id,title:id,artist:'Artist',audioId:id,albumId:'1'},{hash:id+'2',title:id+'2'}];

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
