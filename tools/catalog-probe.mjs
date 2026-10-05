// Read-only diagnostic: print field names and numeric counts, never credentials.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Accounts} from '../src/accounts.mjs';
import {directRequest} from '../src/direct-api.mjs';
import {credentials} from './vip-probe.mjs';
import {Discovery} from '../src/discovery.mjs';
const network=JSON.parse(await readFile('/tmp/kugou-network-check.json','utf8'));
const check=network.checks.find(c=>c.hostname==='gateway.kugou.com');
if(!check?.dns.ok||!check?.https.ok||Date.now()-Date.parse(network.recordedAt)>300000)throw new Error('请先运行 node tools/network-check.mjs，确认 gateway.kugou.com 无凭据 DNS/HTTPS 连通性');
const accounts=new Accounts(fileURLToPath(new URL('../.local/',import.meta.url)));
const request=directRequest(credentials(await accounts.current()));
if(process.argv.includes('--normalized')){
 const discovery=new Discovery();
 for(const kind of ['recommended','hires']){
  try{const lists=await discovery.load(request,kind,1,20);console.log(JSON.stringify({kind,rows:lists.length,known:lists.filter(r=>r.count!==null).length,positive:lists.filter(r=>r.count>0).length,sampleCounts:lists.slice(0,6).map(r=>r.count)}));}
  catch(error){console.log(JSON.stringify({kind,businessCode:error.businessCode??null,transportCode:error.transportCode??null,message:error.message}));}
 }
 process.exit(0);
}
function shape(value,depth=0){
 if(Array.isArray(value))return {arrayLength:value.length,item:depth<3?shape(value[0],depth+1):undefined};
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).slice(0,70).map(([key,v])=>[key,depth<3&&v&&typeof v==='object'?shape(v,depth+1):/(count|total|num)/i.test(key)&&Number.isFinite(Number(v))?Number(v):typeof v]));
 return typeof value;
}
for(const category of [0,11292]){
 try{
  const body=await request(`/top/playlist?category_id=${category}&withsong=0&page=1&pagesize=3`);
  console.log(JSON.stringify({category,status:body.status,shape:shape(body.data)}));
  const row=body.data?.special_list?.[0];const id=row?.global_collection_id??row?.extra?.global_collection_id;
  if(id)console.log(JSON.stringify({category,detail:shape((await request('/playlist/detail?ids='+encodeURIComponent(id))).data)}));
 }catch(error){console.log(JSON.stringify({category,hostname:'gateway.kugou.com',businessCode:error.businessCode??null,transportCode:error.transportCode??null,message:error.message}));}
}
