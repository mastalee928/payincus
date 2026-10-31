# 首页地图复查与亮色主题

范围：按 owner 要求精查现有首页地图，修复后新增亮色；保留已确认的世界底图、手机球体、微光风格和实际地区购买绑定。随后要求隐藏地图来源，已将首页署名注释保存在代码中。暂不发版。

## 修复结果

| 问题 | 处理与证据 |
| --- | --- |
| 1600px 断点地图突然缩小 | 720px 高时，原 1599→1600px 的地图宽度从 1500 跌至 1036.8px。桌面统一使用按窗口高度和宽度计算的尺寸，修后相邻宽度均为 1036.8px；保留 1440:500 比例和 2160px 上限，适配 21:9、32:9。 |
| 密集城市节点难对应 | 首尔/春川真实点相邻，名称避让后缺少对应关系。增加连接原点的细引线，并允许直接点击城市名称；两者仍分别进入真实地区 7/8，未移动地理坐标。 |
| 筛选无库存大洲后没有名称 | 筛选时按空间显示该洲城市名。默认全球视图仍优先显示所有可售地区名称，非写死某几城；悬停、选中和放大保留既有优先级及避让。 |
| 手机减少动态模式不出选择提示 | animateTo 的即时定位分支提前返回，漏掉正常动画结束时打开反馈。补齐即时分支，本地复现失败与修后两种动效模式通过均留存。 |
| 首页只有暗色 | 增加太阳/月亮按钮及首页独立主题存储；首次默认暗色，亮色选择刷新后保留，存储不可用仍可切换。覆盖地图、手机球体、选购提示、售罄状态、导航与页脚，其他页面主题不变。 |
| 辅助文字过小 | 品牌副标题、页脚、图例统计及手机筛选/滑动说明调至 13px；亮色补齐页脚悬停与焦点颜色。地图来源按 owner 最新要求隐藏，正式页不留空署名行。 |

## 验证

- `logs/home-map-review-browser-complete.log`：实际 Chrome 的 1440×900、768×1024、390×844、2560×1080、5120×1440 暗/亮两套页面通过；无页面横向溢出，标签边界/碰撞、1600 断点连续性、首尔/春川选择、历史返回、大洲筛选、售罄禁购、缩放/滚轮/重置、亮色持久化、手机减少动态反馈通过，控制台无错误。亮色 SVG 与原 SVG 全部路径几何逐个相同。
- `logs/home-map-review-extra-readable.log`：简中/繁中/英文手机页面无溢出，正常动画也能出现选择反馈。最终截图与 JSON 在 `logs/home-map-review-20261101/final`、`extra`、`complete`；已目视检查桌面、平板、手机和超宽屏截图。
- `logs/home-map-review-labels-readable.log`、`routes-fixed.log`、`eslint-complete.log`：标签布局专项（含原点坐标保存断言）、前端路由守卫及变更文件 ESLint 通过。既有 i18n 完整性通过，未新增翻译键。最终双端构建与 dist 边界结果见 `logs/home-map-review-build-complete.log`、`dist-complete.log`。
- 本地预览仅获取公开配置与地区目录，未执行购买、付款、真实宿主操作或生产部署。浏览器验证为本机 Chrome 与模拟视口，不能称物理手机或生产验收。新 CI 的完整 SHA、运行编号和终态另记 `logs/ci-home-map-theme.json`；不能复用前项 CI 代替本次。

## 历史失败与视觉边界

- `home-map-review-browser-before-motion-fix.log` 保留减少动态提示缺失；`browser-preview-stopped.log` 是原预览进程退出的连接失败。最初 ESLint 格式警告已修。
- 隐藏来源时将预览条件移到外层，旧路由守卫匹配固定的内层字符串而失败；现同步检查外层条件与内层预览控件，正式首页隐藏预览控件及原登录/控制台路径断言均保留。原失败见 `routes-complete.log`，修后见 `routes-fixed.log`。
- 原尺寸问题截图和每轮报告保留。最后运行时视觉检查为 **0 FAIL / 3 WARN**：无视频、固定标题被启发式标为裸名称、手机滑动卡片。分别沿 owner 要求保留地图主体、原标题和带滑动说明的卡片，不增照片、长文案或新页面结构。
- 静态 taste 扫描仍报告 **24 FAIL / 15 WARN**，主要是原地图明确允许的细线、微光、渐变与玻璃浮窗，以及 `box-shadow:none` 的静态匹配；不冒称静态 taste 全绿。运行时针对 owner 已确认的效果记录豁免，仓库 ESLint/守卫独立通过。

## 最终视觉复核

ROUND 3

Seen in one second: 世界节点地图，手机为可旋转球体；亮色用浅底深字。

Idea (one sentence): 实际可售地区成为首页的地图入口，选购沿真实地区编号进入现有流程。

Live thing: 大洲筛选、选择节点或名称、缩放及手机球体定位，库存来自公开目录。

Layout words by section: hero=左对齐短标题 / map=宽幅地图与筛选 / mobile=球体与滑动地区卡 / footer=品牌及联系。

Scores: design 6.5 · usability 8 · creativity 6 · content 8 → overall 7.0。

Caps applied: 沿用既有单地图设计，没有四张照片；世界节点作为主机入口属于行业既有表达。此分数不代表功能失败，不以重设计追分。

Top three problems (most visible first), each with the screenshot it shows in and the fix:

1. `before/desktop-fold.jpg` 与断点测量：地图尺寸规则不连续。统一桌面公式，最终 21:9/32:9 图保持上限和留白。
2. `final/light-1440.png`：首尔与春川实际点相邻，不能伪造地理间距。使用引线和独立名称按钮，保留真实点位；极密集时仍按空间隐藏较低优先级名称。
3. `after/mobile-fold.jpg`：辅助文字过小。最后调到 13px，见 `complete/mobile-fold.jpg`；手机卡片尾部仍故意露出下一张提示可滑动。

未抽取新设计方向或素材，无随机 seed/redraw。继续使用项目原 Natural Earth 底图与 GeoNames 地名来源，不增虚构数据。地图来源网址随 owner 要求保留在 HomepageMapDemo.vue 注释及原资源记录中，页面不显示。
