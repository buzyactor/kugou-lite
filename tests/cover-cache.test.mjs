import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,symlink,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {cacheCover,readCachedCover,cachedCoverPixels} from '../src/library.mjs';

test('on-disk playback cover survives restart and supplies pixels without a network URL',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'kugou-cover-cache-')),hash='a'.repeat(32);
  try{
    const file=join(folder,'source.png');
    assert.equal(spawnSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=red:s=32x32','-frames:v','1',file]).status,0);
    const png=(await readFile(file)).toString('base64');
    const artUrl=await cacheCover(folder,hash,png);
    const saved=await readCachedCover(folder,hash);
    assert.equal(saved.png,png);assert.equal(saved.artUrl,artUrl);
    const pixels=await cachedCoverPixels(saved.png);
    assert.equal(pixels.length,3072);assert.ok(pixels[0]>240&&pixels[1]<10&&pixels[2]<10);
    assert.deepEqual(await readCachedCover(folder,'b'.repeat(32)),{png:'',artUrl:''});
    assert.deepEqual(await readCachedCover(folder,'../source'),{png:'',artUrl:''});
    await writeFile(new URL(artUrl),'broken');
    assert.equal((await readCachedCover(folder,hash)).png,'');
    const linkedHash='c'.repeat(32);
    await symlink(file,join(folder,'covers',linkedHash+'.png'));
    assert.equal((await readCachedCover(folder,linkedHash)).png,'');
    assert.deepEqual(await cachedCoverPixels('broken'),[]);
  }finally{await rm(folder,{recursive:true,force:true});}
});
