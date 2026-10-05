# 新克隆 Node/Kotlin API 验证

2026-10-05，仅公开只读接口，延续歌手数据调查；没有改UI或替换生产API，也没有读取账号凭据。诊断脚本 `tools/reference-api-probe.mjs`，结果 `new-reference-api-lite.json`、`new-reference-api-android.json`、`new-reference-api-lite-extra.json`，只保存字段结构及选定公开计数。

## 仓库版本

- KuGouMusicApi 1.6.2，HEAD da5ccfd9304c043085a2fd18e94ebc5c315044ab。本轮直接加载此仓库 module 与 util，不再借用kgcheckin请求工具。安装120个运行依赖，ignore-scripts且不改锁文件；未替换应用中的1.3.9依赖。
- KuGouApi_Kotlin_SDK 1.0.5，HEAD 5d2ec16a084c51baeefeea468ef95d5025e78b32。读取AGENTS.md、ArtistApi.kt、ImageApi.kt、KuGouConfig.kt、RequestSigner.kt与RequestExecutor.kt。歌手业务地址与Node库基本一致，未找到独立累计收听/守护/认证说明模块。
- Kotlin完整运行未通过：wrapper无执行权限，改用bash调用后下载gradle-9.7.1失败，约39MiB处Premature EOF；沙箱外重试仍相同。未因此修改Gradle版本或SDK架构。源码对齐不能冒充Kotlin运行成功。

## 真实请求结果

新Node库标准版和lite各16次查询全部业务成功，额外两次查列表/MV字段。目标周杰伦3520、许冠英3066；没有领取、关注、上传或播放动作。

| 接口 | 已取得数据 | 范围与限制 |
| --- | --- | --- |
| artist_detail | 周杰伦1844首/49专辑/2828MV、生日、粉丝及五类长文；许冠英207首/11专辑/26MV、生日、粉丝/资料 | 未取得累计收听、守护计数或认证说明 |
| artist_audios_new | total=1844/207，作者身份/头像/国家/生日、音质hash/时长/码率、专辑、audio_tag排名或IP标签 | 每位只抽样前三首，未验证全量新版目录；没有可用单曲数值热度 |
| artist_albums | 专辑列表/封面/作品信息 | 请求每页3，完整字段结构见JSON |
| artist_videos | MV及封面、发布日期、时长、编码hash、heat/history_heat | 周杰伦抽样3条；许冠英official分类空，并不等于全部MV为空 |
| search author | Heat,FansNum,Identity,IsReal,IsSettledAuthor,FirstFrameImage | 搜索Heat口径不能替换累计收听人数 |
| artist_lists | 分组歌手列表、heat、fanscount、descibe、is_settled、dycover | hotsize=3仍多个分组，不能认为总量仅3；descibe实测问答条数，不是认证文案 |
| images | 周杰伦分类3/4/5共7(count5)、17(count100)个URL | 每分类限制，不是全局count |
| images_audio | 周杰伦分类2–8共17(count5)、42(count100)个不同URL | 不能据此保证官方主页全部照片/可分页 |
| artist_honour | 作品榜单/荣誉列表 | 不是守护人数 |
| krm_audio fields=base,authors.base,authors.ip,extra,tags,tagmap | 单曲基础信息、作者身份/生日/头像、作词作曲、曲风标签等 | 本次authors.ip未返回独立对象；没有认证说明或目标统计 |

### 图片平台兼容的新增结论

1. 新Node util/index.js在模块初始化时，根据platform选择导出的appid/clientver；lite实际3116/11436，标准版1005/20489。两种平台/images与/images/audio均成功，不再出现前轮旧库20006。
2. Kotlin ImageApi使用config.activeAppId/activeClientVersion，签名也按同一config选择。因此源码层面与新Node的匹配方式一致；Kotlin自身HTTP/签名/构建仍没有运行验收。
3. 不能在一个已加载Node模块的进程里仅切换process.env.platform做对照：appid/clientver在require时缓存，而签名helper动态读取环境，可能造成混用。本轮每种平台独立进程，且先设platform再require，避免该干扰。

### FirstFrameImage来源得到进一步确认

/ocean/v6/singer/list的周杰伦dycover.first_frame_image与搜索FirstFrameImage是完全相同的20260807资源。因此已确认它同时属于dycover元数据的首帧字段，而不是从相册分页选出的第二张照片。本次dycover仅含first_frame_image，没有取得动态视频/动画资源，暂不声称它具体对应哪种动态格式。

### 新发现的热度不能混用

周杰伦搜索Heat=24340778，歌手列表heat=65169，两者明显不同，口径尚未核实。MV前三条分别：

| MV | heat | history_heat |
| --- | ---: | ---: |
| 西西里 | 938 | 59456 |
| 女儿殿下 | 290 | 18985487 |
| 七月的极光 | 183 | 4331895 |

这是MV对象字段，不能用于单曲热度占比或歌手累计听众。descibe样本周杰伦“3.6万条问答”、薛之谦“9万条问答”，也不能作为认证文案。

## 缺失字段当前状态

- 照片：42URL图片服务已验证，新Node lite可用；官方主页完整相册/分页尚未确认。
- 单曲热度占比：仍未找到有效数值来源，新发现的是MV热度。
- 歌手累计收听：仍未找到明确接口，现有新库/Kotlin歌手源码也没给出新入口，不代表官方没有。
- 认证说明：Identity/IsReal/sisp等标志已验证，文字映射仍未找到；is_settled仅保留原始意义候选，不直接显示为认证。
- 守护人数：仍未找到明确接口，不能将粉丝、问答条数或荣誉计数替代。

## 复现与网络

运行 `node tools/reference-api-probe.mjs`、`node tools/reference-api-probe.mjs --standard`、`node tools/reference-api-probe.mjs --extra`；脚本逐个实际hostname做DNS和8秒HTTPS检查，API请求12秒超时。依赖已安装，无需用户安装。网络gateway/openapi/expendablekmr/h5activity/openapicdn均DNS成功、TLS有效；根路径403/502/200/404/502不等于业务接口失败。全部所列API业务调用成功，无账号cookie/token。

Kotlin wrapper请求services.gradle.org，经github.com重定向至release-assets.githubusercontent.com；HEAD成功200，声明长度151433392字节，实际下载约39MiB处Premature EOF。失败属于分发链的下载中断，沙箱外同样发生，不能归因“当前环境DNS失败”。本次未强行绕过构建或将源码比对称为SDK运行通过。
