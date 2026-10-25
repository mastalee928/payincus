# 首页世界地图 Demo

## v1.7.5 正式首页

Owner于当前对话明确授权推送和发版本。[v1.7.5](https://github.com/mastalee928/payincus/releases/tag/v1.7.5)已正式发布，源码、双架构预览和正式包证据见HANDOFF.md；本次未更新生产主控。确认的界面已接入原 `PortalView.vue`，正式模式 `preview=false` 不显示本地预览、目录刷新和调试时间；所有站内链接复用当前用户端路径，不固定到演示平台。桌面保留已认可地图，手机默认球体；正式页头与Demo继续共用原项目语言控件。动态开启/暂停按钮已从两处移除，页面自动跟随系统减少动态设置。以下「仅本地、尚未替换正式入口」为此前阶段记录。

## 当前交付（2026-10-26 接手后）

- 直接打开 <http://127.0.0.1:19511/>：手机默认为可旋转矢量球体，桌面为已认可的宽幅矢量地图。<http://127.0.0.1:19511/mobile-globe.html> 仍提供电脑上的手机尺寸预览。旧平面手机方案只在 `?mobile=map` 显式对比入口显示；下面早期「默认手机版为平面」的描述为阶段记录，已由 owner 最新要求取代。
- 首页导航为「产品 / 解决方案 / 控制台」，目标为 `/purchase`、`/help`、`/dashboard`；三语分别有完整文案，purchase 标题仍为「创建实例」。本地 Demo 的帮助和控制台导航转向已有平台对应页面，购买预览沿用现有数字地区参数，预览代理继续只放行公开品牌和目录两项 GET。
- `PublicLanguageSwitch.vue` 从本项目 `PublicSiteHeader.vue` 的原有控件提取，正式页头和 Demo 使用同一份组件、同一 `setLocale` 及本地保存逻辑。完整语言名称、当前勾选、点击外部关闭、Esc 关闭及焦点恢复保留；手机热区至少44px。没有另造原生下拉框。标题、大洲、状态、地区名与球体反馈一起切换；管理员配置的品牌原文保留。
- 实际 Chrome 检查覆盖三语导航/标题/语言持久化、菜单关闭及焦点、默认球体的320/390px首卡、44px标签、真实地区3进入purchase；另复验拖转、双指缩放、候选高亮、防误触、650ms定位、内部滚动及显式平面回退。结果在 `logs/home-map-demo-20261026/navigation-browser-result.json` 和 `default-globe-browser-result.json`。
- 修改前的可恢复源码及可运行包在 `logs/home-map-demo-20261026/before-navigation-2026-10-25T19-23-23-599Z/{source,dist}`。原正式页头另外保存在 `before-shared-language/source/`，手机标签收紧前另存 `before-navigation-2026-10-25T19-39-21-514Z/source/`；各份清单含源文件 SHA256。回退只针对本次改动，不能覆盖无关工作区内容。
- 本地检查、正式合入和生产证据继续分别记录。当前源码没有替换正式首页，也没有发布或OTA。
- 最终验证：client type-check、前端路由/i18n守卫、修改文件ESLint、用户/管理双端构建、独立Demo构建和双端dist边界守卫均通过。相关本地证据留在 `logs/home-map-demo-20261026/`；守卫最终清单见 `logs/test-run-20261026-033935/`。

### 最终看图记录

ROUND 2

Seen in one second: 桌面宽幅世界地图，手机大球体与首张地区卡。

Idea (one sentence): 以全球节点表达品牌，让手机用球体选择地区，配置交给purchase。

Live thing: 真实目录库存、节点/候选/卡片联动、旋转缩放和原地区选购入口。

Layout words by section: header=原项目三语控件与三个导航 / hero=两行标题 / map=桌面宽幅与手机球体 / footer=紧凑品牌与联系。

Scores: design 7.7 · usability 8.2 · creativity 7.2 · content 7.8 → overall 7.8（内部看图判断，非外部评分）。

Caps applied: owner 指定原地图、青色微光、玻璃浮窗、留白和原项目控件；保留这些明确设计要求。最终检查1440/768/390为0 FAIL/0 WARN，所有截图已看。

Top three problems (most visible first), each with the screenshot it shows in and the fix:

1. 原手机号只进入参数试稿才有球体；现在默认首页手机即显示球体，桌面保持原图（nav-after/mobile-fold.jpg）。
2. 新原生语言下拉不符合复用项目控件要求；已提取并共享原项目菜单，完整名称和勾选保留（navigation-menu-desktop.jpg）。
3. 320px英文大洲文字换行挤压首卡；标签使用44px热区及紧凑行高，首卡完整可见（navigation-globe-320-en.jpg）。

## 手机球体独立试稿（2026-10-26）

- 电脑直接查看手机尺寸：<http://127.0.0.1:19511/mobile-globe.html>；直接页面：<http://127.0.0.1:19511/?mobile=globe>。默认首页仍为已有平面矢量地图，桌面始终保留原宽幅图。
- `MobileRegionGlobe.vue`采用SVG矢量路径与circle点位，D3 Geo正交球面投影根据同一经纬度绘制海岸线/节点。背面点位不显示；球体容器为46svh、310–430px，拖动改变朝向、双指改变比例，大洲/卡片选择自动转向。地理数据沿用同一Natural Earth 110m与GeoNames来源，不用生成图片假画节点。
- 海岸线精简GeoJSON 248902字节，仅试稿加载；球体独立异步组件，首次构建约13KB gzip JS，包含D3 Geo。图库及GeographicLib授权完整写入THIRD_PARTY_NOTICES；旧「没有运行时地图库」仅指先前平面版。
- 44px点位热区按屏幕矩阵调整，密集区打开候选列表，确认要求在行上另一次按下，避免触摸结束产生的兼容点击误选。地区代码隐藏，真实状态及轻量选购入口与原地区数字ID对应。
- 前一版备份见`logs/home-map-demo-20261026/before-globe-2026-10-25T18-13-53-618Z/`；有源码及依赖清单/lockfile哈希。只移除试稿URL参数即可查看旧手机版，桌面不启用球体分支。正式合入前仍须owner选择最终版本。
- 精修后的标签为两行全部显示，无更多菜单或手势说明。候选Hover/按住会圈亮对应点位，确认后按最短经度方向650ms平滑定位、微放大约8%，同步地区卡片。候选列表max-height132px，标题和关闭按钮在滚动区外；保留二次按下确认，防止兼容点击误选。
- 首页导航与purchase标题统一「创建实例」（繁体「建立實例」、英文「Create Instance」），仅改界面文案。调整前另存`before-labels-2026-10-25T18-40-26-822Z/`源码回退点；当前没有发布或更新生产。
- 最新Chrome回归共11项：拖动、双指、全大洲标签、近处候选防误触、Hover/按住圈亮、固定标题内部滚动、候选确认旋转与微放大、地区跳转、320px首卡、默认版/桌面保持以及电脑手机框。Root前端路由/i18n守卫、修改文件类型检查与ESLint、双端构建及独立试稿构建通过，数据来源及许可证保留。

Owner 2026-10-25 提供世界地图素材、暗色效果图与五章施工规范，2026-10-26 确认同城市多个 region 可在显示层轻微错开。此阶段交付本地 Chrome 动态 Demo；正式首页路由没有替换，不直接部署生产。

从仓库根运行 `node scripts/start-homepage-demo.mjs`，用 Chrome 打开 <http://127.0.0.1:19511/>。关闭终端会关闭预览；再次运行可恢复。`HOMEPAGE_DEMO_PUBLIC_ORIGIN` 可设置为其它平台的公开源，默认只读当前 owner 平台公开接口。

## 一、图层与样式

底图 / 节点 / 浮窗按 1 / 10 / 20 分层，顶栏固定。暗色画面、大标题、青色微光、细边框遵照效果图；本页不采用 Skill 的粗框方向。玻璃浮窗遵照 rgba(13,19,32,.85)、blur(12px)、青色30%边框、8px圆角、12px/16px内边距。节点呼吸1.5秒、opacity .2→1；减少动态时保持内容、关闭动画。

## 二、电脑交互

悬停显示地区名称、区域代码、真实可售状态和月价；鼠标可移入浮窗操作。节点选择同步列表，列表选择同步地图；选中节点显示光圈。六个大洲标签变暗其它节点并平滑聚焦，全部标签重置地图。支持搜索、只看可售、显示更多、空状态和读取失败重试。

先前控制中枢版本保留在源码的默认catalog展示模式以及回退备份内。最新owner确认：首页留白为主，实际配置选择去`/purchase`；上方地球已认可，不改变它的底图、坐标、尺寸、原有样式与动画。

当前Demo使用`presentation="minimal"`，隐藏完整配置表、搜索/库存过滤和三步说明。大洲标签、缩放、悬停与节点选择保留；选中后仅出现地区、状态与选购入口，携带真实数字地区编号进入原purchase页面，不预选SKU。下方用留白及品牌/帮助/管理员配置的联系信息收尾，保留地图来源署名。

## 三、手机交互

240px地图，不显示地区标签或玻璃浮窗；支持双指捏合、拖动、双击及按钮缩放。命中半径按屏幕22px计算。留白版没有配置卡片长列表；触摸节点后在地图下方出现一条紧凑的地区与选购入口，不自动滚动到旧表格。地图平移有边界，缩放为1–4倍。

## 四、地理与数据

- 地区目录复用 `buildPoolPurchaseRegions` 的45条地理目录并保留自定义条目；所有价格、配置、商品ID、分组ID和空闲台数来自真实 `/api/host-pools/public/catalog`，不创建商品、不推算库存。
- 名称、说明、Logo 用 `useBrand` 与现有公开配置。取消所有延迟展示。可售青色，售罄/未上架灰色；选中光圈代表选择，不代表售卖状态。
- SVG与点位采用同一份 Natural Earth 原始投影、北向旋转12度和统一的0.72纵向透视压缩，映射到1440×500。未使用示意百分比；城市坐标来自GeoNames，不宣称数据中心精确位置。
- 马德里、新加坡的同城region共用原城市坐标，仅显示位置有小幅偏移。第二个马德里地区的代码为Oracle公开文档的`eu-madrid-3`，平台历史条目名为Spain Central 2；仅Demo展示层校正名字/代码，原目录分组/商品绑定没有修改。古来代码为`ap-kulai-2`，地区名显示西部2。
- URL使用地区代码，支持us-east/us-west/frankfurt别名和原numeric分组ID。选购仍传原`/purchase?region=<numeric-id>&product=<numeric-id>`，不把OCI代码误传给原接口。
- 未提供坐标的自定义地区仍在列表中显示，不把它定位在随意城市。

## 五、性能、来源与边界

- 真实海岸线生成本地SVG，不在浏览器加载D3、WebGL引擎、GeoNames全量数据或外部地图服务。国旗复用项目FlagIcon/flag-icons矢量资源。
- Demo独立入口放在`client/demo/homepage/`；正式代码可复用`HomeRegionAtlas.vue`与`homeRegionAtlas.ts`。原正式首页、购买、鉴权、支付、库存和交付接口不变。
- 本地代理仅放行两项公开GET，拒绝其它API及写请求。Demo的登录/帮助链接为当前平台已有公开页面；它没有配置保存、下单或付款接口。
- 海岸线：[Natural Earth 1:110m admin-0](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_admin_0_countries.geojson)，[Public Domain](https://www.naturalearthdata.com/about/terms-of-use/)。
- 城市坐标：[GeoNames cities500与RS导出](https://download.geonames.org/export/dump/)，[CC BY 4.0](https://www.geonames.org/about.html)；同名城市按国家/行政区域核对（Ashburn VA、San Jose CA、Frankfurt am Main等）。
- 区域代码：[Oracle Regions and Availability Domains](https://docs.oracle.com/en-us/iaas/Content/General/Concepts/regions.htm)。投影生成工具：[D3 7.9.0](https://github.com/d3/d3/blob/v7.9.0/LICENSE)（ISC）。
- 本地通过、正式版合入与生产部署分开记录。最终验收结果补充在本页后部；不以Demo声明正式发版完成。

## 留白版的回退与保护

- 原作品源码与独立可运行构建包：`logs/home-map-demo-20261026/before-minimal-2026-10-25T17-01-33-815Z/`，包含`source/`、`dist/`与逐文件SHA256的`manifest.json`。
- 地球SVG、地理数据及两个组件原有第一段scoped CSS均与备份哈希一致；结果在`logs/home-map-demo-20261026/globe-preservation.json`。
- 仅在owner要求回滚时恢复本轮改变的两个SFC及展示层辅助函数，保留其它工作区改动与后续owner要求。回退脚本先验证当前文件是否仍为本次版本，发现后续变化时停止，避免覆盖新的工作。
- 上述备份目录内`recover-home-demo.mjs`默认只检查；owner明确要求回滚后才用`--restore`。脚本校验目录边界、源备份SHA256和当前版本，并另存被覆盖的新版本。不会执行git reset、清理文件或覆盖owner要求。
- Chrome本地交互覆盖地区深链、真实purchase地区跳转、未上架保护、手机触摸、原按钮/双指缩放、暂停及读失败重试。1440/768/390截图已检查；检查器一个off-centre提醒来自全幅地图控件，页脚实际两边均160px，保留owner认可地图布局。
- Demo独立构建沿用现有全局样式与三语资源，仍有现有体积提示；本轮没有添加运行时地图库或发布正式首页。

### 留白版看图记录

ROUND 1

Seen in one second: 原有宽幅地球与主标题。

Idea (one sentence): 首页表达全球节点与品牌，完整资源挑选交给purchase。

Live thing: 真实库存点位、地区选择、缩放与地区选购入口。

Layout words by section: hero=左对齐标题 / map=原有全幅地球 / footer=留白后简洁双行。

Scores: design 7.7 · usability 8.0 · creativity 7.2 · content 7.8 → overall 7.7（内部看图判断，非外部评分）。

Caps applied: Owner明确指定地图、细边框、微光和留白，摄影数量/禁渐变等冲突要求按owner设计覆盖；不为评分添加装饰或修改认可的地球。

Top three findings:

1. 原配置长表和说明占用大量下方空间，已通过minimal模式关闭；对应修改前版本保留完整备份。
2. 删除列表后原「查看配置」会失去目标，已改为数字地区进入现有purchase；手机选中后只显示紧凑选择条。
3. Inspector的off-centre来自全幅地图/控件；主标题左160px、页脚左右160px已核对，保留原地球尺寸与布局。
