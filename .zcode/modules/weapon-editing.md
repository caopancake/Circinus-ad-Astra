# 武器、弹体与发射预览

## 定义

武器、弹体与发射预览系统在独立窗口编辑 `.wpn` 与其弹体引用，并提供只读发射预览窗口。

## 参考

`schemas/spec-defaults.json`：前后端共享的 5 类格式、7 个分支默认模板。
`scripts/architecture/rules/editor-module-boundary.mjs`：编辑器组件边界规则 owner。
`src-tauri/src/services/project/write/entity_identity.rs`：武器、弹体及其关联记录的身份保存 owner。
`src-tauri/src/services/project/query/entities.rs`：草稿武器资源引用 query owner。
`src/app/components/editors/ProjectileEditor.vue`：弹体编辑器组件 owner，拥有 projectile/missile 分支表单。
`src/app/components/editors/WeaponEditor.vue`：武器编辑器组件 owner，拥有表单、发射点画布与弹体入口。
`src/app/components/editors/WeaponFirePreview.vue`：发射预览组件 owner，拥有弹道模拟、光束与播放控制。
`src/app/composables/editors/use-editor-window-view-model.ts`：窗口 ViewModel owner，维护目标 Draft Session、弹体 bundle 与资源。
`src/domain/editors/lib/game-spec-enums.ts`：游戏 spec 正式枚举 owner。
`src/domain/editors/lib/projectile-fields.ts`：弹体引擎槽完整默认值 owner。
`src/domain/editors/lib/weapon-sprite-fields.ts`：武器贴图字段、键映射与 origin 比例 owner。
`src/domain/editors/spec-construction.ts`：规格创建、分支必读字段补入与武器类型选项 owner。
`src/windows/editor.window.ts`：编辑器窗口请求 owner，承载武器、弹体与预览三种窗口类型。

## 边界

- `specClass` 决定正式字段分支；发射点 edits 只作用于当前视图（炮塔/固定）的数组，两套数组互不配对。
- dirty 时外部保存暂存，不能覆盖草稿；镜像配对只按坐标对称实时计算。
- 发射预览是单例只读窗口：只消费已保存 bundle 或一次性草稿快照，严禁写盘、读取编辑器实时草稿或发送保存事件。
- 弹体窗口按 `projectileSpecId` 打开，弹体保存的变更经失效刷新回到武器 bundle。
- 武器草稿只允许消费 `.wpn` 内容，弹体草稿只允许消费 `.proj` 内容；身份变化必须由所属事务更新实际文件与正式关联记录。
- 资源与引用只走统一 query/cache，严禁拼路径或构造 fallback 弹体。
- 预览的发射点与角度读取、贴图 origin 比例与 sprite 层绘制必须与武器编辑器同源。

## 链路

### 武器编辑

1. 窗口按 `.wpn` 目标打开并加载 bundle、弹体与资源。
2. 基础属性、贴图与音效经表单显式提交进草稿。
3. 画布编辑发射点：拖动位置、Shift 新增、Ctrl 设角度、退格删除。
4. 空格开关镜像，成对生效；U/H 切换炮塔与固定视图。
5. 保存经编辑器写链路完成 changeset、历史与刷新。

### 弹体编辑

1. 武器编辑器按 `projectileSpecId` 打开弹体窗口。
2. 弹体编辑按 projectile 与 missile 分支编辑字段与引擎参数。
3. 保存走弹体写链路并广播保存事件。
4. 武器窗口接收弹体失效并刷新引用数据。

### 发射预览

1. 武器编辑器以当前草稿快照（或已保存 bundle）打开预览窗口。
2. bundle 查询按草稿 projectileSpecId 读取弹体，后端 query 按草稿贴图字段返回资源引用。
3. 资源缓存批量解析贴图并交给预览。
4. 预览按炮塔或固定视图构造发射点、模拟弹道与光束阶段。
5. 播放控制支持开火、停火、暂停与倍速。
6. 已存在窗口消费再次打开动作的草稿快照事件并重载 bundle。

