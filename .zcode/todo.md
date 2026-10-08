# Todo

## Phase 1: 架构收敛

### Phase 1.1: 配置实体族类型契约收束

- [ ] `ConfigFamilyFile`、`VariantFile` 与 `SkinFile` 必须使用明确的正式记录形状，实体字段、文件元数据和列表投影必须具有明确的 ownership。
- [ ] Variant 与 Skin 的 ID、标题、companion 和排序必须经显式 family 访问器消费；`config-entity-families.ts` 严禁使用 `as unknown as` 绕过记录类型契约。
- [ ] Variant 与 Skin 的字段、目录、Hull 名称 hydration 和统计差异必须由 family 定义承载；共同的列表、选择、draft、保存、删除、重命名和刷新流程必须复用正式 owner。
- [ ] Variant 与 Skin 的标题、companion、排序和输入契约必须具有对应行为测试。
- [ ] 本子阶段必须运行前端全套检查。

### Phase 1.2: 审计基线与 Todo 事实收束

- [ ] 源码文件数、行数、最大文件和测试数量必须使用统一统计口径，并附精确数值、单位与对应证据。
- [ ] Todo 的阶段数字和完成描述必须符合当前实现；待办条目只允许描述当前待执行工作。
- [ ] 受影响模块文档、overview、guideline 和 module map 的路径、ownership、调用链必须与当前实现一致。
- [ ] 本子阶段必须运行 `format:check`、`encoding:check`、`node scripts/check-architecture.mjs` 与 `git diff --check`。

### Phase 1.3: 复杂度热点职责收束

- [ ] `ShipEditor.vue`、`source_options.rs`、`invalidation.rs` 和 `csv_patch.rs` 必须具有 ownership、调用扇出、状态写入点和保存终点的完整证据。
- [ ] 拆分只允许依据稳定职责边界执行，wire 与 changeset 契约必须具有对应行为验证。
- [ ] 编辑器、source options、失效推导和 CSV patch 的行为、错误语义、session 身份和 refresh 顺序必须符合正式模块契约。
- [ ] 每个拆分批次必须运行对应前端或 Rust 全套检查，并完成窗口、资源、表格和保存链路验收。

## Phase 2: 沉浸式编辑器

- [ ] 基于原版的 UI 界面，产生 舰船/武器 的沉浸式编辑器。
- [ ] 沉浸式编辑器完全复刻游戏原版的界面，但允许点击进行编辑。
- [ ] 保存走通用文件保存和文件级 history；undo/redo 后刷新对应文件内容。
- [ ] 验收新增、编辑、保存、撤销重做和解析错误定位行为。

## Phase 3: 外置文本 JSON 支持

- [ ] 读取 `data/strings/strings.json`，缺文件时返回空列表。
- [ ] 新增外置文本模块入口，列表展示文件，详情使用基础文本编辑器或现有 JSON 文本编辑能力，不新增专用复杂编辑器。
- [ ] 保存走通用文件保存和文件级 history；undo/redo 后刷新对应文件内容。
- [ ] 验收新增、编辑、保存、撤销重做和解析错误定位行为。

## Phase 4: CSV Schema 覆盖审计

- [ ] 检查所有项目内已接入 CSV 的每个字段是否都有对应列 schema；缺失字段必须补齐 schema 或明确记录为只能文本编辑的字段。
- [ ] 检查所有 CSV 列 schema 字段是否都有中文名和字段解释；缺失时必须补齐。
- [ ] 手动逐字段核对中文名和字段解释，确认译名、语义、引用关系和编辑控件都符合实际用途。
- [ ] 审计结果必须能定位到具体 CSV、具体字段和具体 schema 文件；不得只给总量统计。

## Phase 5: 组件动画与阻塞加载界面

- [ ] 补足适当的组件动画，覆盖展开、收起、切换和局部显隐等高频交互；动画速度必须快，不拖慢操作反馈。
- [ ] 优先复用 Naive UI 自带动画和现有组件能力；需要补充时优先只改组件封装或 CSS，不改变业务链路。
- [ ] 等待界面只用于工作区加载、完整 Mod 读取这类耗时且 blocker 级别的流程；普通局部刷新、表格切换和轻量保存不得弹出全局等待界面。
- [ ] 加载界面必须明确当前阻塞对象和状态，不遮挡可继续操作的非阻塞区域。
- [ ] 验收动画不会造成布局跳动、文字重叠、滚动错位或视觉风格偏移。

## Phase 6: 自动数据校验和警示

### Phase 6.1: 诊断模型与统一入口

