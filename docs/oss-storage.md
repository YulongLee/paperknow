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
│       └── exports/{artifactId}.{kind}       # 账户生成的最终成果文件
├── _health/{probeId}.txt                    # 临时私有读写探针，检查后立即删除
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

## 生成成果文件（2026-10-18 实现）

最终 DOCX、PDF、PPTX、XLSX、TXT、Markdown、CSV、JSON、HTML、SVG、PNG、JPEG 与 ZIP 导出使用专用 `artifacts` 表及 OSS `exports/` 目录。二进制只经过受限内存缓冲，数据库保存归属、名称、大小、SHA-256、来源、对象位置和完成状态，不保存文件 BLOB，也不生成服务器长期临时文件。若 OSS 未配置或不可用，保存失败并明确提示，不回退服务器文件或 SQLite BLOB。

浏览器本地草稿仍只在本机保存；游客本地下载不会自动上传。登录账户主动导出时保存最终文件到自己的私有 OSS 目录。论文正文、章节版本、引用追溯、任务状态仍是可编辑的结构化业务数据，继续使用有容量上限的数据库存储。这些记录不能直接当成临时文件删除；当前并非服务器磁盘容量的主要来源。

接口：

- `POST /api/artifacts`：`{name,data,sha256?,projectId?,sourceType?,sourceId?,expectedUserId?}`。`data` 是标准 base64，单文件不超过 20 MiB；默认每账户 500 MiB、2,000 个未删除文件。服务端校验后缀、基础文件标记、归属及内容哈希；同一账户相同内容和格式幂等返回已有成果。
- `GET /api/artifacts`：支持 `page` / `pageSize`（1～50）、名称 `q`、`sourceType`；也支持 `limit` / `cursor` 分页。返回元数据列表及配额，不包含私有 OSS key、地址或凭据。
- `GET /api/artifacts/{id}/download`：会话归属检查后由服务器读取 OSS，核对长度和 SHA-256，再以 `attachment`、`nosniff`、`sandbox` 交付。HTML / SVG 也不会在本站内联执行。
- `POST /api/artifacts/{id}/delete`：`{expectedSha256,expectedUserId?}`，先标记正在删除，再删除远端对象，最后保留已删除状态；失败可重试。下载和上传都不会跨用户使用路径。

上传在读取请求体之前限为 2 个并发，下载对象读取也限为 2 个并发。专用成果上传接口允许 28 MiB JSON，请求解码后仍限制 20 MiB；其他接口保持原有限额。配额在 OSS I/O 前预留，防止并发超额。上传未完成或补偿删除失败会保留 `uploading` / `failed` 元数据供监控与人工处理；不能把它标为已交付。删除失败保留 `deleting` 状态，不自动丢弃记录。

`storage.health()` 执行项目专属私有对象写入、读取、哈希校验和删除；`healthStatus()` 只读取最近状态。监控每 15 分钟调用一次即可，不应每分钟创建探针。检查结果只返回固定说明及时间，不暴露提供商异常、对象内容或密钥。探针清理失败也计为检查失败。

不对 `users/` 整体设置自动过期删除。将来如增加大 JSON 归档，应先写入、回读校验，再使用版本和哈希的比较更新把正文改为 OSS 引用；下载与删除链必须同时支持该引用。不要在现有同步计费/任务完成事务中插入远端 I/O，也不要先清空数据库正文再上传。

## 客户端安装包发布

0.1.0 提供 Windows x64 安装程序和 macOS Apple Silicon / Intel 两种 DMG。客户端使用现有在线工作台，需要联网；版本更新从官网手动下载。代码签名与 macOS 公证留待后续配置，首版不宣称已签名，操作系统可能拦截未签名应用。

安装包通过独立发布工具写入 `clients/{platform}/{arch}/{version}/{sha256}/{fileName}`，不使用论文原件上传接口。工具计算文件 SHA-256，使用分片上传、私有对象权限和 OSS 元数据校验，全部对象验证成功后才原子更新数据库版本清单。既有版本对象保留，发布失败不会将其标为已发布，也不改变已有客户端目录。

- `GET /api/desktop/releases`：公开当前实际发布的版本、系统、架构、大小、文件名、SHA-256、最低系统要求及未签名状态。不返回 OSS 凭据和私有存储位置；无已发布安装包时返回空列表。
- `GET /api/desktop/download/{platform}/{arch}`：重新检查对应私有对象，返回 302 到有效期 5 分钟的 OSS 下载链接，以附件方式由 OSS 直接交付。服务器不保存安装包、不缓存其完整二进制，也不消耗站点服务器带宽中转。
- 首页下载区域和顶部下载入口共用该版本清单；API 失败、无包或元数据不合法时显示重试及网页端入口，不提供占位下载。

发布工具支持本机构建并直接上传 OSS，再导出不含凭据的清单，在服务器核验后写入客户端独立表。更新使用目录 revision 校验，数据库事务与现有订单、积分、用户资料隔离。Bucket 继续私有；安装包目录不会使用户论文目录公开。

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
