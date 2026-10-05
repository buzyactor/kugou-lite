import {validSessionValue} from './login.ts';
import {setTimeout as delay} from 'node:timers/promises';
const READ_ROUTES=new Set(['/user/playlist','/playlist/track/all/new','/playlist/track/all','/playlist/detail','/rank/info','/everyday/recommend','/top/playlist','/top/song','/rank/list','/rank/audio','/search','/user/detail','/user/vip/detail','/song/url','/search/lyric','/lyric']);
export const expired = error => [20005,20017,40004].includes(error?.businessCode);
const valid=value=>typeof value==='string'&&/^[A-Za-z0-9._~-]+$/.test(value);
const REFRESH_INTERVAL=6*60*60*1000, FAILURE_COOLDOWN=5*60*1000;
// Retry only reads after transient transport errors. Authentication rejection is not a network error.
export async function retryRead(request,route,onNotice=()=>{},sleep=delay) {
  for(let attempt=0;;attempt++) {
    try{return await request(route);}
    catch(error){
      if(!error.retryable||attempt>=2)throw error;
      onNotice(`网络暂时不可用，正在重试 ${attempt+1}/2；登录信息已保留…`);
      await sleep([500,1500][attempt]);
    }
  }
}
export class SessionReader {
  constructor(accounts,factory,cookie,onNotice=()=>{},sleep=delay) {
    this.accounts=accounts;this.factory=factory;this.cookie=cookie;this.onNotice=onNotice;this.sleep=sleep;this.inflight=new Map();
  }
  async refresh(original,force=false) {
    if(this.inflight.has(original.userid))return this.inflight.get(original.userid);
    const task=this.refreshOne(original,force);
    this.inflight.set(original.userid,task);
    try{return await task;}finally{if(this.inflight.get(original.userid)===task)this.inflight.delete(original.userid);}
  }
  async refreshOne(original,force) {
    let latest=(await this.accounts.read()).accounts.find(a=>a.userid===original.userid);
    if(!latest)return false;
    if(latest.token!==original.token)return true; // Another request/window already rotated it.
    const now=Date.now();
    if(!force&&now-(latest.tokenUpdatedAt||0)<REFRESH_INTERVAL)return false;
    if(now-(latest.refreshAttemptAt||0)<FAILURE_COOLDOWN)return false;
    // Persist a lease before issuing a rotating request; restarting cannot create a retry storm.
    let acquired=false;
    await this.accounts.update(data=>{
      const account=data.accounts.find(a=>a.userid===original.userid);
      if(account&&account.token===original.token&&now-(account.refreshAttemptAt||0)>=FAILURE_COOLDOWN){account.refreshAttemptAt=now;acquired=true;}
    });
    if(!acquired)return false;
    this.onNotice(force?'正在恢复概念版登录凭证…':'正在维护已保存的登录状态…');
    let reply;
    // Token rotation is a write: a timeout must not trigger another rotation.
    try {reply=await this.factory(this.cookie(latest))('/login/token');}
    catch(error){
      this.onNotice(error.retryable?'登录续期暂时未完成，保留凭证，稍后再试':'服务端未接受本次续期，保留账号');
      return false;
    }
    const value=reply?.data;
    if(reply?.status!==1||String(value?.userid??original.userid)!==original.userid||!valid(value?.token))return false;
    let saved=false;
    await this.accounts.update(data=>{
      const account=data.accounts.find(a=>a.userid===original.userid);
      if(account&&account.token===original.token){
        account.token=value.token;account.tokenUpdatedAt=Date.now();account.platform='lite';
        if(valid(value.vip_token))account.vip_token=value.vip_token;
        if(valid(value.dfid))account.dfid=value.dfid;
        if(validSessionValue(value.t1))account.t1=value.t1;
        saved=true;
      }
    });
    if(saved)this.onNotice('登录凭证已续期并保存');
    return saved;
  }
  async maintain(force=false) {
    const account=await this.accounts.current();
    return this.refresh(account,force);
  }
  async recordRead(account,error=null) {
    // Store only diagnostic times/codes, never API response bodies. Limit successful writes.
    const now=Date.now();
    if(!error&&now-(account.lastReadSuccessAt||0)<60000)return;
    await this.accounts.update(data=>{
      const saved=data.accounts.find(a=>a.userid===account.userid);
      if(!saved||saved.token!==account.token)return;
      if(error){saved.lastAuthRejectedAt=now;saved.lastAuthRejectedCode=error.businessCode;}
      else saved.lastReadSuccessAt=now;
    });
  }
  async request(route) {
    const isRead=READ_ROUTES.has(new URL(route,'https://local').pathname);
    let original=await this.accounts.current();
    if(isRead){await this.refresh(original);original=await this.accounts.current();}
    const call=async account=>{
      const result=isRead?await retryRead(this.factory(this.cookie(account)),route,this.onNotice,this.sleep):await this.factory(this.cookie(account))(route);
      if(isRead)await this.recordRead(account);
      return result;
    };
    try{return await call(original);}
    catch(error){
      if(!expired(error)||!isRead)throw error;
      let latest=await this.accounts.current();
      if(latest.userid!==original.userid)throw new Error('当前账号已切换，请重新打开页面');
      // First reuse the freshest disk credential, then make at most one renewal attempt.
      if(latest.token!==original.token)return call(latest);
      // 20017 can be temporary: confirm with the same credential before rotating it.
      if(error.businessCode===20017){
        this.onNotice('服务端暂未接受请求，正在复查已保存凭证…');
        await this.sleep(1000);
        latest=await this.accounts.current();
        if(latest.userid!==original.userid)throw new Error('当前账号已切换，请重新打开页面');
        try{return await call(latest);}catch(recheck){
          if(!expired(recheck))throw recheck;
          error=recheck;original=latest;
        }
      }
      await this.recordRead(original,error);
      if(!await this.refresh(original,true))throw error;
      const current=await this.accounts.current();
      if(current.userid!==original.userid)throw new Error('当前账号已切换，请重新打开页面');
      return call(current);
    }
  }
}
