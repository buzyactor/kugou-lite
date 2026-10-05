import test from 'node:test';
import assert from 'node:assert/strict';
import {SpectrumFrames} from '../src/desktop.mjs';
import {search,Player} from '../src/music.mjs';

test('CAVA stream handles split and combined binary frames without shifting bars',()=>{
 const frames=new SpectrumFrames();
 assert.equal(frames.push(Buffer.from([1,2,3])),undefined);
 assert.deepEqual(frames.push(Buffer.alloc(13,4)),[1,2,3,...Array(13).fill(4)]);
 assert.deepEqual(frames.push(Buffer.concat([Buffer.alloc(16,20),Buffer.alloc(16,255),Buffer.from([7])])),Array(16).fill(255));
 assert.equal(frames.pending.length,1);
 assert.deepEqual(frames.push(Buffer.alloc(15,8)),[7,...Array(15).fill(8)]);
});
test('search sends viewport capacity consistently across pages',async()=>{
 for(const page of [1,2,3])await search(async route=>{
  const p=new URL(route,'https://example.test').searchParams;
  assert.equal(p.get('pagesize'),'47');assert.equal(p.get('page'),String(page));return {data:{lists:[]}};
 },'测试',page,47);
 await assert.rejects(search(()=>{},'测试',1,0),/数量/);
});
test('desktop pause is idempotent mpv property assignment; volume is per-player',()=>{
 const states=[],writes=[];
 const player=new Player(()=>{},{onState:state=>states.push(state)});
 player.child={kill:()=>{},stdio:{3:{write:line=>writes.push(JSON.parse(line).command)}}};
 player.setPaused(true);player.setPaused(false);player.setVolume(35);player.stop();
 assert.deepEqual(writes,[['set_property','pause',true],['set_property','pause',false],['set_property','volume',35]]);
 assert.deepEqual(states,['Stopped']);
});
test('48-band high-rate frames preserve alignment across split and coalesced reads',()=>{
 const frames=new SpectrumFrames(48);
 assert.equal(frames.push(Buffer.alloc(23,10)),undefined);
 assert.deepEqual(frames.push(Buffer.concat([Buffer.alloc(25,20),Buffer.alloc(48,80),Buffer.alloc(7,30)])),Array(48).fill(80));
 assert.equal(frames.pending.length,7);
 assert.deepEqual(frames.push(Buffer.alloc(41,40)),[...Array(7).fill(30),...Array(41).fill(40)]);
 assert.throws(()=>new SpectrumFrames(0));
});
