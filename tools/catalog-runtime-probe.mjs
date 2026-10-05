// Read-only public catalog probe. Does not restore an account or play music.
// Replace only the desktop subprocess inside this diagnostic to avoid claiming MPRIS.
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawn} from 'node:child_process';import {createInterface} from 'node:readline';import assert from 'node:assert/strict';
const report=JSON.parse(await readFile('/tmp/kugou-network-check.json','utf8'));
const check=report.checks.find(c=>c.hostname==='gateway.kugou.com');if(!check?.dns.ok||!check?.https.ok)throw new Error('请先运行 network-check.mjs');
const dir=await mkdtemp(join(tmpdir(),'kugou-catalog-probe-'));
await writeFile(join(dir,'python'),'#!/bin/sh\nexec /usr/bin/cat >/dev/null\n',{mode:0o700});
const child=spawn(process.execPath,['tools/tui-worker.mjs'],{cwd:process.cwd(),env:{...process.env,PATH:dir+':'+process.env.PATH},stdio:['pipe','pipe','pipe']});
let event=null,error=null,waiting=null,assets=0,thumbnails=0;
createInterface({input:child.stdout}).on('line',line=>{let value;try{value=JSON.parse(line);}catch{return;}
 if(['catalog','tracks'].includes(value.kind))event=value;
 if(value.kind==='catalog_thumbnail'&&value.thumbnailPng)thumbnails++;
 if(value.kind==='catalog_assets'&&value.artist?.png)assets++;
 if(value.kind==='error')error=value.message;
 if(value.kind==='busy'&&value.value===false&&waiting){const resolve=waiting;waiting=null;resolve();}
});
child.stderr.on('data',()=>{});
async function command(text){error=null;let timer;await Promise.race([new Promise(resolve=>{waiting=resolve;child.stdin.write(text+'\n');}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('public catalog command timeout')),150000);})]).finally(()=>clearTimeout(timer));if(error)throw new Error(error);return event;}
try{
 await command('search:周杰伦');assert.equal(event.searchType,'song');assert.ok(event.rows.length);
 await command('searchtype:artist');assert.equal(event.rows[0].kind,'artist');
 const thumbDeadline=Date.now()+15000;while(!thumbnails&&Date.now()<thumbDeadline)await new Promise(resolve=>setTimeout(resolve,50));assert.ok(thumbnails,'search artist thumbnail did not arrive');
 await command('openentity:0');assert.equal(event.mode,'artist');const info=event.artist;assert.ok(event.rows.length);
 console.log(JSON.stringify({stage:'artist',songsLoaded:info.loaded,expected:info.expected,complete:info.complete,photos:info.photos.length,sections:Object.entries(info.sections).filter(([,v])=>v).map(([k])=>k),heatKnown:info.heatKnown,listenersProvided:info.listeners!==null,guardiansProvided:info.guardians!==null}));
 const initialDeadline=Date.now()+15000;while(!assets&&Date.now()<initialDeadline)await new Promise(resolve=>setTimeout(resolve,50));assert.ok(assets,'initial artist image did not arrive');
 const beforePhoto=assets;await command('artistphoto:1');const photoDeadline=Date.now()+15000;while(assets===beforePhoto&&Date.now()<photoDeadline)await new Promise(resolve=>setTimeout(resolve,50));assert.ok(assets>beforePhoto,'switched artist image did not arrive');
 await command('artistprofile');assert.equal(event.mode,'profile');assert.equal(event.profileTab,1);
 await command('profiletab:4');assert.ok(event.artist.sections['荣誉记录']);
 await command('back');assert.equal(event.mode,'artist');
 const beforeAlbumThumbnails=thumbnails;await command('artisttab:albums');assert.equal(event.rows[0].kind,'album');
 const albumThumbDeadline=Date.now()+15000;while(thumbnails===beforeAlbumThumbnails&&Date.now()<albumThumbDeadline)await new Promise(resolve=>setTimeout(resolve,50));assert.ok(thumbnails>beforeAlbumThumbnails,'artist album thumbnail did not arrive');
 await command('openentity:0');assert.equal(event.mode,'album');assert.equal(event.rows[0].kind,'song');assert.ok(event.rows[0].hash);console.log(JSON.stringify({stage:'album',tracks:event.rows.length,validTitle:!!event.rows[0].title,hasFlacHash:!!event.rows[0].flacHash}));
 await command('back');assert.equal(event.mode,'artist');assert.equal(event.artistTab,'albums');
 await command('back');assert.equal(event.mode,'search');assert.equal(event.searchType,'artist');
 const beforePlaylistThumbnail=thumbnails;await command('searchtype:playlist');assert.equal(event.rows[0].kind,'playlist');
 const playlistThumbDeadline=Date.now()+15000;while(thumbnails===beforePlaylistThumbnail&&Date.now()<playlistThumbDeadline)await new Promise(resolve=>setTimeout(resolve,50));assert.ok(thumbnails>beforePlaylistThumbnail,'search playlist thumbnail did not arrive');child.stdin.write('focus:1:0\n');await command('openentity:1');assert.equal(event.kind,'tracks');assert.ok(event.tracks.length);await command('pagesize:9');
 await command('back');assert.equal(event.mode,'search');assert.equal(event.searchType,'playlist');assert.equal(event.selected,1);
 await command('nextpage');assert.equal(event.rows[0].number,21);await command('prevpage');
 await command('searchtype:album');assert.equal(event.rows[0].kind,'album');
 console.log(JSON.stringify({stage:'navigation',fourCategories:true,playlistOpened:true,artistAlbumsOpened:true,profileAndBack:true,pageSizeAndSelectionRestored:true,photoAssetsReceived:assets,searchThumbnailsReceived:thumbnails,playlistThumbnailsVerified:true,artistAlbumThumbnailsVerified:true}));
}finally{child.stdin.end();await new Promise(resolve=>{child.once('close',resolve);setTimeout(()=>child.kill('SIGKILL'),2000).unref();});await rm(dir,{recursive:true,force:true});}
