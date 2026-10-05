import { Accounts } from '../src/accounts.mjs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { directRequest } from '../src/direct-api.mjs';
import { credentials } from './vip-probe.mjs';
import { privateWrite } from '../src/login.ts';
import { search, resolveTrack, decodeAudio, classifyPlayback, inspectAudio, requireLossless } from '../src/music.mjs';
const directory = fileURLToPath(new URL('../.local/', import.meta.url));
try {
  const keywords = process.argv.slice(2).join(' ').trim() || '周杰伦 晴天';
  console.log('[1/4] 读取已保存账号并校验登录（单次接口最多等待 20 秒）');
  const account = await new Accounts(directory).current();
  const request = directRequest(credentials(account));
  const user = await request('/user/detail');
  if (user?.data?.nickname == null) throw new Error('账号校验失败，请重新登录');
  console.log('[2/4] 搜索 VIP 曲目');
  const tracks = await search(request, keywords);
  const track = tracks.find(item => item.vip && item.duration > 60);
  if (!track) throw new Error('搜索结果没有明确标记 VIP 的曲目，请换一首 VIP 歌曲名');
  console.log(`正在验证：${track.artist} - ${track.title}（${track.duration} 秒，VIP 标记）`);
  console.log('[3/4] 获取完整音频地址');
  const url = await resolveTrack(request, track);
  const quality=requireLossless(await inspectAudio(url));
  console.log(`实际音质：${quality.codec} / ${quality.sampleRate} Hz`);
  console.log('[4/4] 正在下载并解码，最长等待 180 秒');
  const heartbeat = setInterval(() => console.log('仍在解码音频…'), 5000);
  let seconds;
  try { seconds = await decodeAudio(url); } finally { clearInterval(heartbeat); }
  const result = { recordedAt: new Date().toISOString(), title: track.title, artist: track.artist,
    quality, ...classifyPlayback(track, seconds) };
  await privateWrite(directory + 'playback-latest.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  if (result.verdict !== 'vip_full_audio_decoded') process.exitCode = 2;
} catch (error) { console.error(error.message); process.exitCode = 1; }
