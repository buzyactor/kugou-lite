import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const locations = ['../KuGouMusicApi/'];
const root = locations.map(p => fileURLToPath(new URL(p, import.meta.url))).find(p => existsSync(p + 'app.js'));
if (!root) { console.error('未找到 KuGouMusicApi；不会回退旧登录接口'); process.exit(1); }
if (!existsSync(root + 'node_modules/express/package.json')) {
  console.error(`请先安装依赖：npm --prefix "${root}" ci --ignore-scripts --no-audit --no-fund`);
  process.exit(1);
}
const child = spawn(process.execPath, ['app.js'], {
  cwd: root, env: { ...process.env, HOST: '127.0.0.1', PORT: process.env.PORT || '3000', platform: 'lite' },
  // 上游错误日志可能包含请求信息；不转发到用户日志。
  stdio: ['ignore', 'ignore', 'ignore'],
});
console.log(`正在启动本地 API：127.0.0.1:${process.env.PORT || '3000'}，按 Ctrl+C 停止。`);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', () => { console.error('API 进程无法启动'); process.exitCode = 1; });
child.on('exit', (code, signal) => {
  if (code) console.error('API 进程退出；检查依赖及端口占用。');
  process.exitCode = signal ? 0 : code ?? 1;
});
