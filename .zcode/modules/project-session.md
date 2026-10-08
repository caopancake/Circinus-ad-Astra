# 项目会话与清单缓存

## 定义

项目会话与清单缓存系统在后端按已打开 Mod 管理实体索引、按需 query、写后失效与 manifest，前端仅缓存结果。

## 参考

`src-tauri/src/services/project/session.rs`：session 注册表与状态锁 owner，拥有打开、关闭与 session 查询。
`src-tauri/src/services/project/root.rs`：canonical 游戏根与持久化缓存 owner。
`src-tauri/src/services/project/query/`：只读实体与表格 query owner。
`src-tauri/src/services/project/write/`：写入 owner，返回 changes、结构化 invalidation 与刷新结果。
`src-tauri/src/services/project/cache/`：按实体类型的懒加载缓存 owner。
`src-tauri/src/services/project/resources/`：Mod/Core 资源解析 owner。
`src/stores/project.store.ts`：前端 manifest 与活动 session 缓存 owner。
`src/orchestrators/project-session-refresh.orchestrator.ts`：写后 refresh 编排 owner，先资源后查询应用失效并广播。
`src/shared/api/session-api.ts`：session 打开/关闭/刷新 wire API。
`src/shared/api/query-api.ts`：query wire API。

## 边界

- query 严禁写盘；write 严禁重开整个项目；两者只经 `sessionId + modRoot` 身份约束协作。
- session 注册表锁只保护 `sessionId -> Arc<Mutex<ProjectSession>>` 的插入、移除与查找；每个 session 各自持有一把状态锁。
- 写入锁序必须为根目录事务租约、session 状态、core/sprite/持久化缓存；注册表锁只允许用于短暂句柄访问。
- session 关闭只从注册表移除条目；已取得 handle 的在途操作自然完成，关闭后新操作按未知 session 拒绝。
- 前端 project store 只保存活动 session 与 manifest，严禁读盘、扫描或按完整快照替代 query。
- 写结果接纳与权威刷新必须分别消费 receipt 的结构化 invalidation，缓存失效必须先资源后查询。
- 编辑草稿资源 query 必须消费 EditorResourceKind、实体身份与独立草稿；引用必须由后端正式实体资源定义产生。
- 前端项目失效必须由刷新编排消费；按会话清理必须由工作区生命周期编排消费；查询、订阅和匹配能力必须分别声明消费者。
- 查询 source options 的 tags 元数据依赖特殊物品蓝图包与势力标签；这些来源变化时必须覆盖所有注册 CSV 表的 tags source scope。
- 查询缓存与媒体缓存的 pending/in-flight 请求在 session 失效或关闭时必须立即释放，迟到结果不得写入新代次。

## 链路

### 打开 ProjectSession

1. 目录打开编排请求打开目标 Mod。
2. 后端计算 canonical root 并校验 Mod 结构。
3. 加载经源指纹验证的派生索引快照，或走正式解析后落盘快照。
4. 建立 session 与 manifest 并返回前端。
5. 前端 project store 注册 manifest 并水合活动运行态。

### 按需 query

1. 组件请求触发 ViewModel 调用 query service。
2. query service 经 wire API 调用后端 session query。
3. 后端从懒加载缓存取数并返回实体与资源引用。
4. 前端写入按 session 隔离的查询缓存并驱动渲染。

### 写后失效

1. 保存编排提交 changeset 后把原始变更交给 refresh 编排。
2. refresh 请求后端 session 刷新并校验 `sessionId + modRoot`。
3. 后端应用变更、更新基线并返回新 manifest 与结构化失效。
4. 前端替换 manifest，先失效资源缓存再失效查询缓存。
5. 广播失效事件驱动子窗口同步。

### 关闭 session

1. Mod 移除或工作区关闭触发关闭请求。
2. 后端从注册表移除条目并释放资源。
3. 在途操作自然完成；后续进入的未知 session 请求被拒绝。
4. 前端按生命周期清理用例移除对应缓存与状态。

## 规范

- 异步刷新提交必须验证捕获 session 和 pending 生命周期；已关闭 session 的响应严禁覆盖新会话 manifest。

- 编辑 query 必须随数据返回 baseVersions；派生信息刷新必须保留 CSV 行身份，内容刷新必须按实际写盘方向处理。

- 所有 Mod 缓存与索引必须按 session 隔离，严禁跨 session 复用。
- ID 归属的实体视图、表计数与失效快照只枚举非注释且实体 ID 非空的行；缺 ID 行仍属于表格、草稿与保存链路。
- 写后失效对无法解析的实体只发出该实体种类的 `id: null` scope，严禁阻断其它实体或扩大失效范围。
- 重命名的失效必须同时携带旧 ID 与新 ID。
- 舰体引用查询的指定 ID 结果必须包含内置武器槽目录，并按当前 Mod 优先、原版补集与皮肤继承规则计算。
- CSV 写后 refresh 必须保留当前缓存与 changeset after 文本一致的行身份和键分配序列；重新读取的外部版本必须按正式加载入口建立行身份。
- 持久化索引只存于工具私有目录并按 canonical `modRoot` 分片；只保存可由源文件重新推导的规格、阵营、任务和表计数。
- core 缓存命中共享 `Arc` 快照，命中路径零深拷贝；加载只写内存并标记 dirty，落盘合并为一次性 flush（打开成功后与缓存失效前执行），严禁在 query 路径内持久化。
- 打开时必须对全部索引输入计算内容指纹；路径集合、内容或格式版本任一不一致即丢弃快照。
- 缓存损坏或不可写只降级为重建，严禁读取旧快照。
- 已登记 session 必须保留至显式关闭；打开其它项目严禁驱逐已有 session，关闭时必须清理对应媒体缓存。

## 陷阱

- 在 query 内写盘会让只读边界与缓存语义互相污染。
- 用一次全量失效替代结构化失效会让无关窗口与缓存反复重建。
- 锁序反转让注册表锁内发生磁盘等待会阻塞全部 session。
- 以 Mod 源文件之外的编辑态填充持久化索引会把临时状态变成权威。
- 忽略内容指纹直接使用快照会让过期索引冒充当前 Mod 结构。