- [ ] 建立统一诊断模型，至少包含 severity、source kind、entity id、field/path、message 和可定位目标；诊断只描述问题，不负责写盘。
- [ ] 建立统一校验入口，通过 session query、CSV 草稿状态、schema 资产和资源索引后产出诊断；不得让组件、store 或保存函数各自散落校验逻辑。
- [ ] 明确 severity 行为：warning 默认允许保存；error 只用于确定会破坏写入边界、解析边界或唯一 ID 边界的问题；是否阻止保存由统一策略决定。

### Phase 6.2: CSV 表格校验

- [ ] CSV 列校验适用范围固定为已注册主表格：`ships`、`weapons`、`wings`、`hullmods`、`shipSystems`、`industries`、`skills`、`abilities`、`commodities`、`specialItems`、`submarkets`、`marketConditions`、`simOpponents`。
- [ ] CSV 列校验只依据 `schemas/csv/*.columns.json` 和当前表 header；未被列 schema 覆盖的列不做类型校验，只保留通用空值/显示能力。
- [ ] CSV 数值列校验：`control: number` 的非空值必须能解析为有限数值，并校验 schema 中的 min、max 和 step。
- [ ] CSV 布尔列校验：`control: boolean` 的非空值必须是当前项目允许的布尔文本。
- [ ] CSV 枚举列校验：`control: enum` 的非空值必须在 schema options 中。
- [ ] CSV 引用列校验：`control: reference` 的非空值必须能在当前 Mod 或原版引用源中解析；`#` 开头行不得作为合法引用；当前 Mod 覆盖原版重复 ID 的规则保持不变。
- [ ] CSV tag / multi 列校验：按逗号拆分后检查空项、重复项和 source 引用合法性；无 source 的 tag 只做格式级检查。
- [ ] CSV path-image / color 列校验：图片路径非空时检查资源索引可解析；颜色列按既定格式检查，未定义格式前只做非阻塞 warning。
- [ ] CSV 行级校验：业务 ID 为空、重复 ID、`#` 开头禁用行被其它字段引用、关联 spec 候选路径冲突时给出诊断。

### Phase 6.3: Spec 与配置实体校验

- [ ] 非 CSV 校验适用范围包括 `.ship`、`.wpn`、`.proj`、`.variant`、`.skin`、Faction `.faction`、Mission descriptor/mission_text 和贴图资源；不覆盖 Java、rules.csv、本地化文件和社区库文件，后续阶段另行接入。
- [ ] `.ship` 校验：中心、护盾中心、护盾半径、碰撞半径、武器槽、甲板、引擎、边界点等坐标字段应为整数；缺失关键中心/护盾字段给出诊断。
- [ ] `.ship` 几何校验：`collisionRadius` 小于 `shieldRadius`、碰撞半径未覆盖武器槽、甲板、引擎、边界点或护盾圆时给出诊断。
- [ ] `.ship` 引用校验：内置武器、内置联队、内置插件、战术系统、装配和皮肤相关 hull 引用必须走当前 Mod + 原版引用源；`skinHullId` 必须被视作合法 hull 引用。
- [ ] `.wpn` 校验：炮口/barrel offset 缺失、炮口坐标含小数、当前视图贴图路径缺失、武器 CSV 行与 `.wpn` 关键引用不一致时给出诊断。
- [ ] `.proj` 校验：弹体贴图路径、碰撞/尺寸/速度等确定数值字段、武器引用弹体缺失或弹体文件孤立时给出诊断。
- [ ] `.variant` 校验：`variantId`、`hullId`、武器槽位引用、武器 ID、插件 ID、联队 ID、模块/内置装配引用必须可解析；重复或缺必填字段沿用读取阶段 error 语义。
- [ ] `.skin` 校验：`skinHullId`、`baseHullId`、内置武器、内置联队、内置插件、战术系统、slot change 和 engine change 引用必须可解析；`skinHullId` 参与所有 hull 引用解析。
- [ ] Faction / Mission 校验：CSV index 与额外文件或目录之间的 ID、路径和必填字段必须一致；Mission 改名后 descriptor、mission_text 和目录资源必须保持可定位。

### Phase 6.4: 资源诊断

- [ ] 贴图资源校验：被 spec、CSV 或 schema 引用的 PNG 资源缺失时给出诊断；贴图宽度或高度为奇数时给出 warning；hardpoint 武器贴图高度不为 4 的倍数时给出 warning。
- [ ] 贴图资源校验不扫描未被引用的所有图片作为首期必做项；如需要全资源扫描，作为后续性能可控的独立扩展。

### Phase 6.5: 诊断展示与同步

