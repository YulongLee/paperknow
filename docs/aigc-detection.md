# 通用 AI 生成文本鉴别

本功能与现有输入、输出内容安全审核独立。后者用于违规内容拦截，本功能提供文本来源线索。现有安全审核的场景、开关与放行判断均未修改。

官方协议：Green `2022-03-02`，RPC POST `TextModerationPlus`，`Service=text_aigc_detector`。每次提交不超过 5000 字。来源：<https://help.aliyun.com/zh/document_detail/2684669.html>。

## 服务端配置

独立开关默认关闭，仅复用明确提供的内容审核 RAM 凭据，不从短信、OSS 或机器身份链自动取密钥。上海、北京、杭州、深圳、成都的官方公网 HTTPS 域名允许使用，其余主机和区域组合拒绝启用。

```dotenv
PK_AIGC_DETECTION_ENABLED=1
# 下列三项可收紧，不能超过默认上限。
PK_AIGC_DETECTION_USER_DAILY_LIMIT=10
PK_AIGC_DETECTION_GLOBAL_DAILY_CALLS=200
PK_AIGC_DETECTION_GLOBAL_DAILY_BILLING_UNITS=1000
# 复用已部署的 PK_MODERATION_ACCESS_KEY_ID / SECRET / ENDPOINT / REGION。
```

开关与预算放在服务器私有环境文件。控制台需配置该场景的检测规则和 RAM 调用权限；服务显示“未使用”不等于要再次购买整套内容安全。真实接口和当前账户权限需在上线时单独验收。

## 接口

`POST /api/aigc-detections`，同源、登录、明确同意后提交：

```json
{"text":"用户选择的完整文本","consent":true,"expectedUserId":"当前账户ID","idempotencyKey":"为本次提交保留的UUID"}
```

新任务 HTTP 202，立即返回 `status:running` 的结果对象；浏览器轮询 `GET /api/aigc-detections/:id`。`GET /api/aigc-detections` 返回 `{items:[...]}`，仅当前账户最近 10 条，用于刷新恢复。另一账户访问单条记录返回 404。

```json
{
 "id":"记录ID","status":"completed","characters":5001,"partCount":2,"completedParts":2,
 "parts":[{"index":0,"start":0,"end":5000,"characters":5000,"label":"ugc","confidence":98},{"index":1,"start":5000,"end":5001,"characters":1,"label":"aigc","confidence":91}],
 "counts":{"aigc":1,"ugc":1,"undetermined":0},"verdict":"mixed","conclusive":true,
 "notice":"通用文本来源鉴别说明","createdAt":"ISO时间","updatedAt":"ISO时间"
}
```

`start/end/characters` 按 Unicode 码点计数，end 不包含末端；不能直接以 UTF-16 字符串 slice 作为分段切割依据，应使用 `Array.from(text)`。为保守兼容上游字数口径，每个实际请求的 UTF-16 单元数也不超过 5000。

`status` 为 `running/completed/failed`。completed 要求全部实际非空分段均取得有效的 `aigc/ugc` 判定；非空分段合法返回 `nonLabel`、无法形成完整结论时，整项任务标记 failed，保留已取得的分段诊断并释放套餐预占，不按成功任务结算。空白分段不调用上游，保留原始位置并由服务端标记 `skipped:true`，不计入作者来源标签统计，也不阻断其余有效分段形成结论；其 label 仍为 undetermined，不伪造 ugc。顶层 `conclusive:false` 或 `verdict:undetermined` 时须显示“暂未获得明确结论”。verdict 还包括 `aigc/ugc/mixed`；它只概括各段标签，不提供全篇 AI 百分比。

仅明确的单一 `aigc/ugc` 标签及有效 0–100 Confidence 才作为该段结论。官方合法单条 `nonLabel`（无 Confidence）映射为 undetermined，可保留诊断，但不能据此成功结算整项任务。缺失或空 Result、未知或冲突标签、缺失/无效/冲突分数属于无效响应，按服务错误失败，不静默当作有效的未判定结果。RiskLevel 受控制台阈值影响，不用于作者来源判断；ugc 98 不换算成 AI 2；分数不平均、不按字数加工成论文 AI 占比。报告不能替代学校指定报告。

如果上游返回 DataId，必须与本次分段请求相符；不同、空值或类型不符时不应用该结果。上游 DataId 在协议中属于可选字段，缺失时仍按正式标签结构校验。业务失败的可用 RequestId 仅内部留存，用于排查已计量但无结论的调用。

## 限额、幂等与费用

- 每次最多 50000 个码点。免费试用默认每人每日 10 个不同任务/100000 码点、全局每日预留 200 次上游请求/1000 个千字计量单元，UTC 日界线。仅已从数据库核验用户、服务、执行次数且真实 held 的会员或专项套餐预占，可豁免这些免费每日限制；其他用户或其他服务的套餐不可豁免。所有任务仍受每人最多一个、全局最多两个同时执行的限制。
- 提交前预计算全部分段调用数与逐段向上取整的千字单元；为覆盖特殊字符不同计数方式，千字预算按 UTF-16 单元保守预留。预算超限在首次调用前拒绝，不先提交部分内容再收费。
- 上游每请求最多 15 秒，全任务最多 90 秒；SDK 禁用自动重试。超时后传输的并发槽保留到实际上游连接结束。不得承诺超时、无结论或 HTTP200/业务错误未被供应商计量。
- 同账号相同正文永久复用已有记录；同 key 不同正文拒绝。初次任务未完成、失败、超时、重复点击和进程重启都不自动重放。运行记录超过两分钟转为安全失败，需支持人员核查后才能另行处置。
- 此独立免费入口不自动扣科研积分；已有匹配会员或专项套餐次数时，提交先预占，完整有效结果成功后扣一次，失败、取消或未形成完整结论释放预占。报价、插入、预占与免费限额判断同事务提交，失败全部回滚。历史套餐 held/settled/released 任务不计入后续免费额度。
- 供应商仍可能对失败或未结论的请求计费；免费试用保守预算不会因失败自动返还。必须另设云账户预算提醒，不要将本地预留量或已释放的用户权益当成已核对的供应商账单金额。

## 隐私与存储

完整正文仅在请求和运行进程内存中传给云端，不写服务器文件、SQLite、OSS 或日志。数据库只存用户、SHA256 输入指纹、分段位置和结果、状态、预算、时间；供应商 RequestId 仅内部核对使用，不对普通用户返回。没有持久化正文队列，因此进程中断不会自动恢复付费调用。

前端同意提示应说明本次选定文本会传到云端鉴别服务，不自动提交用户的整份文献库。结果导出可由浏览器生成；若保存到成果库，沿用现有私有 OSS 附件通道。

## 验证

```bash
node --test tests/aigc-detection.test.mjs tests/aigc-detection-api.test.mjs
node --test tests/content-moderation.test.mjs tests/document-services-api.test.mjs
```

测试使用 mock，不读取密钥、不调用付费接口。覆盖官方请求、无结论和错误、超时不重试、Unicode 全文覆盖、预预算、幂等去重、身份/同意/同源、所有权、隐私、长文失败停止和重启保护。上线仍需小样真实 API、云控制台规则、浏览器输入→鉴别→分段展示的独立验收。
