# PaperKnow 模型与原件存储

运行 `npm start` 时，服务端读取项目根目录的 `.env`。该文件被 Git 忽略，权限应保持为 600；部署到另一台机器时需单独设置这些环境变量。浏览器只接收可用状态和模型名称，不接收密钥。

## 百炼模型

- `PK_AI_URL`：完整的 OpenAI 兼容聊天接口地址（包含 `/chat/completions`）。
- `PK_AI_KEY`：服务端 API Key。
- `PK_AI_MODEL`：首次启动时的默认模型。
- 管理员在 `/service.html?view=admin` 中修改模型名称或暂停服务。模型名称与启停状态保存到 SQLite，重启后仍生效，优先于默认环境变量。
- 运行中的任务使用开始调用时的配置；排队中的任务在开始处理时读取当前配置。已有成果和用量保留实际使用的模型名称。
- 更换供应商的接口或密钥需修改服务端配置并重启。管理员页面目前支持在同一接口下替换模型，不展示或编辑密钥。
- 当前实际模型任务为学术润色与导师意见修改；浏览器本地写作模板没有因此自动变为 AI 生成。

接口参考：[百炼 OpenAI 兼容接口](https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-chat-completions)。

## 阿里云 OSS

- 配置 `PK_OSS_BUCKET`、`PK_OSS_ENDPOINT`、`PK_OSS_REGION`、`PK_OSS_ACCESS_KEY_ID` 和 `PK_OSS_ACCESS_KEY_SECRET`；全部留空时使用原有本机存储。部分填写会阻止服务启动，以免意外退回本机。
- `PK_OSS_PREFIX=paperknow/` 为 PaperKnow 独立目录。文件路径为 `paperknow/users/<用户ID>/originals/<文件UUID>.<扩展名>`。不使用其他产品目录，也不更改共享 Bucket 的权限。
- 新上传原件通过服务端写入 OSS，Object ACL 为 private。页面下载仍通过原有账户鉴权接口，不返回公开链接。
- 数据库记录对象路径、Bucket、长度和 SHA-256，读取后验证完整性。原有 SQLite 原件不迁移，仍可下载与解析。
- 当前项目、解析正文、任务、成果和用量仍保存到本机 SQLite。OSS 只承载服务账户的新上传原件；浏览器体验空间仍使用浏览器存储。
- 上传失败不生成文件记录或解析任务；读取失败显示任务失败，可手动重试。模型请求不会自动重试以免重复计费。
- 跨产品目录用于组织文件，并不等于 RAM 权限隔离；需要独立权限时，为 PaperKnow 配置限制到该目录的独立凭证。

SDK 参考：[OSS 上传与下载](https://www.alibabacloud.com/help/en/oss/user-guide/oss-sdk-quick-start)。
