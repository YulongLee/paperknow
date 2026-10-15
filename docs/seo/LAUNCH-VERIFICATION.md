# PaperKnow SEO 与 GEO 上线验收

日期：2026-10-15。正式域名：https://paperknow.cn/ 。产品发布版本：`5d251df8a63412a3f9dd4206a3473cd2c84b37c5`。

## 发布结果

- PaperKnow 独立构建与发布成功，当前服务健康。
- 发布前服务器保存了恢复快照；只重启 PaperKnow 服务。
- oneshowlearn、oneshowseo、pocketledger 和 Nginx 的发布前后进程编号一致，均继续运行。
- 构建、脚本检查通过；服务器账户测试 80/80、管理员与首页测试 51/51、SEO 测试 13/13 全部通过。

## 正式域名验证

- 22 个公开规范页面全部返回 200；正文摘要与已提交版本一致，每页有一个 H1 与自身 HTTPS canonical。
- robots.txt 返回 text/plain 并声明 sitemap；sitemap.xml 返回 XML，只有 22 个公开规范 URL。
- 首页 index.html、功能页缺少尾斜杠和大小写别名通过 308 规范化，保留有效查询参数。
- 工作台与登录页返回 noindex、no-store；管理员页面访客仍被引导到登录。
- 随机不存在的功能路径返回真实 404。
- 分享 PNG 正确返回图片类型和 1200px 宽度；公开 TXT、JSON、CSV、SVG 示例正常访问。
- 公开页面存在 ETag、Vary: Accept-Encoding，未变化的条件请求返回无正文 304。
- 本地浏览器已检查桌面、390px 与 320px；正文、按钮、菜单和手动轮播无横向溢出。

## 未替代的外部工作

百度搜索资源平台、Google Search Console、Bing Webmaster Tools 的所有权、提交与索引数据尚未取得；本次不能声称已经提交或收录。实际搜索流量、AI 引用和现场 Core Web Vitals 尚无可用数据。没有接入第三方追踪。

内容更新时同时维护产品范围、对应指南、状态页与实际内容日期。公开文档不包含用户论文、私人项目或内部配置。
