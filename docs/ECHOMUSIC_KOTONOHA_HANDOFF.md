# EchoMusic → Kotonoha 歌词推送开发交接

更新：2026-10-11（Asia/Shanghai）。供新对话中的 Codex 独立接手。本次只读代码并整理文档，**尚未实现 EchoMusic 推送**；未改播放器、系统配置、账号、已安装 Kotonoha 或两个独立 checkout。

## 1. 从哪里开始

| 项目 | 本次实际核对 |
| --- | --- |
| EchoMusic | `/home/wolf/Kugou Lite/EchoMusic`，独立 Git 仓库，`main` 干净；HEAD `7f0fca4621d6e1465c66bb5bfe32d717e4c27a6a` |
| EchoMusic 上游 | `https://github.com/hoowhoami/EchoMusic.git`；package `2.3.2-beta.7`，Electron/Vue/Pinia/TypeScript + Rust NAPI 音频模块 |
| Kugou Lite 参考实现 | `/home/wolf/Kugou Lite`；本次开始 HEAD `74d68a3`，主仓库干净，本文随后提交 |
| Kotonoha checkout | `/home/wolf/Kugou Lite/kotonoha`；分支 `feat/tray-lyrics-visibility`，HEAD `d45cf6d653f1b72cf450e1c2a7576ab5f6cb42d5` |
| Kotonoha 已有工作 | 有未跟踪的 `KOTONOHA_INTEGRATION.md`，必须保留；有自身 `AGENTS.md` |

先重新核对 Git、适用 AGENTS、README 和源码；不要重克隆、覆盖或清理已有工作。当前没有发现 EchoMusic 内的 AGENTS，仍需接手时复查，上级 `/home/wolf/AGENTS.md` 适用。建议 EchoMusic 新建 `feat/kotonoha-lyrics` 分支，不把它的文件提交进父级 Kugou Lite 仓库。EchoMusic 的 origin 是原作者仓库，推送前使用用户已授权的 remote/fork。

Kugou Lite 现成资料：[接入交接](KOTONOHA_INTEGRATION.md)、[协议联调证据](kotonoha-protocol-evidence.json)。它们记录的是 2026-10-05 阶段，不代表当前实机状态；其中“根仓库没有 Git”、旧 `/tmp/kugou-cargo` 命令等已经过时，以本次快照和实际环境为准。

## 2. 最重要的经验

**发送完整歌词文档与真实播放观察，让 Kotonoha 自己排版、插值和高亮。** 不从 DOM、屏幕或当前高亮行抓歌词，不把当前行字符串当完整文档，不重新请求一套歌词代替 EchoMusic 已选结果。

Kugou Lite 将纯转换、连接生命周期、播放器组合点分开：

| 参考文件（Kugou Lite 根目录下） | 可复用的经验 |
| --- | --- |
| `src/kotonoha-protocol.mjs` | 字段校验、完整文档、时间单位、身份、大小限制；歌曲模型与 adapter 名称不能原样照搬 |
| `src/kotonoha-adapter.mjs` | 持有当前状态、重连/退避、序号、背压合并、定时器清理；Node 内置 WebSocket 用法不必照搬到 Electron |
| `tools/tui-worker.mjs` | 换歌先清旧词；真实播放/暂停/seek/时长事件接入；异步歌词有双重身份守卫 |
| `tests/kotonoha.test.mjs` | 可控时钟和假连接验证竞态、断线、同曲重播、背压、无词和非法文档 |
| `tools/check-kotonoha.py` | 真实 receiver/decoder/显示协调器验收，不能只测自己的假服务端 |

经验与边界：

