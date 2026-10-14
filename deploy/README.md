# PaperKnow 单机部署

适用 Ubuntu 24.04 x86_64，复用现有 Nginx、Certbot。只新增 PaperKnow 的服务、站点与证书；不改动其他站点、全局 Nginx 配置或现有 ACME 目录。

| 内容 | 路径 |
| --- | --- |
| 当前应用 | `/opt/paperknow/current`（指向一个版本目录的软链接） |
| 版本目录 | `/opt/paperknow/releases/<release>` |
| 独立 Git 仓库 | `/opt/paperknow/repository`（bare，只有构建用户可写） |
| 临时构建 | `/opt/paperknow/builds`（与在线版本分开） |
| 构建缓存 | `/opt/paperknow/build-home/npm-cache`（不复用其他服务的依赖） |
| 发布管理脚本 | `/opt/paperknow/bin`（root 持有） |
| 发布前快照 | `/opt/paperknow/backups`（root，0700） |
| 独立 Node | `/opt/paperknow/runtime/bin/node`，版本须满足 `package.json` 的 `>=25.2.0` |
| SQLite 与上传文件 | `/var/lib/paperknow` |
| 环境配置 | `/etc/paperknow/paperknow.env` |
| ACME 校验文件 | `/var/www/paperknow-acme` |
| 服务端口 | `127.0.0.1:5173`，由应用固定绑定回环地址 |

## 1. 准备应用和配置

先检查 `paperknow.cn`、`www.paperknow.cn` 的 DNS 指向本机，80/443 端口可达，5173 未被占用，并确认现有 Nginx 没有使用这两个域名。若发布了 AAAA 记录，IPv6 也必须可达。

从 Node.js 官方发布物安装满足上述版本要求的 Linux x64 运行时，核对官方校验值后放入 `/opt/paperknow/runtime`。不要覆盖系统 Node。发布目录包含源码、`package-lock.json`、构建后的 `dist/` 和服务器平台安装的 `node_modules/`；不携带开发机的 `.env`、`.data/` 或 `node_modules/`。用独立运行时执行 `npm ci`、`npm run build` 和项目检查，避免漏装 Linux 平台依赖。构建完成后可执行 `npm prune --omit=dev`。

以下命令在发布目录运行。第一次创建用户前检查同名用户不存在；应用、版本目录和运行时由 root 持有，`paperknow` 用户只有读取和执行权限。

```sh
sudo useradd --system --user-group --home-dir /var/lib/paperknow --no-create-home --shell /usr/sbin/nologin paperknow
sudo install -d -o paperknow -g paperknow -m 0700 /var/lib/paperknow
sudo install -d -o root -g root -m 0755 /etc/paperknow /var/www/paperknow-acme
sudo install -o root -g root -m 0600 deploy/paperknow.env.example /etc/paperknow/paperknow.env
sudoedit /etc/paperknow/paperknow.env
sudo install -o root -g root -m 0644 deploy/paperknow.service /etc/systemd/system/paperknow.service
sudo systemctl daemon-reload
sudo systemctl enable --now paperknow
curl --fail http://127.0.0.1:5173/api/capabilities
```

填写模型与 OSS 配置时只修改服务器环境文件。`PK_SECURE_COOKIE=1` 同时用于 Cookie 和 POST 来源检查；保持此值，首次 HTTP 阶段仅用于连通性检查和证书签发，登录、注册在 HTTPS 生效后验证。`PK_TRUST_PROXY=1` 对应单层本机 Nginx，模板会覆盖客户端自带的 IP 头。AI 与智能任务默认关闭，按实际模型配置开启。

## 2. 启用 HTTP 并签发证书

下面的新文件名必须没有被现有站点占用；不要删除 `sites-enabled` 中其他文件。每次 reload 前都要让 `nginx -t` 通过。

```sh
sudo install -o root -g root -m 0644 deploy/nginx-http.conf /etc/nginx/sites-available/paperknow.conf
sudo ln -s /etc/nginx/sites-available/paperknow.conf /etc/nginx/sites-enabled/paperknow.conf
sudo nginx -t
sudo systemctl reload nginx
sudo certbot certonly --webroot -w /var/www/paperknow-acme --cert-name paperknow.cn -d paperknow.cn -d www.paperknow.cn
```