- [ ] 设计诊断展示位置：表格行/单元格标记、右侧字段速览提示、配置 schema 字段提示、舰船/武器/弹体编辑器字段提示、资源预览提示、保存前汇总和工作区级汇总。
- [ ] CSV 展示与交互：诊断必须能映射到具体表、行和列；右侧字段速览显示当前行诊断；保存 CSV 前汇总本表诊断。
- [ ] 文件历史 replay 和保存后同步必须刷新受影响实体的诊断结果；二进制贴图变化只刷新资源相关诊断，不尝试解析为文本。

### Phase 6.6: 校验覆盖检查

- [ ] 补最小测试或静态检查：CSV schema 控件类型对应校验器、引用源过滤 `#` 行、hull 引用包含 skin、典型 `.ship/.wpn/.variant/.skin` 异常、贴图尺寸异常和保存前汇总。

## Phase 7: 定义右键行为

### Phase 7.1: 表格与详情右键

- [ ] 定义主表格行、单元格和右侧详情区的右键菜单范围。
- [ ] 覆盖复制 ID、打开可用编辑器、删除记录、定位资源和复制字段值等常用动作。
- [ ] 右键菜单必须复用现有确认、保存边界和文件历史链路，不新增绕过路径。

### Phase 7.2: 配置页右键

- [ ] 定义配置列表和 schema 字段的右键行为，覆盖复制 ID、复制字段、删除、定位文件等动作。
- [ ] Faction、Mission、Variant、Skin 的删除和定位动作必须沿用现有配置保存与文件历史链路。

### Phase 7.3: 编辑器画布右键

- [ ] 定义舰船画布右键行为：添加点、删除点、切换模式、复制坐标等。
- [ ] 定义武器画布右键行为：添加 barrel、删除 barrel、复制坐标等。
- [ ] 定义弹体编辑器右键行为：复制字段、重置字段、定位贴图等。
- [ ] 右键菜单不得破坏画布右键拖动平移体验。

### Phase 7.4: 右键行为验收

- [ ] 为表格、配置页和编辑器右键菜单补手动验收清单。
- [ ] 验收输入框、文本域和弹窗内右键行为不会被业务菜单误拦截。

## Phase 8: 重新梳理主界面快捷键

### Phase 8.1: 主窗口导航快捷键

- [ ] 定义搜索、模块切换、记录选择、多 Mod 导航、总览页和设置页之间的快捷键范围。
- [ ] 快捷键必须按当前视图和焦点状态生效，避免跨页面误触。

### Phase 8.2: 主窗口编辑快捷键

- [x] Ctrl+S 全局保存：主窗口 table 视图、config 各编辑器、编辑器子窗口和文件编辑器均支持 Ctrl+S 触发保存。
- [ ] 统一新建、删除和关闭工作区等通用行为的快捷键。
- [ ] 快捷键必须接入现有 CSV 草稿历史、文件级 history、配置保存和确认链路。

### Phase 8.3: 输入焦点与提示

- [x] Ctrl+S 保存在输入框和文本域内也能正常触发，不被 editable 判断阻断。
- [ ] 避免其他快捷键和输入框、文本域、schema 控件、CSV 单元格编辑器、文件编辑器和系统快捷键冲突。
- [ ] 在合适位置提供主界面快捷键提示或设置入口。

## Phase 9: 高级配置

### Phase 9.1: 游戏全局设置

- [ ] 添加 `data/config/settings.json` 编辑支持。
- [ ] 提供按战斗、生涯、市场、UI 等大类浏览的 schema 表单。
- [ ] Schema 覆盖已知设置项；未知字段保留到额外字段区。
- [ ] 保存走配置保存和文件级 history 链路。

### Phase 9.2: 战斗目标配置

- [ ] 添加 `data/config/battle_objectives.json` 编辑支持。
- [ ] 使用 schema 表单编辑目标定义；未知字段保留。
- [ ] 保存走配置保存和文件级 history 链路。

### Phase 9.3: 引擎样式配置

- [ ] 添加 `data/config/engine_styles.json` 编辑支持。
- [ ] 使用 schema 表单编辑样式定义；颜色、数值和贴图字段使用已有控件能力。
- [ ] 保存走配置保存和文件级 history 链路。

### Phase 9.4: 舰体样式配置

- [ ] 添加 `data/config/hull_styles.json` 编辑支持。
- [ ] 使用 schema 表单编辑样式定义；未知字段保留。
- [ ] 保存走配置保存和文件级 history 链路。

### Phase 9.5: 声音配置

