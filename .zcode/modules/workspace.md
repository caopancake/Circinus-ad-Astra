# 工作区运行态与持久化

## 定义

工作区系统管理主窗口多 Mod 运行态、Mod 页签导航上下文、工具私有 workspace 快照、启动恢复与活动 Mod 同步。

## 参考

`src/stores/workspace.store.ts`：运行态 owner，拥有全局页、已加载 Mod、Mod 页面上下文、概览、打开失败状态、列宽与持久化投影。
`src/orchestrators/workspace-persistence.orchestrator.ts`：workspace 快照保存与启动恢复 owner。
`src/orchestrators/workspace-lifecycle.orchestrator.ts`：生命周期 owner，拥有关闭目标捕获、5-store 清理用例与工作区关闭。
`src/orchestrators/workspace-navigation.orchestrator.ts`：页签与页面导航 owner，同步跨 store 运行态。
`src/shared/api/workspace-api.ts`：workspace 持久化 wire API。
`src-tauri/src/services/workspace_persistence.rs`：工具私有快照读写 owner。
`scripts/architecture/rules/workspace-module-boundary.mjs`：workspace 边界规则 owner。

## 边界

- workspace store 必须拥有全局页、已加载 Mod、按 `modRoot` 保存的运行代次与页面上下文、概览、打开失败状态与列宽；页面与组件只允许消费。
- 移除 Mod 的 5-store 清理序列唯一归属生命周期编排的清理用例；缓存失效、session 关闭与视图回退由调用方组合。
- 前端按会话清理、后端 session 关闭与 Core 缓存清理必须由生命周期能力边界拥有；目录打开只允许关闭所属迟到响应的 session。
- 顶部页签经导航编排先同步同一 `modRoot` 的 project/tables/editor/history 运行态，再恢复该 Mod 最近的表格或配置页。
- 导航 ViewModel 在替换当前配置视图前查询该 Mod 的活跃 Draft Session；工作区关闭、Mod 移除和主窗口关闭同时检查 CSV 与配置 dirty。
- Rust workspace service 只读写工具私有文件；目录打开只提供打开 outcome。
- 启动恢复一律回到工作区总览；Mod 页面上下文与打开失败状态只存于本次运行。

## 链路

### 加载 Mod 进入运行态

1. 目录打开编排成功建立 ProjectSession。
2. workspace 注册已加载 Mod 条目并激活目标页面。
3. 导航编排按 `modRoot` 同步 project/tables/editor/history 运行态。

### 移除 Mod

1. 用户发起移除；dirty 时先经确认放弃。
2. 生命周期编排执行 5-store 清理用例并撤销目标 Mod 代次。
3. 编排失效该 session 的查询与资源缓存并关闭后端 session。
4. 页签移除后按存活页签决定回退视图。

### 关闭工作区

1. 用户发起关闭；捕获关闭目标内的全部 dirty 并逐项确认。
2. 生命周期编排逐 Mod 执行移除清理。
3. 按捕获的游戏根批量失效核心缓存。
4. 清空概览与失败状态，未保留活动 Mod 时显示总览。

### 启动恢复

1. 启动时读取工具私有快照。
2. 恢复捕获各 Mod 代次，重新打开仍属于该代次的 session 并水合运行态。
3. 恢复期间自动保存暂停；完成后显示工作区总览。

### 持久化保存

1. 页签变化、列宽变化或加载列表变化触发投影保存。
2. 编排把目录、Mod 列表与列宽投影写入工具私有快照。

## 规范

- 游戏概览、ProjectSession 与 Mod 打开失败状态必须分离并按 `modRoot` 隔离；同一 Mod 只保留最新一条失败。
- workspace 缺失返回空默认；损坏时报错且不得立即用空态覆盖。
- 持久化只保存可恢复的目录、Mod 与列宽投影，严禁保存活动页签、全局视图或旧侧栏展开态。
- 列宽必须使用结构化 `modRoot/table/column`，严禁拼接 key。
- Mod 代次必须在注册时分配、移除时撤销，并且只允许保存在当前运行的内存中；恢复响应必须沿用捕获的代次。
- 任何会卸载当前配置组件的导航或移除动作在 dirty 时必须先确认放弃；取消时不得同步活动运行态或销毁 session。
- 概览成功打开 Mod 后进入该 Mod 的概览页；恢复流程严禁作为页面导航入口。

## 陷阱

- 把概览扫描结果或恢复快照当作已加载运行态会让概览与 session 身份混淆。
- 移除 Mod 时绕过统一清理用例会残留页签、草稿或历史状态。
- 恢复期间未暂停自动保存会把半恢复状态写回快照。
- 用字符串拼接列宽 key 会让不同表列宽互相覆盖。
- 关闭工作区跳过 dirty 确认会让未保存修改静默丢失。
- 工作区关闭必须撤销工作区代次；关闭前发起的目录探测、创建后扫描、刷新与恢复响应不得重新建立概览或运行态。
