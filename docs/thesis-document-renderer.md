# 论文 DOCX 转 PDF

`createThesisDocumentRenderer({commandPath, enabled})` 使用服务器上的 LibreOffice Writer 将**当前已生成的 DOCX 字节**转换成 PDF。它不调用模型，不检查学术内容，不表示字体、学校版式或视觉验收已通过。

Linux 默认通过 `/usr/bin/python3 -I` 调用受控 UNO 辅助程序，再启动 `/usr/bin/soffice`；也可通过服务端 `commandPath` 或 `PAPERKNOW_SOFFICE_PATH` 指定 LibreOffice 绝对路径，`pythonPath` 指定系统 Python。Ubuntu 运行环境需要 `libreoffice-writer libreoffice-math python3-uno fonts-noto-cjk fonts-crosextra-carlito fonts-crosextra-caladea fonts-liberation2 poppler-utils`；安装应由部署人员执行。`libreoffice-math` 是行内 OMML 公式正常显示的必要组件，仅安装 Writer 可能产生公式空白；字体包提供中文和常用西文字体替代，不能保证学校指定的专有字体完全一致。用户请求不能指定命令、目录、输出文件名或转换参数。

UNO 使用随机私有管道，不监听 TCP；加载参数为 Hidden、ReadOnly、禁止宏、禁止外部链接更新，拒绝交互请求。先刷新 Writer 全文布局，并在可用时通过页游标遍历末页/首页；每次更新文档索引后重新分页，最后刷新页数与引用字段。仅执行 PDF `storeToURL`，绝不保存 DOCX。PDF 明确保留模板页样式、页码重启所需的自动空白页，避免 Word 的 NUMPAGES 包含空白页而 PDF 默认省略它们；不修改模板页码重启规则。转换前后校验原始 DOCX SHA-256，服务只有收到完整刷新报告且哈希一致才接受结果。非 Linux 或明确配置 `useUno:false` 使用命令行转换，并返回“目录与交叉引用页码未自动刷新”的警告；不能称为目录页码核验通过。

接口：

- `await renderer.status()` 返回 `{available, busy, engine, maxInputBytes, maxOutputBytes, timeoutMs}`；不返回服务器路径。
- `await renderer.convert({bytes: Uint8Array, signal})` 返回 `{bytes: Uint8Array, pages, warnings}`。
- `await convertThesisDocumentPayload(renderer, {data: canonicalBase64}, {signal})` 返回 `{data: PDFBase64, pages, mimeType: 'application/pdf', warnings}`。API 路由必须先检查登录身份、`expectedUserId`、限流及请求体大小；该帮助函数不处理身份认证。

当前转换入口沿用学校模板的严格检查边界：DOCX 最大 **2 MB**、最多 200 个 ZIP 项、解压后最多 25 MB。拒绝宏、嵌入对象、外部资源和动态文件导入字段；有安全缓存的旧图片字段仅在转换副本中静态化。普通网页/邮件链接只保留导航功能，应用不抓取链接。另行拒绝 VML 等直接图片地址。超限时仍可下载 Word，不能绕过检查进入转换器。

**本地引擎生成 PDF 目前仅支持静态 PNG 和 JPEG 图片。** 在启动 LibreOffice 前，以不解码图片的方式检查 PNG 块/IHDR/CRC、JPEG 标记和帧尺寸：每张最多 1200 万像素，最长边 10000 像素，全部嵌入媒体合计最多 2400 万像素。累计范围包括未使用的 ZIP 媒体、声明的图像部件和其他路径下的图片关系，不能通过重命名文件绕过。APNG、损坏的图片头、GIF/WebP/EMF/WMF 等不支持的栅格或矢量媒体会停止 PDF 转换并提示替换图片。这是 **PDF 转换的限制，不是 Word 文件的格式限制**：不删除或替换原图，不修改已生成的 DOCX；Word 导出仍可保留可编辑文档并提示页面渲染未完成。

每个进程同时最多转换一份文档，繁忙返回 429；每次使用全新私有目录与 LibreOffice 用户配置，禁用宏和自动链接更新。命令不经 shell，进程环境不继承服务密钥，日志限制 64 KB，最多运行 120 秒，取消/超时杀掉独立进程组。所有路径均在服务端固定，并在成功与失败后清理临时目录。部署时应继续使用无特权服务用户；这是文件检查与独立进程隔离，不是操作系统容器或网络沙箱。

Linux UNO 辅助进程在导入 UNO、启动 LibreOffice 前设置操作系统资源上限，子进程继承：虚拟地址空间最大 2 GiB（`RLIMIT_AS`）、单个输出/临时文件最大 25 MiB（`RLIMIT_FSIZE`）、打开的文件描述符最多 256、CPU 时间软限制 90 秒/硬限制 95 秒。若服务原有上限更低则保留更低上限，设置失败直接停止转换。它们仅作用于独立的 Python/LibreOffice 转换进程，不改变 Node 服务的限制；不是整体进程树内存配额，也不是完整操作系统沙箱，部署仍可叠加 cgroup/容器资源限制。

输出最大 20 MB；仅接收正常文件，检查 PDF 头并解析页数（1–1000 页）。输出解析可确认文件可读、页数有效，**不能确认全文完整、无缺字或最终排版正确**。正式发布仍需对实际学校模板、中文字体、封面、目录、跨页表格和末尾正文进行验收。

运行单元验收：`node --test tests/thesis-document-renderer.test.mjs`。真实运行时验收可设置 `PAPERKNOW_TEST_SOFFICE` 为服务器可信 LibreOffice 绝对路径；该测试只使用合成论文，检查首尾正文标记、跨页以及临时文件清理。
