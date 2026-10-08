# Workflow

本文件维护任务调查、修改和验证协议。项目架构与运行边界见 `.zcode/overview.md`。

## 改动前

- 前端任务读取 `.zcode/frontend-guidelines.md`。
- Rust 任务读取 `.zcode/backend-guidelines.md`。
- 视觉任务读取 `.zcode/css-guidelines.md`。
- 读取 `.zcode/module-map.md`，再按命中线索加载直接相关的模块文档。

## 模块读取

- `.zcode/modules/` 不进入默认上下文，按任务命中加载。
- 先用 API、组件、ViewModel、service、command、parser、状态键、文件格式、资源 identity 或持久化目标缩小候选范围。
- 索引归属仍不明确时，只读取候选模块的 `定义` 与 `边界` 进行判定。
- 命中模块后沿真实调用、状态、数据、生命周期或持久化契约读取直接依赖。
- 无共享调用、状态、数据、生命周期或持久化契约的模块严禁进入任务范围。

## 开发约束

- 实现前定义输入、输出、状态 owner、保存 owner、错误语义、身份边界和验证方式。
- 当前样例只作验收输入；正式模型同时覆盖反例、缺失数据、跨 Mod、dirty 状态、回放和失败路径。
- 错误设计回到正式状态模型、数据模型或职责边界重做；严禁叠加临时分支、兼容壳、临时 fallback、隐藏状态或样例特判。
- 一切改动以第一性原理取最干净面；严禁保留任何迁移、非收敛分支。
- 修改接入现有正式 API、service、orchestrator、parser、changeset 和 refresh 链路。

## 问题处理

1. 定位证据：列出适用文件、正式入口、状态写入点、API、数据入口和持久化目标。
2. 读取权威：核对顶层文档、当前实现、直接调用对象、类型、schema、parser 和静态规则。
3. 证明可达：从用户入口写清触发条件、执行顺序、身份、对象归属和状态来源。
4. 证明后果：写清可观察结果、错误语义和失效范围；假设风险必须标明证据缺口。
5. 确定范围：扫描共享入口、状态和数据契约，并以对应证据覆盖完整受影响链路。
6. 执行验证：运行任务对应检查，并列出仍需人工确认的运行时或视觉行为。

## 验证方式

- 文档和配置改动必须运行 `format:check`、`encoding:check` 与 `git diff --check`。
- 前端或架构规则改动必须运行 `format:check`、`encoding:check`、`lint`、`typecheck`、`test` 与 `build`。
- Rust 改动必须运行 `cargo fmt --check`、`cargo clippy --all-targets -- -D warnings` 与 `cargo test`。
- 跨层、保存、路径、parser、workspace 或发布链路改动必须运行全部检查。
- 视觉改动必须人工检查亮暗主题、窄窗口、滚动、hover、focus、disabled 和文字布局。

## 常用命令

```powershell
npm.cmd run format:check
npm.cmd run encoding:check
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test
npm.cmd run build
cargo fmt --manifest-path src-tauri\Cargo.toml --check
cargo clippy --manifest-path src-tauri\Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri\Cargo.toml
git diff --check
```

- 开发运行使用 `npm.cmd run tauri -- dev`。
- 无安装包构建使用 `npm.cmd run tauri -- build --no-bundle`，产物位于 `src-tauri\target\release\circinus-ad-astra.exe`。
- 验证失败时必须报告完整命令、退出码、失败位置和阻塞条件；命令必须执行到自然结束。

## 事后要求

- 行为、架构、所有权、调用链、保存边界或长期规范变化时，必须同步对应 overview、guideline、module map 或模块契约。
- 文档必须只描述当前有效事实、契约、入口和边界，严禁记录实现过程、迁移历史、临时状态或候选方案；阶段任务只允许写入 `.zcode/todo.md`。
- 模块文档必须遵守 `.zcode/module-map.md` 的契约，并且内容必须由当前实现证据支撑。
- 完成后必须复查工作树、暂存区、换行、编码和无关用户修改的保留状态。
