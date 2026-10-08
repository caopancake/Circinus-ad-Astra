# 表格草稿历史

## 定义

表格草稿历史系统记录未写盘 CSV draft operation 的、按 Mod/表隔离的内存 undo/redo。

## 参考

`src/stores/tables-edit-history.store.ts`：历史 store owner，按 `modRoot -> tableKey` 管理双栈与 historyLimit。
`src/domain/tables/csv-edit-history.ts`：操作应用与反演 owner，负责 undo/redo 时的行值与行数维护。
`src/domain/tables/csv-table-draft.ts`：draft operation 生产 owner，拥有单元格变更、新建行与删除行操作。
`src/domain/edit-session.ts`：统一编辑会话与撤销栈原语 owner，承载双栈结构。
`src/orchestrators/main-history-command.orchestrator.ts`：主窗口历史分派 owner，CSV 优先于文件历史。
`src/stores/tables.store.ts`：draft 结果消费方，把操作提交与行身份清理接入运行态。

## 边界

- 历史只存内存 operation，严禁存储 changeset、WriteResult 或确认状态。
- 行定位只允许正式 rowKey 规则，严禁按下标或显示文本。
- 双栈结构由统一编辑会话原语承载；操作反演语义归本模块。
- 回放必须委托草稿变更边界执行，成功后才移动栈；失败不动任一栈。
- 保存出现实际变更且文件历史登记成功后必须应用 rowKey 映射并更新 original；只允许在当前草稿无后续 dirty 时清空草稿历史，noop 保存必须保留草稿历史。
- 移除 Mod 时必须清空该 Mod 全部历史栈。
- 保存请求期间新增的历史必须保留；保存前行键映射必须同步更新待回放 operation 身份。

## 链路

### 记录操作

1. 用户在网格提交单元格变更、新建行或删除行。
2. 草稿变更边界产出 operation 与历史标签。
3. store 把 operation 压入当前 `modRoot + table` 的 undo 栈并清空 redo。

### 撤销与重做

1. 主窗口快捷键进入历史分派，当前表 CSV history 优先。
2. 有 entry 时从 undo 栈弹出 operation 并反演应用。
3. 回放成功后把反向 operation 压入 redo 栈。
4. 重做按相同路径反向执行。
5. 回放移除当前选中或正在编辑行时同步清理失效的行身份。

### 保存清理

1. 保存编排得到带实际变更的写结果并完成文件历史登记。
2. 应用后端返回的 rowKey 映射。
3. 以提交快照更新 original 并重算 dirty；提交前的 undo entry 清理，保存期间形成的操作保留并同步 rowKey，无后续 dirty 时清空当前表历史。
4. 无实际变更的 noop 保存保持历史不变。

### 生命周期清理

1. 移除 Mod 时按 `modRoot` 清空该 Mod 全部历史。
2. 设置的 historyLimit 变化同步裁剪 undo 栈。

## 规范

- 保存期间撤销已提交删除时必须分配 new 行身份并保留原插入位置；当前行、编辑目标和 undo/redo 操作必须同步应用身份映射。
- 新动作必须清空 redo；limit 只裁剪 undo 侧。
- 新建、删除及其 undo/redo 必须经同一行变更边界维护虚拟表的 total/filtered 行数。
- 操作必须携带足以反演的前后值，严禁保存整表快照。
- 历史栈严禁持久化，仅在内存按会话存在。
- limit 必须由设置统一输入，严禁模块自行读取配置。

## 陷阱

- 把 changeset 存进草稿历史会让未写盘历史与文件回放互相污染。
- 按下标回放删除行会把操作应用到错误行。
- 回放失败仍移动栈会让撤销重做序列永久错位。
- noop 保存清空历史会让可撤销操作无故丢失。
- limit 裁剪 redo 侧会让撤销后的重做能力无故消失。