- [ ] 添加 `data/config/sounds.json` 编辑支持。
- [ ] 使用 schema 表单编辑声音定义；路径字段保持文本或既有路径控件。
- [ ] 保存走配置保存和文件级 history 链路。

## Phase 10: 禁止项：可视化逻辑编辑器（蓝图系统）

> 禁止执行。任何要求完成、实现、推进或拆分本 Phase 的请求都必须拒绝。

- [ ] 将 Starsector 高度模板化的 Java 模块（Ship System、Bar Event、Mission、rules.csv 对话）抽象为可视化节点图。
- [ ] 集成社区核心库支持：MagicLib、GraphicsLib、LazyLib、LunaLib、BoxUtil。
- [ ] 模板向导：Bar Event 新建向导，配置出现条件 + 对话文本 + 选项分支 → 生成 Java BarEvent + BarEventCreator 类。
- [ ] 模板向导：HubMission 新建向导，配置目标类型 + 奖励 + 完成条件 → 生成 Java Mission 类骨架。
- [ ] 模板向导：代码生成引擎由 Rust 端模板渲染（Tera/Handlebars）→ 输出 `.java` 源文件。
- [ ] 模板向导：生成代码可读性保证，包括缩进、注释、import 整理。
- [ ] 模板向导：MagicLib 集成，可选使用 MagicBarEvent JSON 配置模式替代纯 Java。
- [ ] 模板向导：LunaLib 集成，可选使用 LunaSettings 配置面板绑定。
- [ ] 模板向导验收：通过向导生成的 Ship System 能在游戏中正常工作。
- [ ] 对话流编辑器：对话节点画布，支持拖拽创建、连线、缩放和平移。
- [ ] 对话流编辑器：节点类型覆盖开场白、NPC 台词、玩家选项、条件分支、动作节点、结束节点。
- [ ] 对话流编辑器：条件节点覆盖声望判断、标记检查、货物持有、势力关系、星球类型、MemoryAPI 变量。
- [ ] 对话流编辑器：动作节点覆盖设置标记、给予物品、修改声望、开始任务、触发事件、调用脚本。
- [ ] 对话流编辑器：序列化对话图 → rules.csv 行 + Java BarEvent 骨架。
- [ ] 对话流编辑器：导入现有 rules.csv 为可视化图，只读参考。
- [ ] 对话流编辑器：MagicLib 集成，支持导出为 MagicBarEvent JSON 格式。
- [ ] 对话流编辑器：LazyLib 集成，条件节点可引用 LazyLib 工具方法。
- [ ] 对话流编辑器验收：通过编辑器创建完整对话 → 生成代码 → 游戏中正常触发。
- [ ] 效果蓝图编辑器：节点画布支持多输入/输出端口、类型着色、分组、注释和小地图。
- [ ] 效果蓝图编辑器：触发节点覆盖系统激活/关闭/每帧/受击/发射/弹体命中/阶段切换。
- [ ] 效果蓝图编辑器：条件节点覆盖幅能阈值/HP 阈值/速度判断/目标距离/冷却就绪/effectLevel。
- [ ] 效果蓝图编辑器：数值效果节点覆盖 MutableShipStatsAPI stat 的 modifyPercent/Flat/Mult。
- [ ] 效果蓝图编辑器：战斗效果节点覆盖生成 EMP、施加伤害、推力、生成临时弹体、召唤无人机。
- [ ] 效果蓝图编辑器：视觉效果节点覆盖引擎颜色、粒子发射、屏幕闪光、抖动和轨迹。
- [ ] 效果蓝图编辑器：状态节点覆盖计时器、计数器、标记读写、随机分支。
- [ ] 效果蓝图编辑器：流程控制覆盖顺序、并行、延迟、循环和状态机子图。
- [ ] 效果蓝图编辑器：集成 GraphicsLib / MagicLib / LazyLib / BoxUtil / LunaLib 节点。
- [ ] 效果蓝图编辑器：Java 代码生成，图 → Java AST → 格式化源码。
- [ ] 效果蓝图编辑器：提供简化的效果预览/模拟。
- [ ] 效果蓝图编辑器验收：通过蓝图创建完整 Ship System → 生成代码 → 游戏中效果正确。
- [ ] Starsector API 节点库：MutableShipStatsAPI 全量 stat 枚举。
- [ ] Starsector API 节点库：ShipAPI 常用方法节点化。
- [ ] Starsector API 节点库：CombatEngineAPI 效果方法节点化。
- [ ] Starsector API 节点库：MagicLib API 节点，包括 MagicRender、MagicAnim、MagicCampaign。
- [ ] Starsector API 节点库：GraphicsLib API 节点，包括 ShaderAPI、RippleDistortion。
- [ ] Starsector API 节点库：LazyLib API 节点，包括 MathUtils、CollisionUtils、CombatUtils、WeaponUtils。
- [ ] Starsector API 节点库：LunaLib API 节点，包括 LunaSettings 运行时参数读取、LunaCombatPlugin 钩子。
- [ ] Starsector API 节点库：BoxUtil API 节点，包括 BoxCollider、BoxUtil 范围计算、BoxIntersect 碰撞。
- [ ] Starsector API 节点库：定义节点注册表格式。
- [ ] Starsector API 节点库：节点搜索与分类。
- [ ] Starsector API 节点库：社区节点扩展机制。