## 规范

- Ship 与 Weapon 的草稿贴图必须经统一 query_editor_draft_resources 返回 ResourceRef，再经资源缓存加载；接纳结果必须核对目标和草稿资源代次。
- missile 分支必须完整表达 engineSpec 的 turnAcc、turnRate、acc 与 dec；beam 新建必须提供正式 textureType。
- specClass 条件区段替换必须先提交所属活动输入；颜色与 JSON 原文必须共同参与保存、关闭与外部版本保护。
- 伴随保存事件必须按实体身份与提交序号接纳；较早读取和事件严禁覆盖已接纳的新内容。
- 伴随弹体必须以当前草稿 projectileSpecId 查询；弹体内容、选项目录与贴图必须分别持有响应接纳顺序，结果只允许更新所属投影。
- 初次加载、实体刷新、导入和外部版本载入必须以接纳后的当前草稿解析资源；ResourceRef 与媒体必须作为同一查询结果接入。
- 发射点坐标必须使用吸附步长；角度偏移必须整数化。
- 发射预览的草稿快照必须同时决定武器贴图资源与 `projectileSpecId` 对应的弹体 bundle。
- 实体刷新、资源失效与窗口释放必须使较早资源结果失效；草稿资源接入必须共同核对目标、资源字段和请求代次。
- 已存在的预览窗口再次打开时必须接收最新草稿快照并刷新依赖 bundle。
- 弹体引擎新增必须产生唯一 id、loc、角度、宽高与完整 CUSTOM styleSpec；弹体和导弹选项必须来自游戏正式枚举。
- 弹体引用变更必须经 `projectileSpecId` 正式字段，严禁按显示名或下标关联。
- 弹体编辑的引擎槽位只允许在 missile 分支编辑。
- 武器与弹体的 JSON 输入必须共用形状化输入控件，对象字段必须声明对象形状，完整弹体规格必须由弹体归一化入口处理。
- 武器与弹体的新建必须消费共享模板的独立克隆；引用字段必须由用户继续编辑。
- 武器创建与结构化保存只允许 projectile 和 beam；pulse 原文必须保持可读并允许修正，违规保存必须返回 spec.weapon_class_unsupported 并标明 specClass。
- 武器类型入口必须备注“pulse 在原版中无法正常处理，武器类型只允许 projectile 和 beam。”。
- 画布镜像模式按空格开关，仅作用于当前视图的发射点数组；配对只按坐标对称实时计算，检查器数值输入不参与镜像联动。
- 草稿资源引用必须由后端 query 返回，只允许通过正式资源缓存解析。
- 武器与弹体必须分别持有实际编辑目标；Core 弹体首次保存必须在当前 Mod 的领域默认路径创建覆盖。
- 同 ID 保存必须保留实际文件路径，ID 修改必须保留原目录并完成正式窗口身份交接；只读预览必须跟随所属武器的新身份。
- 规格分支切换必须先交接活动输入，再保留已有业务内容并补入目标分支缺失必读字段；一次切换必须登记为一次编辑动作。
- 贴图字段为纯引用：浏览只接受 Mod 根内 png 并原样写入字段，Mod 外拒绝，不复制、不改名。
- 贴图路径变化或资源重新查询必须清空旧媒体投影；查询失败必须经 AppFeedback 呈现，资源或实体刷新必须支持重新查询当前草稿。
- 预览窗口的轨道构造必须来自武器与弹体的正式字段，资源失效时按依赖刷新。

## 陷阱

- 让预览窗口读取编辑器实时草稿会绕过"只消费已保存数据"的窗口边界。
- 弹体保存后不刷新武器 bundle 会让引用数据停留在旧值。
- 两大视图的发射点数组互相配对会让炮塔与固定坐标互相污染。
- 在预览窗口为缺失弹体构造默认值会掩盖引用错误。
- 贴图浏览复制文件或改写路径会破坏纯引用边界。
