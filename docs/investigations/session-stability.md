# 登录稳定性检查（2026-10-05）

## 已验证

- 默认API为kgcheckin内1.3.9，新克隆Node为KuGouMusicApi1.6.2。设置platform=lite后，两者各三轮只读个人歌单和会员请求成功；歌单目录19项，SVIP/TVIP有效，权益截止2026-10-06 11:17:11。会员截止时间不是登录token截止时间。
- 新Node额外只读用户资料成功。独立android参数试验曾得到20017/20018，不应为读取失败随意切换客户端身份。
- 两个Node与Kotlin的个人歌单均为POST gateway.kugou.com/v7/get_all_list，x-router=cloudlist.service.kugou.com；参数userid/token/total_ver=979/type=2/page/pagesize，query plat=1。会员GET kugouvip.kugou.com/v1/get_union_vip，busi_type=concept。KotlinSDK并非独立服务，完整SDK运行本轮未验证。
- 网关与会员主机DNS及8秒限时HTTPS通过（根路径分别403/200，TLS有效）；login.user.kugou.com直连报ERR_TLS_CERT_ALTNAME_INVALID，生产续期通过gateway与x-router发送，未关闭证书校验。
- 构建前后账号存储文件完全一致。构建后使用生产SessionReader查询个人歌单与会员成功，无需扫码且凭据未变。账号位置由worker根路径决定，不依赖二进制构建目录。

## 不能据此推断

早先20017失败之后，账号凭据更新时间发生了变化，因此不能把后来的成功解释为旧token自动恢复，也不能据此认定新Node修复了拒绝。没有已验证的服务端token TTL；存储中的tokenUpdatedAt只是本地保存/轮换时间。最新查询仅证明该凭据在更新约8分钟后有效，三轮连续观察约21秒，不代表已稳定使用几小时。

## 已加固的恢复逻辑

20017先延迟1秒、重载当前账号并进行一次只读复查，再尝试受冷却保护的续期；其他认证拒绝沿用恢复路径。读操作网络错误仍最多重试两次，写操作不自动重试。扫码后不再立即强制轮换新凭据。账号切换不会让旧请求续期另一账号。

新扫码单独保存loggedInAt，成功读取记录lastReadSuccessAt，确认认证拒绝记录lastAuthRejectedAt/Code。续期不改扫码时间。旧账号扫码时间未知，不以tokenUpdatedAt补造。此记录用于长期诊断，不保证服务端不会撤销凭据。

## 可重复的只读对照

先运行无凭据网络检查，再执行下面的诊断；主机检查通过才查询。每轮只读，不调用续期或领取。显式--refresh才会发起一次可能轮换凭据的请求。

```sh
node tools/network-check.mjs
node tools/session-probe.mjs --api=legacy --samples=3 --interval=10
node tools/session-probe.mjs --api=modern --samples=3 --interval=10
```

默认生产版本未切换；modern为诊断候选。样本输出仅含时间、状态、条目数与会员概要；不输出cookie/token/用户资料原始响应。同一凭据观察时长遇到账号/凭据变化会重置。

## 测试

Node完整81项通过，随后新增扫码时间持久化用例，相关账号/会话19项通过；包括临时拒绝不轮换、账号切换、并发轮换合并、拒绝后续期与安全时间记录。Rust源码未改，离线cargo build通过，开发二进制已构建。
