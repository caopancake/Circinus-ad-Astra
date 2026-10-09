# 项目会话与清单缓存

## 定义

项目会话与清单缓存系统在后端按已打开 Mod 管理实体索引、按需 query、写后失效与 manifest，前端仅缓存结果。

## 参考

`src-tauri/src/commands/project_session.rs`：session 生命周期 command 主归属。
`src-tauri/src/services/project/cache/`：按实体类型的懒加载缓存 owner。
`src-tauri/src/services/project/cache/spec_records.rs`：实际来源根、相对路径、加载 ID 与业务内容的记录 owner。
`src-tauri/src/services/project/query/`：只读实体与表格 query owner。
`src-tauri/src/services/project/query/entity_targets.rs`：实际编辑目标、身份意图及正式版本范围 owner。
`src-tauri/src/services/project/resources/`：Mod/Core 资源解析 owner。
`src-tauri/src/services/project/root.rs`：canonical 游戏根与持久化缓存 owner。
`src-tauri/src/services/project/session.rs`：session 注册表与状态锁 owner，拥有打开、关闭与 session 查询。
`src-tauri/src/services/project/write/`：写入 owner，返回 changes、结构化 invalidation 与刷新结果。
`src-tauri/src/services/project_session.rs`：游戏根与 Mod 根授权、建立会话及性能记录主归属。
`src-tauri/src/services/write_transactions/committed.rs`：已写盘提交的投影结果、恢复记录和根序号 owner。
`src/orchestrators/project-session-refresh.orchestrator.ts`：提交接纳 owner，拥有投影恢复、历史与 manifest 接纳、缓存失效、统一通知及重试进度。
`src/services/entity-query.service.ts`：实体查询能力交接。
`src/services/project-session.service.ts`：session 打开、关闭、刷新与恢复协议主归属。
`src/stores/project.store.ts`：前端 manifest 与活动 session 缓存 owner。

## 边界

- query 严禁写盘；write 严禁重开整个项目；两者只经 `sessionId + modRoot` 身份约束协作。
- session 关闭只从注册表移除条目；已取得 handle 的在途操作自然完成，关闭后新操作按未知 session 拒绝。
- session 注册表必须分别登记授权 root 与会话 handle；受影响会话定位只允许消费登记 root，各 session 状态必须分别持锁。
- 写入锁序必须为根目录事务租约、session 状态、core/sprite/持久化缓存；注册表锁只允许用于短暂句柄访问。
- 写结果接纳与权威刷新必须分别消费 receipt 的结构化 invalidation，缓存失效必须先资源后查询。
- 前端 project store 只保存活动 session 与 manifest，严禁读盘、扫描或按完整快照替代 query。
- 前端项目失效必须由刷新编排消费；按会话清理必须由工作区生命周期编排消费；查询、订阅和匹配能力必须分别声明消费者。
- 查询 source options 的 tags 元数据依赖特殊物品蓝图包与势力标签；这些来源变化时必须覆盖所有注册 CSV 表的 tags source scope。
- 查询缓存与媒体缓存的 pending/in-flight 请求在 session 失效或关闭时必须立即释放，迟到结果不得写入新代次。
- 编辑草稿资源 query 必须消费 EditorResourceKind、实体身份与独立草稿；引用必须由后端正式实体资源定义产生。

## 链路

### 打开 ProjectSession

1. 目录打开编排请求打开目标 Mod。
2. 后端计算 canonical root 并校验 Mod 结构。
3. 加载经源指纹验证的派生索引快照，或走正式解析后落盘快照。
4. 建立 session 与 manifest 并返回前端。
5. 前端 project store 注册 manifest 并水合活动运行态。

### 按需 query

1. 组件请求触发 ViewModel 调用所属实体、CSV、source、Hull 或资源能力。
2. 所属能力经 command.runtime 调用后端 session query。
3. 后端从懒加载缓存取数并返回实体与资源引用。
4. 前端写入按 session 隔离的查询缓存并驱动渲染。

### 写后失效

1. FIFO 事务写盘并登记文件历史、提交身份与实际版本。
2. 事务按路径归属定位已登记会话，构造受影响投影并发布会话更新。
3. receipt 返回 ready 投影或 pending 提交引用与结构化错误。
4. 前端接纳历史、manifest 与投影代次，先失效资源缓存再失效查询缓存。
5. 统一提交事件携带来源窗口、完整 receipt 与保存或回放原因，消费者按身份接纳。

### 提交恢复

1. 手动重试、再次保存或关闭交接取得所属待同步 receipt。
2. pending 投影经 synchronize_committed_write 消费后端登记的提交记录。
3. ready 投影进入本窗口接纳，完成状态推进至广播。
4. 广播成功释放前端 pending；失败保留当前步骤及 receipt。

### 关闭 session

