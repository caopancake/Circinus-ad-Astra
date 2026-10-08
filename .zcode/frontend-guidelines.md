# Frontend Guidelines

本文档只记录 Vue 前端必须遵守的长期通用规则。模块级链路、具体页面行为和领域实现细节写入 `.zcode/modules/`；CSS 规范见 `.zcode/css-guidelines.md`。

## 架构设计

本节记录前端结构的既定设计决策。目录职责速查见 overview，模块级归属见 module-map 与对应模块文档。

- 分层职责：`app` 组合装配与页面，`domain` 拥有纯规则与转换，`services` 包装单一后端能力，`orchestrators` 编排跨模块动作，`stores` 持有内存运行态，`windows` 管理窗口身份与事件，`shared` 承载 wire API、runtime、类型与纯工具。分层依据是交互、规则、后端能力、编排、运行态与窗口身份的变更节奏和验证方式各不相同，混在一层无法单点约束。
- 依赖方向单向：`app -> orchestrators/stores/services/domain/shared`；orchestrator 之间必须单向无环；`stores -> stores/domain/shared`；`domain -> domain/shared`；`shared -> shared`。反向依赖会让下层规则与能力被上层语义污染。
- service 横向依赖必须满足共享能力依赖矩阵；新增关系必须同步正式职责、矩阵和合法及违规行为测试。
- 后端能力必须按实际节点和导入符号授权；混合类型导入必须逐绑定判定，namespace、转导出与动态导入必须保留正式能力来源。
- 查询、订阅、项目失效与会话清理必须分别授权；项目失效归 ProjectSession 刷新编排，会话清理归工作区生命周期编排。
- 组件必须经 ViewModel/composable 消费状态与动作；ViewModel 严禁直连 `shared/api`。组件直连后端会让错误语义、失效与权限校验脱离编排边界。
- draft 提交为显式模型：交互与输入在动作边界提交 draft 并记录撤销，严禁深度同步 watch 携带业务副作用。
- 延迟提交输入必须登记到所属目标会话；原文与正式草稿必须分别拥有状态，保存、关闭、替换与外部更新必须消费同一输入集合。
- 状态、缓存、历史与窗口上下文按 `modRoot` 隔离；跨窗口与外部更新必须携带完整 session、Mod 与目标身份。
- 领域文件按业务域归位（`domain/editors`、`domain/tables`、`domain/schema`、`domain/config`、`domain/settings`、`domain/workspace`），不按技术角色分桶；改动半径必须与业务边界重合。

## 结构分工

- `src/app/`：窗口根、页面、组件、检查器与 ViewModel/composable；应用级装配在这里收口。
- `src/domain/`：纯规则、原语与转换；严禁依赖 app、services、stores 或 windows。
- `src/services/`：单一后端能力包装；跨进程业务能力必须先由 service 包装再被消费。
- `src/orchestrators/`：跨模块用户动作编排；拥有失效顺序、确认与回滚语义。
- `src/stores/`：内存运行态；每个 store 一个 `.store.ts` 文件。
- `src/windows/`：窗口身份、生命周期、事件名与事件封装。
- `src/shared/`：wire API（唯一 invoke 边界）、runtime、类型与纯工具。
- `schemas/`：配置字段与 CSV 列 schema 资产，只能经统一加载入口消费。

## 硬性调用链

- 页面和组件不直接散写 `invoke()`；固定链路是 `Vue -> ViewModel/composable -> service -> shared/api -> Rust command`。
- 保存链路固定为 `组件动作 -> orchestrator -> write service -> shared/api -> Rust FIFO 事务 -> changeset 与文件历史 -> ProjectSession refresh -> 界面同步`；链路外的写入路径一律禁止。
- 撤销重做分派固定为快捷键命令、CSV 草稿历史优先、文件历史回放兜底；命令解析与分发归唯一 owner，严禁组件自建全局键盘监听。
- 全局启动恢复只由窗口挂载入口协调；页面不得直接调用恢复动作。
- 缓存失效与派生状态同步必须位于编排事务边界，不在页面局部手补。
- 配置写入必须由配置保存编排消费，CSV patch 必须由表格保存编排消费，规格和文本写入必须分别由 editor 与 files 能力消费，changeset 回放必须由文件历史回放编排消费。
- 文件历史读取与清空 wire 能力必须由文件历史 service 消费；会话打开、关闭、刷新和 Core 清理必须分别由目录打开、生命周期与刷新边界拥有。
- invoke 必须由 wire API 消费；反馈运行时与工厂必须由统一反馈 hook 消费，并接受转导出后的能力检查。
- 跨模块 payload 用 `null` 表示无值；表单内部可用空字符串，提交或 IPC 边界必须显式转换。
- 语义 ID、路由目标与跨层提交 ID 必须在来源边界表达解析语义，不在业务链路直接 `String(id)`。

