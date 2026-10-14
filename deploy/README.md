# PaperKnow 单机部署

适用 Ubuntu 24.04 x86_64，复用现有 Nginx、Certbot。只新增 PaperKnow 的服务、站点与证书；不改动其他站点、全局 Nginx 配置或现有 ACME 目录。

| 内容 | 路径 |
| --- | --- |
| 当前应用 | `/opt/paperknow/current`（指向一个版本目录的软链接） |
| 版本目录 | `/opt/paperknow/releases/<release>` |
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

更新时先准备新的只读版本目录，检查通过后切换 `current` 软链接并重启 PaperKnow；回滚可指回上一版本再重启。变更数据库结构前备份，旧代码是否兼容新库需单独核对。服务重启会把进行中的任务标记为失败，用户可手动重试。

备份时停止 PaperKnow 后复制整个 `/var/lib/paperknow`，再启动服务；SQLite 使用 WAL，运行时不要只复制主数据库文件。环境文件另行加密备份；启用 OSS 后还需独立保留对象存储数据。备份不得放在公开网站目录。

Nginx 的请求体上限为 3 MiB，与 API 的 JSON 上限一致，可容纳最多 2 MiB 的原始文件及 base64 编码。头部超时 15 秒、请求体与代理读写超时 120 秒；Nginx 超时按相邻读写的空闲时间计，Node 另有 120 秒接收完整请求的限制。耗时计算通过任务队列异步执行，不需要长时间保持 HTTP 请求。
