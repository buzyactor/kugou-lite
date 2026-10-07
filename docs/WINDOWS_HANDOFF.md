# Kugou Lite Windows 开发交接

更新：2026-10-07（Asia/Shanghai）。接收方是 Windows 上的 Codex。本次只整理文档，没有修改应用代码、Arch Linux 配置、API checkout、账号或播放数据，没有生成 Windows 二进制。

## 1. 目标与约定

- 开发原生 Windows 版本，保持 **Rust + Ratatui TUI**，复用 Node 业务层与独立 mpv 播放器。
- 保留 Arch Linux 的行为、配置路径、主题、账号、队列、通知和歌词工作流。平台差异放在明确的平台分支或适配层里。
- 用户只打开准备好的程序；应用修改后，Codex 负责测试、编译、整理运行依赖并交付可直接启动的产物。
- 开始先读本文件、[HANDOFF.md](HANDOFF.md)、[STATUS.md](../STATUS.md)、[README.md](../README.md) 及 Windows 工作目录适用的 `AGENTS.md`，核对实际源码与 Git。旧交接的 Linux 绝对路径和测试结果不能直接套用。
- 建议独立 checkout、`windows-port` 分支；这是建议，本次没有创建分支。已有改动先核对归属，保留其他对话的工作。
- 凭据留本机，不上传 `.local/`、API checkout、依赖、构建输出和用户配置。不要求用户发送 token/cookie，不自动清账号、重登或迁移 Arch 设备身份。
- 完成一批更新文档，审查、提交并推送当前工作分支，报告准确结果；合入 `main` 前保留 Linux 回归证据。仓库保持公开。

## 2. 当前基线与证据边界

| 项目 | 本次核对结果 |
| --- | --- |
| 仓库 | <https://github.com/buzyactor/kugou-lite>，origin：`https://github.com/buzyactor/kugou-lite.git` |
| 应用基线 | `7f3f9f34797485134d5c821c62a2c25d86685054`，云歌单创建、转移和编号调序 |
| 主仓库状态 | 本次开始时 `main` 干净，本地 `origin/main` 与上述提交一致；文档提交会在其后 |
| Linux 工具链 | 本机 Node `26.10.0`、Rust `1.99.0`；项目声明 Node `>=22.18`、Rust edition 2024 |
| Rust 依赖 | Ratatui `0.30.2`、crossterm `0.29`；`tui/Cargo.lock` 已跟踪 |
| 最近应用验证 | STATUS 记录 Linux 完整 Node 157 项、Rust 33 项、隔离 TUI 检查通过；本次文档修改未重跑 |
| Windows 状态 | 尚无本次 Windows 编译、ConPTY、声卡播放、通知或安装包验收 |
| 登录 | 用户反馈更换接口后持续稳定；继续单一 modern 认证，长期保持和每日权益获取仍有验证边界 |
| 云端写入 | 最新歌单操作主要通过模拟测试；真实账号只读核对归属/版本/fileid/sort，未执行真实创建、移动、删除或调序验收 |

Windows 从实际拉取的最新提交继续，不要求退回应用基线。历史 Linux 通过不等于 Windows 已通过。

## 3. 架构与入口

```text
Rust TUI（tui/src/main.rs）
    stdin 命令 / stdout 逐行 JSON 事件
Node worker（tools/tui-worker.mjs）
    ├─ 账号、搜索、歌单、队列、历史、歌词、封面
    ├─ direct-api.mjs → 本地两个 API 库的 JS 模块
    ├─ music.mjs → mpv / ffprobe / ffmpeg 子进程
    ├─ desktop.mjs → Linux MPRIS / CAVA
    └─ 可选 Kotonoha WebSocket adapter
```

