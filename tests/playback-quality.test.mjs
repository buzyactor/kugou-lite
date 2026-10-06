import test from 'node:test';
import assert from 'node:assert/strict';
import {resolvePlayback} from '../src/music.mjs';
import {qualities,qualityFallbacks} from '../src/playback-options.mjs';

const track={hash:'a'.repeat(32),flacHash:'b'.repeat(32),albumId:'1',audioId:'2'};
function source(replies) {
  const attempts=[];
  const request=async route=>{
    const params=new URL(route,'https://local').searchParams;
    const quality=params.get('quality');
    attempts.push({quality,hash:params.get('hash')});
    assert.equal(params.has('free_part'),false);
    const reply=replies[quality];
    if(reply instanceof Error)throw reply;
    return reply;
  };
  return {request,attempts};
}
const audio=quality=>({url:`https://fs.kugou.com/${quality}.mp3`});
const inspect=async url=>({codec:url.includes('/flac.')?'flac':'mp3',sampleRate:44100});

test('FLAC absent falls back to full MP3 with original hash',async()=>{
  const {request,attempts}=source({flac:{url:[]},320:audio('320')});
  const result=await resolvePlayback(request,track,'flac',{inspect});
  assert.deepEqual(attempts,[{quality:'flac',hash:track.flacHash},{quality:'320',hash:track.hash}]);
  assert.equal(result.info.codec,'mp3');assert.equal(result.resolved,'320');
  assert.equal(result.requested,'flac');
});
test('valid lossless codec with MP3 suffix keeps FLAC and avoids further requests',async()=>{
  const {request,attempts}=source({flac:audio('flac')});
  const result=await resolvePlayback(request,track,'flac',{inspect});
  assert.equal(result.info.codec,'flac');assert.equal(attempts.length,1);
});
test('a verified full MP3 returned at lossless tier remains playable if lower tiers have no URL',async()=>{
  const {request}=source({flac:audio('wrong'),320:{},128:{}});
  const result=await resolvePlayback(request,track,'flac',{inspect});
  assert.equal(result.info.codec,'mp3');assert.equal(result.resolved,'mp3');
});
test('lossy response at FLAC tier tries 320 then 128; preview is never played',async()=>{
  const {request,attempts}=source({flac:audio('wrong'),320:{...audio('320'),is_free_part:1},128:audio('128')});
  const result=await resolvePlayback(request,track,'flac',{inspect});
  assert.deepEqual(attempts.map(x=>x.quality),['flac','320','128']);
  assert.equal(result.resolved,'128');
});
test('each higher quality is requested first and persists as preference after fallback',async()=>{
  for(const quality of ['high','viper_clear','viper_atmos']) {
    assert.ok(qualities.includes(quality));
    const {request,attempts}=source({[quality]:{},high:{},flac:audio('flac')});
    const result=await resolvePlayback(request,track,quality,{inspect});
    assert.deepEqual(attempts.map(x=>x.quality),quality==='high'?['high','flac']:[quality,'high','flac']);
    assert.equal(result.requested,quality);assert.equal(result.resolved,'flac');
  }
});
test('high quality and enhanced formats report their actual codec and sample rate',async()=>{
  for(const [quality,codec] of [['high','flac'],['viper_clear','aac'],['viper_atmos','eac3']]) {
    const {request,attempts}=source({[quality]:audio(quality)});
    const result=await resolvePlayback(request,track,quality,{inspect:async()=>({codec,sampleRate:96000,bits:24})});
    assert.equal(result.info.codec,codec);assert.equal(result.info.sampleRate,96000);assert.equal(attempts.length,1);
  }
});
test('transport/authentication, unsafe CDN and probe failure do not trigger tier retries',async()=>{
  for(const reply of [new Error('network timeout'),Object.assign(new Error('auth expired'),{businessCode:20017}),{url:'https://evil.example/song'}]) {
    const {request,attempts}=source({flac:reply});
    await assert.rejects(resolvePlayback(request,track,'flac',{inspect}));
    assert.equal(attempts.length,1);
  }
  const {request,attempts}=source({flac:audio('flac')});
  await assert.rejects(resolvePlayback(request,track,'flac',{inspect:async()=>{throw Error('probe timeout');}}),/probe timeout/);
  assert.equal(attempts.length,1);
});
test('all unavailable tiers fail without playing previews; explicit MP3 never upgrades',async()=>{
  const {request,attempts}=source({flac:{},320:{},128:{...audio('128'),free_part:1}});
  await assert.rejects(resolvePlayback(request,track,'flac',{inspect}),/试听/);
  assert.equal(attempts.length,3);
  assert.deepEqual(qualityFallbacks('320'),['320','128']);
  assert.deepEqual(qualityFallbacks('128'),['128']);
  assert.throws(()=>qualityFallbacks('viper_tape'),/不支持/);
});
test('cancelled old request cannot continue fallback or emit another attempt',async()=>{
  let current=true,count=0;
  await assert.rejects(resolvePlayback(async()=>{current=false;return {};},track,'high',{
    inspect,isCurrent:()=>current,onAttempt:()=>count++,
  }),/取消/);
  assert.equal(count,1);
});