- 默认关闭，不连接；开启后 Kotonoha 不在线也不能影响播放。发送不阻塞音频、UI、切歌或取词。
- 新连接先发当前完整 snapshot，再发 clock；断线只保留最新事实，不排队重放历史进度。
- 普通 clock 约每秒一次；暂停/恢复、真实 seek、停止及时校准。位置来自后端，定时器次数不作为歌曲进度。
- 换歌立即发新身份、`lyrics=null`，取到当前歌词再完整更新。快速 A→B→A 和同曲重播都要有本地播放实例/代次守卫，不能仅比较歌名或 hash。
- 已有可靠性参数可参考：连接超时3秒，退避0.5/1/2/4/8/16/30秒，发送缓冲停滞5秒重连；缓冲未排空时合并最新状态，无无限队列。具体值是参考实现，不是协议规定。
- 禁用、退出、renderer 重载时清理连接、定时器和监听；窗口隐藏到托盘继续播放时不能误关闭推送。
- 日志只记状态、错误分类和行数，限频/轮换；不记完整消息、歌词候选 accesskey、账号、媒体 URL 或本地路径。
- `send()` 成功只说明本地发送调用成功，不能证明接收、来源被选中或浮窗视觉正确。

## 3. EchoMusic 已有接入位置

以下均为 EchoMusic checkout 内的真实路径，尚未新增 Kotonoha 模块。

| 文件 | 当前事实与建议 |
| --- | --- |
| `src/renderer/stores/lyric.ts` | 完整 `lines`、`displayLines`、`loadedHash`、`requestSerial`、候选选择、插件歌词、翻译与偏移；应复用已选择的完整结果 |
| `src/shared/lyrics.ts` | 跨窗口行/字符类型及归一化；没有可靠的逐字时间来源标记，见下一节 |
| `src/renderer/stores/player.ts` | `currentTrackSnapshot/currentTrackId/nativeTrackSeq`、共享 `playbackClock` 和播放事件；歌词窗口关闭也维护歌词索引 |
| `src/shared/playback.ts` | 时钟包含原始 `positionMs/durationMs`、`sampledAt`、`generation`、`playbackRate/isAdvancing`；不是屏幕动画进度 |
| `src/renderer/nowPlaying/sync.ts` | 完整歌词+增量播放状态发布；核对 loadedHash 与当前曲目，带 revision、timeOffset，值得借鉴 |
| `src/renderer/desktopLyric/sync.ts`、`miniPlayer/sync.ts` | 其他同步通道；不要依赖桌面歌词窗口是否开启来启用 Kotonoha |
| `src/main/nowPlaying.ts` | 主进程持有合并快照；`now-playing:sync-snapshot` 校验 sender 是主窗口，可借鉴 IPC 边界 |
| `src/main/player/controller.ts`、`src/main/ipc/player.ts` | 原生播放控制、真实状态；投放时 OutputHost 可能拥有 transport，AirPlay 还有延迟补偿 |
| `src/preload/index.ts`、`src/renderer/App.vue` | 受限 preload API 与全局同步器注册/清理入口 |
| `src/renderer/stores/setting.ts`、`src/main/storage/settings.ts` | 沿既有持久化方式加入设置，不另造用户配置目录 |
| `docs/global-lyric-offset.md`、`src/shared/lyricOffset.ts` | 正值提前；全局+单曲有效偏移，每项±20秒 |
| `docs/plugin-system.md`、`src/renderer/plugins/lyrics.ts` | 已有插件歌词/播放事件/网络能力；插件 resolver 是取词接口，不等于向外推送接口 |

