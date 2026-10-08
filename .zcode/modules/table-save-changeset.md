# 表格保存与变更集

## 定义

表格保存与变更集系统将当前 CSV dirty patches 与用户确认的关联 spec 动作组成一次原子文件 changeset。

## 参考

`src/orchestrators/table-save.orchestrator.ts`：保存编排 owner，以 `saveActiveTableChanges` 拥有输入提交、快照捕获、关联选择、写入与保存后接纳。
`src/services/write.service.ts`：写入能力包装，提交 patches、版本凭据与关联动作。
`src/shared/api/write-api.ts`：CSV 保存 wire API。
`src/domain/tables/associated-spec-candidates.ts`：关联 spec 候选 owner。
`src/domain/tables/csv-dirty.ts`：dirty 行形状 owner。
`src/orchestrators/file-history-write.orchestrator.ts`：保存完成登记 owner。
`src-tauri/src/services/project/write/`：后端写入 owner，合成 CSV 与关联目标并构建 changeset。
`src/orchestrators/table-save.orchestrator.spec.ts`：保存编排行为测试。

## 边界

- 关联动作仅允许该表正式声明的关联目标，严禁为未声明的表或实体生成动作。
- 重命名必须经 JSON-like 解析器处理，严禁字符串替换。
- 文件历史只允许登记实际 changes；成功的原样保存必须接纳返回版本与提交行基线，写入失败必须保留草稿。
- 已写盘结果必须先更新行基线、版本与历史映射，再执行后续同步；同步失败必须保留已接纳状态并结束等待交接。
- 捕获目标必须与当前 manifest session 和 tables 状态一致，任一变化即放弃本次保存。
- 同根跨窗口写入必须由 Rust FIFO 排队；基线冲突必须以带动作的 AppError 上抛并保留草稿。
- 后端文件历史必须与写盘同事务完成；前端必须先接纳写结果，再投影该结果的文件历史与刷新。

## 链路

### 捕获保存目标

1. 用户触发保存或 Ctrl+S 进入保存编排。
2. 编排捕获完整目标并持有准备与保存状态。
3. 所属输入集合逐项提交原始输入，编排复核目标、session 与 tables 状态。
4. 编排捕获独立 patches、版本凭据、关联候选与历史身份集合。

### 提交保存

1. 目标为空或当前表无 dirty 时返回 noop；进行中的保存由同一 Promise 表达。
2. app 层选择回调展示快照中的关联候选，返回选定动作或取消。
3. 编排复核目标并消费同一快照中的 patches、关联动作与版本。
4. 调用排他写提交 patches 与关联动作。
5. 后端校验 session/root，合成 CSV 与关联目标，构建并应用原子 changeset。
6. 返回写结果、rowKey map 与结构化失效。

### 保存后提交

1. session 已变化时保留 dirty 并返回 saved，不做本地提交。
2. 将提交 patches 和返回版本共同接纳到 original 基线。
3. 将当前行、编辑目标与草稿历史映射到保存后的 rowKey，按该基线重算 dirty。
4. 有实际 changes 时投影后端文件历史、失效缓存并同步 ProjectSession。
5. 后续历史按保存捕获保留，保存状态统一结束。

## 规范

- CSV patch 必须携带读取基线，恢复行必须携带 insertAt；正式 rowKey 删除必须命中实际行，未知键必须返回冲突。
- upsert patch 必须构造提交时的独立行快照，并剥离内部行键字段。
- 保存快照必须在活动输入提交后、关联选择前固定；patches、关联行内容、版本与历史捕获必须属于同一次提交。
- 关联选择必须由 app 层提供可等待回调，取消必须结束准备状态；同一保存面重复触发必须复用进行中的请求。
- 删除 patch 必须携带删除动作标记，严禁以空 upsert 表达删除。
- 保存请求期间的新编辑必须保留，original 必须以实际提交 patches 更新，dirty 必须按该基线重算。
- 保存期间的查询与自身失效必须保留前端草稿；写后 refresh 必须保留与已写盘 after 快照相符的后端行身份。
- 保存状态必须覆盖整个提交窗口，同一编辑器重复触发必须保持当前请求；跨窗口请求必须进入后端队列。
- 关联 spec 动作必须与 CSV 变更构成同一次原子 changeset，严禁分次写入。
- 关联 spec 改名必须按本次 `preserveOriginalJson` 设置更新旧文件文本；需要整体重排时必须在 CSV 与 spec changeset 应用前确认。
- 结构化失效必须由后端从同一 changeset 推导，严禁前端拼装失效路径。
- CSV 保存必须原样保留文件自身的表头、列集、行序与注释行，严禁注入、改写或丢弃任何列；每一种 CSV 的保存都必须附带保存测试，以真实文件格式作为夹具断言结构不变。
- CSV 解析对齐游戏 CSVParser（列数容忍：短行缺失键不写入行 Map、长行多余单元格丢弃；`#` 行与裸空行保留，空 Map 行与全空单元格行可区分），保存渲染按最小引号规则输出 LF 行。

## 陷阱

- 捕获后不校验 session 与状态变化会把保存写到旧目标。
- 只提交当前编辑单元格会丢失同批其它 dirty 变更。
- 绕过排他写会让同表并发保存产生交错 changeset。
- 将规范化后的本地 rowKey 映射写回后端 receipt 会污染提交结果的归属。
- 保存失败后清除 dirty 会让用户误以为已保存。
