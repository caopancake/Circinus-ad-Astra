# 后端能力与 IPC 传输

## 定义

后端能力与 IPC 传输模块提供跨进程调用原语、透明错误上下文和正式 command 归属契约。

## 参考

`scripts/architecture/rules/command-boundary.mjs`：command 来源与唯一 owner 检查。
`scripts/shared/command-policy.mjs`：正式 command 实现归属表。
`scripts/shared/frontend-source.mjs`：词法调用、绑定与源码位置事实。
`src/shared/runtime/command-runtime.spec.ts`：传输与来源诊断验收。
`src/shared/runtime/command.runtime.ts`：唯一原始 invoke owner。

## 边界

- command 参数装配必须由能力 service 或正式 wire 实现拥有，传输只允许消费完整参数。
- 传输错误必须保留原始 cause，领域 action 必须归所属用户动作。
- 公开能力权限必须由能力矩阵按真实符号来源约束；command 实现必须由 command-policy 按调用事实约束。
- 共享传输严禁拥有业务状态、确认、日志写入、缓存或保存接纳。
- 原始 Tauri invoke 必须只由 command.runtime 消费。

## 链路

### 跨进程调用

1. 所属能力装配 command 与 payload 或顶层参数。
2. invokeCommand 调用 Tauri invoke。
3. 成功结果返回所属能力与正式消费者。
4. 失败包装为携带 command 和原始 cause 的 AppError。

### 权限判定

1. 共享解析建立绑定、转导出、词法调用与位置。
2. command 检查沿实际符号来源解析传输调用。
3. 调用的 command 字面量与所属文件共同匹配正式 owner。
4. 能力检查独立约束公开操作的消费职责。

## 规范

- AppError.command 必须表达底层 command；formatError 必须透过该包装消费原始用户文案投影。
- command 必须由可静态判定的字面量表达；别名、namespace、转导出和动态模块导入必须保留来源。
- errorContextOf 必须分别表达领域 action 和 command，日志必须按所属字段记录。
- errorDiagnosticOf 必须保留来源稳定码、原始消息和结构化位置；附加 payload 必须沿 cause 消费。
- invokeCommand 必须保留完整 args，nullable、无参数及顶层参数必须服从 Rust command 契约。
- 模块主归属文件必须按本模块的正式职责登记，实际能力与消费者必须在各所属模块表达公开交接。

## 陷阱

- 严禁在错误包装时丢弃来源附加 payload。
- 严禁将任意业务字段装配写入共享传输。
- 严禁把底层 command 名作为用户操作文案。
