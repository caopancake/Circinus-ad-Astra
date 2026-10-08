# 后端文件读写与变更集

## 定义

后端文件读写与变更集系统提供 UTF-8 文本 IO、canonical 路径边界与可回放的文件/目录 changeset。

## 参考

`src-tauri/src/io/paths.rs`：路径归一化与父链校验 owner。
`src-tauri/src/io/file_changes.rs`：changeset 构建、应用与回放 owner。
`src-tauri/src/io/csv_files.rs`：CSV 文件读写与路径上下文 owner。
`src-tauri/src/io/json_files.rs`：JSON 文件读取与目录遍历 owner。
`src-tauri/src/io/text.rs`：UTF-8 文本读取 owner，拥有 BOM 拒绝与 CP1252 归一化入口。
`src-tauri/src/models/`：CP1252 归一化映射与 FileChangeRecord 模型 owner。
`src-tauri/src/services/file_changes.rs`：变更服务实现 owner。
`src-tauri/src/commands/file_changes.rs`：变更 command 边界。

## 边界

- IO 是磁盘路径、遍历、读取、写入、删除、目录事件与 changeset 回放的唯一权威。
- 读、遍历、写、删与回放必须复用同一套路径与 walk-entry 校验。
- 拒绝 `..`、root 外路径与任一已有父链 symlink、junction 或 reparse point。
- 写入或删除前必须构建快照，成功后返回 `FileChangeRecord` 与展开后的失效路径。
- 目录变更必须作为正式目录事件记录并逐文件展开精确影响。
- 失败必须返回带上下文的错误，严禁让前端递归拼路径或提交成功状态。

## 链路

### 文本读取

1. 保存链路或编辑器请求读取目标文件。
2. IO 读取字节并拒绝 UTF-8 BOM。
3. 已知 CP1252 智能引号按统一映射归一化。
4. 返回文本与路径上下文。

### 保存与 changeset 构建

1. 保存入口提交目标路径与文本。
2. IO 校验 canonical root、父链链接与路径边界。
3. 写入前快照当前内容，写入 UTF-8 无 BOM 字节。
4. 构造 before/after `FileChangeRecord` 并展开目录事件。
5. 返回 changeset 与失效路径给 ProjectSession。

### 回放

1. 文件历史回放以确认后的 changeset 请求回放。
2. IO 重校验全部路径归属与父链。
3. 按 before/after 快照逆向或正向应用变更。
4. 失败保留上下文并保持磁盘状态一致。

## 规范

- 写入必须携带读取版本凭据并在出队执行时比较；冲突必须返回 `write.version_conflict` 和目标路径，严禁写入或推进历史。
- 同一 canonical 根的写入必须按 FIFO 执行，嵌套同步写服务必须共享事务租约；不同根必须独立执行，锁序必须为根租约、session 状态、缓存。
- `write_utf8_no_bom` 必须按调用方提供的文本原样写入 UTF-8 字节；换行、缩进与序列化规则归各格式 renderer。
- CP1252 归一化（`0x91/92` 至 `'`、`0x93/94` 至 `"`、`0x96` 至 `-`）在读取时执行并随保存写回磁盘，且不可逆。
- 新建 Mod 的 `mod_info.json` renderer 必须输出 UTF-8 无 BOM 与 CRLF；其它格式遵守各自 parser 或保存模型的输出语义。
- 目录必须以正式目录事件表达，严禁让前端递归枚举。
- 每个保存入口只允许写所属模块声明的持久化目标；关联文件操作必须由同一正式保存模型显式声明。

## 陷阱

- 跳过已有父链链接校验会让 root 外内容经符号链接进入写入范围。
- 把 BOM 检测分散到各格式解析器会让行为分叉。
- 目录变更用文件枚举替代正式事件会让失效推导漏删或多删。
- 回放前不重校验路径会让历史记录命中已迁移目标。
- 快照缺失时构造空 before 会让撤销产生破坏性结果。
