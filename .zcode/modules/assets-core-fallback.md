# 资源与原版回退

## 定义

资源与原版回退系统在 Rust 路径边界内解析 `ResourceRef`、批量提供 data URL，并处理 Mod/Core 资源与引用路径解析。

## 参考

`src-tauri/src/commands/hull_reference.rs`：Hull command 主归属。
`src-tauri/src/commands/resources.rs`：批量资源与引用 command 主归属。
`src-tauri/src/services/project/cache/`：资源指纹缓存 owner。
`src-tauri/src/services/project/resources/`：资源解析与批量 data URL owner。
`src/app/composables/editors/use-resource-reference.ts`：贴图引用选择 owner。
`src/app/composables/tables/use-schema-select-media.ts`：当前选项图片、超额结果及菜单释放主归属。
`src/app/composables/use-visible-resource-media.ts`：可视区媒体解析 owner。
`src/domain/config/hull-references.ts`：选项及内置槽位的纯投影主归属。
`src/domain/schema/schema-options.ts`：引用选项与 ResourceRef 消费规则 owner。
`src/services/hull-reference.service.ts`：Hull 查询及引用投影主归属。
`src/services/resource-cache.service.ts`：前端资源缓存 service owner。
`src/services/resource-media.service.ts`：通用媒体服务 owner，资源缓存之上的响应式投影视图。
`src/services/resource-reference.service.ts`：授权引用解析能力主归属。
`src/shared/runtime/cache.ts`：资源缓存消费的 LRU 及 pending 原语。
`src/shared/runtime/media-budget.ts`：共享 WebView 字节预算与逐出回调主归属。

## 边界

- Core 派生索引只按 canonical 游戏根持久化，只缓存已请求类型，读取前必须以源内容指纹校验，Mod 投射物优先覆盖 Core。
- 前端 resource cache 与 media projection 在每个 WebView 共用 64 MiB data URL 预算；两层均按访问顺序逐出，resource cache 与后端资源指纹缓存各自保持 512 项容量。
- 后端 query 把资源标为 `ResourceRef`；前端通用媒体服务批量 query，组件只消费 ResourceRef 与缓存结果。
- 舰体引用空请求只返回创建表单所需目录；带 ID 请求只解析名称与引用元数据；目录选项严禁批量转 data URL。
- 资源查找按 Mod 优先、符合规则时 Core fallback；编辑器贴图为纯引用，后端校验所选路径位于 Mod 根内并返回正斜杠相对路径。
- 通用媒体服务保持 25ms 合批、single-flight、session 隔离、路径标准化与资源失效；失效或关闭时 pending 与 in-flight 投影请求立即释放，迟到结果不得重新写入。

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

## 规范

- Core root 与所有资源路径必须 canonicalize，拒绝 `..` 与已有父链链接或 reparse point。
- Hull 请求身份必须使用去重排序后的 ID 集合，名称、选项与槽位必须消费所属领域纯投影。
- Skin 实体贴图必须消费 SkinFile.data.spriteName；内置槽位必须携带最后定义该内置武器的 Mod/Core 来源并据此分组。
- 列表缩略图只允许解析 observer 预读区内的资源。
- 前端严禁构造 ResourceRef、拼路径、逐项读图或把 data URL 写入 manifest；缺失 data URL 保持 null。
- 单个 data URL 超过 64 MiB 时必须返回本次内容并跳过共享缓存；可见消费者必须在隐藏、引用切换、失效和卸载释放暂存结果。
- 可见元素 ref 再次登记同一 DOM 时必须保持可见身份和当前资源结果。
- 可见媒体 owner 必须按资源登记、可见性变化、引用替换和卸载增量释放；登记单行不得扫描全部登记项。
- 选项媒体 owner 必须按集合登记菜单、已选值、摘要和键值行资源；集合替换只更新受影响资源，引用计数归零后才释放临时结果。
- 资源读取票据必须归共享媒体 registry；集合释放只结束所属等待，迟到结果不得写入已撤销集合。
- 屏幕外资源严禁发起 data URL 查询；资源失效后可见资源必须重新解析。
- 引用解析只接受 Mod 根内安全相对路径；绝对路径、`..` 与链接逃逸必须拒绝。
- 指纹不一致即丢弃快照并重建；缓存损坏或不可写只降级，严禁读取旧快照。
- 整批返回必须先核对数量、顺序、完整资源身份与 nullable data URL，再发布所属缓存。

## 陷阱

- Core fallback 允许写盘会让只读边界被突破。
- resource cache 与 media projection 分别计算预算会让同一 WebView 的 data URL 占用失控。
- 在前端按路径规则拼出 ResourceRef 会让资源身份脱离后端授权。
- 指纹校验跳过会让过期派生索引冒充当前 Core 内容。
- 缓存命中不刷新访问顺序会让 LRU 逐出策略失真。
- 逐项 IPC 读图会让列表滚动产生请求风暴。
