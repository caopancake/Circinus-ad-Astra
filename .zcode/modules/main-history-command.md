# 主窗口历史命令与快捷键分发

## 定义

主窗口历史命令与快捷键分发系统把统一键位映射为命令，并按优先级把撤销、重做与保存分派到对应链路。

## 参考

`src/domain/workspace/main-window-commands.ts`：快捷键命令映射唯一 owner，拥有 undo/redo/save/close 键位表与输入焦点豁免策略。
`src/app/composables/use-shortcut-dispatch.ts`：快捷键分发唯一 owner，拥有 window 监听、命令路由、纯键表分发与命中拦截。
`src/app/composables/use-main-window-shortcuts.ts`：主窗口快捷键装配 owner，连接保存注册表与历史编排。
`src/app/composables/canvas/use-canvas-editor.ts`：画布骨架快捷键消费方，经分发器路由 undo/redo 与画布纯键。
`src/stores/save-command.store.ts`：活动保存命令、目标保存句柄和交接意图序号 owner。
`src/orchestrators/main-history-command.orchestrator.ts`：历史分派 owner，CSV 草稿优先于文件 history。
`src/orchestrators/file-history-replay.orchestrator.ts`：文件历史回放 owner。
`src/app/AppContent.vue`：主窗口装配入口，注册活动保存目标与窗口快捷键。

## 边界

- 快捷键命令解析唯一归 domain；window 监听与命令路由唯一归分发器 composable。
- 主窗口快捷键装配严禁内联解析键盘事件细节，严禁直接依赖 history store。
- Ctrl+S 为全局保存语义，不受输入焦点限制；undo/redo 默认豁免输入焦点，文本编辑面可显式开启。
- 撤销重做分派优先当前 CSV 草稿历史；当前表无 entry 才进入文件 history 回放。
- 保存分派只允许触发当前活动命令；目标句柄必须登记身份、saving 与等待能力，重复触发必须消费已有任务。
- 导航、实体选择、外部接纳、Mod 移除与关闭必须消费所属保存句柄；连续导航只允许执行最新意图。
- 命中的命令必须阻止默认行为；未注册处理器的命令静默放行。
- 子窗口编辑器与主窗口共用同一键位表，键位语义严禁按窗口漂移。

## 链路

### 撤销与重做分派

1. 用户按下撤销或重做组合键。
2. domain 映射产生 undo 或 redo 命令并检查输入焦点豁免。
3. 分发器阻止默认行为并调用历史编排。
4. 历史编排读取活动 Mod 与当前表。
5. 当前表草稿历史有 entry 时执行 CSV undo/redo。
6. 无 entry 时调用文件 history 回放链路。
7. 失败只呈现反馈，不移动任何历史栈。

### 保存分派

1. 用户按下 Ctrl+S。
2. domain 映射产生 save 命令，输入焦点不构成豁免。
3. 分发器调用保存命令 store 的分派。
4. 活动保存目标执行各自保存编排。
5. 无活动目标时命令静默结束。

### 编辑器窗口快捷键

1. 画布编辑器以编辑器 hooks 装配分发器。
2. 组合键进入 undo/redo 命令并触发编辑器内撤销栈。
3. 纯键（空格、退格、模式键、视图键）经键表分发到画布动作。
4. 输入框、文本域、下拉与可编辑元素内的纯键不触发分发。

## 规范

- 键位表必须以主窗口既有键位为全窗口基准：Ctrl+S 保存、Ctrl+Z 撤销、Ctrl+Shift+Z 与 Ctrl+Y 重做、Escape 关闭。
- 快捷键纯键命中必须阻止默认行为；命令命中但无处理器时不得阻止默认行为。
- 输入焦点豁免只适用于 undo/redo 与纯键，严禁豁免 save 与 close。
- undo/redo 的可编辑目标豁免必须可按表面开启，文本编辑面必须开启。
- 检查器与 schema 的输入焦点必须保留原生撤销体验；文本文件编辑面必须按已声明的焦点策略消费文本快照历史。
- 快捷键触发必须避免与输入控件、schema 控件、CSV 单元格编辑器和系统快捷键冲突。
- 主窗口历史分派失败只呈现反馈，严禁改变历史栈状态。

## 陷阱

- 在装配层内联解析 ctrlKey 或按键名会让键位表出现第二份 owner。
- 让保存注册表接受多个并发目标会让 Ctrl+S 命中不确定的保存面。
- 撤销重做进入输入框会破坏文本原生编辑体验。
- 分派失败抛出未处理 rejection 会阻塞后续按键。
- 在子窗口重新定义键位语义会让同一组合键跨窗口行为漂移。
- 快捷键命中不阻止默认行为会让浏览器或 WebView 默认动作与业务动作叠加。
