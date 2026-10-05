import {SessionReader} from '../src/session-reader.mjs';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {Accounts} from '../src/accounts.mjs';
import {directRequest} from '../src/direct-api.mjs';
import {credentials,vipSnapshot} from './vip-probe.mjs';
import {setTimeout as delay} from 'node:timers/promises';
const option=(name,fallback)=>process.argv.find(a=>a.startsWith(`--${name}=`))?.split('=')[1]??fallback;
const api=option('api','legacy'),samples=Number(option('samples','1')),interval=Number(option('interval','10'));
if(!['legacy','modern'].includes(api)||!Number.isInteger(samples)||samples<1||samples>360||!Number.isFinite(interval)||interval<5||interval>3600)throw new Error('参数无效：--api=legacy|modern --samples=1..360 --interval=5..3600（秒）');
const network=JSON.parse(await readFile('/tmp/kugou-network-check.json','utf8'));
for(const hostname of ['gateway.kugou.com','kugouvip.kugou.com']){
 const check=network.checks.find(c=>c.hostname===hostname);
 if(!check?.dns.ok||!check?.https.ok)throw new Error(`尚未通过无凭据网络检查：${hostname}`);
}
const accounts=new Accounts(fileURLToPath(new URL('../.local/',import.meta.url)));
if(process.argv.includes('--refresh')){
 const session=new SessionReader(accounts,cookie=>directRequest(cookie,{api}),credentials,message=>console.log(JSON.stringify({check:'renewal_notice',message})));
 console.log(JSON.stringify({check:'renewal',hostname:'gateway.kugou.com',renewed:await session.maintain(true)}));
}
let baseline=null,start=Date.now();
for(let sample=0;sample<samples;sample++){
if(sample)await delay(interval*1000);
const account=await accounts.current();
if(!baseline||baseline.userid!==account.userid||baseline.token!==account.token){baseline=account;start=Date.now();}
const iso=value=>value?new Date(value).toISOString():null;
console.log(JSON.stringify({check:'session_timing',api,sample:sample+1,recordedAt:new Date().toISOString(),loggedInAt:iso(account.loggedInAt),tokenUpdatedAt:iso(account.tokenUpdatedAt),lastReadSuccessAt:iso(account.lastReadSuccessAt),lastAuthRejectedAt:iso(account.lastAuthRejectedAt),lastAuthRejectedCode:account.lastAuthRejectedCode??null,credentialAgeSeconds:Math.floor((Date.now()-(account.tokenUpdatedAt||Date.now()))/1000),observedSameCredentialSeconds:Math.floor((Date.now()-start)/1000),serverTokenExpiry:'unknown'}));
const request=directRequest(credentials(account),{api});
for(const [name,hostname,route] of [['playlists','gateway.kugou.com','/user/playlist?page=1&pagesize=30'],['vip','kugouvip.kugou.com','/user/vip/detail']]){
 try{
  const body=await request(route);
  console.log(JSON.stringify({check:name,hostname,mode:'read_only',status:body.status,...(name==='vip'?{membership:vipSnapshot(body)}:{rows:Array.isArray(body.data?.info)?body.data.info.length:null})}));
 }catch(error){console.log(JSON.stringify({check:name,hostname,mode:'read_only',businessCode:error.businessCode??null,transportCode:error.transportCode??null,message:error.message}));}
}
}
