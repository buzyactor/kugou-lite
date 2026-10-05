# 登录接口目录与 KuGouMusicApi 单一登录链路试验

2026-10-05，工作区 `/home/wolf/Kugou Lite`。按当前克隆的源码核查，排除 node_modules、vendor 重复实现和编译产物；源码存在不等于线上可用，也不代表能延长凭证寿命。不记录手机号、账号ID、cookie、token、二维码key、设备值或第三方平台密钥。

## 当前实际采用的链路

- 唯一认证实现：`KuGouMusicApi/`，package版本 **1.6.2**，概念版 `platform=lite`。扫码申请/检查、设备注册、token续期均来自该项目的原生module；失败不会调用kgcheckin或本项目自写refreshLite。
- `src/direct-api.mjs`中的AUTH_ROUTES固定选择modern；普通曲库请求仍按原legacy默认运行，`api=legacy|modern`只影响普通业务接口，**不能切回旧认证接口**。本轮没有混用多个登录策略，也没有并行申请多种凭证。
- `tools/tui-worker.mjs`和`tools/login.mjs`使用相同的原生扫码链路和持久设备标识。`tools/start-api.mjs`也改为启动新库，旧库仍保留在磁盘供后续明确选择测试。
- `/login/token`使用新库原生v5加密/解密，仅把传输地址转为原有HTTPS网关 `https://gateway.kugou.com/v5/login_by_token`，`x-router: login.user.kugou.com`；不直接请求上游源码中的HTTP登录地址，不关闭TLS验证。
- 保留新库返回的t1，支持安全的Base64字符，不因`+ / =`而丢掉；保存/转换cookie/续期使用一致校验，拒绝分号、换行等注入。稳定GUID/MID/DEV/MAC与dfid继续持久化。新账号记录loginProvider=`KuGouMusicApi@1.6.2`。
- 会话原有策略保留：6小时主动维护、认证拒绝后同凭据复查再单次续期、5分钟失败冷却、并发续期合并。**6小时不是服务端有效期**，没有依据把维护间隔调短并宣称已解决掉线。
- `src/token-refresh.mjs`目前只被离线参考测试使用，不是生产续期分支。它仍列入候选，避免下一轮误以为已删掉其实现。

## 当前目录有哪些实现

| 项目 | 登录相关实现与数量 | 当前状态 |
| --- | --- | --- |
| KuGouMusicApi 1.6.2 | 15个login*.js模块，下面完整列出；另6个设备/验证码/风控辅助模块 | 本轮唯一认证提供方；只实测匿名设备注册、申请/生成/检查酷狗QR |
| kgcheckin/api 1.3.9 | 9个login*.js模块，另captcha_sent/register_dev两个辅助模块 | 旧认证停用，磁盘源码保留；普通业务接口仍使用 |
| KuGouApi_Kotlin_SDK 1.0.5 | AuthApi.kt：19个suspend方法及1个本地QR URL方法 | 多数对齐新Node库；候选，完整SDK运行未验收 |
| voicefox | `source/src/kg/login.rs`原生酷狗QR create/check，设备本地生成 | 独立Rust实现，同官方二维码端点；候选，没有在本轮运行 |
| MoeKoeMusic | `src/views/Login.vue`：酷狗QR、手机验证码 | API客户端调用，不是独立的新官方登录端点 |
| EchoMusic | `src/renderer/api/user.ts`：酷狗QR、QQ QR、验证码、密码、微信/openplat、设备管理 | API客户端包装，下表可对应；本轮未运行 |
| kugou-tui | `src/api/cloud.rs`：login_qr_key/create/check | 调用本地Node API，不是第三套官方酷狗认证协议 |
| 本项目 | `src/login.ts`解析/二维码页面、`src/device.mjs`设备存储、`src/session-reader.mjs`恢复/持久化、`tools/login.mjs`/worker入口 | 现在只使用新Node认证，解析层不自行生成另一种登录凭证 |
| go-musicfox、voicefox其他音源、kugou-tui其他音源 | 网易、QQ音乐、汽水登录，见最后一节 | 不适用于酷狗账号；不计入酷狗API数量 |
| kotonoha | 播放状态/歌词/MPRIS与适配器 | 没有酷狗账号登录API，不参与认证 |

**数量口径**：新Node15、旧Node9是模块数，包含本地二维码生成、续期和设备管理，不能称为24种互不相同的登录方式。实际取得酷狗身份的主要路径为酷狗APP扫码、手机验证码、用户名密码、微信开放平台、QQ开放平台；token登录用于已有凭据恢复，扫码授权用于已有账号授权另一台设备。

## KuGouMusicApi：15个登录模块完整表

