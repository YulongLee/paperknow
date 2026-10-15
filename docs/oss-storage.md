# PaperKnow OSS 存储

配置及验证日期：2026-10-15。已接入正式网站，`/api/capabilities` 返回 `storage: aliyun_oss`。

## 项目资源

| 项目 | 配置 |
|---|---|
| 专用 Bucket | `paperknow-production` |
| 地域 | 华东 2（上海），`cn-shanghai` |
| HTTPS Endpoint | `https://oss-cn-shanghai.aliyuncs.com` |
| 项目前缀 | `paperknow/` |
| 存储类型 | Standard、LRS |
| 访问控制 | Private，Block Public Access 已开启 |
| 默认服务端加密 | SSE-OSS / AES256 |

本次新建项目专用 Bucket，没有修改原共享 Bucket `projects-yulong` 的权限、已有对象或生命周期。

## 目录约定

```text
paperknow/
├── users/
│   └── {userId}/
│       ├── originals/{fileId}.{txt|docx|pdf}  # 当前账户上传原件
│       └── exports/                         # 预留，不代表已实现导出上传
├── clients/
│   ├── macos/
│   │   ├── arm64/{version}/                 # 预留 Apple Silicon 安装包
│   │   └── x64/{version}/                   # 预留 Intel Mac 安装包
│   └── windows/x64/{version}/               # 预留 Windows 安装包
└── system/
    └── storage-layout.json                 # 私有目录用途说明，无凭据
```

OSS 使用对象 key 模拟目录。已建立 `users/`、三个客户端平台目录和 `system/` 的空目录标记；用户子目录在实际上传时形成，未创建虚假账户或论文数据。

## 当前数据流

- 新的账户原件上传由服务器接收并写入 OSS，元数据、归属、字节数及 SHA-256 仍保存在账户数据库。
- 下载先经过账户归属校验，再由服务器读取对象并检查完整性；不向浏览器公开原件地址或凭据。
- 历史保存在 SQLite 的原件继续按原存储类型读取，本次未批量搬迁、清空或删除历史资料。
- 账户、项目、解析正文、任务和成果记录仍在服务器数据库。浏览器本地草稿、文献与备份不会因为启用 OSS 自动上传。
- 账户原件上传仍为单文件 2 MiB、每账户总量 50 MiB；启用 OSS 不会自动更改产品限额。

## 客户端安装包发布

当前没有正式 macOS / Windows 安装包，本次只准备目录，不生成占位下载、不改变首页的待发布状态。

后续版本应将实际安装包上传到对应平台及版本目录，核对文件大小、SHA-256、平台架构和签名，再发布受控版本清单。客户端安装包应通过独立发布流程上传，不使用论文原件上传接口。下载可使用服务器生成的短时签名链接；用户原件目录始终保持私有，不能为了客户端下载将整个 Bucket 改成公开读取。

## 配置保存

- 本机使用忽略提交的 `.env`；服务器使用 `/etc/paperknow/paperknow.env`，权限为 `0600 root:root`。
- 配置项为 `PK_OSS_BUCKET`、`PK_OSS_ENDPOINT`、`PK_OSS_REGION`、`PK_OSS_PREFIX`、`PK_OSS_ACCESS_KEY_ID`、`PK_OSS_ACCESS_KEY_SECRET`。
- 本次仅传送 OSS 配置字段，没有覆盖已有模型、短信、邮件或账户配置。凭据未写入 Git、公开页面、客户端代码或运行报告。
- 修改前的服务器环境文件备份位于 `/opt/paperknow/backups/oss-config-2026-10-15T05-47-14-868Z/paperknow.env`，仅用于受控回滚。

## 已验证

1. 账号鉴权、读取 Bucket 信息和创建专用 Bucket 成功。
2. 私有 ACL、阻止公共访问、默认 AES256 加密均确认。
3. 本机真实对象写入、读取、SHA-256 校验通过；匿名读取返回 403，120 秒签名读取返回 200。
4. 腾讯云服务器使用正式版本的存储模块真实写入、读取并核对字节和 SHA-256，通过；探测对象均已清理。
5. 存储及后端回归测试 19/19 通过，包含历史本地文件、账户归属、私有对象及完整性异常处理。
6. 正式网站、工作台、登录及数据说明页面正常；只有 PaperKnow 服务重启，同机其他服务进程保持不变。

本次没有设置自动过期删除或对象备份规则。既有服务器数据库快照不包含 OSS 中的原件；后续备份方案应单独覆盖远端对象，并与删除请求的处理范围一致。
