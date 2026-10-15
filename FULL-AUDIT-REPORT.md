# PaperKnow SEO 与 GEO 审核报告

审核日期：2026-10-15。范围：线上公开网站 https://paperknow.cn/、首页发现的公开链接、工作台初始 HTML、公开能力接口与相应代码。类型：公开站点抽样审核；未对私人项目、上传论文或管理数据进行抓取。下文记录的是实施前基线，不应作为优化后的现状。

实施进展：后续已按用户授权补齐公开内容与 SEO 配置，并通过本地检查，详见 [行动计划与实施状态](ACTION-PLAN.md)。以下关于缺失配置的判断均对应实施前快照。新的完整设计位于 [首页 SEO 和 GEO 完整设计方案](docs/seo/SEO-GEO-DESIGN.md)，公开功能页统一采用 `/features/` 层级；下文早期 URL 示例仅为审核时的示意，不代表已经发布。当前轮播底部区域已按用户要求移除。

## A. 审核结论

**当前具备基本可抓取条件，但 SEO 与 GEO 的内容和技术体系仍需完善，尚不足以据此认定具备持续自然获客能力。**

首页 HTTPS 正常，有中文 title、description、主标题和直接存在于 HTML 的功能说明、问答。这些是有效基础。主要缺口是：8 类功能共用 hash 工作台入口、缺少独立公开介绍页；sitemap、canonical 和品牌结构化信息未完善；可验证案例、公开产品资料和统一的能力说明不足。

整体评级：**需要优化**。不提供总分：实际收录、搜索流量、AI 引用和 Core Web Vitals 数据不足，无法可靠形成综合量化评分。缺少某个标签或文件不等于无法收录，也不等于会受到处罚。

三项优先工作：

1. 为真实可用的主要服务建设独立的公开介绍页，并保留现有进入工作台的快捷入口。
2. 完善 sitemap、规范网址及站长平台监测，统一产品能力与帮助说明。
3. 增加可验证的产品案例、产品档案、隐私和联系信息，形成能够被检索和引用的官方资料。

## B. 证据与发现

标记：Confirmed＝直接验证；Likely＝证据尚不完整；Hypothesis＝待验证。Warning 表示改进机会；本次没有证据证明全站被禁止索引。

