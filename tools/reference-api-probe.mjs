// Public, read-only reference API diagnostic. No account files are read.
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';import {writeFile} from 'node:fs/promises';import dns from 'node:dns/promises';import https from 'node:https';
process.env.platform=process.argv.includes('--standard')?'android':'lite';
const require=createRequire(new URL('../KuGouMusicApi/package.json',import.meta.url));const root=fileURLToPath(new URL('../KuGouMusicApi/',import.meta.url));
const axios=require('axios');axios.defaults.timeout=12000;axios.defaults.maxRedirects=0;const {createRequest}=require(root+'util/request.js');const {signatureAndroidParams,appid,clientver}=require(root+'util');
const report={recordedAt:new Date().toISOString(),credentialsSent:false,apiVersion:require(root+'package.json').version,platform:process.env.platform,appid,clientver,network:[],checks:[]};
for(const hostname of ['gateway.kugou.com','openapi.kugou.com','expendablekmr.kugou.com','h5activity.kugou.com','openapicdn.kugou.com']){
 const item={hostname};try{item.dns=await dns.lookup(hostname,{all:true});}catch(e){item.dnsError=e.code;}
 item.https=await new Promise(resolve=>{const req=https.get({hostname,path:'/',timeout:8000},res=>{res.resume();resolve({status:res.statusCode,tls:res.socket.authorized});});req.on('timeout',()=>req.destroy(Object.assign(new Error(),{code:'HTTPS_TIMEOUT'})));req.on('error',e=>resolve({error:e.code}));});report.network.push(item);
}
function shape(v,depth=0){if(Array.isArray(v))return{length:v.length,first:depth<5?shape(v[0],depth+1):undefined};if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).filter(([k])=>!/token|cookie|signature|secret|^key$/i.test(k)).map(([k,x])=>[k,depth<5?shape(x,depth+1):typeof x]));return typeof v;}
function summary(b){const d=b.data;const out={shape:shape(b)};if(d&&!Array.isArray(d)){out.values=Object.fromEntries(Object.entries(d).filter(([k,v])=>/count|total|fans|birthday|author_name/.test(k)&&['number','string'].includes(typeof v)));if(d.lists)out.searchFlags=d.lists.slice(0,3).map(r=>Object.fromEntries(Object.entries(r).filter(([k])=>['AuthorId','Heat','FansNum','IsReal','Identity','UserId','IsSettledAuthor'].includes(k))));}
 const authors=[];if(Array.isArray(d))for(const group of d){if(Array.isArray(group))authors.push(...group);else if(group?.author)authors.push(...group.author);}
 out.samples=Array.isArray(d)?d.slice(0,3).map(r=>Object.fromEntries(Object.entries(r??{}).filter(([k,v])=>['heat','history_heat','playcount','audio_name','video_name','author_name','is_hot'].includes(k)))):[];
 if(d?.info)out.singers=d.info.slice(0,3).flatMap(g=>(g.singer??[]).slice(0,3)).map(r=>({id:r.singerid,name:r.singername,heat:r.heat,description:r.descibe,is_settled:r.is_settled,dycover:r.dycover}));
 out.images=authors.filter(a=>a.imgs).map(a=>({author_id:a.author_id,counts:Object.fromEntries(Object.entries(a.imgs).map(([k,v])=>[k,v.length])),uniqueUrls:new Set(Object.values(a.imgs).flat().map(v=>v.sizable_portrait)).size}));return out;}
async function call(name,params){let options;try{const b=(await require(root+'module/'+name+'.js')({...params,cookie:{}},o=>{options=o;const hostname=new URL(o.baseURL??'https://gateway.kugou.com').hostname;const n=report.network.find(n=>n.hostname===hostname);if(!n?.dns||!n.https?.tls)throw Object.assign(new Error('network check failed'),{code:'NETWORK_CHECK_FAILED'});return createRequest(o);})).body;const record={name,params,method:options.method,address:new URL(options.url,options.baseURL??'https://gateway.kugou.com').origin+new URL(options.url,options.baseURL??'https://gateway.kugou.com').pathname,status:b.status,error_code:b.error_code,...summary(b)};report.checks.push(record);console.log(JSON.stringify({name,status:b.status,error_code:b.error_code,values:record.values,images:record.images,searchFlags:record.searchFlags,samples:record.samples,singers:record.singers}));}catch(e){const record={name,params,error:{code:e.body?.code??e.code,httpStatus:e.body?.httpStatus,businessCode:e.body?.error_code}};report.checks.push(record);console.log(JSON.stringify(record));}}
if(!process.argv.includes('--extra')){
for(const id of ['3520','3066']){
 await call('artist_detail',{id});await call('artist_audios_new',{id,sort:'hot',pagesize:3});await call('artist_albums',{id,pagesize:3});await call('artist_videos',{id,pagesize:3,tag:'official'});
}
await call('search',{keywords:'周杰伦',type:'author',pagesize:3});await call('artist_lists',{hotsize:3});
for(const count of [5,100])for(const name of ['images','images_audio'])await call(name,{hash:'B3A52A7A958BF0AED0EBFBA2E9A818B7',count});
await call('artist_honour',{id:'3520',pagesize:3});
await call('krm_audio',{album_audio_id:'32100650',fields:'base,authors.base,authors.ip,extra,tags,tagmap'});
}else{await call('artist_lists',{hotsize:3});await call('artist_videos',{id:'3520',pagesize:3,tag:'official'});}
await writeFile(new URL('../docs/investigations/new-reference-api-'+process.env.platform+(process.argv.includes('--extra')?'-extra':'')+'.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
