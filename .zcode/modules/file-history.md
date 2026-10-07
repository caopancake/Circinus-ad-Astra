# 文件历史与回放

## 定义

文件历史与回放系统记录已写盘 changeset，并以确认后的后端回放实现文件级 undo/redo。

## 参考

`src/stores/file-history.store.ts`：文件历史 store owner，按 `modRoot` 管理双栈与 historyLimit。
`src/orchestrators/file-history-write.orchestrator.ts`：写入完成登记 owner，拥有登记校验、历史入栈与刷新触发。
`src/orchestrators/file-history-replay.orchestrator.ts`：回放编排 owner，拥有回放计划、确认交互、执行与确认 UI。
`src/services/write.service.ts`：回放排他写 owner。
`src/orchestrators/main-history-command.orchestrator.ts`：主窗口历史分派 owner。
`src-tauri/src/services/file_changes.rs`：后端 changeset 回放 owner。
`src-tauri/src/commands/file_changes.rs`：回放 command 边界。
`src/app/composables/editors/use-file-history-view-model.ts`：文件历史视图 ViewModel。

## 边界

- 只记录实际写盘 changes，严禁记录前端草稿。
- 回放前、写入前后端都必须重校验全部路径归属与链接父链。
- 磁盘回放成功后历史栈记录已写盘状态；refresh 或窗口同步失败保留待同步记录并允许重试，dirty 文件编辑器只暂存外部文本。
- history limit 必须由设置输入，严禁模块自行读配置。
- 双栈结构由统一编辑会话原语承载；entry 形状与 replay-commit 语义归本模块。
- 回放与首次保存共用同一份 changeset 记录；目录事件逐文件展开，使旧 ID、新 ID 与删除前实体均可精确失效。
- 主窗口命令只在 CSV 草稿历史无 entry 时进入文件历史回放。

## 链路

### 登记

1. 保存编排完成 changeset 提交后调用写入完成登记。
2. 登记校验 modRoot、sessionId 与变更非空，并确认 session 未变化。
3. 文件历史 store 按 `modRoot` 记录变更与标签。
4. 触发 ProjectSession 刷新完成失效。

### 回放计划

1. 主窗口命令分派进入文件历史回放。
2. 编排从栈顶取记录并构造回放计划。
3. 以确认交互向用户呈现影响文件并等待确认。

### 回放执行

1. 用户确认后以排他写提交后端回放。
2. 后端重校验路径归属与父链，应用变更并返回新写结果。
3. refresh 编排以新变更刷新 session 并更新 manifest。
4. 文件编辑器接收外部文本暂存，未 dirty 时直接应用。
5. 磁盘写入成功后移动栈并登记待同步记录。
6. refresh 与窗口同步完成后清除待同步记录；同步失败保留记录供后续重试。

### 撤销与重做

1. undo 弹出撤销记录执行回放，成功后记录进入 redo。
2. redo 反向执行，成功后记录回到 undo。
3. limit 裁剪由原语栈规则维护。

## 规范

- 登记的变更必须来自后端实际写盘结果，严禁前端拼装。
- 回放必须复用首次保存的 before/after 快照，严禁重新计算。
- 回放确认必须显式展示影响文件集合，严禁静默执行。
- 磁盘回放失败必须向用户呈现错误且保持历史状态不变；磁盘成功后的同步失败必须保留待同步记录并向用户呈现错误。
- dirty 文件编辑器只能把回放文本作为外部版本暂存并提示。
- 双栈 limit 由设置统一输入并同步裁剪。

## 陷阱

- 记录前端草稿会让回放产生从未写盘的变更。
- 回放失败仍移动栈会让历史序列永久错位。
- 对 dirty 编辑器直接应用回放文本会覆盖未保存输入。
- 绕过确认直接回放会让批量文件变更不可预期。
- 以文件名重算快照会让重命名后的回放指向错误目标。
