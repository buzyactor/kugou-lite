import {Accounts} from '../src/accounts.mjs';
import {fileURLToPath} from 'node:url';

// Destructive by design: invoke only for an explicitly requested local account reset.
const directory=fileURLToPath(new URL('../.local/',import.meta.url));
try {
  const accounts=new Accounts(directory);
  const removed=await accounts.clear();
  const state=await accounts.read();
  if(state.active!==null||state.accounts.length!==0)throw new Error('清理后账号存储非空');
  console.log(JSON.stringify({action:'local_account_reset',credentialsRead:false,remainingAccounts:0,removed,configurationPreserved:true}));
} catch {console.error('本机账号清理失败；可能有其他窗口持有账号锁，请先退出播放器。');process.exitCode=1;}
