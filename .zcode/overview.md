# Overview

Circinus ad Astra 是一个 Windows 桌面 Starsector Mod 配置工具，目标是把 Mod 的表格、spec、配置实体与文件编辑放进同一个受控产品里。

## 项目目标

- 统一管理已加载 Mod 的 CSV 表格、`.ship/.wpn/.proj/.system` 规格与配置实体编辑
- 以 ProjectSession 驱动实体 query、受权写入与写后精确失效
- 维护文件级与表格级两套草稿历史，支持撤销、重做与确认回放
- 提供舰船/武器画布编辑器、弹体编辑窗口与只读发射预览
- 统一资源引用、贴图批量解析与原版只读回退

## 技术栈

- Tauri 2
- Rust
- Vue 3 + TypeScript
- Pinia
- Naive UI
- Canvas 2D
- Vite

## 路径与职责速查

### 前端

- `src/app/`：承载窗口根、页面、组件、检查器与 ViewModel/composable；应用级装配在这里收口，不承载领域规则与后端能力。
- `src/domain/`：承载纯规则与转换（编辑会话原语、schema 加载、主题令牌、表格与画布规则）；严禁依赖 app、services 或 stores。
- `src/services/`：包装单一后端能力；横向依赖必须满足声明的能力依赖矩阵，公开操作按导入符号及正式 owner 授权。
- `src/orchestrators/`：编排跨模块用户动作（保存、打开、历史、刷新）；依赖图必须单向无环。
- `src/stores/`：保存内存运行态；严禁 IO、确认框或跨模块编排。
- `src/windows/`：管理窗口身份、生命周期与事件。
- `src/shared/`：承载 runtime、类型、纯工具与查询/持久化 wire 能力；command.runtime 是唯一原始 invoke 边界。
- `schemas/`：保存配置字段与 CSV 列 schema 资产，经唯一加载入口消费。
- `src/styles/`：承载全局主题、应用框架和业务样式。

### Rust

- `src-tauri/src/commands/`：处理 wire 参数、错误转换和 service 调用。
- `src-tauri/src/services/`：提供目录打开、ProjectSession、配置实体、文件变更、文件编辑器、新建 Mod、schema 字段扫描、系统打开、应用配置、应用路径、应用设置、应用日志、workspace 持久化与资源能力。
- `src-tauri/src/services/project/`：按 root、session、query、write、resources、cache 与 model 分工；query 只读，write 返回 changeset 与结构化 invalidation。
- `src-tauri/src/domain/`：保存纯业务规则。
- `src-tauri/src/io/`：保存路径和文件边界。
- `src-tauri/src/parsers/`：保存格式解析与渲染。
- `src-tauri/src/models/`：保存 wire 和内部模型。

### 跨层链路

- 实体读取：`组件 -> ViewModel/composable -> 读取能力 -> command.runtime -> Rust command -> project query -> parser/IO/cache`，返回实体数据与资源引用，写入前端按 session 隔离的查询缓存（manifest 由目录打开链路返回）。
- 保存：`组件动作 -> orchestrator -> 写入能力 -> command.runtime -> Rust FIFO 事务 -> changeset、File History 与会话投影 -> receipt 基线接纳 -> 历史、manifest 与缓存接纳 -> 统一提交事件`；待同步结果经原提交恢复入口继续接纳。
- 目录打开：`组件 -> directory-opening orchestrator -> 后端识别（game-root / mod-in-game / external-mod / unknown 类型化 outcome，边界失败走错误通道）-> 游戏概览或 ProjectSession -> workspace/project 运行态`。
- 撤销重做：`快捷键命令 -> 主窗口历史分派 -> CSV 草稿历史优先 -> 文件历史回放（强制用户确认，按已加载会话逐一刷新）-> 编辑器同步`。
- 资源读取：`后端 ResourceRef -> Mod/Core 解析（Core 兜底）-> 批量 data URL -> 前端 query/resource/media 三级缓存与后端 media cache -> 组件`；无上传入口，路径字段只能选择当前 Mod 目录内的文件。
- 窗口同步：`判别窗口 identity -> window service/wire -> Rust 身份与原生实例登记 -> 结构化提交/身份事件 -> 当前目标快照与未保存交接`；草稿快照超 8000 字符丢弃、URL 超 12000 字符报错。

## 边界速查

- 模块级定义、边界、链路与规范写在 `.zcode/modules/` 并经 module-map 索引；overview 只维护项目级边界与整体规则。
- 前端拥有交互、草稿和运行时投影；Rust 拥有磁盘路径、格式解析、FIFO 写入事务、文件历史、版本冲突与 changeset 回放权威。
- session 由 `sessionId + modRoot` 身份约束；按 Mod 归属的缓存、草稿、历史与窗口状态按 `modRoot` 隔离。
- 编辑目标必须由后端加载记录提供实际来源、写入目标与关联记录；写入、版本及回放必须共同消费该定义。
- 规格身份修改必须经同一事务交接业务 ID、所属 CSV 或索引与实际文件名；窗口原生 label 必须保持稳定。
- 当前 Mod 数据优先于原版只读数据；资源 fallback、引用解析与 data URL hydration 经后端 query 与批量资源缓存。
- workspace、settings、日志和派生索引只写工具私有目录；Mod 内容与工具私有状态由独立 owner 管理。
- 保存、删除、导入和 undo/redo 必须经所属模块的 changeset 链路；字段编辑服从全局 edit mode。
- 架构边界由 `scripts/architecture` 规则强制（`node scripts/check-architecture.mjs`）；可静态证明的边界不允许只写入文档。
- 依赖规则必须消费同一份实际节点、类型与运行时边及符号来源；层级、模块与能力事实必须具有唯一检查 owner。
