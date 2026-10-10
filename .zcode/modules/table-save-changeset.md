# 表格保存与变更集

## 定义

表格保存与变更集系统将当前 CSV dirty patches 与用户确认的关联 spec 动作组成一次原子文件 changeset。

## 参考

`src-tauri/src/domain/spec_construction.rs`：关联规格创建构造与武器类型约束 owner。
`src-tauri/src/services/project/write/`：后端写入 owner，合成 CSV 与关联目标并构建 changeset。
`src/domain/tables/associated-spec-candidates.ts`：关联 spec 候选与动作快照 owner。
`src/domain/tables/associated-spec-creation.ts`：CSV 到创建参数与武器评分 owner。
`src/domain/tables/csv-dirty.ts`：dirty 行形状 owner。
`src/orchestrators/file-history-write.orchestrator.ts`：保存完成登记 owner。
`src/orchestrators/table-save.orchestrator.spec.ts`：保存编排行为测试。
`src/orchestrators/table-save.orchestrator.ts`：保存编排 owner，以 `saveTableChanges` 拥有明确 Mod/表的输入提交、快照捕获、关联选择、写入与 receipt 接纳。
`src/orchestrators/entity-identity.orchestrator.ts`：跨窗口关联表准备、短暂表锁与写结果交接 owner。
`src/services/csv-table.service.ts`：CSV 查询与保存能力包装，提交 patches、版本凭据与关联动作。

## 边界

- 关联动作仅允许该表正式声明的关联目标，严禁为未声明的表或实体生成动作。
- 同根跨窗口写入必须由 Rust FIFO 排队；基线冲突必须以带动作的 AppError 上抛并保留草稿。
- 后端文件历史必须与写盘同事务完成；前端必须先接纳写结果，再投影该结果的文件历史与刷新。
- 已写盘结果必须先更新行基线、版本与历史映射，再执行后续同步；同步失败必须保留已接纳状态并结束等待交接。
- 捕获目标必须与当前 manifest session 和 tables 状态一致，任一变化即放弃本次保存。
- 文件历史只允许登记实际 changes；成功的原样保存必须接纳返回版本与提交行基线，写入失败必须保留草稿。
- 重命名必须经 JSON-like 解析器处理，严禁字符串替换。

## 链路

### 捕获保存目标

1. 用户触发保存或 Ctrl+S 进入保存编排。
2. 编排捕获完整目标并持有准备与保存状态。
3. 所属输入集合逐项提交原始输入，编排复核目标、session 与 tables 状态。
4. 编排捕获独立 patches、版本凭据、关联候选与历史身份集合。

### 提交保存

1. 目标为空或当前表无 dirty 时返回 noop；进行中的保存由同一 Promise 表达。
2. app 层选择回调展示快照中的关联候选与创建类型，返回选定动作或取消。
3. 编排复核目标并消费同一快照中的 patches、关联动作与版本。
4. 调用排他写提交 patches 与关联动作。
5. 后端校验 session/root 与关联种类，按创建参数构造规格或解析已有来源更新 ID，构建并应用原子 changeset。
6. 返回写结果、rowKey map 与结构化失效。

### 保存后提交

1. session 已变化时保留 dirty 并返回 saved，不做本地提交。
2. 将提交 patches 和返回版本共同接纳到 original 基线。
3. 将当前行、编辑目标与草稿历史映射到保存后的 rowKey，按该基线重算 dirty。
4. 完整 receipt 进入统一接纳入口，投影历史、会话更新及缓存并发送提交通知。
5. 后续历史按保存捕获保留，保存状态统一结束。

## 规范