| 范围 | 严重程度 | 确定性 | 发现 | 证据 | 影响与处理 |
|---|---|---|---|---|---|
| 首页可抓取性 | Pass | Confirmed | 首页具备基础可抓取条件 | GET `/` 返回 200；初始 HTML 包含 8 项能力说明和 4 条 FAQ 答案 | 保留原始 HTML 中的重要内容；不能把整个网站认定为 JS 空壳 |
| 页面架构 | Warning，高优先级 | Confirmed | 8 项功能缺少各自独立的公开介绍页 | 首页全部链接到 `/workspace.html#category/{writing,literature,reduce,aigc,detection,ppt,format,research}`；工作台约 1045 字节，初始正文为空 `#app` | 这些 hash 视图不能当作 8 个可靠的独立收录落地页。新增真实路径的公开内容页，介绍输入、输出、步骤、限制、示例，按钮再进入工作台 |
| 发现入口 | Warning | Confirmed | 没有站点地图与明确爬虫规则 | `/sitemap.xml`、`/robots.txt` 均为真实 404 | sitemap 帮助发现规范页面；robots 404 当前不代表禁止爬虫。增加有意制定的抓取规则和 sitemap 地址 |
| 规范网址 | Warning | Confirmed | 首页不同地址缺少统一信号 | `/` 与 `/index.html` 都返回 200，首页无 canonical；HTTP 和 www 已单跳 308 到 HTTPS 根域 | 对 `/index.html` 做永久跳转，首页 canonical 使用 `https://paperknow.cn/`；新页面指向自身规范 URL |
| 页面元信息 | Pass | Confirmed | 首页标题和描述已有基础 | title 为“PaperKnow · 论文写作与科研辅助工作台”；有 description、`lang=zh-CN`、viewport，一个主要 H1 | 不需简单堆关键词；新建服务页使用各自准确的标题、描述与正文 |
| 实体与结构化信息 | Warning | Confirmed | 没有 JSON-LD | 首页 `application/ld+json` 数量为 0 | 按页面真实内容补充 Organization、WebSite，条件适用时使用 SoftwareApplication；不虚构价格、评分、用户数或社交资料。它不是排名或 AI 引用保证 |
| 分享预览 | Warning，较低优先级 | Confirmed | 未配置 Open Graph / Twitter Card | 首页没有 `og:*`、`twitter:*` 标签 | 补品牌标题、摘要、规范 URL、预览图，改善转发呈现；不能把缺失等同于搜索索引失败 |
| 公开产品资料 | Warning | Confirmed | 关于与数据说明没有形成稳定公开文档 | 页脚“关于 PaperKnow”是按钮，点击后由 `home-app.js` 注入弹窗；当前公开源码未发现独立 about/privacy/terms/contact 页面 | 增加有独立 URL、可直接读取的产品说明、数据处理规则、协议及联系方式 |
| 宣传可信度 | Warning，高优先级 | Confirmed | 用户规模文案缺少可见依据 | 首页写“千万学生及科研工作者的共同选择”，已审页面没有统计口径、来源和日期 | 本次无法判断数字真假。有真实统计时提供依据；否则使用可验证的产品定位文案 |
| 原创实证内容 | Warning | Confirmed | 主要展示为界面和结构示意 | 首页明确标有“效果示意”“结构示例”“非实际检测结果”，未链接完整真实案例或可复现样本 | 保留示例标记；新增自有样本、处理过程、实际结果、限制与更新时间，有助于用户理解和搜索引用 |
| 跨页一致性 | Warning，高优先级 | Confirmed | 帮助内容和现有能力存在矛盾 | `/api/capabilities`：account=true、ai=false、payment=false、academicSearch=false；`help-model.mjs` 仍写“云同步和在线账户尚未接入” | 统一能力状态来源和各页说明，避免检索到互相矛盾的官方事实 |
| 帮助链接 | Warning | Confirmed | 登录页数据处理链接失效 | `auth.html` 链接到 `/#availability`，首页没有该锚点 | 指向真实的数据与隐私说明页，并补齐公开正文 |
| AI 爬虫访问 | Info | Confirmed / Hypothesis | 无 robots 禁止规则；真实爬虫网络访问仍待验证 | robots 404；普通请求成功；没有获取真实爬虫日志或验证官方 IP 的访问情况 | 公开内容应对搜索爬虫可达；区分搜索抓取与训练抓取，检查防火墙和日志。不要只改 User-Agent 就声称验证了真正的 AI 爬虫 |
| llms.txt | Info | Confirmed | 文件不存在，但不是达标门槛 | `/llms.txt` 404；Google 当前官方指南明确表示 Search 不使用该文件 | 可作为其他系统需要的可选导航资料，优先级低于公开内容页、索引和可信信息 |
| 性能 | Info，待测 | Hypothesis | 无法确认 Core Web Vitals 是否合格 | PageSpeed mobile API 被限流，performance_score=null，未取得 CrUX 数据 | 后续测 LCP、INP、CLS；不能用单次请求耗时替代这些指标 |
| 浏览器安全 | Info | Confirmed | 额外安全响应头可完善 | 有 HTTPS、nosniff、Referrer-Policy；未发现 HSTS、CSP、X-Frame-Options、Permissions-Policy | 作为部署安全工作另行验证，当前没有证据证明它阻止收录 |

技术补充：随机不存在路径返回真实 404；登录页具有 `noindex, nofollow`；管理员入口有服务端权限校验。工作台和私人数据应按用途管理索引，robots 与 noindex 均不能替代登录和权限控制。

## C. SEO 与 GEO 分别如何改进

### SEO：用公开页面承接真实搜索需求

保留用户在导航中直接进入工具的便利，同时从首页介绍区、页脚和帮助内容链接到公开服务文档。建议路径为示意，开发时须实现真实路由并保证刷新和直接访问返回正确正文：

| 公开页面示意 | 应回答的问题 | 进入操作 |
|---|---|---|
| `/ai-writing/` | 可做哪些写作任务、用户需提供什么、如何编辑、支持什么导出、哪些在线能力未开放 | 现有写作工作台 |
| `/ai-reading/` | 我的文献、检索、研读、翻译的实际状态、支持格式与保存方式 | 现有研读工作台 |
| `/ppt/` | AI PPT、开题 PPT、毕业 PPT 的不同流程、模板和 PPTX 输出示例 | 现有 PPT 工作台 |
| `/format/` | 格式检测、智能排版、格式精修的不同输入输出与限制 | 现有格式工作台 |
| `/similarity-check/` | 本地材料比对的工作范围、如何读匹配结果、与学校正式查重的区别 | 现有检测工作台 |
| `/research-tools/` | 可用图表、公式、实际数据格式和导出能力 | 现有科研工具 |

