# Module Map

本文档是 `.zcode/modules/` 的模块文档索引。项目宏观架构边界写在 `.zcode/overview.md`，通用前后端规范写在 guidelines，模块级定义、边界、规范和调用链写在对应模块文档中。

## 模块文档规范

### 文件与命名

- 模块文档统一放在 `.zcode/modules/`。
- 文件名使用英文 kebab-case，并以 `.md` 结尾
- 文档标题使用中文模块名，保持和本文档索引一致。

### 内容结构

- 每个模块文档保留 `定义`、`参考`、`边界`、`链路`、`规范` 和 `陷阱` 章节结构。
- `定义` 只用一句话说明该模块的作用、定义，不允许包含任何实现细节。
- `参考` 只列举能支撑正式模型和 ownership 的关键文件、目录或方法，并说明该对象在模型中的作用。
- `边界` 只写 ownership 表和禁止边界表中长期成立的职责归属、状态归属、读写边界、消费边界和跨模块拥有关系。
- `链路` 只写正式模型中每一条真实链路的调用顺序，不能混入规范、解释、候选方案、历史原因或临时流程。
- `规范` 只写输入输出表、状态持久化表、错误语义、保存语义、跨模块调用语义和长期实现规则中能约束代码的内容。
- `陷阱` 只写禁止边界表的反向错误做法，以及会导致状态错归属、输入绕过、输出污染、错误语义错位、持久化污染、链路断裂或外部协议误判的具体风险。描述对象与 `规范` 不得重叠。

### 书写规则

- 模块正文不得引用其它模块文档的文件名。
- 模块正文禁止泛用性指代、概览性描述、凑行数句、重复换词句和无法约束实现的空话。
- 写章节前必须先建立模块正式模型：核心对象、输入来源、输出对象、状态归属、持久化归属、外部协议或文件格式、UI 行为边界、错误语义和跨模块入口。
- 写章节前必须先建立模块 ownership 表：数据模型、API / command、store、持久化、错误、日志、路由、跨模块入口和外部资源分别归谁拥有，以及谁只能消费不能写入。
- 写章节前必须先建立模块输入输出表：每类输入写清来源、解析层、合法输出和失败语义；每类输出写清消费者、字段语义和禁止污染边界。
- 写章节前必须先建立模块状态持久化表：每个状态写清 owner、是否持久化、保存位置、恢复时机、更新边界和消费方。
- 写章节前必须先建立模块真实链路表：页面入口、store / action、API / IPC、Rust command、core service、持久化、事件、错误和路由链路按真实调用顺序拆开。
- 写章节前必须先建立模块禁止边界表：不得直接 IPC、不得直接读写持久化、不得绕过 parser / mapper / normalizer、不得直接读取外部原始值、不得错归属 toast / log / route、不得反向依赖业务模块。
- 模块正文必须直接按正式模型进行组织，落盘即为完整版本。
- 模块文档不允许多于 300 行。
- `定义` 章节不允许多于 1 行；
- `参考` 章节不允许少于 3 行；每一行必须以一个目录、文件、或方法开头，优先以目录为开头。
- `边界` 章节不允许少于 5 行；不要求以文件开头。
- `链路` 章节必须把每一条真实链路拆成次级章节，内部只按调用顺序编写，不参与字典序排序。
- `规范` 章节不允许少于 5 行；不允许以文件开头。
- `陷阱` 章节不允许少于 3 行；不允许以文件开头。
- 除 `链路` 章节和其它明确表示顺序的章节外，同一章节内的同级条目必须按字典序排序。

### 更新边界

- 模块文档不得记录阶段任务完成情况。
- 模块文档不得为普通新增项追加清单式实现细节。
- 模块文档不得把测试计划、临时实现、候选设计或后续计划写入长期规范。
- 只有新增或修改内容改变模块长期规范时，才允许更新模块文档。
- 新增模块文档时，先在本文档中添加索引，再在对应模块文档中填写内容。
- API 文档与项目实现文档必须分开。

## 模块索引

