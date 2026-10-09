# 文件历史与回放

## 定义

文件历史与回放系统记录已写盘 changeset，并以确认后的后端回放实现文件级 undo/redo。

## 参考

`src-tauri/src/services/file_history.rs`：文件历史内存状态 owner，按 canonical Mod 根持有快照、双栈与版本。
`src-tauri/src/services/write_transactions.rs`：写入与回放协调 owner，拥有提交顺序和历史推进。
`src/stores/file-history.store.ts`：带版本的历史摘要投影 owner。
`src/orchestrators/file-history-write.orchestrator.ts`：保存 receipt 的同步提交与错误呈现 owner。
`src/orchestrators/project-session-refresh.orchestrator.ts`：历史摘要与会话更新的统一接纳 owner。
`src/orchestrators/file-history-replay.orchestrator.ts`：回放编排 owner，拥有回放计划、确认交互、执行与确认 UI。
`src/services/file-history.service.ts`：历史读取与清空能力包装。
`src/services/file-history.service.ts`：历史读取、清空与按条目回放能力包装。
`src/orchestrators/main-history-command.orchestrator.ts`：主窗口历史分派 owner。
`src-tauri/src/services/file_changes.rs`：后端 changeset 回放 owner。
`src-tauri/src/commands/file_changes.rs`：回放 command 边界。
`src/app/composables/editors/use-file-history-view-model.ts`：文件历史视图 ViewModel。

## 边界

- 只记录实际写盘 changes，严禁记录前端草稿。
- 回放前、写入前后端都必须重校验全部路径归属与链接父链。
- 磁盘回放成功后历史栈记录已写盘状态；refresh 或窗口同步失败保留待同步记录并允许重试，dirty 文件编辑器只暂存外部文本。
- history limit 必须由设置输入，严禁模块自行读配置。
- Rust 必须在同一根目录队列中应用磁盘变更和推进历史；前端只允许消费历史摘要与递增版本。
- 历史读取与清空 wire 能力必须由文件历史 service 消费；按条目回放必须由文件历史回放编排消费，并经能力矩阵约束转导出后的来源。
- 回放与首次保存共用同一份 changeset 记录；目录事件逐文件展开，使旧 ID、新 ID 与删除前实体均可精确失效。
- 主窗口命令只在 CSV 草稿历史无 entry 时进入文件历史回放。

## 链路

### 登记

1. command 将保存请求交给根目录 FIFO 事务。
2. 事务校验会话和基线版本，调用所属写服务并登记实际 changeset。
3. 返回提交标识、保存后版本和历史摘要。
4. 所属编辑动作提交草稿基线，统一接纳入口投影历史、会话与缓存并发送通知。

### 回放计划

1. 主窗口命令分派进入文件历史回放。
2. 编排读取后端最新历史摘要，以栈顶条目 ID 与历史版本构造回放计划。
3. 以确认交互向用户呈现影响文件并等待确认。

### 回放执行

1. 用户确认后提交条目 ID、回放方向和预期历史版本。
2. 后端队列校验当前栈顶、文件现状和路径边界，应用快照并推进历史。
3. 回放结果以本次实际方向表达 before/after，前端接纳历史投影。
4. 同步编排接纳事务返回的会话投影，统一提交事件驱动文本与身份交接。
5. 同步完成后释放 pending，同步失败进入可重试状态。

### 撤销与重做

1. undo 弹出撤销记录执行回放，成功后记录进入 redo。
2. redo 反向执行，成功后记录回到 undo。
3. Rust 历史状态依据应用设置裁剪 undo 栈。

## 规范

- 历史读取与通知必须按 session 和历史版本接纳；迟到通知严禁改变较新的历史投影，最后一个同根 session 关闭后必须释放历史。
- commit 与 replay 必须共用投影完成协议；磁盘与历史已完成时，投影失败必须返回 pending 提交记录。
- 待同步提交记录必须归事务运行态，历史裁剪必须保持其恢复能力；成功恢复必须保留当前可重复接纳结果，会话关闭必须释放所属记录。
- 新回放必须先完成所属待同步结果；通知重试必须继续未完成步骤，严禁再次执行磁盘回放。
- 登记的变更必须来自后端实际写盘结果，严禁前端拼装。
- 回放必须复用首次保存的 before/after 快照，严禁重新计算。
- 历史必须保存身份变化与双路径记录；回放必须按实际方向返回身份变化、目标版本及路径范围。
- 失效与文本同步必须共同覆盖源与目标；同一物理文件的大小写改名必须保留实际方向与文件名。
- 文本通知必须携带提交序号与正式版本；窗口接纳必须核对会话、当前路径与来源顺序。
- 回放确认必须显式展示影响文件集合，严禁静默执行。
- 磁盘回放失败必须向用户呈现错误且保持历史状态不变；磁盘成功后的同步失败必须保留待同步记录并向用户呈现错误。
- dirty 文件编辑器只能把回放文本作为外部版本暂存并提示。
- 双栈 limit 必须由后端应用设置输入，历史清空必须经后端队列执行。

## 陷阱

- 记录前端草稿会让回放产生从未写盘的变更。
- 回放失败仍移动栈会让历史序列永久错位。
- 对 dirty 编辑器直接应用回放文本会覆盖未保存输入。
- 绕过确认直接回放会让批量文件变更不可预期。
- 以文件名重算快照会让重命名后的回放指向错误目标。