## 代码习惯

本章按理想标准书写；现有代码与本标准不一致时，以本标准为目标逐步收敛，不为现状放宽。

### 命名与语言惯用法

- Vue 组件文件 PascalCase；composable 前缀 `use*`；store 文件 `*.store.ts`；类型 PascalCase。
- 名称表达领域语义；禁止 `data`、`item`、`value`、`result` 一类占位名。
- 互斥状态用判别联合表达，不用多个布尔标志组合。
- 不可信输入（IPC 返回、外部更新）声明为 `unknown` 并收窄；禁止 `any`。
- 提交与 IPC 输入必须经归一化函数；解析禁止裸 `Number()` / `String()`，解析失败是显式分支，不产生 NaN 或空串。
- 函数保持单一抽象层级，早返回；协议转换、业务判断与展示组装不得混排在同一函数。
- 禁止 `as any`；类型断言不得替代输入校验。

### 错误处理习惯

- 预期错误（业务拒绝、写入失败、输入非法）由 service/orchestrator 抛出携带 `action` 的 `AppError`，这是架构规则强制的边界。
- 一次用户动作只产生一条错误提示；action 内 toast 与 rethrow 不并存。
- 错误呈现必须经 `formatError` 与统一反馈入口；禁止裸 `String(error)` 或 `error?.toString()`。
- 禁止空 catch：任何 catch 分支必须提示、上报或恢复。

### 组件、状态与模块拆分

- 组件负责展示与局部交互；窗口与页面负责装配 ViewModel。
- 状态归属按顺序选择：组件局部 state -> composable -> store；能放局部的不上收。
- 拆分依据是状态与职责边界，不是行数或复用次数；跨视图共享的派生信息抽 composable。
- 组件不得兼管缓存、失效或状态恢复；超出展示职责的复杂度移回编排或 ViewModel。
- Naive UI 组件接线：模板直接使用的组件经 `naive-ui.runtime.ts` 全局异步注册；仅 script 内动态渲染（h 调用）或非模板场景允许直接 `import` 自 `naive-ui/es/*`。

### Store 形态

- store 文件命名为 `<域>.store.ts`，用 `defineStore` setup 风格定义。
- store id 用 kebab-case 并与文件名对齐（`file-history` 对应 `file-history.store.ts`）；禁止 camelCase 或与文件名脱节的 id。
- store id 是 Pinia 内部标识符，禁止按 id 动态访问 store；store id 与持久化文件、事件名互不相干。
- 从 store 解构响应式字段必须用 `storeToRefs`；一次性解构会静默丢失响应性。
- store 严禁拥有 IO、确认框或跨模块编排；保存类动作经注册表分派。

### 测试与验收习惯

- 原语、解析、归一化、命令分派与保存编排的纯逻辑改动必须补 vitest 正反例。
- 错误输入按规则失败是验收内容，不是可选项。
- 测试断言行为与输出协议，不复制生产实现细节。

## 交互约定

- 用户可见错误、警告与确认统一走 `AppFeedback`；禁止 `String(error)` 后直接提示。
- 前端日志只走应用日志链路；业务模块禁止遗留 `console.*`。
- store 默认不直接 toast；用户反馈放在页面组合、编排或明确反馈边界。
- `input`、`textarea`、`select`、`contenteditable` 保留原生输入与右键体验。
- 画布与网格的快捷键、修饰键组合必须经统一分发器；组件内严禁自建全局键盘监听。
- 危险操作必须使用确认能力并统一危险语气；一次操作只产生一条反馈。

## 注释规范

- 注释一律使用英文；现状与标准不一致时按本标准逐步收敛。
- 尽可能少写注释：优先通过改名、拆函数、改类型让代码自解释。
- 必须注释的场景：冻结的常量、算法或外部协议；顺序或事务敏感的边界；约束来源与看似多余但必需的步骤；workaround 及其移除条件。
- 禁止注释的场景：复述代码行为、历史叙事、无追踪目标的 `TODO` / `FIXME`、注释掉的代码。
- 格式约定：完整句或祈使句；单行优先，不写装饰性分隔注释块；JSDoc 只用于公开契约形状。
