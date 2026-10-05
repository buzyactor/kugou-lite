import { setTimeout as delay } from 'node:timers/promises';
import { readFile, mkdir, rm, writeFile, stat, readdir } from 'node:fs/promises';
import { privateWrite } from './login.ts';
import path from 'node:path';
export class Accounts {
  constructor(directory) { this.directory = directory; this.file = path.join(directory, 'accounts.json'); }
  async read() {
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.accounts) || !data.accounts.every(a => /^\d+$/.test(a.userid) && typeof a.token === 'string')) throw new Error('invalid');
      return data;
    } catch (e) {
      if (e.code !== 'ENOENT') throw new Error('账号存储损坏，请保留文件后修复，不会覆盖已有账号');
      try {
        const old = JSON.parse(await readFile(path.join(this.directory, 'account.json'), 'utf8'));
        if (!/^\d+$/.test(String(old.userid)) || typeof old.token !== 'string') throw new Error('invalid');
        return { version: 1, active: String(old.userid), accounts: [{ ...old, userid: String(old.userid) }] };
      } catch (error) {
        if (error.code !== 'ENOENT') throw new Error('旧登录文件不可读');
        return { version: 1, active: null, accounts: [] };
      }
    }
  }
  async withLock(action) {
    await mkdir(this.directory, {recursive:true,mode:0o700});
    const lock = path.join(this.directory,'accounts.lock');
    for(let attempt=0;;attempt++){
      try {await mkdir(lock,{mode:0o700});await writeFile(path.join(lock,'owner'),String(process.pid),{mode:0o600});break;}
      catch(error){
        if(error.code!=='EEXIST'||attempt>=99)throw new Error('其他窗口正在修改账号，请稍后重试');
        let stale=false;
        try {
          const pid=Number(await readFile(path.join(lock,'owner'),'utf8'));
          if(Number.isSafeInteger(pid)&&pid>0){try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH')stale=true;}}
        }catch(e){if(e.code==='ENOENT'){try{stale=Date.now()-(await stat(lock)).mtimeMs>30000;}catch{/* Another writer released it. */}}}
        if(stale)await rm(lock,{recursive:true,force:true});
        else await delay(20);
      }
    }
    try { return await action(); }
    finally { await rm(lock,{recursive:true,force:true}); }
  }
  async update(change) {
    return this.withLock(async()=>{const data=await this.read();change(data);await privateWrite(this.file,JSON.stringify(data)+'\n');});
  }
  async clear() {
    // Explicit local reset: never deserialize old credentials; no recoverable backup is retained.
    return this.withLock(async()=>{
      const removed=[];
      for(const name of await readdir(this.directory)) {
        const credential=/^(?:accounts?|device)\.json(?:$|[.])/.test(name);
        const artifacts=/^(?:login\.html|(?:vip-(?:baseline|latest)|playback-latest)\.json|kotonoha\.log(?:\.1)?|covers)$/.test(name);
        if(!credential&&!artifacts)continue;
        await rm(path.join(this.directory,name),{recursive:true,force:true});removed.push(name);
      }
      await privateWrite(this.file,JSON.stringify({version:1,active:null,accounts:[]})+'\n');
      return removed;
    });
  }
  async save(account) {
    if (!/^\d+$/.test(String(account.userid)) || !/^[A-Za-z0-9._~-]+$/.test(account.token)) throw new Error('无效账号');
    await this.update(data => {
      const previous=data.accounts.find(a=>a.userid===String(account.userid));
      const saved = {...previous,userid:String(account.userid),token:account.token,loggedInAt:Date.now(),tokenUpdatedAt:Date.now(),refreshAttemptAt:0,platform:'lite',lastReadSuccessAt:0,lastAuthRejectedAt:0,lastAuthRejectedCode:null};
      for(const key of ['dfid','vip_token','username','t1','KUGOU_API_GUID','KUGOU_API_MID','KUGOU_API_DEV','KUGOU_API_MAC','loginProvider'])if(typeof account[key]==='string'&&account[key]&&!/[;\r\n]/.test(account[key]))saved[key]=account[key];
      const index = data.accounts.findIndex(a=>a.userid === saved.userid);
      if(index < 0) data.accounts.push(saved); else data.accounts[index] = saved;
      data.active = saved.userid;
    });
  }
  async setName(userid,username) {
    const name=String(username??'').replace(/[\x00-\x1f\x7f]/g,'').trim().slice(0,80);
    if(!name)return;
    await this.update(data=>{const account=data.accounts.find(a=>a.userid===String(userid));if(account)account.username=name;});
  }
  async select(index) {
    await this.update(data => { if(!Number.isInteger(index)||!data.accounts[index]) throw new Error('账号不存在'); data.active=data.accounts[index].userid; });
  }
  async remove(userid) {
    if(!/^\d+$/.test(String(userid)))throw new Error('账号不存在');
    let wasActive=false;
    await this.update(data=>{
      const index=data.accounts.findIndex(a=>a.userid===String(userid));
      if(index<0)throw new Error('账号不存在');
      wasActive=data.active===String(userid);
      data.accounts.splice(index,1);
      if(wasActive)data.active=data.accounts[0]?.userid??null;
    });
    // Remove the legacy copy too, otherwise old CLI tools could continue using a deleted login.
    try {
      const old=JSON.parse(await readFile(path.join(this.directory,'account.json'),'utf8'));
      if(String(old.userid)===String(userid))await rm(path.join(this.directory,'account.json'),{force:true});
    } catch(error) { if(error.code!=='ENOENT')throw new Error('账号已删除，但旧登录文件清理失败'); }
    return wasActive;
  }
  async current() { const data = await this.read(); const result = data.accounts.find(a=>a.userid===data.active); if(!result) throw new Error('没有已保存账号，请按 L 登录'); return result; }
  async summary() { const data = await this.read();return data.accounts.map((a,i)=>({index:i,userid:a.userid,username:a.username||'',label:`${a.username||'用户名待同步'} · 尾号 ${a.userid.slice(-4)}`,active:a.userid===data.active})); }
}