模块均位于`KuGouMusicApi/module/`。路由按文件名转换，真实目的地址按源码；未指定baseURL的普通请求默认`https://gateway.kugou.com`。表中第三方交换步骤只列公共端点，不列内置secret或具体会话值。

| 模块 / 对外路由 | 真实地址与方法 | 主要入参 / 用途 | 本轮验证 |
| --- | --- | --- | --- |
| login_qr_key.js /login/qr/key | GET https://login-user.kugou.com/v2/qrcode | 可选type=web；appid默认1001，web为1014，plat=4/type=1/srcappid/qrcode_txt。qrcode_txt使用当前lite appid，默认参数/签名由util注入 | 成功取得key，未输出key |
| login_qr_create.js /login/qr/create | 本地生成，无HTTP请求 | key、qrimg；输出酷狗H5二维码URL和PNG Base64；URL为https://h5.kugou.com/apps/loginQRCode/html/index.html?qrcode=KEY | PNG生成成功 |
| login_qr_check.js /login/qr/check | GET https://login-user.kugou.com/v2/get_userinfo_qrcode | key→qrcode、plat=4、当前appid/srcappid、cookie.KUGOU_API_DEV；状态0过期/1等待/2待确认/4成功，成功可有userid/token/vip_token/dfid/t1 | 真实返回waiting；用户确认登录尚未测试 |
| login_qr_authorize.js /login/qr/authorize | POST https://login-user.kugou.com/v2/scan，然后POST /v2/authorize | 已登录cookie token/userid、qrcode、可选appid；appid必须匹配授权账号平台 | 候选，未运行；这是授权写入，不是只读检查 |
| login.js /login | POST https://gateway.kugou.com/v9/login_by_pwd，x-router=login.user.kugou.com | username/password，可选code，设备DEV；AES+RSA封装，成功解开secu_params | 候选，未运行 |
| login_cellphone.js /login/cellphone | POST https://loginserviceretry.kugou.com/v7/login_by_verifycode | mobile/code，可选userid、设备cookie；lite含t1/t2/dfid/dev | 候选，未发短信/未登录 |
| login_token.js /login/token | 上游POST http://login.user.kugou.com/v5/login_by_token；本项目POST HTTPS gateway同path+x-router | token/userid，dfid、t1、GUID/MAC/DEV；新版原生v5，返回secu_params解出新token/t1 | 原生module及HTTPS路由通过离线行为测试；无新账号，未做真实续期 |
| login_wx_create.js /login/wx/create | GET api.weixin.qq.com/cgi-bin/token、/cgi-bin/ticket/getticket；GET open.weixin.qq.com/connect/sdk/qrconnect | 上游微信appid/secret、随机nonce、签名；结果含uuid/二维码 | 候选，未运行 |
| login_wx_check.js /login/wx/check | GET https://long.open.weixin.qq.com/connect/l/qrconnect | uuid，查询微信扫码确认/授权code | 候选，未运行 |
| login_openplat.js /login/openplat | 微信api.weixin.qq.com/sns/oauth2/access_token交换code；POST gateway/v6/login_by_openplat，x-router=login.user.kugou.com | code→openid/access_token，partnerid=36；lite设备/t1/t2，force_login=1 | 候选，未运行；可能改变已有会话 |
| login_qq_qr_create.js /login/qq/qr/create | GET https://openmobile.qq.com/oauth2.0/m_authorize、QQ xlogin跳转、https://xui.ptlogin2.qq.com/ssl/ptqrshow | 取得QQ QR及qrsig/ptqrtoken/pt_login_sig/pt_openlogin_data/xlogin_url/cookie | 候选，未运行 |
| login_qq_qr_check.js /login/qq/qr/check | GET https://xui.ptlogin2.qq.com/ssl/ptqrlogin，按回调跳转取得openid/access_token；POST gateway/v6/login_by_openplat | 上一步完整QQ会话字段；partnerid=1，third_appid按lite选择 | 候选，未运行 |
| login_qq.js /login/qq | POST gateway/v6/login_by_openplat，x-router=login.user.kugou.com | 已取得openid/access_token、第三方appid、partnerid=1、设备字段 | 候选，未运行 |
| login_device.js /login/device | POST https://userinfoservice.kugou.com/v2/get_dev | userid/token RSA/AES封装；查询登录设备 | 候选，未读取用户设备 |
| login_device_kick.js /login/device/kick | GET https://gateway.kugou.com/loginservice/v1/dev_logout | 自身userid/token（RSA无填充处理）、t_mid/t/t_appid/t_clientver等目标设备字段 | 候选，未运行；踢设备为改变会话的操作 |

