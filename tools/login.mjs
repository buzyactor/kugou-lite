import { Accounts } from '../src/accounts.mjs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { directRequest, LOGIN_PROVIDER } from '../src/direct-api.mjs';
import { Device } from '../src/device.mjs';
import { login } from '../src/login.ts';
const directory = fileURLToPath(new URL('../.local/', import.meta.url));
let previous;
try {
  await new Accounts(directory).update(()=>{});
  const identity=await new Device(directory,route=>directRequest()(route)).get();
  const cookie=Object.entries(identity).filter(([key])=>key==='dfid'||key.startsWith('KUGOU_API_')).map(([key,value])=>`${key}=${value}`).join('; ');
  await login({ request: directRequest(cookie), directory, accountExtras: {...identity, loginProvider:LOGIN_PROVIDER},
    onReady: file => console.log(`请在浏览器打开本地二维码页面：${file}`),
    onState: state => {
      if (state !== previous) console.log(({waiting: '等待扫码…', confirm: '请在手机上确认登录', success: '扫码已确认', expired: '二维码已过期'})[state]);
      previous = state;
    },
  });
  await new Accounts(directory).save(JSON.parse(await readFile(directory + '/account.json', 'utf8')));
  console.log('KuGouMusicApi 登录已保存至 .local/accounts.json。运行 npm run vip:probe -- --direct 查询权益。');
} catch (error) { console.error(error.message); process.exitCode = 1; }
