# 歌手页面数据来源调查

调查日期：2026-10-05。后续新克隆库验证见 `new-reference-apis.md`；旧库签名失败结论不适用于新版1.6.2，两种平台已分别验证图片成功。仅源码调查、公开只读请求及文档；未修改界面或运行 API 适配层，未恢复账号、携带账号 cookie/token、领取权益或播放音乐。结果样本为周杰伦 author_id=3520，图片查询关联《晴天》hash=B3A52A7A958BF0AED0EBFBA2E9A818B7。可核查的字段结构、图片分类数量、错误码和网络结果见 `artist-api-evidence.json`；不保存账号凭据或签名值。

## 版本与源码范围

- 运行时加载 `kgcheckin/api/package.json`：`kugoumusicapi` 1.3.9；kgcheckin HEAD `8bf3e12aada29682f27af0852457ebc7fd19227d`。这是嵌入的社区 API 快照，不是酷狗官方 SDK。
- kgcheckin README 明确来源为 MakcRe/KuGouMusicApi。本次在线读取该仓库 main 的 package.json，版本 1.6.2；这是 main 当前声明，不声称 npm 最新发行版本。未升级本地库。
- 上游 main 的 artist_detail、images、images_audio、artist_honour 与本地所查模块基本一致；上游另有 artist_audios_new，本地未提供。仅在 /tmp 加载新版单曲模块，用本地请求工具验证。
- MoeKoeMusic HEAD `b974ff5c5183be902ff92519f4fd905ec6cae93e`；EchoMusic HEAD `7f0fca4621d6e1465c66bb5bfe32d717e4c27a6a`。两者声明使用 MakcRe/KuGouMusicApi 子模块，本地 api/server 为空；调用代码可查，不能据此声称已运行其完整服务。
- 另搜索 kugou-tui 及现有 API 模块。上游 main 模块目录中未找到独立以 author_id 分页取相册、歌手累计收听或守护统计的明确模块；不等于官方服务不存在这些接口。

## 实际地址、参数、字段

请求工具默认 baseURL=https://gateway.kugou.com，补充 dfid、mid、uuid、appid、clientver、userid、clienttime 和签名；无凭据请求 userid=0，无账号 token。路由头 x-router 表示上游业务服务，不等于实际 TCP 请求 hostname。

| 模块/客户端路由 | 实际请求 | 业务参数与路由 | 本次返回 |
| --- | --- | --- | --- |
| artist_detail /artist/detail | POST https://gateway.kugou.com/kmr/v3/author | JSON author_id；x-router=openapi.kugou.com，kg-tid=36；模块没有 page/count/fields 参数 | data.birthday、author_name、sizable_avatar、author_id、album_count、mv_count、fansnums、song_count、intro、long_intro、area_id、pinyin_initial、is_publish、user_status |
| search type=author | GET https://gateway.kugou.com/v1/search/author | keyword,page,pagesize,albumhide=0,iscorrection=1,nocollect=0,platform=AndroidFilter；x-router=complexsearch.kugou.com | data.lists[].AuthorId,AuthorName,Avatar,FirstFrameImage,Heat,FansNum,Identity,IsReal,IsSettledAuthor,UserId,AuthorStatus,AlbumCount,AudioCount,VideoCount 等 |
| artist_audios | POST https://openapi.kugou.com/kmr/v1/audio_group/author | author_id,page,pagesize,sort=1(hot)/2(new),area_code=all，另有 appid/clientver/mid/clienttime/key；kg-tid=220 | 根 total；data[] 的 hash/audio_name/author_name/album_audio_id/playcount 等；本次前三首 playcount=0，前阶段1844首也未取得有效热度 |
| 上游 artist_audios_new /artist/audios/new | GET https://gateway.kugou.com/openapi/kmr/v2/audio_group/author | author_id,area_code=all,sort=1/2,page,pagesize；replace_api_version=1,mvdata_need=1,show_audio_honor=1,show_audio_tag=1,replace_need=1；kg-tid=36 | data.total,data.songs[].authors[].identity/sisp/base（含身份、国家、生日、头像），audio_info、audio_tag、album_info 等；本次3首无有效单曲热度、累计收听或守护统计 |
| images /images | GET https://expendablekmr.kugou.com/container/v2/image | query album_image_type=-3,author_image_type=3,4,5,appid=1005,clientver=20489,count,data=[{hash,album_id,album_audio_id}],isCdn=1,publish_time=1；签名，clearDefaultParams | data[].author[]：author_id,author_name,is_publish,res_hash,avatar,sizable_avatar,audio_publish_date,imgs；另有 album[]，须与歌手图片分开 |
| images_audio /images/audio | GET https://expendablekmr.kugou.com/v2/author_image/audio | query appid=1005,clientver=20489,count,data=[{hash,audio_id,album_audio_id,filename}],isCdn=1,publish_time=1,show_authors=1；签名，clearDefaultParams | data[][]：歌手对象及 imgs 分类2–8；图片含 id,file_hash,sizable_portrait,filename,publish_time,source |
| artist_honour | POST http://h5activity.kugou.com/v1/query_singer_honour_detail | query singer_id,page,pagesize；签名，模块本身用 HTTP，未带账号凭据 | data.info_list[]：榜单排名/天数/媒体信息。page1/2都返回20项，尽管pagesize=3；不是守护榜或认证说明，不能按请求pagesize假设实际页容量 |

