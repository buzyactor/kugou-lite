# Kugou Lite 开发交接

更新：2026-10-06（Asia/Shanghai）。新工作对话先读本文件，再读根 STATUS.md、README.md和相关源码；本文件可以独立使用，不依赖已压缩聊天。用户最新反馈优先，历史测试不等于当前实机验收。

## 1. 接手时的真实快照

- 工作区：`/home/wolf/Kugou Lite`。保持Rust TUI，不改成网页或普通桌面播放器。
- 本次开始前根仓库干净，分支main；HEAD为`43eb1de3a9bc2a4789bea604d3fa24c143b8383e`。随后本交接会单独提交，接手仍要重新运行git status/log。
- origin：`https://github.com/buzyactor/kugou-lite.git`，用户明确选择私有。2026-10-05已创建并推送；源码Release为`https://github.com/buzyactor/kugou-lite/releases/tag/snapshot-20261005`，含源码tar.gz与SHA-256，不含二进制、API克隆或账号数据。本次更新会同步main，不替换历史Release。
- 已有可运行二进制：`tui/target/debug/kugou-lite`。本轮实际检查文件存在，26032744字节，mtime为2026-10-05 18:38；后续Node逻辑在运行时从本工作区读取，因此mtime不代表全部Node代码的更新时间。不是脱离仓库与运行依赖的单文件发行物。
- 2026-10-06实际环境：Node v26.10.0、Rust 1.99.0；系统GitHub CLI在`/usr/bin/gh`。**旧/tmp/kugou-github/gh和/tmp/kugou-cargo已不存在**；不要照抄历史命令强制CARGO_HOME到被清理目录。
- 本次没有读取账号文件或验证当前登录；2026-10-05清空账号是历史操作，不能据此断言用户现在仍未登录。不要为了接续再次清账号或轮换token。
- 根目录没有项目AGENTS.md；上级`/home/wolf/AGENTS.md`存在，先读适用说明。参考仓库有各自AGENTS，进入其中工作前再读；本交接不要求修改它们。

## 2. 用户约定（必须保留）

1. **用户只打开已编译二进制**。应用修改后由开发者完成相关测试并编译好，不能让用户自行编译。纯文档变更不需要重新编译播放器。
2. 后续每完成一批修改、检查通过并审查diff后，适时提交和推送私有GitHub仓库。用户已持续授权同步，不需要重新询问是否上传；工具沙箱授权与GitHub认证仍按当前环境处理。同步失败明确说明原因并给手动步骤，不能把本地commit写成上传成功。
3. 先核对git status、保护已有未提交工作，不擅自reset/stash/覆盖。参考项目的修改属于独立仓库，不能误加入根仓库。
4. 账号凭据、token、cookie、二维码key、签名播放URL不进日志、文档或Git；不让用户把token发聊天。不为写交接读取凭据内容。真实账号调试仅按用户授权目的读取，输出只用脱敏字段。
5. 线上验证先对**实际hostname**做无凭据DNS和带超时HTTPS/TLS测试，成功再查询歌单/会员。失败报hostname、错误码和确认到的网络限制，不笼统归因DNS，也不为沙箱网络限制重构播放器。
6. 登录保持时间是当前最高优先级未决问题。用户要求单一登录API，不要并行试一堆认证实现或在失败后悄悄切旧库；不得批量发短信、授权其他设备或重试不确定结果的写入。
7. 非测试镜像代码的有意义行为检查优先；不要因文档更新重跑所有耗时检查，也不要混淆模拟UI、协议接收与Hyprland实机验证。
8. 每次完成/验证变化更新STATUS.md；本文件维护接续入口，详细历史保留在STATUS及专项文档，不把大量流水记录塞AGENTS。

## 3. 架构与改动入口