Certbot 交互中填写实际运维邮箱并确认条款。命令使用 webroot，不让 Certbot 改写其他 Nginx 配置。HTTP 与 HTTPS 模板只启用其中一份。

## 3. 切换 HTTPS

确认 `/etc/letsencrypt/live/paperknow.cn/` 中证书存在且覆盖两个域名后执行：

```sh
sudo install -o root -g root -m 0644 deploy/nginx-https.conf /etc/nginx/sites-available/paperknow.conf
sudo nginx -t
sudo systemctl reload nginx
curl --fail https://paperknow.cn/api/capabilities
curl --fail --location https://www.paperknow.cn/api/capabilities
```

若修改过环境文件，执行 `sudo systemctl restart paperknow`。浏览器验证注册/登录、上传小文件、任务结果，并确认已有站点仍可访问。正式地址统一为 `https://paperknow.cn`；两个域名的 HTTP（ACME 校验除外）和 `https://www.paperknow.cn` 均以 308 跳转至该地址并保留路径、查询参数，避免用户在不同域名创建彼此隔离的草稿与会话。

确认现有 Certbot 定时续期机制已启用。新增仅匹配本证书的续期成功钩子，让 Nginx 读取续期后的证书：

```sh
sudo install -d -o root -g root -m 0755 /etc/letsencrypt/renewal-hooks/deploy
sudo install -o root -g root -m 0755 deploy/paperknow-nginx-reload /etc/letsencrypt/renewal-hooks/deploy/paperknow-nginx-reload
sudo certbot renew --cert-name paperknow.cn --dry-run
```

## 日常维护

状态和日志：`sudo systemctl status paperknow`、`sudo journalctl -u paperknow -n 100 --no-pager`，站点日志为 `/var/log/nginx/paperknow.*.log`。

使用下面的 Git 发布脚本管理更新与回滚。服务重启会把进行中的任务标记为失败，用户可手动重试。

Nginx 的请求体上限为 3 MiB，与 API 的 JSON 上限一致，可容纳最多 2 MiB 的原始文件及 base64 编码。头部超时 15 秒、请求体与代理读写超时 120 秒；Nginx 超时按相邻读写的空闲时间计，Node 另有 120 秒接收完整请求的限制。耗时计算通过任务队列异步执行，不需要长时间保持 HTTP 请求。

## Git 发布与独立文件管理

这组脚本只管理 PaperKnow：不安装系统软件，不修改系统 Node、Nginx、证书、环境配置或其他服务，不添加定时任务。Git 和 npm 使用单独的 `paperknow-build` 用户、主目录和缓存；应用仍由 `paperknow` 用户运行。npm 构建放进独立的临时 systemd 服务，限制为 1 个 CPU、1 GiB 内存（768 MiB 开始回收）和 128 个任务，降低 CPU / I/O 优先级，只允许本次构建目录和构建缓存目录写入；代码通过检查后才切换在线版本。在线服务也使用相同的 CPU / 内存限制，保护同机其他业务。发布前检查系统盘、应用盘、数据盘至少保留 2 GiB 可用空间；空间不足直接停止。所有路径固定，不接受任意服务名或目录参数。

### 一次性准备

先确认下面的用户与目录没有被其他业务使用。已有目录不要重建或覆盖。Git、Python 3、curl、flock、runuser、nice、ionice 应已安装。运行以下操作的管理员需要 sudo；构建用户不需要 sudo 权限，也不保存 GitHub 私钥。

```sh
sudo useradd --system --user-group --home-dir /opt/paperknow/build-home --no-create-home --shell /usr/sbin/nologin paperknow-build
sudo install -d -o paperknow-build -g paperknow-build -m 0700 /opt/paperknow/build-home /opt/paperknow/builds
sudo install -d -o paperknow-build -g paperknow-build -m 0750 /opt/paperknow/repository
sudo install -d -o root -g root -m 0700 /opt/paperknow/backups
sudo install -d -o root -g root -m 0755 /opt/paperknow/bin /opt/paperknow/releases
sudo -u paperknow-build env HOME=/opt/paperknow/build-home GIT_TERMINAL_PROMPT=0 git clone --bare https://github.com/YulongLee/paperknow.git /opt/paperknow/repository
sudo install -o root -g root -m 0755 deploy/release.sh deploy/rollback.sh /opt/paperknow/bin/
sudo install -o root -g root -m 0644 deploy/deploy-common.sh deploy/backup.py /opt/paperknow/bin/
```