- [应用启动与窗口挂载](modules/app-runtime.md)：说明 URL 窗口类型、settings 初始化、唯一窗口壳、窗口根装配和应用启动失败呈现。
- [多窗口机制](modules/app-windowing.md)：说明 managed window、singleton identity、跨窗口事件、关闭守卫与主窗口 refresh 协调。
- [应用设置与主题](modules/app-settings.md)：说明 settings store、主题令牌、editMode、日志目录、persistence/mirror 与子窗口 snapshot。
- [应用反馈与日志](modules/app-feedback-log.md)：说明 AppFeedback 工厂与 hook、确认框、业务消息、应用日志、错误文件入口与工具私有配置清理。
- [目录打开](modules/directory-opening.md)：说明目录选择、游戏或 Mod 识别、canonical root、ProjectSession 建立与打开 outcome。
- [新建 Mod](modules/mod-creation.md)：说明 Mod 父目录、最小目录骨架、`mod_info.json` renderer 与创建后的受信 session 打开。
- [工作区运行态与持久化](modules/workspace.md)：说明多 Mod 页签、导航上下文、workspace 快照、启动恢复、移除 Mod 与活动 Mod 同步。
- [项目会话与清单缓存](modules/project-session.md)：说明 `sessionId + modRoot`、manifest、按需 query、派生索引、cache 和写后 invalidation。
- [文本与格式解析器](modules/text-parsers.md)：说明 CSV-like 与 JSON-like 解析、UTF-8 无 BOM、CP1252 规范化和格式错误上下文。
- [表格编辑](modules/csv-tables.md)：说明窗口化表格 query、tables store、行身份、选择、列 schema 渲染与 dirty。
- [表格草稿历史](modules/csv-edit-history.md)：说明按 Mod/表隔离的内存 operation、CSV undo/redo、rowKey 映射和 history limit。
- [表格保存与变更集](modules/table-save-changeset.md)：说明 dirty patches、关联 spec 动作、原子 changeset、rowKey map 与保存后提交。
- [编辑会话原语](modules/draft-session.md)：说明 base、draft、dirty、revision、pending external、目标切换与未保存注册表。
- [文件历史与回放](modules/file-history.md)：说明已写盘 changeset、按 Mod 隔离的文件级 undo/redo、确认回放与 session refresh。
- [主窗口历史命令与快捷键分发](modules/main-history-command.md)：说明快捷键命令映射、统一分发器、CSV 草稿优先级与文件 history 分派。
- [画布编辑器骨架](modules/editor-canvas.md)：说明画布命中检测、选区同步、镜像轴、光标绘制、undo 集成与显式 draft 提交引擎。
- [文件编辑器](modules/file-editor.md)：说明独立文本窗口、`sessionId + modRoot + path`、文本 Draft Session、保存和外部文本同步。
- [配置系统](modules/config.md)：说明 mod_info、Faction、Mission、Variant、Skin、目标草稿、实体 query/write 与文件级 history。
- [字段模式系统](modules/schema.md)：说明 schema 资产加载、runtime、字段渲染、editMode、校验、引用 source、SelectOption 与资源选择。
- [配置实体族编辑器](modules/family-editors.md)：说明装配与皮肤两族参数化编辑、family 定义、实体 query/write 和单文件保存。
- [舰船编辑器](modules/ship-editor.md)：说明 `.ship` 画布注入、槽位、引擎、shield、贴图引用选择与独立窗口保存。
- [武器、弹体与发射预览](modules/weapon-editing.md)：说明 `.wpn` 编辑、`specClass` 分支、弹体窗口、发射预览与武器工作流链路。
- [战术系统编辑器](modules/system-editor.md)：说明 `.system` spec、schema 表单、type 条件字段与独立窗口保存。
- [资源与原版回退](modules/assets-core-fallback.md)：说明 `ResourceRef`、Mod/Core 优先级、data URL batch、Mod 内 PNG 引用选择与派生资源索引。
- [后端文件读写与变更集](modules/rust-file-io-changeset.md)：说明 UTF-8 IO、canonical 路径、父链校验、文件或目录快照与 replay。
- [性能基线](modules/performance-baseline.md)：说明正式计时日志、可复现样本、ProjectSession 阶段、持久化索引和入口 bundle 体积。
- [静态检查系统](modules/static-checks.md)：说明文本、格式配置、架构静态检查与模块文档契约的入口、边界和规则自检原则。
- [关于页面](modules/about-page.md)：说明主窗口只读信息页、构建时内联 `CHANGELOG.md`、marked 渲染与 about 路由。