| 路径 | 职责 |
| --- | --- |
| `tui/src/main.rs` | Ratatui/crossterm主循环、输入、导航与Node worker启动；启动配置通过stdin命令传入worker |
| `tui/src/controls.rs`、`settings.rs` | 分页设置、快捷键、XDG JSON导入导出与持久化 |
| `tui/src/lyrics.rs`、`kitty.rs`、`home_art.rs` | 歌词布局/高亮/滚动、Kitty图片生命周期、主页高清图标 |
| `tui/src/theme.rs`、`theme_picker.rs` | 主题颜色、预设、选择菜单与独立theme.json |
| `tui/src/catalog_ui.rs`、`collections.rs`、`search_ui.rs` | 歌手/专辑、歌单档案/目录与丰富搜索 |
| `tools/tui-worker.mjs` | Node账号/API协调、generation守卫、页面/队列、播放器和完整歌词组合点；与Rust使用逐行JSON，不让上游日志污染stdout |
| `src/music.mjs: Player` | 独立mpv子进程、fd3 JSON IPC、实际time-pos/duration/pause/seek/停止/EOF/实时码率；当前没有嵌入libmpv |
| `src/direct-api.mjs` | 路由白名单、两个业务库选择、唯一modern认证、超时和脱敏错误 |
| `src/accounts.mjs`、`device.mjs`、`login.ts`、`session-reader.mjs` | 私有多账号、稳定设备、QR解析/t1、读取重试与有限续期 |
| `src/library.mjs` | 曲目/封面、完整KRC/LRC解析、译文、LRCLIB精确匹配fallback |
| `src/user-playlists.mjs`、`playlist-access.mjs`、`playlist-sort.mjs`、`navigation-history.mjs` | 创建/收藏分类、官方ID口径、全部集合排序与返回页/选中/滚动位置 |
| `src/catalog.mjs`、`discovery.mjs`、`playlist-info.mjs` | 四类搜索、歌手全目录、推荐/发现、曲数和播放量元数据 |
| `src/desktop.mjs`、`tools/mpris.py` | MPRIS、Linux通知、CAVA频谱；MPRIS身份org.mpris.MediaPlayer2.kugou_lite |
| `src/kotonoha-protocol.mjs`、`kotonoha-adapter.mjs` | 独立完整歌词转换和异步WebSocket snapshot/clock；不依赖Kotonoha Python类型 |

运行依赖：Node>=22.18、mpv、ffmpeg/ffprobe；桌面控制需要Python dbus/gi，CAVA需要CAVA与PulseAudio/pipewire-pulse环境。Cargo edition2024、ratatui0.30.2/crossterm0.29，开发构建opt-level=2。不要无关升级依赖。

## 4. 已有功能与不能回退的交互

- 持久多账号，显示用户名，切换/删除；二维码Esc回进入前的账号页，**Q退出，H/F2主页，Esc上一级**。
- 搜索歌曲/歌单/专辑/歌手；简约顶栏或丰富独立搜索，实时建议/热搜，分页自适应，跨页编号连续。
- P打开创建歌单，N切收藏；R每日推荐歌曲，N推荐歌单；D新歌/Hi-Res切换；所有进入歌单有左侧图片档案与Z排序。返回保持分类、页码、选中与滚动位置，滚动上下保留余量。
- 所有歌单目录有左侧缩略图，歌手搜索头像、歌手专辑封面与歌手主照片原比例。图片异步结果校验页面/generation/cover，切页或缩放清理独立Kitty图像ID。主页右下角用原1448×1086透明PNG高清传输，**不退回64×64字符图**。
- 歌手热门单曲按接口sort=hot排序；认证说明/累计收听/守护人数已按用户要求移除，不能再拿缺失字段绘制热度占比或虚构数据。相册完整性仍是接口边界。
- 歌单元数据播放量用play_count/total_play_count，累计优先，未知不当0；这是播放次数，不声称去重听众人数。
- FLAC默认且实测编码校验，媒体URL和显示文件名后缀不能当音质依据；显式选择320/128才允许有损。每个播放器独立音量，+/-调节；实时码率进最底部状态栏。
- 底部进度鼠标拖动、前后/播放图标可点；歌词完整换行、英文词/符号相邻不凭空插空格、非当前原文+译文紧凑成组，不能超出歌词区域或污染CAVA边框。
- 两套侧/顶导航，主题预设23套，设置分页，独立theme.json及导入导出；所有板块、进度、状态栏、不同歌词阶段颜色属于主题配置。
- 可选Linux与应用内通知；CAVA多个图案，真实频谱来自输出监视器，可能含其他应用声音。

详细按键以README和真实controls/main为准，不能从本表推断未实现的新功能。

## 5. 当前登录试验：先继续这一项

**用户反馈旧登录经常不足1–2小时失效。现在只采用KuGouMusicApi 1.6.2原生认证。**

- AUTH_ROUTES把/login/qr/key/create/check、/register/dev和/login/token固定到modern。旧kgcheckin1.3.9仍供普通曲库业务使用；这不是并用多套认证。api=legacy参数不能切回旧认证。
- 新库原生v5保留其t1/t2加密和secu_params解包；仅传输使用HTTPS gateway.kugou.com，x-router=login.user.kugou.com。不要改成直接HTTP，也不要关闭TLS验证。login-user.kugou.com（QR）与login.user.kugou.com（token服务）是不同hostname。
- 稳定GUID/MID/DEV/MAC与dfid持久化；QR返回t1保留，安全Base64 t1支持+ / =，防止丢会话参数；loginProvider=KuGouMusicApi@1.6.2。
- SessionReader：6小时主动维护、5分钟失败冷却、并发合并、20017同凭据复查一次后才尝试有限续期。6小时不是官方有效期；请求超时不意味着服务端未完成旋转。
- `src/token-refresh.mjs`只是旧参考实现/离线测试，不在生产认证分支；不要将它重新接回作为fallback。
- 2026-10-05已按用户要求清除本项目账号/设备/相关缓存，并保留界面主题。**不要再次运行tools/clear-accounts.mjs，除非用户明确要求**。
- 历史真实验证仅到匿名设备注册+QR准备/check=waiting，未证明用户新扫码成功、token实际续期或连续1–2小时有效。最初两次设备准备未完成，后续成功；不能宣称新登录已稳定。

