# 静态检查系统

## 定义

静态检查系统以可执行规则约束文本格式、架构边界、命名与模块文档契约，是文档边界的强制执行层。

## 参考

`scripts/check-architecture.mjs`：架构检查入口 owner，收集文件并执行全部规则。
`scripts/check-encoding.mjs`：文本编码检查 owner，强制 UTF-8 无 BOM。
`scripts/check-identifier-length.mjs`：标识符长度检查 owner，限制变量与函数名长度。
`scripts/architecture/rules/index.mjs`：规则注册表 owner，拥有全部规则的注册清单。
`scripts/architecture/rules/frontend-layer-boundary.mjs`：前端分层与 service 白名单规则 owner。
`scripts/architecture/rules/rust-project-layer-boundary.mjs`：Rust project 内部分层矩阵规则 owner，支持 crate 绝对与相对导入解析。
`scripts/architecture/rules/rust-service-edge-boundary.mjs`：后端顶层 service 横向依赖授权表规则 owner。
`scripts/architecture/rules/error-boundary.mjs`：错误语义边界规则 owner。
`scripts/architecture/rules/docs-module-map.mjs`：模块文档契约规则 owner。
`scripts/architecture/self-boundary.mjs`：规则自检 owner，约束规则书写方式。
`scripts/shared/`：文件收集器、路径谓词、前端路径分类与 Rust 导入解析共享工具 owner。

## 边界

- 规则只读仓库文件并输出失败清单，严禁写文件或修改状态。
- 每条规则必须注册进规则注册表，未注册规则不生效。
- 规则自检元规则位于规则目录之外，其约束对象是规则书写本身；全部规则含元规则仍必须经注册表装配生效。
- 单文件锚定必须使用 `singleFileByRel()`，严禁规则内做裸源路径相等判断。
- 规则严禁检查函数名或文件名是否存在，严禁用原始文件名正则锁定单文件。
- 规则严禁通过目录前缀、内容身份字符串或白名单、例外表授权绕过边界。
- 就近测试文件（`*.spec.ts`）不受生产模块命名后缀与失败语义约束；测试夹具允许构造普通 Error。
- 架构规则的自检由自检规则执行，规则书写方式本身受约束。

## 链路

### 架构检查执行

1. 检查入口收集仓库文本文件并构造文件视图。
2. 逐条执行注册规则并聚合失败清单。
3. 存在失败时以非零退出码失败并输出明细。
4. 全部通过时输出通过信息。

### 模块文档契约

1. 文档契约规则读取模块索引并解析索引目标。
2. 校验索引与磁盘文档双向存在。
3. 校验每份文档的六章节结构、章节顺序与行数上下限。
4. 全文字数上限与章节缺失按违规输出。

### 持续维护

1. 新边界必须以新规则或既有规则扩展表达，严禁只写入文档。
2. 规则新增后必须以合成样例或真实违规验证其触发。
3. 退役边界必须同步移除规则与授权条目。

## 规范

- 前端、Rust 与文档文件的收集范围由共享收集器统一决定；架构、编码与标识符长度三个检查入口共用同一收集器，范围差异只允许以扩展名与包含谓词表达，规则与入口脚本严禁自建目录遍历。
- 规则判定文件 surface 只允许三种形态：共享分类器的路径角色、归一化相对路径的成员判定、`singleFileByRel()` 单文件锚定。
- 检查必须在 CI 与本地以同一入口执行，严禁出现仅本地可过的规则。
- 规则失败消息必须指出文件、违规内容与期望边界。
- 文本编码、标识符长度与架构检查三个入口都必须在验证链路中执行。
- 规则之间严禁重复约束同一事实；同一事实只允许一个 owner 规则。
- orchestrator 循环检查必须解析实际文件节点与省略扩展名的导入路径，类型导入只允许参与类型边界检查。

## 陷阱

- 在规则内写死单一源文件路径会让规则随重构静默失效。
- 用宽泛正则匹配路径身份会让规则误伤合法文件。
- 只在文档中声明边界而不落规则会让边界随提交漂移。
- 新规则不做触发验证会让防护形同虚设。
- 让规则输出成功明细而非失败清单会让 CI 输出不可诊断。
