# 静态检查系统

## 定义

静态检查系统以共享源码事实和能力契约约束依赖、职责、格式、命名与模块文档。

## 参考

`scripts/architecture/capability-boundary.check.mjs`：能力授权、规则归属和真实仓库入口的行为测试。
`scripts/architecture/schema-input-boundary.check.mjs`：字段分派器与专用输入组件的职责验收。
`scripts/architecture/workspace-input-boundary.check.mjs`：生产导航与共址输入测试角色的职责验收。
`scripts/architecture/rules/frontend-layer-boundary.mjs`：前端层级、组件消费、wire 边界、service 依赖和运行时循环的检查 owner。
`scripts/architecture/rules/index.mjs`：正式规则及元规则注册表。
`scripts/architecture/rules/rust-project-layer-boundary.mjs`：Rust 内部分层和 command payload 归属的检查 owner。
`scripts/architecture/rules/rust-service-edge-boundary.mjs`：Rust 顶层能力依赖的检查 owner。
`scripts/architecture/rules/write-boundary.mjs`：公开能力声明、操作权限和转导出来源的检查 owner。
`scripts/check-architecture.mjs`：仓库事实建立、规则执行和诊断输出入口。
`scripts/check-encoding.mjs`：UTF-8 无 BOM 检查入口。
`scripts/check-identifier-length.mjs`：变量与函数长度检查入口。
`scripts/shared/files.mjs`：仓库路径清单、源码读取和事实装配 owner。
`scripts/shared/frontend-policy.mjs`：层级、能力、正式 owner 与诊断位置的共享契约。
`scripts/shared/frontend-source.mjs`：TypeScript 与 Vue 脚本解析、绑定、转导出和源码位置 owner。
`scripts/shared/imports.check.mjs`：源码语义、实际路径、转导出和共享解析的行为测试。
`scripts/shared/imports.mjs`：项目 alias、实际节点、去重模块边和符号来源 owner。
`scripts/shared/rust-crate-paths.mjs`：Rust crate、super、self 路径解析与去重 owner。

## 边界

- 全部依赖规则必须消费入口建立的同一份绑定、实际节点和模块边，严禁在规则内重新解析导入或补文件扩展名。
- 同一依赖事实必须具有唯一规则 owner；层级失败必须由通用依赖规则报告，能力权限必须由能力规则报告。
- 注册表必须装配全部正式规则和元规则；退役契约必须同步收束其检查入口与消费者。
- 源码事实只允许由共享解析入口建立；规则只允许读取事实和输出诊断，严禁修改仓库状态。
- 模块业务规则只允许表达独立业务契约；组件消费、wire 调用和 service 横向依赖必须由通用规则拥有。
- 测试源码必须按测试角色分类；生产能力权限必须通过合成生产节点和实际仓库入口验收。
- 路径角色与能力表必须表达正式所有权，严禁以原始源文件身份或内容字符串授权绕过边界。
- Rust 规则必须复用生产源码过滤与 crate 路径解析，同一模块或层级依赖只允许报告一次。

## 链路

### 架构事实建立

1. 共享收集器建立仓库可用路径清单并读取适用源码、schema、配置和模块文档。
2. Vue 编译器提取普通脚本与 setup 脚本；TypeScript 编译器解析绑定、导出、动态导入和类型引用。
3. 项目 alias 与 base URL 配置解析为路径模式，导入指向实际存在的文件或目录入口。
4. 绑定按实际目标和类型属性聚合为模块边，同时保存绑定的原始名称、局部名称与源码位置。
5. 各源码对象携带解析后的导入、导出、模块边与依赖诊断进入规则注册表。

### 规则与诊断

1. 通用依赖规则验证层级、组件、wire、service 关系，并遍历 orchestrator 运行时图。
2. 能力规则验证公开声明，并沿具名、namespace、动态导入和转导出追踪正式能力来源。
3. 模块规则消费同一事实验证各自的业务契约；Rust 规则解析正式生产引用。
4. 检查入口聚合解析与规则诊断，失败时输出具体文件、位置、目标或符号及期望 owner。
5. 全部检查通过时输出通过信息，失败时返回非零退出码。

### 模块文档

1. 文档规则解析 module map 并核对磁盘文档。
2. 核对六章节结构、章节顺序与行数限制。
3. 文档契约失败进入同一诊断出口。

### 本地与 CI 验证

1. lint 执行 ESLint。
2. Node 测试入口执行 shared 与 architecture 的全部 `*.check.mjs`。
3. 架构入口执行全部规则。
4. 标识符入口执行变量与函数长度检查。

## 规范

- 项目内部依赖必须解析为实际节点；缺失目标必须产生可定位错误。
- 混合导入必须逐绑定表达类型与运行时属性；模块边必须按调用文件、实际目标和属性去重。
- 动态导入必须使用可静态授权的字面量模块来源；类型引用必须参与类型边界并保持其类型属性。
- namespace 与通配转导出必须展开运行时能力；符号别名和转导出必须保留正式能力来源，显式导出必须拥有其名称。
- 受控能力入口的公开运行时导出必须声明能力及正式消费者；读取、订阅、项目失效和会话清理必须分别授权。
- 通用层级与能力检查必须按实际节点角色判定；service 自身引用与已声明能力关系必须具有明确语义。
- orchestrator 循环必须使用统一运行时模块边；类型边只允许参与类型边界检查。
- 规则只允许验证正式约束，严禁以函数或文件名称存在作为完成判据。
- 新约束必须覆盖合法与违规行为测试；命名、导入、转导出、重复诊断与真实入口必须通过正式测试命令验收。
- 规则、授权矩阵和文档必须与职责或接口变更同步维护，本地与 CI 必须使用同一验证入口。
- 编码、格式、架构和标识符长度必须经各自正式入口检查，仓库遍历必须复用共享收集器。

## 陷阱

- 严禁以导入字符串的省略路径代替实际文件节点判断职责。
- 严禁把整条混合导入标记为类型边，或把类型引用加入运行时循环。
- 严禁将查询和订阅按状态变更能力授权。
- 严禁依赖转导出、namespace 或动态导入隐藏正式能力来源。
- 严禁通过多个规则重复报告同一模块依赖或能力归属事实。
