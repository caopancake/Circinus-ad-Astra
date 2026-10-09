# 目录打开

## 定义

目录打开系统识别用户选择的游戏根或 Mod 目录，建立 ProjectSession 或游戏概览，并管理打开失败状态。

## 参考

`src/orchestrators/directory-opening.orchestrator.ts`：打开编排 owner，拥有识别分流、打开结果形状与失败回滚。
`src-tauri/src/services/directory_opening/detection.rs`：目录识别 owner，判定游戏根、游戏内 Mod 与外部 Mod。
`src-tauri/src/services/directory_opening/session_opening.rs`：ProjectSession 建立 owner。
`src-tauri/src/services/directory_opening/overview.rs`：游戏概览扫描 owner。
`src-tauri/src/commands/directory_opening.rs`：目录打开 command 边界。
`src/app/composables/use-workspace-shell-actions.ts`：打开动作消费入口，处理 outcome 与失败反馈。
`src/domain/project/load-warnings.ts`：加载警告格式化 owner。
`scripts/architecture/rules/directory-opening-boundary.mjs`：目录打开边界规则 owner。

## 边界

- 目录识别只归后端：前端只接收识别结果与 outcome，严禁按目录名猜测类型。
- 游戏概览与 ProjectSession 是独立身份，必须按 `modRoot` 隔离；只有成功 session 才能驱动业务 query。
- 打开失败的回滚必须复用工作区生命周期清理入口，释放已登记 session，并保留单条按 `modRoot` 隔离的失败记录。
- 已加载 Mod 重复打开是幂等导航动作，不得重建 session 或清空运行态。
- 打开期间用户确认的 dirty 语义归工作区生命周期，本模块不吞掉确认。
- 恢复编辑目标必须由已识别的 `modRoot` 与其内部错误路径共同确定，路径安全校验只以后端为权威。
- 扫描警告、打开 outcome 与恢复通知必须共同保留结构化诊断；用户文案必须在正式呈现投影中产生。

## 链路

### 打开目录

1. 用户经目录选择对话框提交路径。
2. 编排层调用后端目录识别。
3. 识别为游戏根时写入游戏概览并返回概览 outcome。
4. 识别为游戏内 Mod 时先写入概览，再进入 Mod 打开链路。
5. 识别为外部 Mod 时直接进入 Mod 打开链路。
6. 无法识别时返回带消息的未知 outcome。

### 打开 Mod 项目

1. 编排层检查该 `modRoot` 是否已在工作区。
2. 已存在时按请求视图做幂等导航并返回已加载 outcome。
3. 新 Mod 注册 loading 条目与打开代次并激活概览。
4. 调用后端打开 ProjectSession；仍持有当前代次时注册 manifest，失去代次时关闭返回的 session 并返回取消 outcome。
5. 成功后更新条目名称与状态，并按性能打点水合运行态。
6. 失败时回滚 5-store 运行态、写入打开失败记录并向调用点抛出。

### 从概览打开 Mod

1. 用户在游戏概览中打开某个 Mod。
2. 编排层以概览的 `starsectorRoot` 作为已知游戏根。
3. 复用 Mod 打开链路并返回 outcome。

### 新建 Mod 后打开

1. 新建完成后按是否提供游戏根决定打开后的视图。
2. 提供游戏根时先扫描游戏概览再打开。
3. 复用 Mod 打开链路返回 outcome，不重新识别刚创建的目录。

## 规范

- 打开 outcome 必须区分游戏概览、新加载、已加载、取消与未知五种形状；取消结果只允许结束对应打开动作。
- 目录探测的路径边界失败作为错误返回；未识别目录只以 Unknown outcome 表达，严禁折叠成 warning；概览扫描的根目录校验失败同样作为错误返回。
- 打开成功必须同步活动视图：概览请求显示工作区总览，Mod 请求进入该 Mod 概览。
- 成功打开对应 Mod、成功刷新或关闭工作区必须清理适用的打开失败记录。
- 概览扫描返回的 Mod 列表只用于概览展示，不进入工作区运行态。
- loading 条目必须先于后端调用注册，避免窗口期重复触发。
- manifest 登记、运行态水合与失败回滚必须属于发起打开时的 Mod 代次；移除后到达的成功响应必须关闭对应 session。
- 目录探测、创建后概览扫描与工作区刷新必须捕获工作区代次；关闭工作区后到达的扫描结果只允许结束原动作，严禁重新写入概览。
- 回滚后必须回到工作区总览，不得停留在半初始化页面。
- 游戏目录的 `mods` 目标由后端以同一游戏根判定和路径边界解析。

## 陷阱

- 在前端按目录名推断游戏根或 Mod 会绕过后端识别的 canonical 校验。
- 打开失败后保留 loading 条目会让工作区出现永久假加载。
- 重复打开已加载 Mod 时重建 session 会丢失该 Mod 的草稿与历史。
- 把概览扫描结果当作已加载运行态会让概览与 ProjectSession 身份混淆。
- 回滚时清空全部失败记录会把其它 Mod 的真实失败吞掉。
