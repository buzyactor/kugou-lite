import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';

// Raw binary CAVA frames may be split or coalesced at arbitrary pipe boundaries.
export class SpectrumFrames {
  pending=Buffer.alloc(0);
  constructor(size=16){if(!Number.isInteger(size)||size<1||size>512)throw new Error('invalid spectrum frame size');this.size=size;}
  push(chunk) {
    this.pending=Buffer.concat([this.pending,chunk]);
    let last;
    while(this.pending.length>=this.size){last=[...this.pending.subarray(0,this.size)];this.pending=this.pending.subarray(this.size);}
    return last;
  }
}
export class Spectrum {
  constructor(emit){this.emit=emit;}
  start(){
    if(this.child)return;
    const dir=mkdtempSync(join(tmpdir(),'kugou-cava-'));
    const config=join(dir,'config');
    writeFileSync(config,'[general]\nbars = 48\nframerate = 60\n[input]\nmethod = pulse\nsource = auto\n[output]\nmethod = raw\nraw_target = /dev/stdout\ndata_format = binary\nbit_format = 8bit\n',{mode:0o600});
    const child=spawn('cava',['-p',config],{stdio:['ignore','pipe','ignore']});
    this.child=child;const frames=new SpectrumFrames(48);
    child.stdout.on('data',chunk=>{const bars=frames.push(chunk);if(this.child===child&&bars)this.emit({kind:'spectrum',bars});});
    child.on('error',()=>this.emit({kind:'spectrum',bars:[],error:'CAVA 未安装'}));
    child.on('close',()=>{rmSync(dir,{recursive:true,force:true});if(this.child===child){this.child=null;this.emit({kind:'spectrum',bars:[],error:'CAVA 音频输入不可用'});}});
  }
  stop(){const child=this.child;this.child=null;child?.kill('SIGKILL');this.emit({kind:'spectrum',bars:[]});}
}
export class Desktop {
  constructor(onCommand,emit){
    this.child=spawn('python',['-u',fileURLToPath(new URL('../tools/mpris.py',import.meta.url))],{stdio:['pipe','pipe','ignore']});
    this.child.stdin.on('error',()=>{});
    createInterface({input:this.child.stdout}).on('line',line=>{try{const event=JSON.parse(line);if(event.command)onCommand(event.command);else if(event.ready)emit({kind:'desktop',message:'MPRIS 已连接'});}catch{}});
    this.child.on('error',()=>emit({kind:'desktop',message:'MPRIS 不可用：需要 python-dbus、python-gobject'}));
    this.child.on('exit',()=>{if(!this.closed)emit({kind:'desktop',message:'MPRIS 不可用：请在桌面会话运行'});});
  }
  update(state){if(!this.child.stdin.destroyed)this.child.stdin.write(JSON.stringify(state)+'\n');}
  close(){if(this.closed)return;this.closed=true;this.child.stdin.end();this.child.kill();}
}