所有上述候选均做了真实只读请求。新单曲、详情、搜索、荣誉成功；图片接口的失败/成功条件见下。

## 两张现有照片与更多图片

1. `data.sizable_avatar` 与搜索 `Avatar` 指向同一个 20260324 softhead 资源：主头像，去重后只算一张。
2. 搜索 `FirstFrameImage` 指向另一个 20260807 softhead 资源：搜索结果首帧图。字段名支持“首帧”这一解释，但没有拿到动态头像资源及绑定关系，不能进一步断言是视频封面或完整相册照片。
3. 两者实测 size=240/480/600 都返回相应正方形 JPEG，改变 size 只换分辨率，不增加照片。
4. images 和 images/audio 在当前全局 lite 签名下返回业务码20006；模块固定 appid=1005/clientver=20489，而 helper 在 lite 环境选择概念版签名密钥。在独立诊断进程中使用标准版签名，其他查询保持相同，成功 status=1/error_code=0。这证明签名配置兼容差异；不表示需要重新登录。生产代码本轮未改动，也未在运行播放器中切换全局平台。
5. 标准版 images/audio，count=20，得到分类计数 2:3、3:1、4:15、5:1、6:20、7:1、8:1，共42条且42个不同URL；count=100仍42条。本次不能由此证明已穷尽官方主页照片。
6. count=1/5实测分别限制各分类数量，而不是总图片数量：count=1也返回7个分类各1张。不能用 count 当作全局总量上限。分类6在20和100都返回20张，尚未区分真实总量与服务端上限。
7. images 中手工改 author_image_type=3/4/5并重新签名，分别只返回对应分类；现有模块硬编码3,4,5，不透传调用参数。以下分类名按 URL 路径推断，不是已验证的官方枚举名。

| imgs 键 | 图片URL路径 | 分类含义推断 |
| --- | --- | --- |
| 2 | uploadpic/softimage | 桌面图/旧背景资源 |
| 3 | v2/singer_portrait | 歌手肖像 |
| 4 | v2/mobile_portrait | 移动端肖像/背景 |
| 5 | uploadpic/mobilehead/{size} | 移动头像 |
| 6 | v2/mobile_super_portrait | 移动端大图资源 |
| 7 | v2/rank_portrait | 排行榜肖像 |
| 8 | v2/banner_portrait | 横幅资源 |

现有图片模块没有 page、pagesize、offset 参数；本次尝试额外 page=2并重新签名，两条图片接口均20006，未验证到可用分页。不要把这种参数失败写成“官方不支持分页”。它们是独立的歌手图片服务，但入口按歌曲hash关联歌手，尚未找到按author_id直接请求且有明确分页的官方歌手主页相册接口。额外使用上游文档另一hash查询时返回了其他author_id，进一步说明必须校验图片所属歌手，不能把任意歌曲图片都混入目标歌手。

## 参考客户端的实际来源

