# 多窗口机制

## 定义

多窗口机制系统集中管理子窗口创建与复用、当前窗口生命周期、跨窗口事件与 dirty 关闭守卫。

## 参考

`src-tauri/src/models/window.rs`：规格、文本与恢复窗口的判别身份、Windows 路径比较键与生命周期消息。
`src-tauri/src/services/windows.rs`：原生窗口能力 owner，拥有身份登记、创建复用、目标占用、实例交接与关闭等待。
`src/app/EditorWindowContent.vue`：编辑器窗口内容，消费窗口参数并触发保存同步。
`src/app/composables/editors/use-editor-window-view-model.ts`：共享编辑窗口生命周期主归属，拥有读取票据、外部保存与身份事件接纳。
`src/app/composables/use-dirty-window-close-guard.ts`：dirty 关闭守卫 owner，在关闭请求上确认放弃并销毁。
`src/orchestrators/entity-identity.orchestrator.ts`：跨窗口目标准备、占用、身份交接和释放主归属。
`src/services/editor.service.ts`：共享编辑窗口 bundle、领域依赖与资源装配主归属。
`src/services/window.service.ts`：窗口 command 的类型化签名与参数装配主归属。
`src/windows/current.window.ts`：当前窗口生命周期 owner，提供关闭、销毁、关闭请求监听、最小化、最大化、拖拽、重载与显示。
`src/windows/editor.window.ts`：编辑器窗口请求 owner，组装类型化身份、尺寸与 URL 参数。
`src/windows/file-editor.window.ts`：文件编辑器窗口请求 owner，承载常规与错误恢复两种请求形状。
`src/windows/managed.window.ts`：请求装配 owner，拥有 URL query 长度检查与复用窗口的聚焦消息。
`src/windows/tauri.events.ts`：跨窗口事件监听与发送封装 owner。
`src/windows/window.events.ts`：窗口事件名与 payload 类型 owner。

## 边界

- URL 序列化只省略 null/undefined 参数，保留空字符串；query 总长度超限必须取消创建并抛出明确错误。
- dirty 或 saving 窗口必须在关闭请求入口立即 preventDefault；保存成功后必须重新判定最新 dirty，并经正式 destroy 入口完成同一意图。
- 主窗口保存事件监听在窗口卸载时必须释放；handler 错误必须交给注册的错误记录器。
- 关闭守卫必须消费正式草稿与活动输入的聚合 dirty；主窗口必须消费响应式未保存注册表，控件挂载与卸载必须更新判定。
- 创建结果必须由 Rust 窗口能力返回实例 label 与复用状态；创建失败必须释放登记，反馈必须归调用方。
- 已存在 singleton 时只做显示、聚焦和可选的聚焦事件发送，不重建窗口。
- 当前窗口关闭、销毁、重载与显示必须经当前窗口生命周期 owner，严禁业务代码直接调用 Tauri API。
- 窗口身份必须包含完整 session、`modRoot` 和业务目标；字符串拼接或以活动 Mod 补齐身份被禁止。
- 编辑窗口读取必须把消费者 AbortSignal 传入 bundle、派生数据与草稿贴图能力，窗口释放必须撤销全部读取等待。
- 重复关闭必须合并为一个等待与确认意图；保存失败、取消或同步失败必须结束当前意图并保持窗口。

## 链路

### 创建子窗口

1. 业务调用点组装结构化请求并调用对应窗口请求函数。
2. draftSnapshot 参数超过独立上限时被移除，预览窗口回退到已保存 bundle。
3. 请求函数把 URL 参数合并为 query 并交给 managed window 创建入口。
4. query 总长度超限时抛出明确错误，创建取消。
5. Rust 按类型化身份查找登记；相同身份的进行中创建共用登记结果。
6. 已有实例显示并聚焦，前端发送所属聚焦消息。
7. 新身份取得稳定 label，以隐藏方式构造原生窗口并返回实例。
8. 失败释放登记，调用点呈现带窗口标题的错误。

### 关闭 dirty 窗口

1. 用户触发标题栏关闭、窗口关闭按钮或 Escape。
2. 关闭守卫在关闭请求上立即 `preventDefault`，避免原生 close-requested 阻塞 GUI 线程。
3. 守卫等待已登记保存并重试所属待同步提交，失败或取消结束本次意图。
4. 成功后重新读取 dirty，存在未保存状态时等待放弃确认。
5. 主窗口关闭或移除 Mod 时按会话请求子窗口交接。
6. 当前意图获准后经 destroy 销毁窗口，Rust 释放身份、占用与等待登记。

### 主窗口保存事件协调

1. 主窗口工作区动作启动时注册保存事件监听。
2. 同步编排接纳当前窗口 receipt 并发送完整提交事件。
3. 共享监听入口启动身份交接、接纳历史和投影、按身份与代次失效缓存，再投影所属规格和文本。
4. 窗口卸载时释放全部监听。

## 规范

- sessionId、kind 与实体 ID 必须按原值比较；Mod 与文件路径必须统一处理分隔符、大小写、尾部分隔符及扩展路径前缀。
- 会话关闭必须阻止新窗口登记；创建期间的关闭意图必须在实例构造完成后继续执行。
- 保存与回放通知必须共用 committedWriteApplied，事件必须携带 originWindowLabel、modRoot、nullable sessionId、reason 与完整 WriteResult。
- 关闭、创建失败与动作取消必须释放所属登记及占用；生命周期等待必须按请求身份接纳完成或取消。
- 关闭守卫遇到 dirty 必须先拦截再确认，取消或失败时必须保持窗口。
- 写入前必须登记下一规格身份与文本路径占用；待保存目标窗口必须拒绝交接并取得焦点，干净实例必须经所属关闭守卫释放。
- 原生 label 必须由应用内登记序号产生，并且必须在业务身份交接时保持稳定。
- 子窗口只能消费 URL snapshot 初始化设置，严禁在子窗口内读取设置文件。
- 广播重试必须复用实际 receipt 及完成进度；事件处理失败必须归所属错误 owner，发送成功必须以 Tauri 事件发送结果判定。
- 当前窗口回声必须按来源 label 过滤，重复提交必须按根和提交序号去重；身份消费者必须先取得接纳意图，依赖投影消费者必须等待该动作。
- 窗口创建必须以隐藏方式启动，由内容就绪后显式显示。
- 规格身份必须分别表达 sessionId、kind、modRoot 与 id；文本身份必须分别表达 sessionId、modRoot 与 path；恢复身份必须分别表达 nullable modRoot 与 path。
- 跨窗口事件必须使用事件名注册表的常量，严禁裸字符串事件名。
- 身份交接必须共同更新原生登记、URL 参数、ViewModel 目标、标题与事件过滤；再次打开新身份必须复用已交接实例。
- 重载当前窗口必须走当前窗口生命周期 owner，与实现保持同一命名。

## 陷阱

- URL 参数序列化不做长度守卫会让超长草稿在创建阶段产生不可诊断的失败。
- 关闭确认后重新发起 `close` 会再次触发关闭请求形成循环。
- 创建子窗口后不等待创建结果会让失败静默成为白屏窗口。
- 把失败反馈写进窗口层会让窗口层反向依赖用户反馈 store。
- 直接用业务字符串拼接窗口 label 会让不同目标的窗口互相复用。
- 绕过关闭守卫直接监听关闭事件会让 dirty 状态在未确认时丢失。
