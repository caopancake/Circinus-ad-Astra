# 资源与原版回退

## 定义

资源与原版回退系统在 Rust 路径边界内解析 `ResourceRef`、批量提供 data URL，并处理 Mod/Core 资源与引用路径解析。

## 参考

`src-tauri/src/services/project/resources/`：资源解析与批量 data URL owner。
`src-tauri/src/services/project/cache/`：资源指纹缓存 owner。
`src/shared/api/assets-api.ts`：资源 wire API。
`src/services/resource-cache.service.ts`：前端资源缓存 service owner。
`src/services/resource-media.service.ts`：通用媒体服务 owner，资源缓存之上的响应式投影视图。
`src/shared/runtime/cache.ts`：统一缓存原语 owner。
`src/app/composables/editors/use-resource-reference.ts`：贴图引用选择 owner。
`src/app/composables/use-visible-resource-media.ts`：可视区媒体解析 owner。
`src/app/composables/use-core-assets.ts`：Core 字段、graphics 与窗口生命周期消费入口。
`src/orchestrators/core-assets.orchestrator.ts`：Core 读取、根代次、共享 Promise、响应接纳与日志 owner。
`src/stores/core-assets.store.ts`：所属窗口的 Core 根与两类资源状态 owner。
`src/domain/schema/schema-options.ts`：引用选项与 ResourceRef 消费规则 owner。

## 边界

- 后端 query 把资源标为 `ResourceRef`；前端通用媒体服务批量 query，组件只消费 ResourceRef 与缓存结果。
- 资源查找按 Mod 优先、符合规则时 Core fallback；编辑器贴图为纯引用，后端校验所选路径位于 Mod 根内并返回正斜杠相对路径。
- 舰体引用空请求只返回创建表单所需目录；带 ID 请求只解析名称与引用元数据；目录选项严禁批量转 data URL。
- 前端 resource cache 与 media projection 在每个 WebView 共用 64 MiB data URL 预算；两层均按访问顺序逐出，resource cache 与后端资源指纹缓存各自保持 512 项容量。
- 通用媒体服务保持 25ms 合批、single-flight、session 隔离、路径标准化与资源失效；失效或关闭时 pending 与 in-flight 投影请求立即释放，迟到结果不得重新写入。
- Core 派生索引只按 canonical 游戏根持久化，只缓存已请求类型，读取前必须以源内容指纹校验，Mod 投射物优先覆盖 Core。
- Core 字段与 graphics 必须分别持有数据、加载状态与结构化错误；共享运行态必须归 store，读取与日志必须归加载编排。

## 链路

### 资源解析

1. 组件或 schema 选项携带 ResourceRef 请求资源。
2. 通用媒体服务合并同帧请求并以 single-flight 查询后端。
3. 后端按 Mod 优先、Core fallback 解析路径并读取字节。
4. 返回 data URL 进入前端 LRU 缓存并驱动渲染。

### 贴图引用选择

1. 用户在编辑器发起贴图浏览。
2. 文件选择限定 Mod 根内 png；Mod 外拒绝。
3. 后端校验绝对路径归属并返回正斜杠相对路径。
4. 相对路径原样写入引用字段，不复制、不改名。

### 舰体引用解析

1. 编辑器按需请求舰体引用目录或带 ID 元数据。
2. 空请求返回创建表单目录；带 ID 请求解析名称与引用。
3. 名称按当前 Mod `ship_data.csv` 优先、原版补集解析。

### 核心派生索引

1. 首次访问某 Core 类型时扫描并落盘派生快照。
2. 读取前以源内容指纹校验；指纹按游戏根进程内缓存。
3. 清空内存核心缓存时一并丢弃指纹缓存。

### 窗口 Core 读取

1. 窗口壳建立加载生命周期，按 settings 优先、当前 ProjectSession 补充取得根。
2. 资源消费入口通过加载编排调用所属 Core service，同类同代次请求共用 Promise。
3. 根变化清空两类投影并推进代次，字段与 graphics 分别查询。
4. 当前代次结果写入所属状态，失败记录结构化诊断；读取入口再次请求执行重试。
5. schema 与资源门面投影响应式状态，窗口释放撤销响应接纳并释放根监听。

## 规范

- Skin 实体贴图必须消费 SkinFile.data.spriteName；内置槽位必须携带最后定义该内置武器的 Mod/Core 来源并据此分组。
- 前端严禁构造 ResourceRef、拼路径、逐项读图或把 data URL 写入 manifest；缺失 data URL 保持 null。
- Core root 与所有资源路径必须 canonicalize，拒绝 `..` 与已有父链链接或 reparse point。
- 引用解析只接受 Mod 根内安全相对路径；绝对路径、`..` 与链接逃逸必须拒绝。
- Core 成功、错误与请求收尾必须核对根代次及窗口生命周期；根清空必须立即清空投影。
- Core 加载失败必须保留静态 schema 或空图形选项；后续读取必须按当前根重试。
- 屏幕外资源严禁发起 data URL 查询；资源失效后可见资源必须重新解析。
- 列表缩略图只允许解析 observer 预读区内的资源。
- 指纹不一致即丢弃快照并重建；缓存损坏或不可写只降级，严禁读取旧快照。

## 陷阱

- 在前端按路径规则拼出 ResourceRef 会让资源身份脱离后端授权。
- 逐项 IPC 读图会让列表滚动产生请求风暴。
- 缓存命中不刷新访问顺序会让 LRU 逐出策略失真。
- resource cache 与 media projection 分别计算预算会让同一 WebView 的 data URL 占用失控。
- Core fallback 允许写盘会让只读边界被突破。
- 指纹校验跳过会让过期派生索引冒充当前 Core 内容。
