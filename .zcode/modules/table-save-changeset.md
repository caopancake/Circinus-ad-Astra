# 表格保存与变更集

## 定义

表格保存与变更集系统将当前 CSV dirty patches 与用户确认的关联 spec 动作组成一次原子文件 changeset。

## 参考

`src/orchestrators/table-save.orchestrator.ts`：保存编排 owner，拥有目标捕获、noop 判定、patch 构造与保存后提交。
`src/services/write.service.ts`：排他写 owner，拥有同目标互斥与 changeset 提交。
`src/shared/api/write-api.ts`：CSV 保存 wire API。
`src/domain/tables/associated-spec-candidates.ts`：关联 spec 候选 owner。
`src/domain/tables/csv-dirty.ts`：dirty 行形状 owner。
`src/orchestrators/file-history-write.orchestrator.ts`：保存完成登记 owner。
`src-tauri/src/services/project/write/`：后端写入 owner，合成 CSV 与关联目标并构建 changeset。
`src/orchestrators/table-save.orchestrator.spec.ts`：保存编排行为测试。

## 边界

- 关联动作仅允许该表正式声明的关联目标，严禁为未声明的表或实体生成动作。
- 重命名必须经 JSON-like 解析器处理，严禁字符串替换。
- 无实际 changes 严禁记 history、清草稿或生成空文件；任一失败严禁提交本地保存状态。
- 捕获目标必须与当前 manifest session 和 tables 状态一致，任一变化即放弃本次保存。
- 排他写冲突必须以带动作的 AppError 上抛，严禁静默排队或丢弃。
- 保存完成登记必须在 dirty 清理之前完成，严禁先清后记。

## 链路

### 捕获保存目标

1. 用户触发保存或 Ctrl+S 进入保存编排。
2. 编排结束单元格编辑并确认活动 Mod 与表。
3. 校验 manifest 的 `modRoot` 与 session 与当前运行态一致。
4. 收集关联 spec 候选并返回捕获目标。

### 提交保存

1. 目标为空或已在保存中时返回 noop。
2. 当前表无 dirty 时返回 noop。
3. 从 dirty 构造 patches：upsert 剥离内部行键，删除行动作携带空行。
4. 调用排他写提交 patches 与关联动作。
5. 后端校验 session/root，合成 CSV 与关联目标，构建并应用原子 changeset。
6. 返回写结果、rowKey map 与结构化失效。

### 保存后提交

1. session 已变化时保留 dirty 并返回 saved，不做本地提交。
2. 有实际变更时先完成文件历史登记并触发 refresh。
3. 应用 rowKey 映射并标记表已保存。
4. 清空当前表草稿历史并结束保存状态。

## 规范

- upsert patch 必须构造提交时的独立行快照，并剥离内部行键字段。
- 删除 patch 必须携带删除动作标记，严禁以空 upsert 表达删除。
- 保存请求期间的新编辑必须保持 dirty，写盘结果只能作为外部变更暂存。
- 保存状态必须覆盖整个提交窗口，期间重复触发必须被排他写拒绝。
- 关联 spec 动作必须与 CSV 变更构成同一次原子 changeset，严禁分次写入。
- 关联 spec 改名必须按本次 `preserveOriginalJson` 设置更新旧文件文本；需要整体重排时必须在 CSV 与 spec changeset 应用前确认。
- 结构化失效必须由后端从同一 changeset 推导，严禁前端拼装失效路径。
- CSV 保存必须原样保留文件自身的表头、列集、行序与注释行，严禁注入、改写或丢弃任何列；每一种 CSV 的保存都必须附带保存测试，以真实文件格式作为夹具断言结构不变。
- CSV 解析对齐游戏 CSVParser（列数容忍：短行缺失键不写入行 Map、长行多余单元格丢弃；`#` 行与裸空行保留，空 Map 行与全空单元格行可区分），保存渲染按最小引号规则输出 LF 行。

## 陷阱

- 捕获后不校验 session 与状态变化会把保存写到旧目标。
- 只提交当前编辑单元格会丢失同批其它 dirty 变更。
- 绕过排他写会让同表并发保存产生交错 changeset。
- 无变更时仍记历史或清草稿会让撤销链出现空洞。
- 保存失败后清除 dirty 会让用户误以为已保存。
