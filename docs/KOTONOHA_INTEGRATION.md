# Kugou Lite → Kotonoha 跨对话交接

本文件是下一段 Kotonoha 开发的入口，可以独立阅读，不依赖聊天历史。Kugou Lite 侧最小接入与可靠性已实现；下一段只需继续 Kotonoha 的来源绑定、桌面显示和实机验收。2026-10-05 更新。

## 1. 仓库与已核实的协议

- Kugou Lite 根目录：`/home/wolf/Kugou Lite`。本轮没有根 AGENTS.md，先读取 STATUS.md；根目录没有可用 Git 记录，不能假设 `git diff` 能恢复历史工作。已有 UI、账号、主题、高清主页图标等工作已保留。
- 本地 Kotonoha：`/home/wolf/Kugou Lite/kotonoha`。有自身 AGENTS.md；本轮只读，没有修改该仓库，工作树检查为空。
- 参考上游 main commit：**175cfcc04ffb67fbbba26c76437275083090233a**。通过 GitHub commits/main API核对，本地 HEAD 与之相同。项目版本0.2.3，协议 **kotonoha.adapter / version 1**。
- [固定 commit 的协议说明](https://github.com/locez/kotonoha/blob/175cfcc04ffb67fbbba26c76437275083090233a/plugins/README.zh-CN.md)
- [实际解码器](https://github.com/locez/kotonoha/blob/175cfcc04ffb67fbbba26c76437275083090233a/src/kotonoha/lyrics/protocol.py)、[实际接收器](https://github.com/locez/kotonoha/blob/175cfcc04ffb67fbbba26c76437275083090233a/src/kotonoha/receiver.py)
- 标准端点：`ws://127.0.0.1:28745/kotonoha/adapter`，UTF-8 JSON文本帧。上游支持HTTP POST调试，本模块正式发送只用WebSocket。
- 接收端没有应用层ack、resync或播放器控制。序号在每条连接内独立，两种消息共享；重连从0开始，先完整snapshot。错误消息可以被上游静默丢弃，发送成功不等于已被应用接受。
- receiver限制：4 MiB/帧，4096行/文档，4096词/行；行时间有序、非负、end>=start；词起止同时存在或同时null。非空文档声明Line/Word；文档durationS如果提供必须为正数。

## 2. Kugou Lite 的真实数据流

| 模块 | 当前职责与接入事实 |
| --- | --- |
| `src/music.mjs: Player` | 独立mpv进程，JSON IPC fd3。观察pause/time-pos/seekable/audio-bitrate，新增duration观察。旧child的IPC消息有身份检查，不会当作新播放器消息使用。 |
| `tools/tui-worker.mjs` | Node协调账号、请求、队列、实际播放、完整歌词和资产。持有position/playbackStatus/generation；`playTrack`完成地址与编码检查后启动mpv，再开始独立的歌词/封面加载。这里是生产适配器组合点。 |
| `src/library.mjs` | `loadLyrics`搜索酷狗最多3份KRC，优先有翻译的可用结果；否则精确匹配歌曲名/歌手/时长的LRCLIB行同步LRC。`parseKrc`、`parseLrc`产生完整行数组，行/词start、duration均为毫秒。 |
| `tui/src/lyrics.rs`、`kitty.rs` | Rust只负责歌词排版、当前行/字高亮、翻译开关、滚动、字号与Kitty渲染。滚轮浏览/自动归位是显示行为，不改变完整文档。 |
| `src/desktop.mjs`、`tools/mpris.py` | Node启动Python MPRIS桥，桌面控制命令回到worker，再操作mpv；不是歌词完整文档的来源。 |
| `tui/src/settings.rs`、`controls.rs`、`main.rs` | XDG JSON配置、导入导出、设置页、输入与worker通信。Rust不依赖Kotonoha的Python类型。 |

mpv的事实事件：

- `file-loaded`确认音频载入后给出Playing/Paused；pause属性变化是暂停/恢复事实。
- time-pos给出实际秒位置。pause属性改变后另发get_property time-pos（request_id7302），补一次真实校准。
- seek命令只表达请求；`playback-restart`后读time-pos（request_id7301），结果成功才通过onSeek发送跳转校准。
- duration属性是后端真实秒时长；适配器收到前playback.durationS=null，歌曲元数据可以有接口标称时长。
- 显式stop、mpv退出发布Stopped；EOF后触发onEnded，worker根据`src/playback-options.mjs: nextIndex`选择下一首。single模式重新调用playTrack同一曲目。
- 停止的clock位置为null，保留最后歌曲/歌词供状态识别；账号切换、删除当前账号或重新扫码清队列时clearTrack发布track=null、lyrics=null的完整快照。

当前没有Kugou Lite手动选取歌词候选/来源界面，也没有用户可调的歌词时间偏移。KRC翻译是language载荷的现有启发式选择；LRC fallback目前不额外搜索译文。不要把歌词滚动偏移当作时间偏移，也不要从TUI当前高亮行/屏幕提取文档。

## 3. 本轮新增模块与边界

| 路径 | 职责 |
| --- | --- |
| `src/kotonoha-protocol.mjs` | 纯转换：配置校验、稳定catalog身份、秒时间转换、完整歌词文档与协议资源限制。 |
| `src/kotonoha-adapter.mjs` | KotonohaAdapter拥有当前播放/文档、连接、序号、状态合并、超时、退避及清理。构造不连接；configure enabled才连接。 |
| `tools/tui-worker.mjs` | 将mpv回调、换歌、歌词异步结果、账户清理接到adapter；不等待连接/发送。独立限流滚动日志，不把消息体或凭据写入日志。 |
| `tests/kotonoha.test.mjs` | 可控调度器/模拟WebSocket行为测试：时间、竞态、连接序号、断线、背压及安全边界。 |
| `tools/kotonoha-probe.mjs` | 本地测试音频驱动，使用真实Player、adapter和共享single队列规则，不访问账号或网络媒体。 |
| `tools/check-kotonoha.py` | 启动本地克隆中的实际上游接收器/解码器/显示协调器，使用本地PCM与真实mpv --ao=null联调；不启动浮窗、不修改上游。 |
| `docs/kotonoha-protocol-evidence.json` | 最新实际协议联调的脱敏数据、snapshot/clock与验收范围。 |

生产运行不增加npm/Python依赖：连接使用Node内置WebSocket，项目已有Node>=22.18要求。Python接收器仅用于开发验证；适配器不导入Kotonoha Python代码。

## 4. 实际启用与启动

用户只打开已构建二进制。开发者已执行离线构建，不要求用户自行编译。

1. 在真实Hyprland终端启动已安装的Kotonoha：`kotonoha --port 28745 -v`。
2. 打开Kugou Lite：`"/home/wolf/Kugou Lite/tui/target/debug/kugou-lite"`。
3. `?`打开设置，`2`进入歌词页，开启“Kotonoha 桌面歌词”。同页可调整校准间隔。播放一首歌即可发布。

配置文件默认`~/.config/kugou-lite/config.json`，遵循XDG_CONFIG_HOME与现有`--config PATH`。追加或修改以下键，不覆盖其他已有设置：

```json
{
  "kotonoha_enabled": true,
  "kotonoha_endpoint": "ws://127.0.0.1:28745/kotonoha/adapter",
  "kotonoha_clock_ms": 1000
}
```

- 默认enabled=false，不建立连接。间隔250–10000 ms，默认1000；端点可在JSON里设置，修改端点后重启播放器。
- 端点仅接受本机127.0.0.1/localhost/[::1]的ws/wss，路径必须/kotonoha/adapter，禁止用户名/密码/query/fragment。正常上游用ws及127.0.0.1；wss仅适用于自己部署有效TLS的本地接收端，不绕过证书验证。
- 初始配置与UI变更通过内部worker命令`kotonoha:{"enabled":...,"endpoint":...,"clockMs":...}`传递；这不是上游协议字段。
- 三个配置键支持现有`--import-config`/`--export-config`，不会被其他设置保存操作丢弃；不写入theme.json或账号文件。
- 日志：项目根`.local/kotonoha.log`，超过1 MiB轮换为.log.1，最多64条待写入记录。同类错误限频60秒；连接、换歌、文档更新记录一次，不记录clock或逐帧数据。可以用`tail -n 50 "/home/wolf/Kugou Lite/.local/kotonoha.log"`查看。

## 5. 消息发送、身份与竞态

### 快照与校准

- 连接成功/重连：用当前最新状态、完整当前歌词发送snapshot。没有文档就是lyrics=null。
- 新歌/同歌重新播放/音质切换重新启动mpv：新播放实例，立即snapshot，歌词=null，位置=null，status=Unknown；不把上一首歌词套到新实例。
- 后端duration确定或变化：更新playback/track时长，已有文档的时长同步，发送snapshot。
- 当前歌词加载完成、改变或变为空：发送完整snapshot，保留所有行和字词，不发送“当前一行”的替代结构。
- 暂停/恢复/停止：立即clock；下一次后端time-pos查询补校准。seek由真实mpv返回位置后立即clock。
- 正常低频clock约每秒一次，发送最近实际time-pos，绝不按定时器次数累计位置。Paused/Stopped也低频保留状态。Playing位置观测停止超过max(5秒,3×配置间隔)则停止重复发布旧位置；不会自行伪造继续播放。
- capturedAt是最近状态/位置观察的ISO时间。上游receiver用自身monotonic接收时间作观测锚点；未实现跨机器时间同步或传输延迟校正。本模块仅支持本机。
- 单个原生发送缓冲最多放一个帧；缓冲未排空时后续事实合并为最新状态，25 ms检查排空，5秒未恢复就重连。没有离线clock队列。
- 连接超时3秒；失败退避0.5/1/2/4/8/16/30秒，上限30秒；稳定连接30秒后失败才重置退避。退出/禁用取消连接、重连、校准和排空定时器，关闭socket；worker退出还等待已拥有的日志写入链。
- 本地格式错误省略整个歌词文档并记录原因。超过4 MiB降为无歌词快照；不发送截断文档。意外服务端应用消息记录为unexpected-peer-message并重连，不执行播放器控制。

### 四种身份

| 身份 | 实现 |
| --- | --- |
| 适配器 | adapter=`kugou-lite`，稳定，不随歌词provider变化。 |
| 播放器实例 | playerId=`kugou-lite-<PID>-<UUID>`，每个Node worker唯一，重连保持，进程重启改变。 |
| 歌曲catalog身份 | stableId=`kugou-<原始hash小写>-<audioId或0>`，lyrics.songId同值。原始32位hash及酷狗MixSongID/album_audio_id来自现有曲目模型；缺失ID记0。没有单独version字段，版本差异依靠hash与audioId。FLAC/MP3选用的资源hash变化不改变同一catalog歌曲身份。 |
| 歌词来源 | lyrics.source=`kugou`或`lrclib`，sourceName保留已有来源名称；没有来源标注时unknown。不是adapter id。 |

trackRef严格等于`kugou-lite:<playerId>:<stableId>`，与上游TrackIdentity.track_ref一致。没有歌曲时trackRef=null。

本地另有playInstance计数，每次实际新启动mpv加一，**不作为自创协议字段发送**。worker原有generation守卫与adapter的playInstance/catalogId守卫共同拒绝上一首、同歌上一轮迟到的歌词。序号两类共享，按实际发送递增；可能有合法间隙，每个新连接从0开始。

v1没有独立playbackInstanceId或显式seek标记：同曲连续播放/单曲循环会复用stableId/trackRef，以新snapshot清歌词、真实归零/跳转clock和序号次序表达。未通过改变stableId冒充新歌曲。Kotonoha侧仍需实测同歌动画归位与手动选词保持策略。

## 6. 歌词时间与偏移规则

- 输入行start/duration、词start/duration为**绝对毫秒**；输出start/end为**秒**，end=(start+duration)/1000。词start已包含行start，不再累加行起点。
- KRC含真实字词时间时timing=Word；保留词原文本（包含空格）、原文拼接、行跨度和translation。只按行同步的row.lineTimed=true时输出words=[]，整段原文仍保留，timing=Line；不将LRC中的整行占位词当精确逐字时间。
- KRC `[offset:+N]`已在parseKrc里加到行/词绝对时间上，正值延后，负值提前。adapter **不再加offset**；现有TUI与浮窗复用同一时间轴。协议没有offset字段。
- v1禁止负数。负偏移造成媒体零点以前的start/end会裁到0，零点后的跨度不受影响。这是协议兼容处理；没有把整份文档额外平移来“修复”负数。
- 现有parseLrc不处理LRC `[offset]`，不能宣称支持。LRC行end取下一行start，最后一行默认+5秒，是现有解析器估算，适配器保留这个边界，不宣称来源提供了精确end。
- 现有用户手动时间偏移尚不存在。Kotonoha若增加用户偏移，应只在浮窗展示层应用一次；不得再自动应用KRC头部offset。未来播放器加入可调偏移时，需要明确所有权并更新协议/交接，不能两端累加。
- 适配器始终传完整译文；Kugou Lite的T翻译开关、歌词缩放、靠左/中/右、滚动不改变发布文档。Kotonoha独立决定行选择、字体、动画与译文显示。

## 7. MPRIS 并存及下一段的来源选择

现有MPRIS未删除/替换：总线`org.mpris.MediaPlayer2.kugou_lite`，Identity=`Kugou Lite`；trackid=`/org/mpris/MediaPlayer2/track/t<hash>`；Position是微秒，适配器positionS是秒。原有MPRIS控制继续可用，适配器是单向数据通道。

上游`app/source_gate.py`与`source_registry.py`拥有来源候选/优先级，配置display_sources默认`["mpris","cider","adapter"]`。不能假设“WebSocket连上”就一定选择适配器歌词：MPRIS模式、手动歌词与缓存也参与应用层决策。

Kotonoha新对话应：

1. 先读本文件、Kotonoha AGENTS.md、实际source_gate/source_matching/lyrics_workflow/display_coordinator，再检查最新HEAD。升级协议时重新跑实际decoder验证，不沿用旧字段猜测。
2. 为Kugou Lite验证/明确adapter完整歌词优先策略。可在Kotonoha来源设置把adapter排在mpris前，验证当前模式和手动覆盖是否仍影响选择；需要代码时在Kotonoha实现，不改播放器伪造身份。
3. 在MPRIS与适配器同存时，将`kugou_lite`总线身份和上述稳定ID/hash关联，保留一个展示来源和一个时钟所有者；MPRIS保留控制能力。跨来源必要时用曲名/歌手/时长匹配，不能依靠相同序号或相同playerId。
4. 手动选词归Kotonoha：同歌snapshot/null加载状态、重连和同歌重播时，确保不会误清手动覆盖或把旧词文档套到别的版本。当前DisplayCoordinator已有manual override与_same_track处理，需结合本接入验证。
5. 做Arch+Hyprland layer-shell浮窗、字体/逐字高亮、平滑插值、透明/鼠标穿透、暂停/seek/停止、快速切歌、单曲循环、全屏和多显示器实机验收。
6. 验证歌词尚未取得时的等待/无歌词状态，之后由同一连接完整文档更新；断开可释放ownership，重连不回放旧clock。
7. v1没有双向控制，浮窗若要播放/暂停/seek应使用现有MPRIS或另行明确控制协议，不能向此WebSocket私发控制命令并宣称播放器支持。

## 8. 已执行的验证与尚未执行项

| 层级 | 本轮证据 |
| --- | --- |
| Node行为/既有回归 | `npm test`完整94项通过，其中11项Kotonoha行为覆盖毫秒转换/译文/真实字词/offset、行同步、无词换歌、迟到、同曲重复、暂停/恢复/seek/stop、seq/trackRef、重连、离线超时、背压、安全URL、巨大/坏文档及实际时长更新。 |
| Rust/配置 | Rust31项通过；新增Kotonoha字段往返与非法端点保护覆盖于已有配置测试。离线cargo build成功，开发二进制更新。 |
| 真实TUI输入 | `tests/ui_smoke.py`：默认关闭启动命令、歌词页开关、间隔改变、保存JSON通过；原有扫码Esc、图标、进度鼠标及退出回归通过。worker为模拟，非账号/API验收。 |
| CLI导入导出 | `tests/config_smoke.py`：三项新配置随既有JSON与--config往返、主题与既有设置保留通过。 |
| 既有MPRIS逻辑 | `python tests/mpris_test.py`四项通过；不是本轮真实用户DBus控制验收。 |
| 实际协议+后端联调 | `python tools/check-kotonoha.py`：真实上游receiver/decoder/display coordinator +真实mpv JSON IPC、本地8秒合成PCM、--ao=null；接收20帧、拒绝0帧。含接收器未在线时播放、真实8秒时长、KRC offset/译文/字词、pause/resume/seek/stop、同曲重播无词、实际EOF触发共享single规则重启、重连snapshot。 |
| Hyprland桌面/实际账号 | **未执行**。本进程未继承WAYLAND_DISPLAY/HYPRLAND_INSTANCE_SIGNATURE，没有启动浮窗GUI；没有读取用户凭据或查询播放CDN。真实视觉、MPRIS+adapter争用、真实账号歌曲与后台全屏表现需下一段验证。 |

复现开发验证（不要求最终用户编译）：

```sh
cd "/home/wolf/Kugou Lite"
npm test
CARGO_HOME=/tmp/kugou-cargo cargo test --manifest-path tui/Cargo.toml --offline
CARGO_HOME=/tmp/kugou-cargo cargo build --manifest-path tui/Cargo.toml --offline
python tests/ui_smoke.py
python tests/config_smoke.py
python tests/mpris_test.py
python tools/check-kotonoha.py
```

实际协议脚本需要本地kotonoha源码及其Python运行依赖（已在本环境可用），Node和mpv；使用临时目录与随机loopback端口，不读账号。会重写本项目docs/kotonoha-protocol-evidence.json为最新测试证据，记录实际本地Kotonoha HEAD。未运行整个Kotonoha测试套件，因为没有修改它的代码。

工作区没有根Git记录，本轮逐文件检查新增协议/连接模块、Player增量IPC、worker回调/清理和Rust新配置；未修改任何上游API库、Kotonoha源码、主题或账号存储，未升级依赖。不要用本轮接入测试推断此前账号失效问题已解决。

## 9. 脱敏实际消息

下面不是手写的假设协议：从上述真实WebSocket联调记录中提取。歌曲与歌词为本地合成测试fixture，不涉及用户账户；中间的校准消息省略，序号有间隙合法。完整证据见同目录kotonoha-protocol-evidence.json。

实际 snapshot：

```json
{
  "protocol": "kotonoha.adapter",
  "version": 1,
  "type": "snapshot",
  "adapter": "kugou-lite",
  "sequence": 0,
  "capturedAt": "2026-10-05T10:53:18.800Z",
  "playback": {
    "playerId": "kugou-lite-protocol-probe",
    "status": "Playing",
    "positionS": 0.250484,
    "durationS": 8,
    "track": {
      "stableId": "kugou-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-123",
      "title": "Integration Tone",
      "rawTitle": "Integration Tone",
      "artist": "Local Fixture",
      "album": "Protocol Test",
      "durationS": 8
    }
  },
  "lyrics": {
    "source": "kugou",
    "sourceName": "酷狗 KRC",
    "songId": "kugou-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-123",
    "timing": "Word",
    "title": "Integration Tone",
    "artist": "Local Fixture",
    "album": "Protocol Test",
    "durationS": 8,
    "lines": [
      {
        "index": 0,
        "id": "line-0",
        "start": 1.25,
        "end": 2.45,
        "text": "Hello world",
        "translation": "本地测试译文",
        "words": [
          {
            "start": 1.25,
            "end": 1.65,
            "text": "Hello"
          },
          {
            "start": 1.65,
            "end": 2.45,
            "text": " world"
          }
        ]
      },
      {
        "index": 1,
        "id": "line-1",
        "start": 4.25,
        "end": 5.25,
        "text": "Again",
        "translation": "本地测试译文",
        "words": [
          {
            "start": 4.25,
            "end": 5.25,
            "text": "Again"
          }
        ]
      }
    ]
  }
}
```

实际 clock：

```json
{
  "protocol": "kotonoha.adapter",
  "version": 1,
  "type": "clock",
  "adapter": "kugou-lite",
  "sequence": 5,
  "capturedAt": "2026-10-05T10:53:18.833Z",
  "trackRef": "kugou-lite:kugou-lite-protocol-probe:kugou-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-123",
  "positionS": 3.00004,
  "status": "Playing"
}
```

## 10. 已知边界与复现方式

- Kotonoha不在线：先开播放器并启用接入，日志应有transport-error/连接超时与有上限重试；mpv/TUI仍工作。随后启动接收端，应收到当前完整快照，不是一串旧clock。
- 快速切歌/同曲重播：第一首词未取回时切歌，旧结果不能覆盖新实例；单元测试有双重身份守卫，真实协议脚本有同歌重播和EOF single重启，真实账号网络迟到仍需实机验收。
- 没词：snapshot.lyrics=null是协议定义的等待/缺失状态，**没有区分加载中、无匹配或网络失败的字段**，本轮不发明扩展。
- 消息被上游拒绝：v1没有ack，播放器只能报告本地文档错误/发送失败；用Kotonoha `-v`的receiver日志定位远端静默丢弃。check-kotonoha.py在真实ingest后记录接受/拒绝数。
- 不同来源元数据：现有曲目模型经常没有专辑名，发送空album；没有媒体URL，也没有签名CDN访问参数。不能把空专辑或来源歌曲ID当作匹配失败的充分理由。
- 同曲的不同播放实例不在v1 wire独立表达；序号/完整快照只保证当前连接顺序。应用层手动覆盖及动画清理需要Kotonoha策略。
- 播放进程突变/SIGKILL无法执行JS清理回调，但操作系统会关闭socket；Kotonoha应以连接生命周期释放该来源。正常stdin EOF/SIGTERM/退出关闭适配器和后台定时器。
- 用户时间偏移和LRC头部offset尚未实现，不能在浮窗端再自动平移KRC。无词的后台获取仍走现有loader，不新增其他歌词网站或账号请求。
- MPRIS目前固定一个总线名，多开播放器时可能只有一份MPRIS注册；adapter的playerId按worker唯一，Kotonoha需要明确多个adapter客户端的选择行为。
