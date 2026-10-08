# 表格草稿历史

## 定义

表格草稿历史系统记录未写盘 CSV draft operation 的、按 Mod/表隔离的内存 undo/redo。

## 参考

`src/domain/edit-session.ts`：统一编辑会话与撤销栈原语 owner，承载双栈结构。
`src/domain/tables/csv-edit-history.ts`：操作应用与反演 owner，负责 undo/redo 时的行值与行数维护。
`src/domain/tables/csv-table-draft.ts`：draft operation 生产 owner，拥有单元格变更、新建行与删除行操作。
`src/orchestrators/main-history-command.orchestrator.ts`：主窗口历史分派 owner，CSV 优先于文件历史。
`src/stores/tables-edit-history.store.ts`：历史 store owner，按 `modRoot -> tableKey` 管理双栈与 historyLimit。
`src/stores/tables.store.ts`：draft 结果消费方，把操作提交与行身份清理接入运行态。

## 边界

- 保存请求期间新增的历史必须保留；保存前行键映射必须同步更新待回放 operation 身份。
- 历史只存内存 operation，严禁存储 changeset、WriteResult 或确认状态。
- 双栈结构由统一编辑会话原语承载；操作反演语义归本模块。
- 回放必须委托草稿变更边界执行，成功后才移动栈；失败不动任一栈。
- 成功提交的 receipt 必须先交接 rowKey、original 与已捕获历史；保存期间的新操作必须保留，未发起写入的 noop 必须保持历史。
- 移除 Mod 时必须清空该 Mod 全部历史栈。
- 行定位只允许正式 rowKey 规则，严禁按下标或显示文本。

## 链路

### 记录操作

1. 用户完成一次单元格编辑动作，或发起新建行、删除行。
2. 草稿变更边界产出 operation 与历史标签。
3. store 把 operation 压入当前 `modRoot + table` 的 undo 栈并清空 redo。

### 撤销与重做

1. 主窗口快捷键进入历史分派，当前表 CSV history 优先。
2. 有 entry 时从 undo 栈弹出 operation 并反演应用。
3. 回放成功后把反向 operation 压入 redo 栈。
4. 重做按相同路径反向执行。
5. 回放移除当前选中或正在编辑行时同步清理失效的行身份。

### 保存清理

1. 保存编排得到成功提交的写结果。
2. 应用后端返回的 rowKey 映射。
3. 以提交快照更新 original 并重算 dirty；提交前的 undo entry 清理，保存期间形成的操作保留并同步 rowKey，无后续 dirty 时清空当前表历史。
4. 有实际 changes 时登记文件历史并执行后续同步；未发起写入的 noop 保持历史不变。

### 生命周期清理

1. 移除 Mod 时按 `modRoot` 清空该 Mod 全部历史。
2. 设置的 historyLimit 变化同步裁剪 undo 栈。

## 规范

- limit 必须由设置统一输入，严禁模块自行读取配置。
- native 文本、多行浮层与多选必须在一次编辑动作结束时产生一条前后值操作；原始输入期间只允许登记待提交状态。
- 保存映射必须同步 operation.rowKey 与行记录身份；来源位置与恢复插入位置必须分别交接。
- 保存期间撤销已提交删除时必须分配 new 行身份并保留原插入位置；当前行、编辑目标和 undo/redo 操作必须同步应用身份映射。
- 历史栈严禁持久化，仅在内存按会话存在。
- 工具栏撤销与重做必须先交接活动输入；原生输入焦点内的快捷键必须保留文本撤销语义。
- 操作必须携带足以反演的前后值，严禁保存整表快照。
- 新动作必须清空 redo；limit 只裁剪 undo 侧。
- 新建、删除及其 undo/redo 必须经同一行变更边界维护虚拟表的 total/filtered 行数。
- 行创建与删除操作必须捕获独立 CsvDraftRow，业务内容与工具元数据必须共同参与回放。

## 陷阱

- 把 changeset 存进草稿历史会让未写盘历史与文件回放互相污染。
- 按下标回放删除行会把操作应用到错误行。
- 回放失败仍移动栈会让撤销重做序列永久错位。
- 把后续同步失败当作写入失败会让历史基线偏离已经落盘的内容。
- limit 裁剪 redo 侧会让撤销后的重做能力无故消失。