### 新库6个认证辅助模块

| 模块 | 真实目的 | 用途 |
| --- | --- | --- |
| register_dev.js | POST https://userservice.kugou.com/risk/v2/r_register_dev | 设备指纹注册，成功返回dfid；匿名临时设备真实验证成功。最初两次完整准备未完成，随后成功，不能宣称此接口始终稳定 |
| captcha_sent.js | POST http://login.user.kugou.com/v7/send_mobile_code | mobile/businessid=5/plat=3，发短信，未运行 |
| get_verify_info.js | POST gateway/verifyservice/v3/get_verify_info | eventid/userid/platid等，取得风控验证信息，未运行 |
| verify_user_info.js | POST https://verifyservice.kugou.com/v4/verify_user_info | eventid/v_type/verifycode/sid/edt，提交风控，未运行 |
| sidedt.js | 本地generateSimulate后调用verify_user_info.js | 行为数据生成并提交；不是独立登录方式，未运行 |
| user_verify.js | GET http://trackercdngz.kugou.com/v1/user_verify | 本地库的风控检查；未运行 |

## kgcheckin/api：9个旧模块完整表

路径`kgcheckin/api/module/`；**本轮生产认证不再加载这些模块**，源码留作后续对照。

| 模块 | 真实目的 / 与新库差异 |
| --- | --- |
| login_qr_key.js | GET login-user.kugou.com/v2/qrcode，同一类QR入口 |
| login_qr_create.js | 本地酷狗H5 QR URL/PNG，不是HTTP登录 |
| login_qr_check.js | GET login-user.kugou.com/v2/get_userinfo_qrcode，同一类QR轮询 |
| login.js | POST gateway/v9/login_by_pwd，路由login.user.kugou.com |
| login_cellphone.js | POST gateway/v6/login_by_verifycode（lite）或/v7（标准）；lite p2 RSA封装，旧t1/t2=0；新库固定loginserviceretry/v7与设备t1/t2 |
| login_token.js | POST http://login.user.kugou.com/v4/login_by_token（lite）或/v5（标准），t1/t2=0；新库lite为v5且t1/t2真实加密 |
| login_wx_create.js | 微信token/ticket/SDK QR，与新库同类链路 |
| login_wx_check.js | long.open.weixin.qq.com/connect/l/qrconnect |
| login_openplat.js | 微信OAuth交换，再POST gateway/v6/login_by_openplat |

辅助：`captcha_sent.js` → login.user.kugou.com/v7/send_mobile_code；`register_dev.js` → userservice.kugou.com/risk/v1/r_register_dev（新库为v2）。kgcheckin根`phoneLogin.js`/`qrcodeLogin.js`只是这些模块的用户入口，不算新增官方协议。

## Kotlin AuthApi 全部19个挂起方法与本地方法

实际文件：`KuGouApi_Kotlin_SDK/shared/src/commonMain/kotlin/top/ghhccghk/multiplatform/kugouapi/api/AuthApi.kt`。不是TUI生产链路；不要把源码对齐写成SDK运行成功。

| 方法 | 对应地址 / 职责 |
| --- | --- |
| registerDev | userservice.kugou.com/risk/v2/r_register_dev |
| sendCaptcha | login.user.kugou.com/v7/send_mobile_code |
| loginByPassword | gateway/v9/login_by_pwd |
| loginByPhoneCode | loginserviceretry.kugou.com/v7/login_by_verifycode |
| loginByToken | login.user.kugou.com/v5/login_by_token |
| createQrKey | login-user.kugou.com/v2/qrcode |
| createQrCodeUrl（本地非suspend） | 生成酷狗H5 QR URL |
| checkQrCode | login-user.kugou.com/v2/get_userinfo_qrcode |
| getLoginDevices | userinfoservice.kugou.com/v2/get_dev |
| kickDevice | gateway/loginservice/v1/dev_logout |
| createWxLogin | 微信token/ticket/SDK QR |
| checkWxLogin | long.open.weixin.qq.com/connect/l/qrconnect |
| loginByOpenPlat | 微信access_token交换，gateway/v6/login_by_openplat |
| getVerifyInfo | gateway/verifyservice/v3/get_verify_info |
| verifyUserInfo | verifyservice.kugou.com/v4/verify_user_info |
| generateSidEdt | 生成行为数据并提交验证 |
| userVerify | trackercdngz.kugou.com/v1/user_verify |
| createQqQrCode | openmobile.qq.com/m_authorize、xui.ptlogin2.qq.com/ptqrshow |
| checkQqQrCode | xui.ptlogin2.qq.com/ptqrlogin、回调交换 |
| loginByQq | gateway/v6/login_by_openplat |

