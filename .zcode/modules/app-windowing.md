# 多窗口机制

## 定义

多窗口机制系统集中管理子窗口创建与复用、当前窗口生命周期、跨窗口事件与 dirty 关闭守卫。

## 参考

`src/windows/managed.window.ts`：managed window owner，负责 label hash、singleton 查找、URL query 长度守卫、`tauri://created`/`tauri://error` 监听和显示聚焦。
`src/windows/current.window.ts`：当前窗口生命周期 owner，提供关闭、销毁、关闭请求监听、最小化、最大化、拖拽、重载与显示。
`src/windows/tauri.events.ts`：跨窗口事件监听与发送封装 owner。
`src/windows/window.events.ts`：窗口事件名与 payload 类型 owner。
`src/windows/editor.window.ts`：编辑器窗口请求 owner，组装结构化 singleton key、尺寸与 URL 参数。
`src/windows/file-editor.window.ts`：文件编辑器窗口请求 owner，承载常规与错误恢复两种请求形状。
`src/app/composables/use-dirty-window-close-guard.ts`：dirty 关闭守卫 owner，在关闭请求上确认放弃并销毁。
`src/app/EditorWindowContent.vue`：编辑器窗口内容，消费窗口参数并触发保存同步。
`src/app/composables/editors/use-editor-window-view-model.ts`：编辑器窗口 ViewModel，消费外部保存事件与失效刷新。

## 边界

- 窗口身份必须包含完整 session、`modRoot` 和业务目标；字符串拼接或以活动 Mod 补齐身份被禁止。
- URL 序列化只省略 null/undefined 参数，保留空字符串；query 总长度超限必须取消创建并抛出明确错误。
- 创建结果必须经 `tauri://created` 与 `tauri://error` 上抛；失败反馈由 app 层调用点给出，窗口层不持有用户反馈。
- 已存在 singleton 时只做显示、聚焦和可选的聚焦事件发送，不重建窗口。
- 当前窗口关闭、销毁、重载与显示必须经当前窗口生命周期 owner，严禁业务代码直接调用 Tauri API。
- dirty 编辑器与文件窗口在关闭请求上必须立即 `preventDefault` 并确认放弃；确认放弃后以 `destroy` 完成同一关闭意图。
- 关闭守卫必须消费正式草稿与活动输入的聚合 dirty；主窗口必须消费响应式未保存注册表，控件挂载与卸载必须更新判定。
- 主窗口保存事件监听在窗口卸载时必须释放；handler 错误必须交给注册的错误记录器。

## 链路

### 创建子窗口

1. 业务调用点组装结构化请求并调用对应窗口请求函数。
2. draftSnapshot 参数超过独立上限时被移除，预览窗口回退到已保存 bundle。
3. 请求函数把 URL 参数合并为 query 并交给 managed window 创建入口。
4. query 总长度超限时抛出明确错误，创建取消。
5. singleton label 已存在时显示、聚焦已有窗口，可选发送聚焦事件后返回。
6. 新窗口以隐藏方式创建，监听创建成功与创建失败事件。
7. 创建成功后 promise 完成；创建失败时 promise 以包含窗口标题的错误拒绝。
8. 调用点捕获失败并给出用户反馈或记录日志。

### 关闭 dirty 窗口

1. 用户触发标题栏关闭、窗口关闭按钮或 Escape。
2. 关闭守卫在关闭请求上立即 `preventDefault`，避免原生 close-requested 阻塞 GUI 线程。
3. 守卫弹出放弃确认；用户取消时窗口保持。
4. 用户确认放弃后以允许的 `destroy` 完成关闭，不重新发起 `close`。

### 主窗口保存事件协调

1. 主窗口工作区动作启动时注册保存事件监听。
2. 编辑器或文件编辑器保存成功后发送已写盘事件。
3. 监听器把事件交给保存处理链完成文件历史与 refresh。
4. 窗口卸载时释放全部监听。

## 规范

- 单例 label 必须经规范化 key 哈希生成，不得直接使用业务字符串。
- 编辑器 singleton key 必须按 `sessionId、kind、modRoot、id` 结构化序列化；同目标的新 session 必须使用独立窗口身份。
- 窗口创建必须以隐藏方式启动，由内容就绪后显式显示。
- 子窗口只能消费 URL snapshot 初始化设置，严禁在子窗口内读取设置文件。
- 跨窗口事件必须使用事件名注册表的常量，严禁裸字符串事件名。
- 关闭守卫遇到 dirty 必须先拦截再确认，取消或失败时必须保持窗口。
- 重载当前窗口必须走当前窗口生命周期 owner，与实现保持同一命名。

## 陷阱

- 直接用业务字符串拼接窗口 label 会让不同目标的窗口互相复用。
- 创建子窗口后不等待创建结果会让失败静默成为白屏窗口。
- 把失败反馈写进窗口层会让窗口层反向依赖用户反馈 store。
- 关闭确认后重新发起 `close` 会再次触发关闭请求形成循环。
- 绕过关闭守卫直接监听关闭事件会让 dirty 状态在未确认时丢失。
- URL 参数序列化不做长度守卫会让超长草稿在创建阶段产生不可诊断的失败。
