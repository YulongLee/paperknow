# OSS 托管密钥备份（待真实云验收）

这是独立于客户端密钥模式的手动备份工具，阿里云 OSS 使用 SSE-OSS（AES256）管理对象加密密钥，无需用户单独保存加密密钥。此模式不是端到端加密：有权限的云账号和 OSS 服务可以解密对象，同一云账号被接管、删除或整体失效时，不能保证备份可用。不要将其描述成异地或跨账号灾备。

目标桶必须与来源桶不同，使用 private ACL、单桶阻止公共访问，并且未开启或暂停版本控制。命令启动时会检查这些设置，每次上传显式要求 AES256、private 及禁止覆盖，并通过回读取回对象时验证 SSE 标头；发布清单前再检查数据库快照和全部对象的哈希。恢复至全新隔离目录时再次检验数据库、对象和清单对应关系，不覆盖线上数据。云端清单只是完成标记，并非抵御云账号入侵的独立认证凭证。持有足够 OSS 权限的人员可以同时更改数据与清单，哈希核对不能可靠发现这种有意篡改；对象与清单无独立客户端签名或认证。

此实现使用之前的数据库快照和本地 OSS 快照，当前没有服务端跨桶复制或自动调度；在服务器普通磁盘暂存明文不符合要求。**数据库、对象缓存及恢复输出均有明文，必须位于经人工验证的独立加密卷**，例如确认受 FileVault 保护的本机空间；`PK_BACKUP_ENCRYPTED_VOLUME_CONFIRMED=YES` 只是运维确认，并不能自动证明所在卷已加密。待实现更可靠的环境验证后再用于生产。

使用前完成 `oss-offline-snapshot.md` 的一致性快照，另按 `oss-cloud-encrypted-backup.md` 配置独立目标桶和受限凭据；该模式不需要 `PK_BACKUP_AES256_KEY`。除目标桶原先所需权限外，还须授予 `oss:GetBucketPublicAccessBlock`。禁止使用生产根账号凭据执行备份。所有凭据、文件路径及账户需受控；目标账号或桶的其他授权也要单独审查。

候选备份身份应只允许读取生产桶 `paperknow/users/*`，及对专用备份桶 `paperknow-sse-backup-v1/*` 进行 `oss:PutObject`、`oss:PutObjectAcl` 和 `oss:GetObject`；对目标桶本身只允许读取 ACL、版本状态和公共访问阻断状态。不给该身份源写入、目标删除、桶策略变更或其他桶的访问权限；根据实际 SDK 请求和云策略模拟器进行确认。备份身份与生产应用身份应分别配置。当前生产应用使用根身份，同账号新建桶无法令其自动丧失所有者权限，须先完成独立 RAM 身份切换并实测目标桶拒绝生产身份，或使用经审查的独立云账号；切换计划见 `oss-ram-migration-plan.md`。

真实云样本验收只用合成数据：先核查桶 ACL、公共访问阻断、桶策略和 RAM 授权；再以备份专用身份验证上传、读回加密标头、拒绝覆盖、失败结果和隔离恢复，同时验证该身份对源写入、目标删除和无关桶的访问被拒绝。演练数据和残留对象需登记；保留与清理策略未经审批前不自动清理。样本通过不代表生产数据备份已完成。

```sh
PK_BACKUP_ENCRYPTED_VOLUME_CONFIRMED=YES node deploy/oss-cloud-sse-snapshot.mjs backup /encrypted/db-snapshot /encrypted/backup-root /encrypted/backup-root/oss-snapshot-UUID
PK_BACKUP_ENCRYPTED_VOLUME_CONFIRMED=YES node deploy/oss-cloud-sse-snapshot.mjs restore /encrypted/restore-root SNAPSHOT-UUID
```

数据库最大 100 MiB、单文件最大 20 MiB；失败后工具不自动删除任何远端对象。若清单已上传而回读校验失败，远端可能仍有清单，也可能留下其他未完成对象；不能据失败推断清单不存在或数据已清理，也不能把这次运行视为成功。每次重试使用新标识，不覆盖已有对象。备份成功必须在隔离环境完成应用级恢复演练，检验账号、项目、任务和文件。现阶段仅有模拟存储的合成数据测试；未验证真实阿里云权限、公共访问设置、费用或生产恢复，也没有自动备份、告警和保留清理。

参考：[OSS 服务端加密](https://www.alibabacloud.com/help/en/oss/user-guide/server-side-encryption-8)、[阻止公共访问](https://www.alibabacloud.com/help/en/oss/user-guide/block-public-access)。
