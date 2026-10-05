import dns from 'node:dns/promises';
import https from 'node:https';
import {readFile,writeFile} from 'node:fs/promises';
const hosts=process.argv.length>2?process.argv.slice(2):['gateway.kugou.com','kugouvip.kugou.com','login.user.kugou.com'];
if(hosts.some(host=>!/^([a-z0-9-]+\.)+kugou\.com$/.test(host))){console.error('仅支持无凭据的酷狗 hostname');process.exit(2);}
function timed(promise,ms){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('timeout'),{code:'DNS_TIMEOUT'})),ms);})]).finally(()=>clearTimeout(timer));}
function connect(hostname){return new Promise(resolve=>{
 let done=false;const finish=value=>{if(done)return;done=true;clearTimeout(timer);resolve(value);};
 const request=https.request({hostname,path:'/',method:'GET',port:443,headers:{'User-Agent':'KugouLite-Network-Check'},rejectUnauthorized:true},response=>{response.resume();finish({ok:true,httpStatus:response.statusCode,tlsAuthorized:response.socket.authorized});});
 const timer=setTimeout(()=>{finish({ok:false,errorCode:'HTTPS_TIMEOUT'});request.destroy();},8000);
 request.on('error',error=>finish({ok:false,errorCode:error.code||'HTTPS_ERROR',syscall:error.syscall||null}));request.end();
});}
const nameservers=(await readFile('/etc/resolv.conf','utf8')).split('\n').filter(line=>line.startsWith('nameserver ')).map(line=>line.split(/\s+/)[1]);
const checks=await Promise.all(hosts.map(async hostname=>{
 const result={hostname};
 try{result.dns={ok:true,addresses:await timed(dns.lookup(hostname,{all:true}),6000)};}catch(error){result.dns={ok:false,errorCode:error.code||'DNS_ERROR',syscall:error.syscall||null};}
 result.https=await connect(hostname);return result;
}));
const report={recordedAt:new Date().toISOString(),credentialsSent:false,nameservers,checks};
await writeFile('/tmp/kugou-network-check.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify(report,null,2));process.exit(checks.every(c=>c.dns.ok&&c.https.ok)?0:1);
