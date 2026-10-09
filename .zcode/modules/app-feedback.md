# 应用反馈与错误恢复

## 定义

应用反馈与错误恢复模块统一通知、确认、诊断呈现和授权文件恢复入口。

## 参考

`src-tauri/src/errors.rs`：后端稳定码、原始错误链、位置与附加 payload。
`src/app/app-feedback.ts`：反馈工厂及恢复动作 owner。
`src/app/composables/use-app-feedback.ts`：唯一工厂消费 hook。
`src/shared/lib/errors.ts`：AppError、诊断与文案投影主归属。
`src/shared/lib/feedback-session.ts`：错误路径所属会话解析。
`src/shared/types/error.types.ts`：诊断与通知对象。
`src/shared/types/feedback.types.ts`：反馈公开交接类型。

## 边界

- error 必须接收原始错误，warning 必须分别承载 userMessage 与 diagnostic。
- message、dialog 和工厂必须由正式反馈 hook 消费。
- 文件恢复必须消费所属 session 或后端提供的 recovery 编辑目标，路径授权必须归后端。
- 日志写入必须调用日志能力，文案与诊断必须分别投影。
- 组件只允许经反馈 hook 获取 AppFeedback；编排必须消费注入反馈。
- 转码必须由 files 能力写盘并经正式 receipt 接纳。

## 链路

### 错误呈现与恢复

1. 用户动作提交原始错误或通知对象。
2. 工厂映射用户文案并取得结构化位置。
3. 路径与已加载 manifest 或当前子窗口身份匹配所属会话。
4. 提示展示位置与已授权文件动作。
5. 文件打开经窗口能力，转码经 files 能力及保存同步。
6. 原始诊断、action、command 和位置进入日志能力。

### 确认

1. 所属动作提供确认内容和回调。
2. 工厂装配 dialog，确认调用 onConfirm。
3. 取消、关闭或遮罩调用 onCancel。

## 规范

- ID 校验拒绝必须为 warning，稳定码必须为 config.id_invalid。
- error/warning 必须记录原始诊断，success/info 严禁隐式写日志。
- 反馈工厂必须由 hook 注入 message 与 dialog，文件会话解析必须优先消费已加载 manifest，再消费当前子窗口自身身份。
- 提示基线必须由唯一 WindowShell provider 承载，可手动关闭且悬浮暂停；普通提示 10 秒，error duration 必须为 0。
- 提示必须由工厂统一渲染文件位置和授权恢复按钮，调用方严禁自建时长、关闭与渲染选项。
- 文件位置必须从 location 消费，行列必须从 1 开始，列必须按 UTF-16 单元表达。
- 文案映射必须按稳定码和领域上下文产生；command 包装必须保持呈现透明，父子文案必须去重。
- 转码只允许 text.invalid_utf8 且目标授权时提供，源编码必须由用户显式选择。
- 转码必须接入文件保存及历史链路，打开或转码失败必须记录原始诊断并呈现一次错误。
- 错误链必须保留来源 code、位置与 payload；action 和 command 必须独立表达。

## 陷阱

- 严禁从错误文案推导授权根或位置。
- 严禁在业务组件复制 message/dialog 的实现。
- 严禁将用户提示文案写作原始日志诊断。
