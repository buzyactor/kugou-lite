import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../references/', import.meta.url));
mkdirSync(root, { recursive: true });
const repos = ['go-musicfox/go-musicfox', 'hoowhoami/EchoMusic',
  'develop202/kgcheckin', 'MoeKoeMusic/MoeKoeMusic', 'sijin-xb/kugou-tui',
  'MakcRe/KuGouMusicApi'];
const selected=process.argv.includes('--runtime-only')?repos.filter(repo=>['kgcheckin','KuGouMusicApi'].includes(repo.split('/')[1])):repos;
const records = [];
for (const repo of selected) {
  const url = `https://github.com/${repo}.git`;
  const name = repo.split('/')[1];
  const existing = path.join(root, '..', name);
  const dest = ['kgcheckin','KuGouMusicApi'].includes(name)||existsSync(path.join(existing,'.git')) ? existing : path.join(root,name);
  if (!existsSync(dest)) {
    const result = spawnSync('git', ['clone', '--depth', '1', url, dest],
      { stdio: 'inherit', timeout: 120000 });
    if (result.status !== 0) {
      records.push({ repo, status: 'clone_failed' });
      process.exitCode = 1;
      continue;
    }
  }
  const revision = spawnSync('git', ['-C', dest, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  const origin = spawnSync('git', ['-C', dest, 'remote', 'get-url', 'origin'], { encoding: 'utf8' });
  const valid = revision.status === 0 && origin.status === 0 && origin.stdout.trim() === url;
  records.push({ repo, status: valid ? 'available' : 'needs_inspection',
    ...(valid ? { commit: revision.stdout.trim() } : {}) });
  if (!valid) process.exitCode = 1;
}
writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({
  recordedAt: new Date().toISOString(), repositories: records,
}, null, 2) + '\n');
