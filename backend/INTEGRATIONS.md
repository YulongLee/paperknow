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

## Codex 科研智能任务

`PK_AGENT_ENABLED=1` 启用 Codex SDK 任务入口。入口位于服务平台的“科研智能助手”，也支持认证后的 `POST /api/jobs`，参数 `type: "agent"`、`text`、`requirements`、`projectId`、`fileIds` 与 `idempotencyKey`。材料只能选择当前账户所属原件，最多 5 份、解析正文合计 40,000 字符。

执行路径：账户鉴权 → 原有任务队列 → 服务端读取本次授权原件（支持 OSS）→ Codex SDK → 当前模型的 Responses 接口 → PaperKnow MCP 材料工具 → 成果与实际用量保存。已使用百炼 `deepseek-v4.1-flash` 真实验证 Responses 调用与 MCP 工具循环；这属于第三方模型接入，不代表具有 OpenAI Codex 模型的相同质量或全部功能。

- 每次执行使用新的私有临时目录和独立 CODEX_HOME，不读取开发者个人 Codex 登录、技能、插件或会话配置。任务结束清除临时文件，正式成果仍保存在 PaperKnow 数据库。
- SDK 子进程只接收必要的 PATH、CODEX_HOME 与当前模型密钥，不继承整个后端环境。OSS 凭证和数据库不交给 Codex。
- 默认系统命令与网络搜索关闭，文件系统为 read-only。MCP 仅提供本次快照的 `list_materials`、`read_material`、`text_statistics`，不接受任意文件路径或 SQL。
- 智能任务最长 180 秒，最多记录 20 次 MCP 调用，超过限制或模型失败不保存成功成果；失败不自动重试。管理员替换或暂停模型同样影响新智能任务。
- 页面支持取消任务、查看状态、查看材料与工具记录、编辑结果、保存新版本和导出文本。用量来源标识为 `codex_sdk`，不存在虚构额度。
- 当前能力是研究计划、材料阅读、文本整理和建议生成。DOCX/PDF/PPTX 自动生成、统计程序执行、图表制作等后续能力需单独注册受控工具；接入 SDK 不会自动使这些功能可用。需要终端执行能力时必须先接入独立的隔离执行环境，不在共享产品服务器上开放任意命令。
- 部署环境通过 npm 安装 Codex SDK 及其匹配平台的运行时；需 Node.js 与可运行的 MCP 子进程。更换模型前需验证该模型对 Responses 及工具调用的兼容性。当前不启用历史会话续接，后续可在用户授权隔离的前提下扩展。

官方参考：[Codex SDK](https://developers.openai.com/codex/sdk/)、[自定义模型与 MCP 配置](https://developers.openai.com/codex/config-reference/)。