1. Mod 移除或工作区关闭触发关闭请求。
2. 后端从注册表移除条目并释放资源。
3. 在途操作自然完成；后续进入的未知 session 请求被拒绝。
4. 前端按生命周期清理用例移除对应缓存与状态。

## 规范

- CSV 写后 refresh 必须保留当前缓存与 changeset after 文本一致的行身份和键分配序列；重新读取的外部版本必须按正式加载入口建立行身份。
- CSV 查询必须显式投影 sourceRowIndex 与 factionId；搜索必须消费业务值与势力投影，势力过滤只允许消费 factionId。
- Core 弹体必须保留 Core 实际来源，同时必须声明当前 Mod 的覆盖创建目标；失效重建必须消费相同来源组合。
- ID 归属的实体视图、表计数与失效快照只枚举非注释且实体 ID 非空的行；缺 ID 行仍属于表格、草稿与保存链路。
- Variant 与 Skin 必须分别持有索引和诊断，统计必须消费所属记录数量；manifest 诊断必须按 Variant、Skin 顺序聚合。
- Variant 与 Skin 的业务输出必须是文件内容；加载身份、文件目标、版本与资源必须分别归正式记录。
- WriteResult 必须携带 sessionUpdates；每项必须表达 sessionId、modRoot、commitId 与 ready 或 pending，ready 必须携带 manifest、invalidation 和 projectionRevision。
- core 缓存命中共享 `Arc` 快照，命中路径零深拷贝；加载只写内存并标记 dirty，落盘合并为一次性 flush（打开成功后与缓存失效前执行），严禁在 query 路径内持久化。
- detail、list 与编辑目标查询必须消费同一目标定义；规格目标必须承载实际来源、所属根、写入目标、加载身份及关联行。
- manifest 接纳必须核对 session 与单调投影代次；提交接纳与事件消费必须按根、提交序号去重。
- pending 提交与前端同步登记必须保存稳定码、原始 message 与 nullable location，呈现必须消费所属文案投影。
- 会话与 Core CSV 缓存必须分别保存业务 data、rowKey 与势力投影 factionId，严禁覆盖文件中的同名业务键。
- 写后失效对无法解析的实体只发出该实体种类的 `id: null` scope，严禁阻断其它实体或扩大失效范围。
- 初始化、缓存恢复和失效重建必须消费同一所属来源构造；每次投影中的受影响族必须去重且各构造一次。
- 多文件版本必须覆盖实际规格与所属 CSV、势力索引与授权规格、任务索引与任务目录；新建必须携带目标不存在凭据。
- 已写盘提交的投影恢复必须经所属 FIFO 根租约；正常 ready 结果只允许直接接纳，广播重试必须复用已完成投影。
- 已登记 session 必须保留至显式关闭；打开其它项目严禁驱逐已有 session，关闭时必须清理对应媒体缓存。
- 异步刷新提交必须验证捕获 session 和 pending 生命周期；已关闭 session 的响应严禁覆盖新会话 manifest。
- 所有 Mod 缓存与索引必须按 session 隔离，严禁跨 session 复用。
- 打开时必须对全部索引输入计算内容指纹；路径集合、内容或格式版本任一不一致即丢弃快照。
- 投影 pending 期间的新查询必须返回 session.projection_pending，当前草稿与展示必须保留。
- 投影构造必须先完成全部受影响索引、诊断、统计与版本，再原子发布；失败必须保留原投影并登记 pending。
- 持久化索引只存于工具私有目录并按 canonical `modRoot` 分片；只保存可由源文件重新推导的规格、阵营、任务和表计数。
- 持久化缓存必须消费格式版本 6 的来源记录、行记录与两族独立结构化诊断，并按源指纹和格式标识核对恢复内容。
- 提交投影恢复必须消费会话读取归属；Core 写入授权必须归实际写盘和回放入口，投影恢复必须保持已提交内容。
- 来源指纹、缓存恢复与目录加载必须经同一根边界授权实际文件及父链；索引引用必须纳入源指纹与版本范围。
- 缓存损坏或不可写只降级为重建，严禁读取旧快照。
- 编辑 query 必须随数据返回 baseVersions；派生信息刷新必须保留 CSV 行身份，内容刷新必须按实际写盘方向处理。
- 舰体引用查询的指定 ID 结果必须包含内置武器槽目录，并按当前 Mod 优先、原版补集与皮肤继承规则计算。
- 重命名的失效必须同时携带旧 ID 与新 ID。

## 陷阱

- 以 Mod 源文件之外的编辑态填充持久化索引会把临时状态变成权威。
- 在 query 内写盘会让只读边界与缓存语义互相污染。
- 忽略内容指纹直接使用快照会让过期索引冒充当前 Mod 结构。
- 用一次全量失效替代结构化失效会让无关窗口与缓存反复重建。
- 锁序反转让注册表锁内发生磁盘等待会阻塞全部 session。
