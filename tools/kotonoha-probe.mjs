/** Local-fixture driver for check-kotonoha.py; never accesses accounts or remote media. */
import {createInterface} from 'node:readline';
import {KotonohaAdapter} from '../src/kotonoha-adapter.mjs';
import {Player} from '../src/music.mjs';
import {parseKrc} from '../src/library.mjs';
import {nextIndex} from '../src/playback-options.mjs';
const [endpoint,file]=process.argv.slice(2);
const emit=event=>console.log(JSON.stringify(event));
const adapter=new KotonohaAdapter({playerId:'kugou-lite-protocol-probe',onLog:record=>emit({kind:'adapter',...record})});
const config={enabled:true,endpoint,clockMs:1000};
const track={hash:'a'.repeat(32),audioId:'123',title:'Integration Tone',artist:'Local Fixture',album:'Protocol Test',duration:8};
const lyrics=parseKrc('[offset:250]\n[1000,1200]<0,400,0>Hello<400,800,0> world\n[4000,1000]<0,1000,0>Again').map(row=>({...row,source:'酷狗 KRC',translation:'本地测试译文'}));
let instance=0,loopOnce=false;
const start=(position=0)=>{player.play(file,false,position);instance=adapter.beginTrack(track);};
const player=new Player(message=>emit({kind:'backend',message}),{
 silent:true,
 onTime:position=>{adapter.observeTime(position);emit({kind:'backend',position});},
 onState:status=>{adapter.observeState(status);emit({kind:'backend',status});},
 onSeek:position=>{adapter.observeSeek(position);emit({kind:'backend',seek:position});},
 onDuration:duration=>{adapter.observeDuration(duration);emit({kind:'backend',duration});},
 onEnded:()=>{if(loopOnce&&nextIndex(0,1,'single',1,true)===0){loopOnce=false;start();emit({kind:'backend',autoLoop:true,instance});}},
});
adapter.configure(config);
emit({kind:'ready'});
const input=createInterface({input:process.stdin});
input.on('line',command=>{
 switch(command){
  case 'start':start();break;
  case 'loop':loopOnce=true;start(7.75);break;
  case 'lyrics':adapter.setLyrics(instance,lyrics,track);break;
  case 'pause':player.setPaused(true);break;
  case 'resume':player.setPaused(false);break;
  case 'seek':player.seek(3,true);break;
  case 'stop':player.stop();break;
  case 'reconnect':adapter.configure({...config,enabled:false});adapter.configure(config);break;
  case 'quit':player.stop();adapter.close();input.close();process.exit(0);break;
  default:emit({kind:'error',message:'unknown probe command'});
 }
});
input.on('close',()=>{player.stop();adapter.close();});
process.on('SIGTERM',()=>{player.stop();adapter.close();process.exit(0);});