建议先做**内置可选集成**：纯 TypeScript 转换模块 + 主进程单一 adapter 服务 + 受限 IPC 输入 + 全局 renderer 数据发布。主进程拥有 socket/重连/退出，renderer 发布歌词事实，不从歌词页面组件创建连接。已有 `ws ^8.18.3` 依赖，可按项目惯例使用，无需为此升级 Electron/Node。Electron 进程边界参考[官方 IPC 文档](https://www.electronjs.org/docs/latest/tutorial/ipc)。

可参考 Now Playing 的合并快照，但先明确取 `lines` 还是显示转换后的 `displayLines`。字体、滚动、原生桌面歌词开关不应删除外发内容；若沿用简繁转换须写清并测试。不要把 translation 的界面可见性当成文档字段可用性。

若选择插件形式，先验证它能取得完整当前文档、真实时钟、受管理的 WebSocket 客户端及生命周期。现有“本地 WebSocket 服务”不自动等于可用的外连客户端。不要为接入绕过插件能力或 Electron context isolation。

## 4. 时间、偏移与精度：不能直接复制的部分

| EchoMusic 输入 | 含义 | Kotonoha 输出 |
| --- | --- | --- |
| `LyricLine.time` | 秒 | 行 start 已是秒，不能再除1000 |
| `characters[].startTime/endTime` | 绝对毫秒，KRC 已加行起点 | 除1000，不再加行 time |
| `playbackClock.positionMs/durationMs` | 毫秒 | 除1000，发送真实媒体位置/时长 |
| `playerStore.currentTime/duration` | 秒 | 如用此路径，不重复换算 |
| `currentTimeOffset` | 全局+单曲有效偏移，毫秒，正值提前 | 建议只移动歌词时间，不移动媒体 clock |

偏移建议：`外发歌词时间秒 = (原始歌词时间毫秒 - currentTimeOffset) / 1000`。例如原词从1250ms开始、有效偏移+200ms，外发从1.05s开始；媒体 position 仍是真实播放位置。偏移改变重建 snapshot，词和行边界一致移动，负时间裁到0，不把整份文档再次平移。协议 v1 没有 offset 字段。

Kugou Lite 的 KRC `[offset]` 在解析器已处理，adapter 不重复处理；EchoMusic 当前所读 `parseLyricDetailPayload` 没有显式处理 `[offset]` 头，不能声称语义相同。先区分文件头偏移、应用有效偏移和 Kotonoha 自己的手动偏移，任何一项只能应用一次。

**characters 非空不代表真实逐字。** 当前解析器会为无词时间的 KRC 调用 `buildFallbackCharacters`，普通 LRC 也放一个整行字符并估算结束时间；译文/音译还可能均分时间。建议在解析结果/跨进程模型中保留真实 timing provenance：

- 有真实 KRC/增强 LRC 字词时间才输出 `timing="Word"` 和对应 words。
- 普通行同步或估算字符输出 `timing="Line"`、`words=[]`，保留完整 text/translation，不伪造逐字精度。
- 行 end 由可信词跨度、下一行起点或有说明的末行估算取得；EchoMusic 行模型没有独立 end。保留合法重叠，不随意截字。
- 保留英文空格和字词文本；不发送 highlighted、当前索引、DOM、注音布局等界面状态。
- v1 有 translation，没有独立 romanized/ruby/逐字译文契约，不能加字段就宣称接收端支持，也不把音译冒充译文。

**倍速/缓冲边界：**EchoMusic 支持 playbackRate 和 isAdvancing，v1 没有对应字段。首轮明确验收1倍速；其他倍速、缓冲、gapless、投放延迟要单独验证/列限制，不能以一个 isPlaying 布尔值证明持续前进。不要私加 rate 并假设 Kotonoha 会使用。发送真实样本，过期样本停止重复推送；不发送屏幕预测位置后让接收端再预测一遍。

## 5. 当前 Kotonoha 协议

以本地 `kotonoha/plugins/README.zh-CN.md`、`src/kotonoha/lyrics/protocol.py`、`receiver.py` 为准。当前为 `kotonoha.adapter` / version `1`，WebSocket 文本 JSON：`ws://127.0.0.1:28745/kotonoha/adapter`。

- 类型只有 snapshot/clock；每条连接共享递增非负 sequence，重连可从0开始，先 snapshot。
- 状态用 Playing/Paused/Stopped/Unknown；未知位置/时长用 null，不拿未知当0。
- 每帧最多4 MiB、每文档4096行、每行4096词，行时间有序、非负、end>=start；超限发无词快照，不截断一半文档。
- 没有 ack、resync、双向播放控制、显式 seek 或 playbackInstanceId。不要发明控制消息或加载原因字段。
- endpoint 限本机和固定路径，不含用户名/密码/query/fragment；无词 `lyrics=null`，不阻止播放。

身份应分开：adapter 建议 `echomusic`；playerId 每个应用实例唯一且重连稳定；stableId 区分歌曲/版本，不能只是曲名，不能是签名 URL；lyrics.source 表示真实来源（如 kugou、插件来源或 unknown），不是 adapter 名称。酷狗 hash 可参考现有 catalog 身份，但本地/插件曲目需各自稳定命名空间，不把未确认的模型字段当 MixSongID。歌词换候选改变文档，不改变歌曲身份。

`trackRef` 必须严格等于 `adapter:playerId:stableId`；`lyrics.songId` 建议与 stableId 一致。单曲循环在本地增加播放实例代次，不往 v1 塞自创字段。

以下是合成的**目标协议示例**，不是 EchoMusic 已实现的抓包：

```json
{
  "protocol": "kotonoha.adapter",
  "version": 1,
  "type": "snapshot",
  "adapter": "echomusic",
  "sequence": 0,
  "capturedAt": "2026-10-11T00:00:00.000Z",
  "playback": {
    "playerId": "echomusic-fixture",
    "status": "Playing",
    "positionS": 1.25,
    "durationS": 8,
    "track": {
      "stableId": "fixture-song-1",
      "title": "Local Tone",
      "rawTitle": "Local Tone",
      "artist": "Fixture",
      "album": "Protocol Test",
      "durationS": 8
    }
  },
  "lyrics": {
    "source": "unknown",
    "sourceName": "本地测试",
    "songId": "fixture-song-1",
    "timing": "Word",
    "title": "Local Tone",
    "artist": "Fixture",
    "durationS": 8,
    "lines": [{
      "index": 0, "id": "line-0", "start": 1.25, "end": 2.45,
      "text": "Hello world", "translation": "你好世界",
      "words": [
        {"start": 1.25, "end": 1.65, "text": "Hello"},
        {"start": 1.65, "end": 2.45, "text": " world"}
      ]
    }]
  }
}
```

```json
{
  "protocol": "kotonoha.adapter",
  "version": 1,
  "type": "clock",
  "adapter": "echomusic",
  "sequence": 1,
  "capturedAt": "2026-10-11T00:00:01.000Z",
  "trackRef": "echomusic:echomusic-fixture:fixture-song-1",
  "positionS": 2.25,
  "status": "Playing"
}
```

## 6. 最容易误判：接收与展示来源是两层

之前 Kugou 接入已经验证过真实协议接收，但 Kotonoha 的来源争用尚未完成实机闭环。**只调整配置顺序，不能保证 adapter 的完整歌词和时钟赢过 MPRIS/自动搜词。**

Kotonoha 需要同时核对：

- `app/source_gate.py`、`source_registry.py`、`source_matching.py`：展示候选、来源匹配和时钟所有权。
- `providers/mpris_lyrics.py` 及 resolver：MPRIS 的歌词解析、外部 ownership 和自动找“更好”歌词。
- `app/display_coordinator.py`：同曲手动歌词覆盖和当前文档保持。

本地默认 display_sources 是 mpris/cider/adapter，歌词 provider 优先级另有一套。目标是“EchoMusic adapter 持有其完整歌词及对应时钟，MPRIS 仍可控制播放”，不能关闭整个 MPRIS 规避竞争。EchoMusic 同时被 MPRIS 和 adapter 发现时要匹配成同一歌曲/播放器，而不是争抢两套显示；缺元数据、不同歌曲版本不可强行合并。

先区分哪份 Kotonoha 正在运行（系统安装版或 checkout）、实际 HEAD/配置/端口/来源，再判断 bug。不要卸载系统版，也不要启动两份占同一端口。新会话需要改 Kotonoha 时先读其 AGENTS、保留未跟踪文档、另开分支，隔离配置和缓存。Python venv 隔离不等于用户配置隔离。

## 7. 实施、测试与交付

1. 在 EchoMusic 分支定义输入模型/身份/timing provenance/偏移方案；写纯转换测试。
2. 实现单一 adapter 生命周期，接全局歌词/播放状态，加入持久开关（默认关闭）、本机端点和校准间隔，不触碰登录链路。
3. 模拟测试换歌/同歌重播、歌词迟到、候选改变、正负偏移、暂停/seek/EOF、禁用/退出、重连/背压/超限；seek 验证后端确认而非仅点击目标。
4. 用实际上游 decoder/receiver 验证消息及顺序，再做真实 EchoMusic→Kotonoha 接收、来源竞争和浮窗验收；无词、缓存命中、最小化/托盘继续播放也要覆盖。
5. 编译可运行 EchoMusic 包，用户只打开产物；报告类型/测试结果、平台、精确路径及实机边界。

已有相关测试：`tests/global-lyric-offset.test.mjs`、`lyric-sync.test.mjs`、`lyric-timeline.test.ts`、`plugin-lyrics-page.test.mjs`；不要复制其中仅检查源码文字的断言作为新推送行为证据。项目没有统一 `test` script，按实际测试入口运行，例如在 EchoMusic 根：

```bash
node --test tests/global-lyric-offset.test.mjs tests/lyric-sync.test.mjs tests/lyric-timeline.test.ts tests/plugin-lyrics-page.test.mjs
pnpm exec vue-tsc --noEmit
# 准备好匹配平台的 Native 产物后，再完整打包
pnpm build
```

构建注意：当前 README 要求 Node22.12+/pnpm9+/Rust stable，但 CI 的 Node配置与之不完全一致，接手核对实际工具链，不直接照旧 CI 推断可用。根目录用 pnpm workspace，server 也在 workspace 内；`.node` 不随源码上传，`pnpm build/dev` 不代编 Native。Linux需7个、Windows/macOS需8个模块，按 EchoMusic README 的 napi 构建步骤准备，不拿 Kugou 的 cargo/mpv 命令当 EchoMusic 构建。包在 `release/`，最终路径以实际产物为准。

Kugou 的 `tools/check-kotonoha.py` 会写回历史证据 JSON，不为“看一下”直接运行覆盖。为 EchoMusic 新建独立 evidence/fixture。自动化解码、--ao=null 或离屏测试都不证明真实声卡、Hyprland 浮窗和来源选择；分别报告。本次仅核对源码、文档和协议示例，不声称 EchoMusic 已构建或功能已通过。

## 8. 可直接发给新对话

> 工作区是 /home/wolf/Kugou Lite/EchoMusic。请先读父目录 docs/ECHOMUSIC_KOTONOHA_HANDOFF.md、EchoMusic README/docs/global-lyric-offset.md 和适用 AGENTS，检查 Git 状态与源码。在独立分支实现 EchoMusic 将已选完整歌词与真实播放时钟推送到本机 Kotonoha 的可选功能，默认关闭；保持 EchoMusic 现有架构、登录、原生歌词和系统媒体控制。参考父目录 Kugou 的 kotonoha-protocol/adapter 与行为测试，但不要照搬毫秒/秒、歌曲身份及偏移：EchoMusic 行时间秒、字符毫秒，有全局+单曲正值提前偏移和估算字符，需保留真实逐字来源。主进程拥有单一连接/重连/清理，不依赖歌词窗口挂载。验证真实 Kotonoha decoder/receiver，并区分协议接收与 MPRIS/自动找词的展示竞争；保留 MPRIS 控制和手动选词。不要卸载/覆盖已安装 Kotonoha，不改 Arch 系统配置，保护 kotonoha checkout 的既有未跟踪文档。完成后由你测试、编译并准备可直接打开的 EchoMusic 产物，用户不自行构建；更新交接，报告具体路径、实机验证边界和 Git 结果，不把源作者 origin 当作用户授权推送目标。
