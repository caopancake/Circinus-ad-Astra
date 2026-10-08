# 文件编辑器

## 定义

文件编辑器系统在独立窗口编辑一个已授权 Mod 文本文件，支持 ProjectSession 编辑与工作区错误恢复编辑两种模式。

## 参考

`src/app/FileEditorApp.vue`：窗口根 owner，装配唯一窗口壳与文件编辑器内容。
`src/app/FileEditorContent.vue`：窗口内容 owner，拥有行号槽、文本域、快捷键与外部文本呈现。
`src/app/composables/editors/use-file-editor-view-model.ts`：编辑 ViewModel owner，拥有文本 Draft Session、加载、保存、undo/redo 与行列聚焦。
`src/windows/file-editor.window.ts`：窗口请求 owner，承载常规与错误恢复两种请求形状。
`src/orchestrators/file-editor-window.orchestrator.ts`：窗口打开编排 owner，处理 warning 与失败目标的窗口化。
`src-tauri/src/services/file_editor.rs`：后端编辑 service owner，拥有路径校验与文本读写。
`src-tauri/src/commands/file_editor.rs`：文件编辑 command 边界。
`src/app/composables/use-dirty-window-close-guard.ts`：dirty 关闭守卫。

## 边界

- 常规模式窗口身份为 `sessionId + modRoot + path`；错误恢复模式身份为调用链提供的 `modRoot + path`，无 ProjectSession。
- 恢复模式保存仅写当前文件，严禁进入文件历史、严禁触发 ProjectSession refresh；该特例以保存处 `sessionId` 判定显式表达。
- 前端严禁从错误文本推导授权根目录或直接写盘；Rust 必须校验 `modRoot` 归属、绝对路径、父目录与链接边界。
- 转码动作以用户显式选择的源编码解码，严禁自动探测编码；已是 UTF-8 的文件严禁再次转码。
- 错误恢复入口只允许消费 Rust 游戏概览 warning 或目录打开链路携带的结构化编辑目标；无编辑目标的错误严禁显示文件按钮。
- 保存只允许写当前文件；恢复模式保存只走无 session 文件写入能力，严禁发送依赖 ProjectSession 的保存同步事件。
- dirty 窗口接收回放文本只能暂存，不能覆盖文本域；外部版本必须经显式载入。
- dirty 状态关闭必须显式确认放弃文本；标题栏、Escape 与窗口内关闭必须走同一关闭守卫。
- 文本撤销重做必须在文本域内生效，撤销栈由统一编辑会话原语承载。

## 链路

### 打开常规编辑窗口

1. 业务调用点以 `sessionId + modRoot + path` 发起窗口请求。
2. 窗口请求组装身份、标题与上下文并打开 managed window。
3. 内容挂载后初始化文本 Draft Session 并加载文件文本。
4. 按目标行列滚动并聚焦文本域。

### 编辑与保存

1. 用户在文本域输入，文本 Draft Session 记录 dirty。
2. 用户点击保存或 Ctrl+S 进入保存编排。
3. 保存经 service/API 到后端校验并写盘。
4. 会话以实际提交文本和返回版本接纳基线，保留后续输入与文本历史。
5. 常规模式失效缓存并向主窗口发送保存事件，进入 history 与 refresh。
6. 同步失败呈现已写盘状态与同步错误，等待交接结束。

### 外部文本同步

1. 文件历史回放命中当前文件时发送外部文本事件。
2. dirty 窗口将文本暂存为外部版本并呈现提示。
3. 用户确认载入后替换文本域内容。

### 错误恢复编辑

1. 错误呈现携带结构化编辑目标时显示文件按钮。
2. 以 recovery 模式打开无 session 窗口，身份为 `modRoot + path`。
3. 保存走无 session 文件写入能力并仅写当前文件。
4. 恢复模式保存不入文件历史、不触发 ProjectSession refresh，写盘即终点。

### 转码为 UTF-8

1. 反馈层在 `text.invalid_utf8` 错误且路径命中已授权会话时提供转码动作，其它错误不出现。
2. 用户在模态选择框显式选择源编码（GBK/GB18030 或 Windows-1252），后端按所选编码解码，严禁自动探测。
3. 后端拒绝已有效的 UTF-8 文件，所选编码无法完整解码时报错且不写盘。
4. 解码成功经 `save_text_file` 的 changeset 链路写回，并经文件编辑器保存事件进入 history 与 refresh。

## 规范

- 本地编辑、保存与基线交接必须使较早读取的值与错误失效；文本、目标和版本必须共同接纳。
- 保存期间文本域必须保持可编辑，后续文本必须按实际写盘基线计算 dirty；本地保存必须保留文本快照历史。
- 外部读取、重置与关闭必须消费同一保存等待能力；外部载入或重置必须按目标上下文清理历史。
- 外部文本载入必须在 dirty 时确认放弃，确认必须绑定发起时的完整目标；接纳后必须清理文本历史。
- 文本域必须完整保留换行与空白，严禁规范化输入内容。
- 行号槽必须与文本域滚动同步，目标行高亮并支持列定位。
- 撤销重做必须在文本域获得焦点时仍然生效。
- Escape 关闭必须与标题栏关闭走同一守卫语义。
- 错误恢复窗口严禁发送依赖 session 的保存同步事件。
- 窗口复用必须通过聚焦上下文事件定位到新目标。

## 陷阱

- 从错误消息文本解析授权根目录会让恢复窗口写越权目标。
- 回放文本直接覆盖文本域会让未保存输入丢失。
- 恢复模式窗口的保存严禁发送依赖 session 的保存同步事件。
- 行号槽与文本域滚动不同步会让行列定位失准。
- 把外部暂存文本当作已保存内容会让 dirty 状态与磁盘状态混淆。