- CSV patch 必须携带读取基线与 isComment，恢复行必须携带 insertAt；正式 rowKey 删除必须命中实际行，未知键必须返回冲突。
- CSV 保存必须原样保留文件自身的表头、列集、行序与注释行，严禁注入、改写或丢弃任何列；每一种 CSV 的保存都必须附带保存测试，以真实文件格式作为夹具断言结构不变。
- CSV 解析对齐游戏 CSVParser（列数容忍：短行缺失键不写入行 Map、长行多余单元格丢弃；`#` 行与裸空行保留，空 Map 行与全空单元格行可区分），保存渲染按最小引号规则输出 LF 行。
- upsert patch 必须构造提交时的独立行快照，业务内容只允许从行记录 data 独立克隆，恢复位置必须从 insertAt 装配。
- upsert 的注释标记必须与业务快照共同固定并更新实际基线；关联规格候选必须消费原始行及当前行的正式注释身份。
- 保存快照必须在活动输入提交后、关联选择前固定；patches、关联行内容、版本与历史捕获必须属于同一次提交。
- 保存期间的查询与自身失效必须保留前端草稿；写后 refresh 必须保留与已写盘 after 快照相符的后端行身份。
- 保存状态必须覆盖整个提交窗口，同一编辑器重复触发必须保持当前请求；跨窗口请求必须进入后端队列。
- 再次保存必须先重试所属待同步 receipt；恢复成功后必须提交当前输入并捕获新快照，空闲保存必须保持即时捕获顺序。
- 保存请求期间的新编辑必须保留，original 必须以实际提交 patches 更新，dirty 必须按该基线重算。
- 关联 spec 动作必须与 CSV 变更构成同一次原子 changeset，严禁分次写入。
- 关联目标与版本必须在确认前捕获；正式提交必须携带 AssociatedSpecWrite 的动作与实际 EntityEditTarget。
- 已有来源的保存、删除与改名必须消费实际已加载路径；改名必须保留原目录，来源缺失必须消费所属默认创建构造。
- 保存入口必须显式接收 manifest 与 table，结果必须共同表达 status 与已写盘 receipt；关联表准备必须复用该动作。
- 规格保存前必须提交并保存所属 CSV 草稿；取消或失败必须保留规格编辑面，完成准备后必须锁定所属表。
- 表锁必须覆盖提交与本地 receipt 接纳；锁定期间必须保持读取接纳与编辑动作归属，失败、窗口销毁和会话结束必须释放锁。
- 表格身份释放事件必须按原请求的 session 和 Mod 核对当前会话；回执只允许更新所属行与基线，会话重开后必须仅释放原锁。
- 表运行态只允许接纳所属 CSV 的基线版本；规格版本必须归关联保存快照与实体记录。
- 关联 spec 改名必须按本次 `preserveOriginalJson` 设置更新旧文件文本；需要整体重排时必须在 CSV 与 spec changeset 应用前确认。
- 关联候选列表必须在当前窗口内独立滚动，确认与取消必须保持可操作。
- 关联创建必须携带所属格式的创建参数；删除必须携带 ID，重命名必须携带原 ID 与目标创建参数。
- 关联确认必须提供 projectile 与 beam 调整入口，并显示“pulse 在原版中无法正常处理，武器类型只允许 projectile 和 beam。”。
- 关联选择必须由 app 层提供可等待回调，取消必须结束准备状态；同一保存面重复触发必须复用进行中的请求。
- 删除 patch 必须携带删除动作标记，严禁以空 upsert 表达删除。
- 已有来源重命名必须保留全部业务内容并更新 ID；来源缺失的创建必须消费共享模板与目标创建参数。
- 武器初始分支必须按 10 项 projectile 字段与 3 项 beam 字段的非空原文计分；零值必须计分，平分必须选择 projectile。
- 结构化失效必须由后端从同一 changeset 推导，严禁前端拼装失效路径。

## 陷阱

- 捕获后不校验 session 与状态变化会把保存写到旧目标。
- 只提交当前编辑单元格会丢失同批其它 dirty 变更。
- 绕过排他写会让同表并发保存产生交错 changeset。
- 将规范化后的本地 rowKey 映射写回后端 receipt 会污染提交结果的归属。
- 保存失败后清除 dirty 会让用户误以为已保存。