| 路径 | 职责 / 移植关注点 |
| --- | --- |
| `tui/src/main.rs` | 主循环、输入、worker 启动与退出、运行资源定位 |
| `tui/src/settings.rs`、`theme.rs` | 设置/主题目录、迁移、导入导出和原子写入 |
| `tui/src/kitty.rs`、`home_art.rs`、`lyrics.rs` | 图片和文字能力检测、降级、中文宽度及逐字歌词 |
| `tui/src/notifications.rs` | 应用内通知与 Linux `notify-send` 分层 |
| `tools/tui-worker.mjs` | Node 协调、取消/账号守卫、数据路径、Desktop/Spectrum 生命周期 |
| `src/music.mjs` | mpv IPC、控制与事件、EOF/失败、实际 codec 和码率 |
| `src/direct-api.mjs` | 双业务库路由、固定 modern 认证、超时和脱敏错误 |
| `src/accounts.mjs`、`device.mjs`、`login.ts` | 私有文件、设备身份、扫码、目录锁、Node 原生 TypeScript |
| `src/library.mjs` | 封面缓存、ffmpeg 子进程、KRC/LRC 和译文 |
| `src/queue-history.mjs`、`queue-store.mjs`、`play-history.mjs` | 多队列、已播放历史、账号隔离、退出保存 |
| `src/favorites.mjs`、`cloud-playlists.mjs` | 归属校验、单次写入、转移和调序核对 |
| `tests/*.test.mjs`、`tests/fixtures/queue-worker-mocks.mjs` | 逻辑测试、真实 worker + 模拟 API/账号/音频 |

worker stdout 是 Rust 协议通道，只能输出约定 JSON 行。诊断与依赖日志不得混入，也不得输出凭据和播放签名 URL。

## 4. Windows 环境准备

首轮建议 Windows 11 x64、Windows Terminal + PowerShell、Rust MSVC；这是开发验证目标，尚未证明最低系统版本。Windows 10、ARM64 和其他终端后续单独验证。

