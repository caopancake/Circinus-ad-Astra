# Backend Guidelines

本文档只记录 Rust 后端必须遵守的长期通用规则。模块级链路、锁序细节与领域实现写入 `.zcode/modules/`。

## 结构

- `src-tauri/src/commands/`：Tauri command 边界，负责参数接收、状态访问、错误转换和调用后端实现。
- `src-tauri/src/services/`：后端能力实现，涵盖目录打开、ProjectSession、配置实体、文件变更、文件编辑器、新建 Mod、schema 字段扫描、系统打开、应用配置、应用路径、应用设置、应用日志、workspace 持久化与资源。
- `src-tauri/src/services/project/`：ProjectSession 内部按 `root`、`session`、`query`、`write`、`resources`、`cache` 与 `model` 分层。
- `src-tauri/src/domain/`：纯业务规则（配置实体定义、Mod 创建规则）。
- `src-tauri/src/io/`：路径边界、文件读写与 changeset 应用。
- `src-tauri/src/parsers/`：CSV-like 与 JSON-like 解析和渲染。
- `src-tauri/src/models/`：wire 模型、内部模型与归一化映射。

## 架构设计

本节记录后端结构的既定设计决策，条款自带分层与策略理由。

- command 只处理 wire payload、错误转换和 service 调用。分层依据是 wire 形状、领域实现与持久化细节的变更节奏不同，混层无法单点验证。
- query 必须只读，write 必须执行目标写入且严禁重开 ProjectSession；write 返回实际 changes、结构化 invalidation 与保存结果，无法定位实体 ID 时只扩大到该实体类型的正式全类 scope。
- session 必须由 `sessionId + modRoot` 身份约束；注册表只允许保护句柄表，session 状态必须各自持锁，跨 session 操作严禁互阻。已登记 session 必须保留至显式关闭。
- 所有外部路径必须重新 canonicalize 并验证属于声明 root；已有父链中的 symlink、junction 与 reparse point 一律拒绝。默认拒绝让边界漂移成为硬失败，而不是依赖人肉 review。
- 保存、删除、导入与回放必须先构建文件或目录快照，再由 IO 应用可回放 changeset；目录变更必须展开为正式目录事件，保证失效推导精确。
- 已知 CP1252 智能引号归一化映射唯一 owner 在 models，读取时执行并随保存不可逆写回；parsers 与 io 复用同一份。
- 持久化索引只存工具私有目录并按 canonical `modRoot` 分片；读取前必须以内容指纹校验，不一致即丢弃重建，损坏或不可写只降级不阻塞。
- workspace、settings、日志与派生索引只写工具私有目录，严禁写入 Mod 目标。

## Rust 约定

- 写入必须由 write_transactions 协调 FIFO 租约、会话、基线版本和 file_history；file_history 只允许持有内存历史并依赖 IO 与模型。
- command payload 必须只由 command 消费；会话授权接口必须使用 models 中的 SessionModScope。
- `#[tauri::command]` 只允许出现在 `src-tauri/src/commands/`。
- command 层只负责参数接收、状态访问、错误转换和调用后端实现；严禁承载解析、扫描或写盘实现。
- command 错误必须携带可定位上下文（路径、行、位置）与稳定语义，前端负责动作归类与呈现。
- 同步 query/invalidate 类 command 标注 `(async)` 经异步运行时执行，不占主线程；含网络或磁盘等待的链路必须显式 await。
- 跨模块引用只经正式公开入口；`shared` 不得依赖业务模块。
- clippy 零 warning；模块按作用域拆分，严禁单文件承载多类职责。
- 任何磁盘与回放行为必须复用统一路径校验，禁止旁路实现。

## 代码习惯

本章按理想标准书写；现有代码与本标准不一致时，以本标准为目标逐步收敛，不为现状放宽。

### 命名与语言惯用法

- 文件与模块 snake_case；类型 PascalCase；函数与变量 snake_case；常量 UPPER_SNAKE_CASE。
- 公开名称表达业务能力和 owner；禁止 `tmp`、`mgr` 一类占位名与职责不清缩写。
- Option / Result 流程优先用组合子（`map`、`and_then`、`ok_or`、`filter_map`）表达，不展开嵌套 match。
- 语义值用 newtype 承载，不在使用点反复校验裸值。
- 边界转换实现 `From`，调用侧用 `?`；严禁手写重复转换函数。
- 非测试路径禁止 `unwrap()`；`expect()` 仅用于不变量断言且消息说明不变量。

### 错误处理姿势

- 错误必须携带 path、记录序号或位置上下文，让前端能定位到具体文件与字段。
- 解析结构错误必须显式抛出，严禁静默吞掉或用默认值掩盖。
- 失败必须保留上下文并让前端保持 dirty，严禁提交成功状态。
- 回放前必须重校验全部路径归属与父链，严禁信任历史记录中的旧路径。

### 模块与文件拆分

- 拆分依据是职责边界，不是行数；单文件承载多类职责时按层归位拆出。
- command 层不写业务算法；领域规则归 domain，磁盘效果归 io，解析归 parsers。
- 同一 owner 的测试与实现同文件，按实体参数化覆盖全部行为。

### 测试与验收习惯

- 新解析、归一化、回放与实体动作必须带正反例测试。
- 测试断言行为与输出协议，不复制生产实现细节。

## 序列化约定

- wire 模型 serde 序列化为 camelCase，与前端类型一一对应；内部模型不受 wire 形状约束。
- 严禁随意变更 Tauri command 名称、serde 字段、事件名或持久化文件格式；确需变更时必须同步迁移与文档。
- 持久化格式版本变化必须与内容指纹校验联动，旧快照一律丢弃重建。

## 日志与错误

- 失败必须返回携带上下文的错误；用户可感知问题必须落到日志或前端反馈。
- 诊断信息写入日志，严禁进入 wire 返回值污染前端状态。
- 无法恢复的内部错误降级记录时必须保留原始消息，严禁静默吞掉。
- 高风险区：路径边界与父链、格式解析、changeset 回放、持久化缓存指纹。改动这些区域必须带正反例测试并全量回归。

## 注释规范

- 注释一律使用英文；现状与标准不一致时按本标准逐步收敛。
- 尽可能少写注释：优先通过命名、类型与结构让代码自解释。
- 必须注释的场景：冻结的常量、算法或外部协议；顺序或事务敏感的边界（锁序、成对调用、不可重入）；约束来源与看似多余但必需的步骤；workaround 及其移除条件。
- 禁止注释的场景：复述代码行为、历史叙事、无追踪目标的 `TODO` / `FIXME`、注释掉的代码。
- 格式约定：`///` doc comment 只用于公开契约（参数、返回、失败语义）；`//` 行注释用于约束与意图；完整句或祈使句；单行优先，不写装饰性分隔注释块。