降重复率、降 AI 率等服务页应按真实服务状态建设，不能为了覆盖关键词将待开放能力描述为已经可用。无需一次生成大量内容相似的页面；以足够独特且对用户有用的页面为准。

### GEO：建立能核实、能引用的官方信息

GEO 指提升网站在生成式 AI 搜索中被发现、理解和引用的条件，不是一个统一认证或加文件即可通过的评分标准。

已有优势：产品定位文字、直接问答、各能力的边界说明都在原始 HTML 中；示意结果已标记，没有把演示数据冒充实际报告。

下一步应提供：

- 稳定的产品定义、功能规格、实际服务状态、数据与导出说明。
- 两至三个自制样本的完整案例，例如 DOCX 样式调整前后、实际数据生成图表、开题材料整理成可编辑 PPTX。
- 与用户真实问题对应的直接答案，例如“本地材料比对能否替代学校查重”“哪些数据保存在浏览器”“PPT 是否能继续编辑”。
- 对教程和案例标注真实作者或审核人、更新时间、来源和适用版本；不为营销首页机械添加虚构作者。
- 根据官方搜索爬虫要求检查访问，并通过真实日志、引用来源和站长平台观察效果。

Google 官方说明：生成式搜索沿用基础 SEO，不要求特殊 AI 文件、固定字数段落或专用 schema；`llms.txt` 不影响 Google Search 的排名。OpenAI 官方区分用于搜索的 OAI-SearchBot 与用于训练的 GPTBot，二者可分别设置。没有证据支持“必须开放训练爬虫才能被 AI 搜索引用”的说法。

## D. 待确认事项与环境限制

1. **实际收录和排名未知。** 未取得百度搜索资源平台、Google Search Console 或 Bing Webmaster Tools 的站点数据；不能据此说已经有多少收录或完全没收录。代码中没有验证标签也不能证明未通过 DNS 验证。
2. **实际流量和转化未知。** 没有查看流量、搜索词、AI 引用来源或注册漏斗报表。当前源码未发现常见统计脚本仅作为观察，不据此认定后台没有任何统计。
3. **性能实测缺失。** PageSpeed API 返回限流，不是网站性能不合格。服务器统一 `Cache-Control: no-store` 和约 133 KB 原始样式可作为后续优化线索，未压缩体积不代表实际传输体积或 LCP 结果。
4. **外部备案链接探测受限。** 脚本访问工信部备案站点返回 521，不能据此认定应删除或更换正确的官方备案链接。需真实浏览器另验。
5. **搜索工具读取限制。** 网页检索工具直接打开首页出现内部错误；本地直接 HTTPS 抓取成功，两个独立复核均验证了页面内容。工具限制不等于全站对搜索引擎不可访问。
6. **规则与语言适配。** 没有把英文可读性、固定英文单词数或固定段落长度套在中文页面上。技能脚本对缺 robots/llms、分享标签给出的红色等级已人工纠正，未当作禁止索引的证据。

## 审核方法与证据

运行了技能附带的 fetch_page、parse_html、robots_checker、llms_txt_checker、pagespeed、security_headers、broken_links、redirect_checker、social_meta、internal_links 和 finding_verifier；并人工核对原始 HTML、服务端路由、帮助与登录链接。发现复核文件包含 16 条去重后的观察；自动去重不替代事实核对。

原始公开证据位于 `/tmp/paperknow-seo-20261015/`，属于临时文件；本报告已经保留判断所需的核心事实。深度 1 的首页链接发现仅归并到首页、工作台、登录页 3 个路径；不是全站穷举，也不是实际索引量。

官方参考（查阅于 2026-10-15）：

- [Google：生成式 AI 搜索优化指南](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)
- [Google：AI 功能与网站](https://developers.google.com/search/docs/appearance/ai-features)
- [Google：网址结构与 fragment](https://developers.google.com/search/docs/crawling-indexing/url-structure)
- [Google：JavaScript SEO](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)
- [OpenAI：搜索与训练爬虫说明](https://developers.openai.com/api/docs/bots)
- [百度搜索资源平台](https://ziyuan.baidu.com/site/index)
- [百度：链接提交](https://ziyuan.baidu.com/linksubmit/url/)

这些指南不承诺具体收录、排名或引用结果。优化应以真实能力、可访问内容和后续观测为依据。
