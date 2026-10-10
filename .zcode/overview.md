# Overview

Circinus ad Astra 是一个 Windows 桌面 Starsector Mod 配置工具，统一管理 Mod 表格、规格、配置实体和文件编辑，并提供受控的保存、历史、资源和窗口能力。

## 项目目标

- 管理已加载 Mod 的 CSV、`.ship`、`.wpn`、`.proj`、`.system` 规格和配置实体。
- 以项目会话隔离实体读取、授权写入、缓存、草稿、历史和窗口状态。
- 提供字段编辑、舰船与武器画布、弹体编辑、只读发射预览和资源引用。
- 保存、回放、外部更新和窗口交接遵循统一的目标、版本和生命周期原则。

## 技术栈

- Tauri 2
- Rust
- Vue 3 + TypeScript
- Pinia
- Naive UI
- Canvas 2D
- Vite

## 宏观层级

### 前端

- `src/app/`：窗口根、页面、组件、检查器与 ViewModel/composable；应用装配在这里收口，不承载领域规则与后端能力。
- `src/domain/`：编辑会话、表格、schema、配置、设置、workspace 和编辑器的纯规则与转换；严禁依赖 app、services、stores 或 windows。
- `src/services/`：单一后端能力包装、参数装配和结果交接；跨进程能力不得由组件、store 或 domain 直接调用。
- `src/orchestrators/`：保存、打开、导航、历史、刷新、生命周期和身份交接；拥有确认、等待、恢复和失效顺序。
- `src/stores/`：内存运行态、manifest、表格、历史、设置、Core 和 workspace 状态；严禁拥有 IO、确认框或跨模块编排。
- `src/windows/`：窗口 identity、URL、原生实例、事件过滤、关闭请求和销毁生命周期。
- `src/shared/`：`command.runtime`、wire 类型、错误、读取票据、缓存、事件和纯工具；原始 `invoke` 只允许由 `command.runtime` 消费。
- `schemas/`：配置字段、CSV 列和规格默认模板资产，经正式加载 owner 消费。
- `src/styles/`：全局主题、应用框架和业务样式。

### Rust

- `src-tauri/src/commands/`：处理 wire 参数、状态访问、错误转换和 service 调用。
- `src-tauri/src/services/`：提供目录打开、workspace、ProjectSession、配置、文件、设置、日志、Core、资源和窗口能力。
- `src-tauri/src/services/project/`：按 root、session、query、write、resources、cache 和 model 分工；query 只读，write 返回实际 changeset、版本和 invalidation。
- `src-tauri/src/services/write_transactions/`：协调 FIFO 根租约、目标版本、文件历史、会话投影和提交恢复。
- `src-tauri/src/domain/`：保存实体定义、编辑目标、资源引用、Mod 创建规则和纯业务投影。
- `src-tauri/src/io/`：保存 canonical 路径边界、文件读写、目录快照、改名和 changeset 应用。
- `src-tauri/src/parsers/`：保存 CSV-like、JSON-like、spec 和文本解析、渲染及诊断位置。
- `src-tauri/src/models/`：保存 wire 模型、内部模型、归一化映射和结构化错误数据。

## 跨层链路

- 目录与会话：目录选择 → `directory-opening orchestrator` → `detect_directory` → canonical root → `open_project_session` → `ProjectSession` → workspace runtime
- 查询与编辑目标：组件 → `ViewModel/composable` → query service → `command.runtime` → Rust `ProjectSession` query → parser/IO/cache → `EntityData`、`EntityEditTarget` 与 `ResourceRef` → 前端 query cache
- 保存事务：`EditSession` → save orchestrator → 目标与版本准备 → write service → `command.runtime` → Rust FIFO transaction → changeset、`File History` 与 `ProjectSession projection` → `WriteResult`
- 写后接纳：`WriteResult` → committed-write synchronizer → `synchronize_committed_write` → projection revision → resource/query invalidation → manifest、列表、历史和窗口接纳
- 历史回放：main history dispatch → CSV draft history 优先 → `File History` replay plan → 当前路径和版本复核 → changeset replay → `ProjectSession refresh`
- 资源读取：`ResourceRef` → resource-reference service → Rust root authorization → Mod/Core resource query → resource/media cache → 组件展示
- Core 生命周期：`WindowShell` → Core orchestrator → fields/graphics command → Rust Core index → root generation → Core store
- 窗口生命周期：业务 identity → window service → Rust native registry → 原生窗口与目标占用 → identity event → URL、标题、目标和 dirty 接纳 → close guard 与释放
- workspace 生命周期：workspace action → pending/save wait → 子窗口关闭 → cache invalidation → `close_project_session` → tables/project/editor/history/store cleanup → restore 或总览

## 项目内关键链路

- `sessionId + modRoot` 必须贯穿 ProjectSession、query、write、cache、history、window 和事件；任何调用不得使用活动 Mod、裸路径或字符串拼接补齐身份。
- 实际编辑目标只能由 `query_entity_edit_target`、`query_text_identity_intent` 或后端恢复目标提供；前端不得扫描磁盘或构造正式目标。
- 所有写入必须经过 `write_transactions::begin`、版本复核和统一 `WriteResult`；组件、store、query 和资源能力不得直接写文件。
- `WriteResult` 接纳顺序固定为实际基线、File History、ProjectSession projection、resource/query cache、列表和窗口事件；pending 只能通过 `synchronize_committed_write` 恢复。
- CSV draft history 与 File History 是不同 owner；当前表格 operation 必须优先，文件回放不得绕过 CSV 草稿历史。
- replay 必须重新校验当前路径、父链、版本、session 和目标；历史记录只能提供候选 changeset，不提供当前授权。
- `ReadTicket` 必须同时拥有读取身份、取消信号、Promise 和接纳状态；失效或关闭只结束所属等待，迟到结果不得写入新生命周期。
- `ResourceRef` 必须由后端授权并绑定 session、source 和规范化相对路径；Core fallback 只读，不能把 Core 内容写入 Mod。
- resource cache、media cache、visible registry 和超额 data URL 必须共同服从引用生命周期；可见媒体必须增量释放，菜单与已选值资源不得互相覆盖。
- Core fields 与 graphics 必须由同一 WindowShell 生命周期分别加载；root、generation、A-B-A、根清空和窗口销毁是唯一接纳条件。
- 窗口 identity 必须包含完整 session、`modRoot`、kind 和业务目标；原生 label、目标占用、URL、标题、事件过滤和 ViewModel 目标必须共同交接。
- dirty 或 saving 窗口必须先拦截关闭；保存、pending 恢复和最新 dirty 判定完成前不得销毁窗口、移除 Mod 或关闭 session。
- workspace、settings、日志和派生索引只允许写工具私有目录；Mod、Core 和用户外部目录必须由所属 path owner 授权。
- 子窗口只允许消费主窗口 settings snapshot；主窗口拥有 settings 持久化，子窗口不得自行读盘、补默认值或广播镜像。
- 结构化错误必须保留稳定码、原始诊断、路径、行列、action、command 和 payload；用户文案、日志诊断和恢复授权不得互相推导。
