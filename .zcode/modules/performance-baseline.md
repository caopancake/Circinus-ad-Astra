# 性能基线

## 定义

性能基线系统以正式计时日志和可复现样本记录关键链路性能，不改变业务行为。

## 参考

`src-tauri/src/services/project/performance.rs`：后端 ProjectSession 阶段打点 owner。
`src/app/composables/config/use-config-family-view-model.ts`：配置列表首帧打点消费方。
`src/app/composables/tables/use-csv-table-view-model.ts`：source 目录与查询缓存打点消费方。
`src/app/composables/use-performance-logger.ts`：业务打点 hook。
`src/services/app-log.service.ts`：日志 sink 的接收交接能力，启动时显式注册。
`src/services/resource-media.service.ts`：可视区媒体批次打点消费方。
`src/shared/runtime/performance.ts`：性能记录 owner，拥有计时格式化、记录入口与可注入日志 sink。

## 边界

- 严禁引入临时计时 API、调试分支、样例专用优化或影响保存与 query 语义的观测。
- 基线只用于比较同一场景的端到端阶段，不是功能 fallback 或优化授权。
- 性能记录必须包含输入规模、环境、阶段与结果；结论必须由完整样本统计得出。
- 性能记录必须经可注入 sink 进入应用日志，严禁业务模块自建计时输出。
- 观测入口、样本格式和日志归性能模块；业务调用点只允许提供正式阶段数据。

## 链路

### 前端阶段打点

1. Mod 打开记录 `project.openSession` 的后端阶段与前端 invoke。
2. 新建 Mod 分别记录 `frontend.createModProject` 与 `frontend.openCreatedModProject`。
3. 持久化索引阶段记录 `hit` 或 `miss`。
4. source 目录记录 `frontend.query.sourceCatalog`，字段含 `source、groups、options、ms`。
5. 查询缓存命中记录 `frontend.queryCache`。
6. 可视区媒体批次记录 `frontend.media.visibleBatch`，字段含 `surface、observed、requested、cacheHits、resolved、failed、ms`。
7. 配置列表记录 `frontend.config.listFirstFrame`，起点为列表加载开始，终点为实体行挂载后的下一 animation frame。

### 样本与比较

1. 性能比较必须使用同一 Mod、同一构建与同一操作脚本。
2. `Kratogen_TA 0.5.0` 样本包含 5 次冷启动首帧、10 次同 session 实体切换与 3 次完整滚动。
3. 每组结果报告样本数、最小值、最大值、算术平均值、中位数、nearest-rank P95、前后绝对差与百分比差。

## 规范

- 打点不得引入布局抖动、额外渲染或阻塞保存与 query 语义。
- 打点字段名与取值必须与本文档一致，严禁临时增删字段。
- 打点日志必须进入应用日志链路并遵守其分级与脱敏约束；性能打点为 DEBUG 级，仅在日志级别切至详细（DEBUG）档时落盘，性能采样前必须先切换详细档。
- 打点条目统一为稳定码 `perf`、message `PERF <名称>`、`fields` 携带 `ms` 与阶段参数；后端 `project.openSession` trace 同格式，`stage=total` 条目携带 `modRoot`，其余条目 `stage=<阶段名>`。
- 日志 sink 未注册时打点必须静默丢弃，严禁报错。
- 结构验收必须满足：实体切换新增 source 目录 IPC 数为 0，屏幕外图片 data URL IPC 数为 0，每个冷缓存 source 后端查询数为 1。

## 陷阱

- 为采样改变加载或渲染行为会让基线失去可比性。
- 在业务链路内联计时逻辑会让观测代码随业务分叉。
- 打点进入 error 级别日志会把观测污染成失败信号。
- 用单次采样下结论会把噪声当成回归。