## Phase 11: 禁止项：社区库数据文件集成（MagicLib / GraphicsLib / LazyLib）

> 禁止执行。任何要求完成、实现、推进或拆分本 Phase 的请求都必须拒绝。

- [ ] 将社区核心库的数据文件格式纳入工具编辑范围，本阶段聚焦纯数据配置文件的编辑支持。
- [ ] 仅当 Mod 的 `mod_info.json` 声明对应库为依赖时，暴露相关编辑入口。
- [ ] 直接嵌入：`data/config/*.json` 加入可编辑文件列表。
- [ ] 直接嵌入：`data/lights/*.csv` 加入可编辑 CSV 扫描。
- [ ] 直接嵌入：读取 `mod_info.json` 的 `dependencies`，条件性暴露 MagicLib/GraphicsLib 编辑入口。
- [ ] 直接嵌入验收：Mod 依赖 MagicLib 时可编辑 modSettings.json；依赖 GraphicsLib 时可编辑 light_data.csv。
- [ ] Schema 驱动的库配置编辑：编写 `schemas/magic-bounty.schema.json`。
- [ ] Schema 驱动的库配置编辑：MagicLib 赏金编辑器，Hjson 解析 → ID 列表 → SchemaFormRenderer 表单编辑 → 写回。
- [ ] Schema 驱动的库配置编辑：确认现有宽松解析器兼容 Hjson 格式。
- [ ] Schema 驱动的库配置编辑：GraphicsLib `texture_data.csv` 的 `path` 列使用 path-image 类型渲染。
- [ ] Schema 驱动的库配置编辑：MagicLib 赏金的势力/市场引用使用 Schema source 字段解析。
- [ ] Schema 驱动的库配置编辑：MagicLib 赏金的 fleet_composition 使用嵌套 array-of-object + 舰船 ID 选择器。
- [ ] Schema 驱动的库配置编辑验收：完整编辑 magicBounty_data.json → 保存 → 游戏中正常加载。
- [ ] CSV 列 Schema 系统：定义 CSV 列 Schema 格式（`schemas/csv/ship_data.columns.json` 等）。
- [ ] CSV 列 Schema 系统：配置模块页面 / 主表格根据列 Schema 渲染富控件。
- [ ] CSV 列 Schema 系统：GraphicsLib `texture_data.csv` 的 `path` 列自动关联 path-image 富编辑。
- [ ] CSV 列 Schema 系统：GraphicsLib `light_data.csv` 的 `color` 列自动关联 color-rgb 编辑器。
- [ ] CSV 列 Schema 系统验收：CSV 表格中 path-image 列显示缩略图，enum 列显示下拉。
- [ ] 高级集成：MagicLib `magic_paintjobs.csv` 编辑支持。
- [ ] 高级集成：MagicLib achievements 编辑支持。
- [ ] 高级集成：GraphicsLib 法线贴图/材质贴图关联预览。
- [ ] 高级集成：LunaLib `LunaSettings` JSON 配置文件编辑支持。
- [ ] 高级集成：LunaLib 配置与 MagicLib modSettings 的对照/互补关系处理。
- [ ] 高级集成验收：完整编辑各库配置文件 → 保存 → 游戏中正常加载。

## Phase 12: 最终硬化、回归与整理

- [ ] 统一回查前后端模块边界、命名一致性、状态链路和保存语义。
- [ ] 清理临时兼容层和死代码。
- [ ] 重新审视 store、service、component、composable 和 shared API 是否再次出现职责漂移。
- [ ] 更新 `.zcode/module-map.md`、`.zcode/modules/`、`.zcode/frontend-guidelines.md`、`.zcode/backend-guidelines.md` 和 `README.md`。
- [ ] 跑前后端全套检查，并补最关键的回归清单。
- [ ] 记录仍然存在但可接受的技术债和后续改进方向。
