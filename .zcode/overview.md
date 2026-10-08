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
- `src/services/`：包装单一后端能力；service 之间默认禁止依赖，仅架构规则白名单内的基础设施边例外。
- `src/orchestrators/`：编排跨模块用户动作（保存、打开、历史、刷新）；依赖图必须单向无环。
- `src/stores/`：保存内存运行态；严禁 IO、确认框或跨模块编排。
- `src/windows/`：管理窗口身份、生命周期与事件。
- `src/shared/`：承载 wire API、runtime、类型与纯工具；`shared/api` 是唯一 invoke 边界。
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

- 实体读取：`组件 -> ViewModel/composable -> service -> shared/api -> Rust command -> project query -> parser/IO/cache`，返回实体数据与资源引用，写入前端按 session 隔离的查询缓存（manifest 由目录打开链路返回）。
- 保存：`组件动作 -> orchestrator -> write service -> shared/api -> Rust write -> changeset 与后端 File History 原子登记 -> ProjectSession refresh -> 结构化失效 -> 界面同步`；编辑器子窗口保存经结构化事件回主窗口补登记历史与 refresh。
- 目录打开：`组件 -> directory-opening orchestrator -> 后端识别（game-root / mod-in-game / external-mod / unknown 类型化 outcome，边界失败走错误通道）-> 游戏概览或 ProjectSession -> workspace/project 运行态`。
- 撤销重做：`快捷键命令 -> 主窗口历史分派 -> CSV 草稿历史优先 -> 文件历史回放（强制用户确认，按已加载会话逐一刷新）-> 编辑器同步`。
- 资源读取：`后端 ResourceRef -> Mod/Core 解析（Core 兜底）-> 批量 data URL -> 前端 query/resource/media 三级缓存与后端 media cache -> 组件`；无上传入口，路径字段只能选择当前 Mod 目录内的文件。
- 窗口同步：`窗口 identity（managed singletonKey + URL 参数 + ViewModel target key）-> managed window -> 全局广播结构化事件、消费端按身份过滤 -> 主窗口保存与 refresh -> dirty 外部版本交接`；草稿快照超 8000 字符丢弃、URL 超 12000 字符报错。

## 边界速查

- 模块级定义、边界、链路与规范写在 `.zcode/modules/` 并经 module-map 索引；overview 只维护项目级边界与整体规则。
- 前端拥有交互、草稿和运行时投影；Rust 拥有磁盘路径、格式解析、FIFO 写入事务、文件历史、版本冲突与 changeset 回放权威。
- session 由 `sessionId + modRoot` 身份约束；按 Mod 归属的缓存、草稿、历史与窗口状态按 `modRoot` 隔离。
- 当前 Mod 数据优先于原版只读数据；资源 fallback、引用解析与 data URL hydration 经后端 query 与批量资源缓存。
- workspace、settings、日志和派生索引只写工具私有目录；Mod 内容与工具私有状态由独立 owner 管理。
- 保存、删除、导入和 undo/redo 必须经所属模块的 changeset 链路；字段编辑服从全局 edit mode。
- 架构边界由 `scripts/architecture` 规则强制（`node scripts/check-architecture.mjs`）；可静态证明的边界不允许只写入文档。