仓库通过公开 HTTPS 拉取，不复用服务器其他服务的 Git 身份。`current` 必须已指向 `releases/<Git提交号>`，支持首次部署已有的 7 位提交号。`PK_DATA_DIR` 必须为 `/var/lib/paperknow`；脚本检查真实数据路径后才备份。

### 从 GitHub 更新

```sh
sudo /opt/paperknow/bin/release.sh
```

脚本拉取 `origin/main`，要求新提交是当前版本的后代。**如果 GitHub 分支比线上代码旧，脚本会拒绝发布，避免把功能退回旧版本。** 相同提交只做健康检查，不重建、不重启。

每次发布在独立临时目录执行 `npm ci`、构建、语法检查、后端与代理限流测试，再移除开发依赖。只复用 npm 下载缓存，不复用 `node_modules`，不改变已运行版本。完成后写入 `/opt/paperknow/releases/<完整SHA>`，由 root 持有；原子切换 `current` 并只重启 `paperknow.service`。成功需要服务主进程确实运行于目标版本，且本机能力接口返回正常。

### GitHub 尚未包含本地最新提交时

先修复 GitHub 推送权限并推送是长期做法。若需要立即发布已审阅的本地提交，可用 Git bundle 携带 Git 历史，在服务器专属仓库中导入 `workspace-release` 分支，再按完整 SHA 发布。**这会真实保留 Git 历史，但不等于已推送 GitHub。** 不导入私钥、`.env`、本地数据库或 `node_modules`。

在开发机创建 bundle（需先提交所有待发布改动）：

```sh
git bundle create paperknow-release.bundle HEAD
git rev-parse HEAD
```

将 bundle 上传至服务器专属目录后，管理员把文件交给 `paperknow-build` 用户读取，例如 `/opt/paperknow/build-home/paperknow-release.bundle`。在服务器执行：

```sh
sudo -u paperknow-build env HOME=/opt/paperknow/build-home git --git-dir=/opt/paperknow/repository bundle verify /opt/paperknow/build-home/paperknow-release.bundle
sudo -u paperknow-build env HOME=/opt/paperknow/build-home git --git-dir=/opt/paperknow/repository fetch /opt/paperknow/build-home/paperknow-release.bundle HEAD:refs/heads/workspace-release
sudo /opt/paperknow/bin/release.sh --ref <完整40位提交SHA>
```

`--ref` 仅接受仓库中已存在、可从 `origin/main` 或 `workspace-release` 到达的完整提交 SHA；仍检查必须是当前版本的后代。它不会联网拉取或接受悬空对象。只导入自己审阅过的 bundle，默认不强制覆盖分支历史。

### 快照与回滚

发布和回滚切换前都会在线备份 SQLite（包含本地上传文件）及环境配置。SQLite 使用 backup API 获取包含 WAL 已提交事务的一致快照，并执行完整性检查；备份失败不会切换版本。快照目录为 0700、数据库和环境副本为 0600，路径会在发布输出中显示，不打印配置内容。启用 OSS 后仍需另行备份远端对象；快照目录应再做加密异地备份，不会自动清理现有版本或备份。

单独创建快照：

```sh
sudo /usr/bin/python3 -I /opt/paperknow/bin/backup.py
```

回滚至服务器上已经构建过的版本（参数是实际版本目录名，含旧的 7 位目录也可）：

```sh
sudo /opt/paperknow/bin/rollback.sh --release <已有版本目录名>
```

发布或回滚健康检查失败会尝试恢复之前的代码链接并重新检查服务。**自动恢复和手动回滚都只回滚代码，不恢复数据库或环境配置。** 数据库迁移不一定向后兼容；执行回滚前必须核对，脚本不会用旧快照覆盖新业务数据。需要恢复数据库时，应单独停用 PaperKnow、保留当前数据后由管理员处理，避免丢失发布后的记录。并发发布/回滚由同一把锁排除。

脚本自身的更新需要审阅后重新安装到 `/opt/paperknow/bin`；发布过程不会用新仓库脚本替换正在执行的管理工具。