下一步有用户新反馈时：确认其新扫码后的P歌单/V会员结果；先无凭据网络检查，再最少只读时间采样，区分网络错误、20017、token自然旋转和账号切换。不在用户没有反馈时假定应重登。未确认的实机结果明确留空。

专项文档：`docs/investigations/login-api-inventory.md`（所有库、模块、端点、用途、验证状态）、`session-stability.md`（旧库阶段历史）、`new-reference-apis.md`、`artist-data-sources.md`。新Node15个login模块、旧Node9个、Kotlin19个suspend认证/辅助方法；这是接口模块数，不是15/9种独立登录方式。

## 6. Kotonoha跨对话边界

- 玩家侧详见`docs/KOTONOHA_INTEGRATION.md`，原参考commit175cfcc04ffb67fbbba26c76437275083090233a、adapter协议v1。里面“根无Git/本地HEAD与上游相同”等是**当时记录，已过时**，以本文件和当前仓库为准。
- 当前实际Kotonoha HEAD：`091296c5063a73ff4cc852e225ba525e1cdbc717`，提交主题fix(sources): honor preferred adapter lyrics and playback clock；本次只读看到其`KOTONOHA_INTEGRATION.md`为未跟踪文件。另一对话已有改动，不能覆盖、reset或误提交进根仓库。
- 本文没有替另一对话验收它的新实现。原有MPRIS/adapter来源优先级和Hyprland验收待办可能已有推进，先读Kotonoha实际代码、AGENTS与它的进度/测试，不能照原交接重复改一遍。
- 播放器在连接/重连/换歌/文档更新发完整snapshot，暂停/恢复/确认seek/停止发clock，低频校准默认1000ms来自实际mpv；异步超时/退避与背压不阻塞TUI，默认关闭。
- 行/词内部绝对毫秒→协议秒；KRC offset已经应用，正值延后，不再叠加；LRC行同步不能伪造字词。没有播放器手动选词或用户时间偏移，LRC头部offset未实现。
- adapter=kugou-lite，playerId按worker唯一，stableId由原hash/audioId组成；trackRef依协议；本地playInstance/generation防迟到。单曲循环/同歌重播保持catalog身份，v1没有独立播放实例字段。
- 启用：?→2歌词设置页，“Kotonoha 桌面歌词”；默认ws://127.0.0.1:28745/kotonoha/adapter。配置kotonoha_enabled/kotonoha_endpoint/kotonoha_clock_ms，不与theme.json混放。
- 原玩家侧真实接收器+mpv本地PCM无GUI联调接受20帧/0拒绝；这**不是Hyprland浮窗/GPU验收，也不是现在091296c版本的重新验证**。

## 7. 验证记录与待验收项

| 检查 | 最近已记录结果 | 接手时注意 |
| --- | --- | --- |
| npm test | 2026-10-05完整97项通过 | 本次纯文档不重跑；应用改动按影响运行 |
| Rust测试 | 2026-10-05 31项通过 | 不同历史阶段计数不同，不能累加 |
| cargo build | 2026-10-05离线构建成功 | 旧临时Cargo缓存已经清理，现有binary仍在 |
| UI/config模拟 | QR Esc、账号删除、底栏鼠标、设置、Kotonoha开关/校准JSON往返通过 | 模拟worker/PTY不是真实API或GPU |
| MPRIS逻辑 | 4项Python测试通过 | 不是本次真实DBus操作验收 |
| Kotonoha接收协议 | 旧参考版本真实receiver/decoder/display coordinator+mpv通过 | 当前Kotonoha已更新，改协议时再验 |
| 主页高清图 | PTY PNG完整字节、缩放/隐藏/清理通过 | Kitty GPU观感仍需实机反馈 |
| 新认证 | 匿名waiting成功 | 新扫码账号/实际续期/两小时保持尚未由本对话验证 |
| 每日VIP | 用户历史probe返回130012/already_claimed，权益未变化 | 新增免费VIP与跨天奖励未证明，自动每日领取尚未启用 |

其他边界：完整大歌单排序的真实账号全程、真实Kitty歌词边框/英文排版/全屏封面、某些曲目外部歌词匹配需实机验收。歌手统计与相册字段不在当前接口返回不等于官方没有；不能编造认证/听众/守护/热度值。

