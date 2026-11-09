# v1.8.5 验证记录

本版修复更新下载暂时失败、首页底部地区卡偏移和手机菜单遮挡。已完成同来源CI、双架构首装及六公开资产核验；生产部署仍需独立确认。

## 改动与验证范围

- OTA：对408/429/500/502/503/504、断流及超时最多三次尝试，普通下载失败后使用同Release资产ID生成的GitHub官方API。元数据校验名称、URL、大小与digest；仅允许官方HTTPS，token不发给CDN，私有临时文件经大小/SHA256核验后就位。401/403/404、部分响应与完整性错误不盲重试，不进入安装。
- 首页：底部地区卡两侧等宽居中，按地图实际宽度处理短桌面窗口避让；手机打开语言菜单时关闭导航。正式组件与固定目录demo共用源码。
- 本机下载器真实HTTP断流、请求头/正文停滞、凭据边界、重定向及完整性测试通过。首页三轮含684布局状态、253选中卡状态、45地区三语文字135状态、真实Chrome触摸/键盘和实际App首页/购买导航；双端构建和相关守卫通过。
- 地理位置、原地区ID/库存购买、支付/权限与网关协议保持。本版没有新增迁移（累计241），Agent保持v1.0.5。

## 正式发行证据

- 正式源码：`e7faf22a03f920532ee0a35466f06597921767bb`；tree：`64aa7d4a309be4d266fab92a3a499a993ea8026d`。
- 候选PR实际checkout：`b6d0b062c5a6dd71f306ac709841c8d10a5d2611`，独立核tree相同；[PR #7](https://github.com/mastalee928/payincus/pull/7)合入main的提交与正式源码一致。
- 注释稳定tag对象：`4bf4a6644c1451d15eebbe745c5b20b469c87dba`，解引用到上述源码；后续文档提交不移动tag。
- [v1.8.5 Release](https://github.com/mastalee928/payincus/releases/tag/v1.8.5)公开时间：`2026-11-09T11:27:19Z`，非draft、非prerelease，latest=v1.8.5，说明已回读一致。

| 工作流 | 事件 | 运行 | 结果 |
|---|---|---|---|
| Alpine SSH security | pull_request | [42577102536](https://github.com/mastalee928/payincus/actions/runs/42577102536) | success |
| CI | pull_request | [42577102595](https://github.com/mastalee928/payincus/actions/runs/42577102595) | success |
| Build & Release | workflow_dispatch | [42577106537](https://github.com/mastalee928/payincus/actions/runs/42577106537) | success |
| CI | push | [42590910672](https://github.com/mastalee928/payincus/actions/runs/42590910672) | success |
| Build & Release | push | [42607390425](https://github.com/mastalee928/payincus/actions/runs/42607390425) | success |

候选与main CI各十job全部终态成功并逐job核实际checkout。Alpine关联运行九job成功，原密码/持续SSH与SFTP及双架构维护专项通过。预览四必需job成功、发布步骤skipped；正式五job全部成功。213守卫、241迁移、AMD64/ARM64原生首装、唯一后台、双前端、公开Agent、完整备份/预检/恢复/改变后回退续接、SQL ZIP完整性及旧CRLF历史/错误来源拒绝均核实际日志。下载器504官方API备用、断流/超时、凭据和元数据回归出现在实际构建日志；选中地区卡20尺寸与触摸/键盘回归出现在候选/main CI。

## 公开安装包实测

六资产实际下载并核API digest、大小与SHA256；双OTA清单字节一致，架构/URL/大小/hash与tar一致。包内1.8.5、241迁移、LICENSE、root归属、安全路径和原生依赖架构均核验。

两架构包均包含已编译`system-update-download.js`、`system-version.js`、`run-system-update-task.js`修复；用户端编译资源包含地图容器查询/居中避让和菜单捕获处理。每包双架构网关组件的20文件、权限/ELF、完整sourceCommit与Ed25519签名独立验证，公钥沿用此前受信发行基线，未从新包学习信任。

| 公开资产 | 字节 | SHA256 |
|---|---:|---|
| `incudal-v1.8.5-linux-amd64.tar.gz` | 214360463 | `61e9b9c004dee900dafaa3f12a95caa7306afd53bb4be60968c6f4649448debf` |
| `incudal-v1.8.5-linux-amd64.tar.gz.sha256` | 100 | `107158a27e255bfe345474336f672f99c5611ee37e45e4c14ac61dbb83a4fa18` |
| `incudal-v1.8.5-linux-arm64.tar.gz` | 213610245 | `d50b8a2e5f9d89abf74b206c75cf6d10acbe5d18875f0db621df4829ddcb7dfb` |
| `incudal-v1.8.5-linux-arm64.tar.gz.sha256` | 100 | `6d7de3d90305fe7a7d2cafa3ec20ac87815bc079f574056c1af09040feb4afe3` |
| `incudal-v1.8.5-ota-manifest.json` | 999 | `e74059068285833efb7036f11d12288b6f80b11dc9c7906631b06126184b4d2f` |
| `ota-manifest.json` | 999 | `e74059068285833efb7036f11d12288b6f80b11dc9c7906631b06126184b4d2f` |

Agent v1.0.5保留原源码`2c3201122bfface31b7c20e6497437b5814ce699` / tree `512e37424d51cf66fab1a7ade5c3ca2323fd94de`；原tag及三资产digest、字节数和更新时间与原实际下载基线完全一致，本轮没有重新发布Agent。v1.8.4稳定tag与源码保持。

## 证据边界

Chrome为本机浏览器设备模拟、库存为固定替身，未验真实iOS/Android/Safari。GitHub首装中的OSS传输为本地替身，无原客户宿主，不能代替真实OSS全新B灾备、独立备用、客户公网或千台/72小时验收。本次发行不代生产OTA；生产当前版本须从实际目标读取。

新版下载器随安装包交付，安装后用于后续更新；旧版本首次下载本包仍由当前已安装下载器执行。网页检查见[升级与检查](release-v1.8.5-owner-click-test.md)。