QQ相关源码当前可见若干构造URL/字段为空的实现，需要后续专门检查后再运行；本轮没有为测试SDK升级依赖、修改其架构或编译它。

## 本轮清理与真实验证

- 已实际清理Kugou Lite本机账号数据：`.local/accounts.json`、`device.json`、会员baseline/latest、`covers/`和`kotonoha.log`。旧account.json当时不存在；清理工具还覆盖旧account.json、账号/设备的临时文件/备份、登录HTML、playback-latest、轮换日志，避免下一次迁移旧凭据。重建600权限空账号存储，active=null、accounts=[]；不保留旧凭据备份。
- 保留界面/主题配置、`.local/ui.json`及API依赖；未操作手机上的酷狗账号或强制退出其他设备；未删除参考仓库的用户文件。
- `node tools/clear-accounts.mjs`可复用此显式清理。执行前关闭播放器窗口，避免旧进程仍在进行已发起的扫码/请求；工具使用账号目录锁，不读取待删除凭据内容。
- 无凭据DNS/限时HTTPS：login-user.kugou.com及gateway.kugou.com正常，根路径403但TLS通过；userservice.kugou.com正常、HTTP200、TLS通过。没有确认到环境网络限制。
- `node tools/auth-probe.mjs`在临时目录生成匿名设备与QR：真实设备注册成功、二维码申请/生成成功、check=waiting；旧账号完全未读取，临时目录随后删除，没有输出或保存key/token。
- 97项Node测试通过，包括原生新库认证/无旧库fallback、t1保留、破损旧账号完整清理及既有会话/播放器回归；真实TUI模拟worker设置/账号导航回归通过。Rust源码未改，已执行离线build，二进制准备好。
- **尚未验证用户扫码成功、新token真实续期以及1–2小时后的有效性。** 匿名waiting只能证明入口可用，不证明登录保持改善。

## 后续保持时间测试

打开已编译的`/home/wolf/Kugou Lite/tui/target/debug/kugou-lite`，按L重新扫码。成功后按P/V查看个人歌单和会员；无需另开API进程，不要同时启动其他登录/续期试验。

开发者可做只读时间采样（不运行--refresh，以避免人为旋转影响结果）：

```sh
node tools/network-check.mjs gateway.kugou.com kugouvip.kugou.com
node tools/session-probe.mjs --api=legacy --samples=25 --interval=300
```

这里legacy表示沿用生产业务API，登录提供方仍是新KuGouMusicApi。采样打印时间、同凭据年龄及安全业务码，不打印账号ID/token；可每5分钟检查约2小时。同时运行播放器若自然触发续期，要记录tokenUpdatedAt变化，不能把续期后的凭据当成初始token保持成功。当前serverTokenExpiry仍unknown，不承诺长期有效。

## 目录中的其他平台登录（不可作为酷狗替代）

| 项目 / 文件 | 登录入口 |
| --- | --- |
| go-musicfox/vendor/github.com/go-musicfox/netease-music/service/login_qr_service.go | 网易POST music.163.com/weapi/login/qrcode/unikey及/weapi/login/qrcode/client/login |
| 同目录login_cellphone_service.go | 网易POST music.163.com/weapi/login/cellphone，支持密码/验证码 |
| 同目录login_email_service.go | 网易POST music.163.com/api/login，邮箱/密码 |
| 同目录login_refresh_service.go | 网易music.163.com/weapi/login/token/refresh |
| go-musicfox/internal/ui/login_webview_* | 网易原生WebView打开music.163.com/#/login并读取MUSIC_U，不是酷狗API |
| voicefox/source/src/wy/login.rs | 网易/api/login/qrcode/unikey及/api/login/qrcode/client/login，候选host interface.music.163.com/interface3.music.163.com/music.163.com |
| voicefox/source/src/tx/login.rs | QQ音乐：xui.ptlogin2.qq.com/cgi-bin/xlogin、/ssl/ptqrshow、/ssl/ptqrlogin，graph.qq.com/oauth2.0/login_jump；与酷狗QQ开放平台后的账号归属不同 |
| kugou-tui/src/source/netease.rs | 网易Node API的/login/qr/key/create/check；保存服务端MUSIC_U cookie，不是酷狗token |
| kugou-tui/crates/libresoda/src/soda/qr_login.rs | 汽水/passport/web/get_qrcode/及相关状态/回调；另支持手填cookie。需其CDP签名链路，不适用于酷狗 |

这里只列目录中与登录有关的入口；没有为了枚举候选批量申请短信、微信/QQ令牌、授权设备或触发风控验证。