## 8. 可用命令（开发者执行）

```sh
cd "/home/wolf/Kugou Lite"
git status --short
git log -5 --oneline
# 用户启动，只需二进制；现有工作区不需要重新拉全部参考项目
./tui/target/debug/kugou-lite
# 在新checkout缺API依赖时才准备，两个克隆不进入根Git
node tools/clone-references.mjs --runtime-only
npm --prefix kgcheckin/api ci --ignore-scripts --no-audit --no-fund
npm --prefix KuGouMusicApi ci --ignore-scripts --no-audit --no-fund
npm test
cargo fmt --manifest-path tui/Cargo.toml --check
cargo test --manifest-path tui/Cargo.toml --offline
cargo build --manifest-path tui/Cargo.toml --offline
```

默认`~/.cargo` registry/git目录实际存在，但本次未验证其缓存覆盖项目依赖；offline缺依赖时按真实错误申请联网构建，不创建新的播放器架构补偿环境。确有独立缓存再设置CARGO_HOME，不复用已经消失的/tmp/kugou-cargo。

按改动选择：`python tests/ui_smoke.py`、`config_smoke.py`、`lyrics_smoke.py`、`layout_regression_smoke.py`、`collections_smoke.py`、`playlist_sort_smoke.py`、`search_cover_smoke.py`、`catalog_ui_smoke.py`、`theme_picker_smoke.py`、`notifications_smoke.py`（均位于tests目录）；MPRIS为`python tests/mpris_test.py`。部分色彩检查需移除测试进程NO_COLOR；Kitty解析依赖/usr/lib/kitty。不要为了测试改用户全局终端配置。

登录只读采样（先确认用户当前授权和新扫码情况，命令不主动旋转）：

```sh
node tools/network-check.mjs gateway.kugou.com kugouvip.kugou.com
node tools/session-probe.mjs --api=legacy --samples=25 --interval=300
```

legacy只是普通业务库；采样约2小时，不要另开同时认证/续期试验，记录自然tokenUpdatedAt变化但不输出token。匿名QR入口探针为`node tools/auth-probe.mjs`，不用旧凭据。会员查询`node tools/vip-probe.mjs --direct`默认只读；`--claim`和C键会真实上报，未经本次需要不触发。

Kotonoha协议检查：`python tools/check-kotonoha.py`，需要当前本地Kotonoha及Python依赖；会重写`docs/kotonoha-protocol-evidence.json`，不要把新证据当作无改动或套旧测试结论。

## 9. 配置、账号、同步与手动上传

- 用户配置默认`~/.config/kugou-lite/config.json`（支持XDG_CONFIG_HOME和--config）；theme.json独立且预设按主题名存放，支持单独导入/导出。旧.local/ui.json是迁移来源。
- `.local/accounts.json`/device.json为私有，目录700/文件600；旧account.json可迁移。损坏不会静默覆盖；清空工具是显式破坏性重置，不作为常规恢复方法。
- `.gitignore`排除.local、API/参考克隆、tui/target、node_modules、Python缓存、.env、.aws/.codex/.agents和dist。源码包不是可直接运行的预装二进制发行物。
- 用户要求定期同步，当前目标始终私有buzyactor/kugou-lite/main，不能默认改公开或创建别的仓库。先审查改动与忽略规则，只提交任务文件，确认远端与本地一致再报告上传成功。

开发者/用户手动同步示例，替换提交说明：

```sh
cd "/home/wolf/Kugou Lite"
git status
# 审查并按实际变更列文件，别盲目夹带其他对话的工作
git add docs/HANDOFF.md STATUS.md README.md
git diff --cached --stat
git commit -m "docs: update development handoff"
git push origin main
```

只有需要时`gh auth status`或`gh auth login --hostname github.com --git-protocol https --web`；正式gh现位于/usr/bin/gh，旧临时路径失效。登录由用户在官方浏览器授权，不收集密码/token。没有gh时用户可`sudo pacman -S github-cli`安装；这不是开发者未经授权自动安装系统包的指令。

## 10. 给新工作对话的入口消息

> 工作区是/home/wolf/Kugou Lite。请先读docs/HANDOFF.md、STATUS.md、README.md及适用AGENTS，核对git状态、源码和相关测试，不依赖旧聊天。保持Rust TUI；应用修改后由你测试并编译，用户只打开二进制；完成一批修改后同步私有buzyactor/kugou-lite。当前核心未决是KuGouMusicApi单一登录链路的真实保持时间，不混用旧认证，不自动再次清账号。Kotonoha在另一对话开发，先核对它实际HEAD/未提交工作与旧协议交接，不覆盖它的改动。优先处理用户新的反馈，测试与实机验收分开报告。
