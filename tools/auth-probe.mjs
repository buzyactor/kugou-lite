import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {directRequest,LOGIN_PROVIDER} from '../src/direct-api.mjs';
import {Device} from '../src/device.mjs';
import {parseLogin} from '../src/login.ts';

// No accounts are read. Create an isolated anonymous QR session and discard it; never print its key.
const directory=await mkdtemp(path.join(tmpdir(),'kugou-auth-probe-'));
let stage='device',responseStatus=null,responseErrorCode=null;
try {
  const identity=await new Device(directory,route=>directRequest()(route)).get();
  const cookie=Object.entries(identity).filter(([key])=>key==='dfid'||key.startsWith('KUGOU_API_')).map(([key,value])=>`${key}=${value}`).join('; ');
  const request=directRequest(cookie);
  stage='qr-key';
  const keyReply=await request('/login/qr/key');
  responseStatus=keyReply.status??null;responseErrorCode=keyReply.error_code??null;
  const key=keyReply?.data?.qrcode;
  if(keyReply.status!==1||typeof key!=='string'||!key)throw new Error('二维码准备失败');
  stage='qr-image';
  const image=await request('/login/qr/create?'+new URLSearchParams({key,qrimg:'true'}));
  if(typeof image?.data?.base64!=='string'||!image.data.base64.startsWith('data:image/png;base64,'))throw new Error('二维码图像失败');
  stage='qr-check';
  const result=parseLogin(await request('/login/qr/check?'+new URLSearchParams({key})));
  console.log(JSON.stringify({recordedAt:new Date().toISOString(),provider:LOGIN_PROVIDER,accountsRead:false,deviceRegistered:Boolean(identity.dfid),qrPrepared:true,state:result.state,credentialsPersisted:false,sessionLifetimeVerified:false}));
} catch(error) {
  console.log(JSON.stringify({provider:LOGIN_PROVIDER,accountsRead:false,ok:false,stage,responseStatus,responseErrorCode,errorType:error.name??null,reason:['设备注册未完成','设备标识格式无效','设备信息不可读，请保留文件后修复','二维码准备失败','二维码图像失败'].includes(error.message)?error.message:null,businessCode:error.businessCode??null,transportCode:error.transportCode??null}));process.exitCode=1;
} finally {await rm(directory,{recursive:true,force:true});}
