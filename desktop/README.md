# PaperKnow 桌面客户端 0.1.0

这是连接 `https://paperknow.cn/` 在线服务的 Windows / macOS 客户端。AI 生成、账号、会员与支付均使用现有网站服务，安装包不包含服务器、模型服务或任何密钥。需要联网使用；不会把网页尚未开放的能力变为可用。

## 支持系统与分发文件

- Windows 10 / 11，64 位 Intel / AMD：`PaperKnow-0.1.0-win-x64.exe`，按用户安装的 NSIS 安装程序，可选择目录，不要求管理员权限。
- macOS 13 Ventura 及以上，Apple Silicon：`PaperKnow-0.1.0-mac-arm64.dmg`。
- macOS 13 Ventura 及以上，Intel：`PaperKnow-0.1.0-mac-x64.dmg`。

三种安装包分别构建，不使用更大的 universal 包。macOS 中打开 DMG 后将 PaperKnow 拖到 Applications。Windows 在安装向导完成安装；系统应用列表提供正常卸载。卸载默认保留本地账号会话及草稿，避免无意删除资料。

当前依用户要求暂不配置开发者代码签名与 macOS 公证。Windows 可能提示未知发布者，macOS 可能阻止打开；不能保证所有设备都允许安装。此版本没有自动升级或自动执行下载文件的能力。后续获得开发者证书后，应补充签名、公证和双系统实机验收，再扩大分发。安装包 SHA-256 用于核对传输完整性，不等同于发行者数字签名。

## 使用与安全边界

- 默认打开首页，可通过原有登录入口登录；Cookie / Local Storage / IndexedDB 使用客户端独立的持久会话。与系统浏览器的登录状态不共享。
- 登录会话与本地草稿保存在系统用户目录的 PaperKnow 应用数据中。账号内容仍由网站后台处理；浏览器本地草稿应及时通过网站备份/导出。
- 只在客户端主窗口加载 `paperknow.cn` 和 `www.paperknow.cn` 的 HTTPS 页面。本站新窗口保留同一会话和沙箱。
- 其他 HTTPS 链接用系统浏览器打开；不执行 `file:`、`javascript:`、自定义命令协议，不绕过 TLS 证书验证。
- 原有支付宝 iframe 仍在 Chromium 沙箱中加载，主窗口导航策略不会拦截该子帧。外部支付宝收银台可在系统浏览器打开；支付成功与否始终由网站服务器核对。
- 导出、OSS HTTPS 文件和本站 Blob 下载通过原生保存对话框保存，不自动打开下载文件。支持文件上传的系统文件选择器。
- 远程页面关闭 Node 集成、启用上下文隔离和渲染进程沙箱，无 preload / IPC 原生能力桥。默认拒绝摄像头、麦克风、屏幕捕获、位置、通知和剪贴板读取；仅允许本站标准的已清洗剪贴板写入，供复制按钮使用，仍受浏览器激活/焦点规则约束。
- 网络暂时不可用时显示本地连接提示，可点击重新连接，或从视图菜单重新加载；不清除已有会话/草稿。
- 安装包的 `Resources/licenses/`（Windows 为 `resources/licenses/`）附带 Electron 原始 MIT 许可证与 Chromium 完整第三方许可，帮助菜单的“开源组件许可”可定位这些文件。它们从锁定 Electron 运行时原样复制，不省略第三方版权声明。

## 开发与构建

依赖在独立 `desktop/package-lock.json` 锁定：Electron `44.9.0`、electron-builder `26.15.3`。根网站部署无需安装客户端依赖。

```sh
cd desktop
npm ci
# 如环境禁止 npm lifecycle 下载：node node_modules/electron/install.js
npm test
npm start
CSC_IDENTITY_AUTO_DISCOVERY=false npm run pack:mac
npm run pack:win
```

产物输出到仓库 `outputs/desktop-0.1.0/`，不会进入源码提交。构建机须为 macOS 才能可靠生成 DMG；Windows 目标可在 macOS 交叉打包，但仍需要 Windows 实机安装验收。`pack:all` 顺序执行以上两个目标，不额外生成 Windows ARM64。

品牌图标复用现有 `dist/brand/paperknow-logo.svg` 中的图形。生成后的 PNG / ICNS / ICO 是固定构建资源；修改品牌图形时，在 macOS 运行 `npm run icons` 重新生成。该脚本只使用系统 Swift / AppKit / sips / iconutil，无线上密钥。

纯策略测试使用 Node 内置测试运行器，无需 Electron 或图形环境，可在网站服务器回归执行：

```sh
node --test desktop/tests/*.test.cjs
```

## 官方参考

- [Electron 安全建议](https://www.electronjs.org/docs/latest/tutorial/security/)
- [Electron 44 平台变更：macOS 13+](https://www.electronjs.org/blog/electron-44-0)
- [Electron 系统支持：Windows 10+](https://github.com/electron/electron)
- [electron-builder v26 macOS 配置](https://www.electron.build/v26/docs/mac/)
- [electron-builder v26 Windows 配置](https://www.electron.build/v26/docs/win/)
- [electron-builder v26 NSIS 配置](https://www.electron.build/v26/docs/nsis/)

版本更新时需同时检查 Electron 支持生命周期、最低系统版本、网站支付和文件导出回归；不要长期停留在过期 Chromium 版本。