- MoeKoeMusic/src/views/PlaylistDetail.vue：getArtistInfo调用/artist/detail；显示sizable_avatar、song_count、album_count、mv_count、fansnums，单曲调用/artist/audios。未找到累计收听、守护或认证说明的歌手主页请求。
- MoeKoeMusic/src/components/search/ArtistGrid.vue：火焰图标显示搜索Heat，粉丝显示FansNum。因此验证的是歌手搜索热度指标，不是每首歌曲热度。
- MoeKoeMusic/src/components/PlayerControl.vue：loadLyricsCoverImages调用/images?hash=...，extractLyricsCoverImages遍历author[].imgs及album[].imgs作歌词背景轮播；不是歌手主页相册分页实现。我们若使用它必须排除专辑图、其他歌手图。
- EchoMusic/src/renderer/api/artist.ts、views/details/ArtistDetail.vue：详情/artist/detail；单曲实际使用/artist/audios/new，另有专辑/MV分页；utils/mappers/playlist.ts映射粉丝及作品数。未找到目标三项统计或认证说明来源。
- EchoMusic 的 /user/grade 等“累计听歌”属于登录用户的听歌时长，不能用来填歌手累计收听人数；评论中的 biz 认证也不能直接映射到歌手认证。

## 缺失字段结论与候选状态

| 字段 | 已验证来源 | 未验证候选/下一步 | 状态 |
| --- | --- | --- | --- |
| 更多歌手照片 | images/audio的data[][]及imgs2–8，标准版签名返回42个唯一URL；images返回3/4/5 | official主页相册完整性、直接author_id分页入口、分类6上限尚未验证 | 已找到可用图片来源，完整官方相册仍待确认 |
| 歌手热度 | author搜索Heat=24340778，MoeKoeMusic也显示此字段 | 指标统计口径未找到权威解释 | 已验证有数值，不能称累计听众 |
| 单曲热度占比 | 旧单曲playcount为0；新版返回排名标签audio_tag但本次无可用数值热度 | 尚未找到可验证的数值热度端点；榜单排名不是占比 | 仍未找到可用来源 |
| 累计收听人数 | 本轮详情/搜索/新旧单曲/荣誉均未取得 | 在所检模块及参考客户端中未找到明确端点；需要官方歌手页实际只读请求链或其他可追溯源码 | 仍未找到，不能声称官方没有 |
| 认证说明 | 搜索IsReal=1、Identity=1135；新版authors[].identity=1135、sisp=1及base.type=1实际存在 | 身份位掩码/IsReal/sisp含义及对应认证文字尚未验证，未找到独立认证说明端点 | 找到身份标志候选，说明文字仍未找到 |
| n.n万乐迷守护 | 所检响应没有对应计数字段；artist_honour返回作品榜单荣誉 | 尚未找到明确守护统计端点；不能拿FansNum/fansnums或荣誉条数替代 | 仍未找到，不能声称官方没有 |
| 粉丝数 | detail.fansnums、search.FansNum，真实约2575万，随时间变化 | 两接口采样时间/缓存不同可能导致小幅差异 | 已验证 |
| 生日与五类资料 | detail.birthday、long_intro[].title/content | 无需借用其他统计 | 已验证 |

## 网络与验证边界

实际hostname先做DNS及8秒超时HTTPS，无账号凭据：gateway根路径403、openapi根路径502、expendablekmr根路径200、h5activity/singerimg根路径404，TLS均有效，DNS均成功。根路径状态不是业务接口失败；实际业务调用见证据。没有发生可确认的沙箱网络阻断。图片20006是服务端业务码，不是DNS错误。

只调查公开样本，不能排除不同歌手、平台、登录态、客户端版本拥有额外字段。当前未找到的字段明确保持“来源未找到”；未来补充来源必须验证字段语义，不以名字相似直接替换。

源码参考：https://github.com/MakcRe/KuGouMusicApi/blob/main/module/images_audio.js 、https://github.com/MakcRe/KuGouMusicApi/blob/main/module/artist_audios_new.js 、https://github.com/MakcRe/KuGouMusicApi/blob/main/docs/README.md 。main可能变化，本次版本快照为1.6.2。