| 依赖 | 准备依据 |
| --- | --- |
| Git | 克隆主仓库及两个 API checkout |
| Rust / Cargo | [rustup Windows 安装说明](https://rust-lang.org/tools/install/)；MSVC 需要 C++ 构建工具和 Windows SDK，见 [MSVC prerequisites](https://rust-lang.github.io/rustup/installation/windows-msvc.html) |
| Node.js | 首轮可用与 Linux 相同的 26.10.0；使用 LTS 时独立回归并记录版本。[下载](https://nodejs.org/en/download) |
| mpv | 原生 `mpv.exe` 和该构建所需 DLL。[构建来源](https://mpv.io/installation/) |
| FFmpeg | 同时需要 `ffmpeg.exe`、`ffprobe.exe`。[Windows 构建入口](https://ffmpeg.org/download.html) |
| Windows Terminal | [Microsoft 安装说明](https://learn.microsoft.com/en-us/windows/terminal/install) |

根 `package.json` 没有应用 npm 依赖，依赖安装在 API 目录。Node 直接导入 `src/login.ts`，不能沿用上游旧打包脚本的 Node 14。测试 fixture 还需要 `node:module registerHooks`；换版本核对 [TypeScript 支持](https://nodejs.org/api/typescript.html)和[模块 hooks](https://nodejs.org/api/module.html#moduleregisterhooksoptions)。

以下由 Windows Codex 执行。`C:\Dev` 是示例，已有 checkout 时先核对，不重复克隆覆盖。`npm.cmd` 避免 PowerShell 选择 `npm.ps1` 导致策略报错，无需修改全局执行策略。

```powershell
New-Item -ItemType Directory -Force 'C:\Dev' | Out-Null
Set-Location 'C:\Dev'
git clone https://github.com/buzyactor/kugou-lite.git 'Kugou Lite'
Set-Location 'C:\Dev\Kugou Lite'
git status --short --branch
git log -5 --oneline
Get-Content -Encoding UTF8 docs\WINDOWS_HANDOFF.md
Get-Content -Encoding UTF8 docs\HANDOFF.md
Get-Content -Encoding UTF8 STATUS.md
Get-Content -Encoding UTF8 README.md
# 核对状态后，首次创建开发分支
git switch -c windows-port
node --version
rustc --version
cargo --version
Get-Command node, mpv, ffmpeg, ffprobe
mpv --version
ffmpeg -version
ffprobe -version
```

缺少依赖由 Codex 按权限准备。开发时可将工具目录加入当前进程 `$env:Path`，发行包应自行定位运行时，不能依赖开发机全局 PATH。

## 5. API 版本与容易遗漏的本地补丁

主仓库忽略 `kgcheckin/`、`KuGouMusicApi/`、`references/`，新 clone 不会带上它们。两个运行库都需要：默认音乐业务为 `kgcheckin/api`；扫码、设备注册、续期，以及创建/改名/调序管理路由用 `KuGouMusicApi@1.6.2`。不要因旧库也有认证模块就切回旧认证。

| checkout | 上游 | 本机 HEAD / 状态 |
| --- | --- | --- |
| `KuGouMusicApi` | `MakcRe/KuGouMusicApi` | `da5ccfd9304c043085a2fd18e94ebc5c315044ab`，package 1.6.2，干净 |
| `kgcheckin` | `develop202/kgcheckin` | `8bf3e12aada29682f27af0852457ebc7fd19227d`，`api/util/request.js` 有两行本地补丁 |

新环境按现有基线准备，避免浅克隆最新上游混入业务变化。以下只适用于目标目录不存在；逐条核对退出码，失败先处理。

```powershell
git clone --no-checkout https://github.com/develop202/kgcheckin.git kgcheckin
git -C kgcheckin checkout --detach 8bf3e12aada29682f27af0852457ebc7fd19227d
git clone --no-checkout https://github.com/MakcRe/KuGouMusicApi.git KuGouMusicApi
git -C KuGouMusicApi checkout --detach da5ccfd9304c043085a2fd18e94ebc5c315044ab
npm.cmd --prefix kgcheckin/api ci --ignore-scripts --no-audit --no-fund
npm.cmd --prefix KuGouMusicApi install --ignore-scripts --no-audit --no-fund
git -C kgcheckin rev-parse HEAD
git -C KuGouMusicApi rev-parse HEAD
```

现有 `node tools/clone-references.mjs --runtime-only` 也会准备两个库，但新克隆是上游最新浅克隆，不固定上表提交、不恢复补丁。选择它时要核对差异。普通 `npm run references` 还会克隆其他参考项目，首轮移植不需要。

锁文件差异已核对：legacy 有 `api/package-lock.json`，可用 `npm ci`；modern 的上述提交只有 `pnpm-lock.yaml`，没有 `package-lock.json`，首次不能直接 `npm ci`。上面的 npm install 会在被忽略的 checkout 中生成 npm 锁文件，后续可据它 `npm ci`；首次解析的依赖不保证与 Linux 已安装依赖完全一致，应记录和测试。若选择按上游 pnpm 锁安装，则核对 pnpm 版本、使用 frozen lockfile，保留原锁。Windows 的可重复准备和发行步骤应记录所采用的依赖锁策略。

**补丁原文：**Linux 的 `kgcheckin/api/util/request.js` 相对上述 HEAD 只改设备参数两行。Windows 新环境须核对并复现，以匹配已有设备参数传递。原代码：

```javascript
const mid = `${cryptoMd5(dfid)}${cryptoMd5(dfid).slice(0, 7)}`;
const uuid = cryptoMd5(`${dfid}${mid}`);
```

现有本地代码：

```javascript
const mid = options?.cookie?.KUGOU_API_MID || `${cryptoMd5(dfid)}${cryptoMd5(dfid).slice(0, 7)}`;
const uuid = options?.cookie?.KUGOU_API_GUID ? '-' : cryptoMd5(`${dfid}${mid}`);
```

本次只记录，不修改 Arch 的库。Windows 开发应制作主仓库可追踪的补丁或幂等准备步骤，核对版本和预期原文；不要让打包继续依赖未上传手改，也不要 force-add 整个忽略目录。

正常运行直接调用 API 的 JS 模块，**无需先开 HTTP API 服务或 3000 端口**。`tools/start-api.mjs` 是独立检查工具。

## 6. 已核对的平台适配点

### P0：运行资源、配置和数据路径

`tui/src/main.rs` 用编译时 `env!("CARGO_MANIFEST_DIR")` 的父目录定位 worker，启动 PATH 中的 `node` 并切换该目录。`settings.rs` 的旧配置和 `notifications.rs` 的图标也引用编译目录。直接搬走 exe 仍会指向构建机源码路径。

Windows 应定位程序旁资源和 bundled Node，开发运行可保留源码查找。子进程用独立参数，不拼 shell 字符串；验证中文、空格路径及不同启动 cwd。

Linux 设置/主题目前在 `XDG_CONFIG_HOME` 或 `HOME/.config` 下的 `kugou-lite/`；账号/设备/队列/历史/封面主要在 checkout 的 `.local/`。缺少 `HOME` 时当前设置代码退到相对 `.config/`，还不是 Windows 用户目录适配。

建议 Windows 配置/主题用 `%APPDATA%\KugouLite\`，账号/本地数据用 `%LOCALAPPDATA%\KugouLite\`，封面放子目录。这是**待实现方案**，当前没有已生效的 Windows 路径或通用数据目录环境变量。统一 Rust、worker、CLI/probe 的路径策略；导出配置不含凭据。便携数据模式如需提供，须明确启用，不能默认向 Program Files 写账号。

`src/login.ts: privateWrite` 用 chmod 700/600、同目录临时文件+rename；账号锁用 mkdir 和 `process.kill(pid,0)`。Rust 配置也 rename 替换。Windows 的 ACL、覆盖替换、占用文件和进程探测需要实测，不能把 POSIX mode 当成 Windows 私密保护。失败保留旧文件，不用先删旧文件再写新文件的方案。

### P0：mpv 控制和进程生命周期

`src/music.mjs: Player` 当前传 `--input-ipc-client=fd://3`，用 Node 第四个 stdio 管道收发全部播放命令/事件。不能假定 Node + Windows mpv 直接支持相同 fd 继承。mpv Windows fd 客户端有专门句柄要求，也支持 named pipe server，见 [mpv IPC 参数](https://mpv.io/manual/stable/#options-input-ipc-server)。

建议保留 Linux fd3 路径，为 Windows 增加 `--input-ipc-server=\\.\pipe\kugou-lite-<唯一实例名>` + Node `node:net` 客户端，抽传输层共用 Player 解析。重点：

- 连接有限等待、失败退出、多实例隔离；避免错过 `file-loaded`。可先 idle 启动、连 IPC 并订阅再加载音频，具体实现实测。
- 保留 time-pos/duration/pause/seekable/audio-bitrate、seek 完成、EOF 和失败回调。播放器是独立进程，当前没有嵌入 libmpv。
- stop、换歌、切账号、关闭窗口清理 socket 和自有进程；旧事件不能影响新歌，手动停止不能触发错误跳歌。
- worker 依赖 stdin EOF 收尾保存；Rust Drop 最多等约 3 秒再强杀。Windows `SIGTERM` 不能作为可靠异步保存回调，需先完成队列/历史保存再结束。
- 按 Windows 平台验证 `windowsHide`/创建进程方式，后台 Node/mpv/FFmpeg 不弹额外黑框，主 TUI 仍有可用终端。

### P1：桌面组件与终端能力

| 当前实现 | Windows 首轮处理 | 后续方向 |
| --- | --- | --- |
| `Desktop` 启动 Python MPRIS，依赖 D-Bus/gi | 平台选择安全空实现，保留 update/close 接口，核心播放不依赖 Python | Windows SMTC/媒体键 |
| Spectrum 固定 Pulse、`/dev/stdout` | 不启动 Linux CAVA，诚实显示频谱不可用，不造随机动画 | Windows 真实采集与频谱 |
| `notify-send`、Linux D-Bus 通知 | 保留应用内通知，桌面能力单独判断，不反复报缺 Linux 工具 | Windows 通知、切歌替换和小狼图标 |
| Kitty 图片/文字缩放 | 能力检测，先用现有彩色方块/标准文本降级，核对首页和中文宽度 | 图片终端适配 |
| `tools/install-desktop.mjs` | Windows 不运行；保留 Linux `.desktop` 安装逻辑 | exe 图标、快捷方式、双击入口 |
| Kotonoha WebSocket adapter | 默认关闭，Python/Qt checkout 是独立项目，未上传在此仓库 | 读 [独立交接](KOTONOHA_INTEGRATION.md) 后再移植桌面歌词 |

worker 启动即创建 Desktop，播放状态变化启停 Spectrum，必须在调用链上处理平台能力。高清资源 `复古终端像素狼头音乐图标.png` 已跟踪：首页 include_bytes 嵌入 PNG，Linux 通知另取文件。Windows exe/通知图标需要相应资源处理。

## 7. 功能回归重点

详尽操作见 README；移植保留以下现有语义：

- 搜索歌曲/歌单/专辑/歌手、歌手→专辑→歌曲可播放；专辑小分页和公开歌单分页兼容不能回退到业务码 20010。
- 集合播放读取完整列表，同一歌单跨页不变成两份队列；普通歌曲搜索仍按当前页建队列。
- `B` 队列，`N` 浏览历史队列，Enter 切换播放，Delete 删除正在查看的队列；编辑、命名、固定和下一首优先保留。
- 默认退出保存队列（`clear_queues_on_exit=false`），恢复不自动出声；开启清理只清当前账号队列。`E` 已播放历史账号隔离，重播优先缓存封面。
- `auto_skip_errors=true`，有上限及防循环；认证、缺工具、IPC 故障不能误跳完整列表。
- 六档音质 `flac/320/128/high/viper_clear/viper_atmos`，不可用无损回退 MP3；实际 codec/码率用于显示，网络/认证失败不是音质不可用，高档标签不证明音质或会员效果。
- `M` 跨页标记最多100首，`F` 收藏、`K`/右键操作；自建归属按 type/owner，不能因 `is_mine=0` 拒绝实际自建歌单。
- 创建/改名、移动/复制、编号调序保留；编号从1开始且对应云默认位置，不直接当作 sort 值；sort 实际可递减。
- 写入只发一次，超时是未知结果；移动先核对目标再删源，使用新读 fileid、核对版本；取消和切账号守卫保留。
- KRC、已有译文、时间校准、主题和普通终端可读歌词/菜单不回退。

## 8. 实施顺序与测试

1. 记录 Windows/工具版本、Git/API 基线和首次测试失败，区分编译、平台运行和缺依赖。
2. 解决资源/数据路径、进程和桌面降级，原生 Windows Terminal 启动 TUI；键盘、鼠标、中文、菜单及配置导出可用。
3. 修复 Windows mpv IPC，先用临时本地音频验证暂停/跳转/音量/进度/EOF/失败/退出，不依赖账号。
4. 隔离数据 + 模拟 fixture 检查 worker、队列编辑/保存、历史、账号隔离与云操作；补 Windows 文件占用/锁检查。
5. 用户在 Windows 扫码后验证真实只读接口和播放；真实写入用用户指定测试歌单/歌曲。构建/smoke 不自动增删、重登或 `--claim`。
6. 编译 release、整理运行目录，移到新的中文空格路径，从其他 cwd/双击启动；确认不依赖源码、开发机 PATH 和个人凭据，再补通知/媒体键等。

初始 PowerShell 检查命令（逐条检查 `$LASTEXITCODE`，失败先处理）：

```powershell
cargo check --locked --manifest-path tui/Cargo.toml
cargo test --locked --manifest-path tui/Cargo.toml
# 显式传递文件，避免依赖 shell 展开通配符
$testFiles = @(Get-ChildItem -LiteralPath tests -Filter '*.test.mjs' |
    Sort-Object Name | ForEach-Object { $_.FullName })
node --test @testFiles
cargo build --release --locked --manifest-path tui/Cargo.toml

# 文件 CLI 提前退出，不启动账号 worker
$smokeRoot = Join-Path $env:TEMP ('kugou-win-smoke-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $smokeRoot | Out-Null
$smokeConfig = Join-Path $smokeRoot 'config.json'
& '.\tui\target\release\kugou-lite.exe' --config $smokeConfig --export-config (Join-Path $smokeRoot 'export.json')
# 开发目录启动，不能代替发行包移动后的检查
& '.\tui\target\release\kugou-lite.exe'
```

`--config` 当前只指定设置文件，不隔离账号/队列/历史。上述导出不启动 worker 才不会访问账号。适配后测试应隔离整个数据根目录。

完整 Node 套件含真实 mpv/FFmpeg/ffprobe 与上游模块加载，缺工具不应笼统跳过。`desktop.test.mjs` 有直接模拟 `child.stdio[3]` 的检查，抽传输层后保留等价命令验证；`queue-worker.test.mjs` 的真实 worker + mocks 可复用，仍需验证 Windows 退出。

Python TUI smoke 多处使用 `pty/fcntl/termios`、`/usr/lib/kitty`、shebang、冒号 PATH 和无 `.exe` 程序名，不能当 Windows 原生验收。新增 ConPTY 或原生终端检查，保留 Linux smoke；逻辑/离屏与实机输入、图片、声卡、通知分别报告。当前未发现已跟踪的 Windows CI 工作流，可后续新增 Windows/Linux CI。

## 9. 交付与完成标准

当前单独 Rust exe 还需要 worker、源码、两套 API 及依赖、Node、mpv、ffmpeg/ffprobe、资源。先交付目录包，不能把 exe 单文件标为完整便携版。以下是**待实现定位后**的建议布局：

```text
dist/kugou-lite-windows-x64/
    kugou-lite.exe
    runtime/node.exe
    runtime/mpv.exe                 # 及必需 DLL
    runtime/ffmpeg.exe
    runtime/ffprobe.exe
    tools/                         # worker 和必要导入模块
    src/                           # 含 login.ts，保持相对布局
    KuGouMusicApi/                  # 运行模块/util/package/依赖
    kgcheckin/api/                  # 运行模块/util/package/依赖/设备补丁
    复古终端像素狼头音乐图标.png
    licenses/
    README-WINDOWS.txt
```

复制文件必须和资源查找、模块解析配套，首版可先复制经核对的完整运行 API 再裁剪。按实际再分发构建核对 Node/mpv/FFmpeg 与依赖许可；`docs/THIRD_PARTY_LICENSE_KUGOUMUSICAPI.txt` 不是全部依赖许可总表。`dist/` 已忽略，包里不带账号、`.local/` 或缓存。

完成时记录系统/架构、终端/工具版本、提交、测试和真实播放/退出结果、产物绝对路径、未完成桌面功能。用户应能直接打开准备的启动入口。Linux 回归由可用 Linux 环境验证；Windows 成功不等于 Arch 回归通过，也不授权改 Arch 配置。本次未构建 Windows exe、安装入口或重启现有程序。

## 10. 可直接发给 Windows Codex

> 在当前 Windows 工作区开发 Kugou Lite 原生 Windows 版本。先读 docs/WINDOWS_HANDOFF.md、docs/HANDOFF.md、STATUS.md、README.md 和适用 AGENTS.md，核对 Git、源码、工具链和两个 API checkout。保持 Rust/Ratatui TUI，保护现有 Arch Linux 行为和配置，在独立 Windows 分支推进。先解决运行资源定位、Windows 数据目录、mpv named pipe IPC、进程生命周期和 Linux 桌面组件降级，再验证真实 TUI 和播放。注意 kgcheckin 的两行设备参数补丁未随主仓库上传，按交接复现并做成可重复准备步骤；认证仍固定 KuGouMusicApi@1.6.2，不混旧认证、不自动清账号或领取权益。应用修改后由你测试、编译、整理可直接启动的 Windows 运行目录，用户只打开程序。区分模拟与 Windows 实机结果，更新文档，审查后提交推送当前工作分支，报告具体产物路径和同步结果。先完成可以独立推进的工作，不停在计划。
