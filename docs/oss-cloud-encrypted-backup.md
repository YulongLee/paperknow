# 独立 OSS 加密归档与隔离恢复验证

本工具是手工、默认关闭的运维工具，未创建或修改任何线上云资源。它读取已完成并验证过的数据库快照及配对的 OSS 离线快照，向**预先配置的独立私有备份 Bucket**上传客户端 AES-256-GCM 加密数据；每个对象上传后回读解密核对，最后才写入加密清单。源 Bucket 和备份 Bucket 必须不同。无需自动定时任务、自动清理或访问生产数据库。

使用前先阅读 `oss-offline-snapshot.md`，运行数据库及本地 OSS 快照的完整性检查。数据库快照建立时若有关联 OSS 对象正在变更，旧对象可能无法获得；需要在可控窗口取得一致材料，不能忽略失败。归档包含数据库、快照元数据、清单和数据库索引所对应的 OSS 原件及 `ready` 成果，**不包含环境配置、云资源设置、客户端安装包、对象历史版本和无索引孤儿对象**。历史 SQLite 本地文件已经包含在数据库中。

## 准备条件

- 由运维提前独立开通和评估私有备份 Bucket，限制 RAM 权限和 Bucket 策略，启用阻止公共访问，确认所需数据保留期限、地域、监管要求及费用。未核实安全策略时不得运行。本工具会检查 ACL 为 private，且为保证禁止覆盖要求 Bucket 未启用或暂停对象版本控制；ACL 检查并不能证明 Bucket 策略或公共访问阻断已正确配置。
- 备份专用凭据只授予此备份 Bucket 所需的 `GetBucketAcl`、`GetBucketVersioning`、`PutObject`、`PutObjectAcl` 和 `GetObject` 权限；不要授予来源 Bucket 写入、覆盖或删除权限。本工具不调用删除。读写凭据和加密密钥通过受保护环境注入，不放在命令行、日志、Git 或聊天中。
- 另行保管随机生成的 32 字节 AES 密钥，密钥丢失会导致**所有加密备份无法恢复**。密钥必须与备份分开存储和限制访问。应由运维使用合规的密钥管理系统生成、保管和轮换；本工具不创建密钥或轮换密钥。环境变量 `PK_BACKUP_AES256_KEY` 为标准 Base64 编码的 32 字节密钥。
- 分别配置源桶身份 `PK_OSS_BUCKET`、`PK_OSS_PREFIX`（缺省为 `paperknow/`），及目标独立变量 `PK_BACKUP_OSS_BUCKET`、`PK_BACKUP_OSS_ENDPOINT`、`PK_BACKUP_OSS_REGION`、`PK_BACKUP_OSS_ACCESS_KEY_ID`、`PK_BACKUP_OSS_ACCESS_KEY_SECRET`。不得与源桶同名。服务端只接受阿里云 HTTPS endpoint。工具不读取源 OSS，不需要源 OSS 凭据。
- 中间本地快照和恢复输出仍是明文，必须使用独立加密卷，根目录为运维账号所有且 `0700`，不经符号链接，不在应用、配置和运行数据目录下。检查本地和云端容量，处理过程逐文件在内存中加密；单个数据库快照不得超过 100 MiB，单个 OSS 对象不得超过 20 MiB，清单不超过 8 MiB。

## 显式操作

仅在受保护的运维环境注入以上变量后，在项目目录执行：

```sh
node deploy/oss-cloud-snapshot.mjs backup /path/to/completed-db-snapshot /path/to/private-local-backup-root /path/to/private-local-backup-root/oss-snapshot-UUID
node deploy/oss-cloud-snapshot.mjs restore /path/to/private-encrypted-restore-root SNAPSHOT-UUID
```

`backup` 成功后输出随机快照 UUID 和对象数，保管 UUID 与对应密钥版本。每份快照使用新的随机路径，设置私有 ACL、服务端 AES256 和禁止覆盖；客户端每个文件使用独立随机 nonce 的 AES-256-GCM 并绑定快照和对象名。上传或回读失败时不会删除远端对象：若清单已上传但回读失败，远端可能已有清单；也可能留下其他未完成对象。不能据失败推断清单不存在或数据已清理，也不能把这次运行视为成功。重试采用新标识，不覆盖已有对象；须由管理员核对并手工处理，不应对其他备份进行批量清理。服务端禁覆盖在启用或暂停版本控制的桶中无效，因此该工具拒绝此类桶；不得依赖该工具对目标 Bucket 设置或生命周期进行修改。

`restore` 仅读取指定快照并解密到新建隔离目录；校验数据库哈希、每个对象和数据库清单的关联后才输出目录路径。它不会写回源 Bucket、生产账户或数据库；不要将隔离副本直接覆盖线上。加密校验不替代密钥安全、访问控制和完整业务恢复演练；还需要在独立环境启动应用，验证账户、任务、文件归属及可下载性，记录恢复时间和结果。

模拟测试 `node --test tests/oss-cloud-snapshot.test.mjs tests/oss-snapshot.test.mjs` 仅使用合成数据和内存存储，无法证明真实 Bucket 策略、上传性能、异地灾备或生产恢复可用。实施前需由运维确认、配置并在隔离云环境另行验收。

参考：[阿里云 PutObject 文档](https://www.alibabacloud.com/help/en/oss/developer-reference/putobject)。
