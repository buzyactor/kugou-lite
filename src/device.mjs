import {readFile} from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
import path from 'node:path';
import {privateWrite} from './login.ts';
export class Device {
  constructor(directory,request){this.file=path.join(directory,'device.json');this.request=request;this.pending=null;}
  async get(){
    if(this.pending)return this.pending;
    this.pending=this.load();
    try{return await this.pending;}finally{this.pending=null;}
  }
  async load(){
    let identity;
    try{identity=JSON.parse(await readFile(this.file,'utf8'));}
    catch(error){if(error.code!=='ENOENT')throw new Error('设备信息不可读，请保留文件后修复');}
    if(!identity){identity={mid:randomBytes(16).toString('hex'),uuid:randomBytes(16).toString('hex')};await privateWrite(this.file,JSON.stringify(identity)+'\n');}
    if(!identity.KUGOU_API_GUID){
      identity.KUGOU_API_GUID=identity.uuid;
      identity.KUGOU_API_MID=BigInt('0x'+createHash('md5').update(identity.uuid).digest('hex')).toString();
      identity.KUGOU_API_DEV='KugouLite';
      identity.KUGOU_API_MAC=['02',...Array.from(randomBytes(5),n=>n.toString(16).padStart(2,'0'))].join(':').toUpperCase();
      await privateWrite(this.file,JSON.stringify(identity)+'\n');
    }
    if(typeof identity.dfid==='string'&&/^[A-Za-z0-9._~-]+$/.test(identity.dfid))return identity;
    // Registration identity remains stable across failed requests and restarts.
    if(!/^[a-f0-9]{32}$/.test(identity.mid)||!/^[a-f0-9]{32}$/.test(identity.uuid))throw new Error('设备标识格式无效');
    let reply;
    try{reply=await this.request('/register/dev?'+new URLSearchParams({mid:identity.mid,uuid:identity.uuid}));}catch{return identity;}
    const dfid=reply?.data?.dfid;
    if(reply.status!==1||typeof dfid!=='string'||!/^[A-Za-z0-9._~-]+$/.test(dfid))throw new Error('设备注册未完成');
    identity.dfid=dfid;await privateWrite(this.file,JSON.stringify(identity)+'\n');return identity;
  }
}
