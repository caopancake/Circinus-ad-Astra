# Todo

## 批次验收

- 文档批次：运行 `format:check`、`encoding:check`、`node scripts/check-architecture.mjs` 与 `git diff --check`。
- 前端批次：运行 `format:check`、`encoding:check`、`lint`、`typecheck`、`test` 与 `build`。
- Rust 批次：运行 `cargo fmt --check`、`cargo clippy --all-targets -- -D warnings` 与 `cargo test`。
- 跨层、保存、路径、parser、workspace 或发布链路批次：运行前后端全部检查；视觉批次：验收亮暗主题、窄窗口、滚动、hover、focus、disabled 和文字布局。
- 每批记录命令、退出码、耗时、测试数量与失败位置，核对工作树、暂存区、编码、换行和用户修改的保留状态。

## Phase 1: 配置实体族类型契约收束

- [ ] 收束 `ConfigFamilyFile`、`VariantFile` 与 `SkinFile` 的记录契约，明确已加载记录、可编辑文件内容、文件元数据和列表派生信息的 ownership。
- [ ] 统一 Variant 与 Skin 的 ID、标题、companion 和排序访问器，使用明确的记录类型，消除 `config-entity-families.ts` 中绕过记录契约的 `as unknown as`。
- [ ] 将展示、字段和 Hull 名称 hydration 差异收口到 family，明确 Rust 对实际目录、保存路径和统计来源的归属，复用现有公共编辑流程。
- [ ] 补齐两族标题、companion、排序和记录输入契约的行为测试，回归跨 Mod、版本凭据、dirty 和重命名交接。

## Phase 2: 沉浸式编辑器

- [ ] 基于游戏原版界面实现舰船与武器沉浸式编辑器，完全复刻原版界面并支持点击编辑。
- [ ] 接入现有画布骨架、目标草稿、资源引用、编辑器保存、文件级 history 与 refresh 链路。
- [ ] 验收新增、编辑、保存、撤销重做、dirty 外部版本交接和解析错误定位。

## Phase 3: 外置文本 JSON 支持

- [ ] 接入 `data/strings/strings.json` 的读取与外置文本模块入口，缺文件时返回空列表。
- [ ] 文件列表与详情复用现有基础文本编辑器或 JSON 文本编辑能力，接入现有保存、文件级 history 与回放刷新链路。
- [ ] 验收新增、编辑、保存、撤销重做、缺文件和解析错误定位。

## Phase 4: CSV Schema 覆盖审计

- [ ] 以现行表注册表、已接入 CSV header 和 `schemas/csv/*.schema.json` 逐字段核对覆盖，补齐缺失 schema 或明确记录为文本编辑字段。
- [ ] 逐字段核对并补齐中文名与解释，核实译名、语义、引用关系和控件的实际用途依据。
- [ ] 整理可定位具体 CSV、字段、schema 文件与依据的审计台账，记录覆盖结论和待修复项。

## Phase 5: 组件动画与阻塞加载界面

- [ ] 在已有 Naive UI 动画、组件和 CSS 基础上补齐展开、收起、切换与局部显隐的覆盖，保持快速反馈。
- [ ] 完善现有工作区与 Mod 加载状态的呈现，明确阻塞对象和状态；为工作区加载与完整 Mod 读取等阻塞流程完善等待界面，保持可操作区域可用。
- [ ] 验收动画与加载呈现的布局、文字、滚动和视觉一致性，以及局部刷新、表格切换和轻量保存的可操作性。

## Phase 6: 自动数据校验和警示

### Phase 6.1: 诊断模型与统一入口

- [ ] 建立描述问题的统一诊断模型，包含 severity、source kind、entity id、field/path、message 和可定位目标。
- [ ] 建立统一诊断入口，复用现有解析、session query、CSV 草稿、schema、引用与资源解析能力，接入组件、store 和保存流程的诊断消费。
- [ ] 定义 severity 与保存策略：warning 默认允许保存，error 表达确定破坏写入、解析或唯一 ID 边界的问题，现有边界失败接入对应诊断语义。

### Phase 6.2: CSV 表格校验

- [ ] 为已注册主表格 `ships`、`weapons`、`wings`、`hullmods`、`shipSystems`、`industries`、`skills`、`abilities`、`commodities`、`specialItems`、`submarkets`、`marketConditions`、`simOpponents` 接入 CSV 列诊断。
- [ ] 依据现有加载器返回的 `schemas/csv/*.schema.json` 和当前表 header 接入列类型诊断，schema 覆盖外的列保留通用空值与显示能力。
- [ ] 为数值、布尔和枚举列分别接入有限数值与 min/max/step、项目允许的布尔文本和 schema options 值域诊断。
- [ ] 复用当前 Mod 与原版引用目录，按 Mod 优先语义诊断引用可解析性，过滤 `#` 开头的禁用行。
- [ ] 为 tag / multi 列接入逗号拆分后的空项、重复项和 source 引用诊断，无 source 的 tag 进行格式诊断。
- [ ] 为 path-image 列接入非空图片路径的资源诊断，为 color 列接入既定格式诊断，格式未定义时产生非阻塞 warning。
- [ ] 接入业务 ID 为空、重复 ID、禁用行被引用和关联 spec 候选路径冲突的行级诊断。

### Phase 6.3: Spec 与配置实体校验

- [ ] 为 `.ship`、`.wpn`、`.proj`、`.variant`、`.skin`、Faction `.faction`、Mission descriptor/mission_text 和贴图资源接入诊断。
- [ ] 为 `.ship` 接入中心、护盾中心、半径、武器槽、甲板、引擎和边界点的整数约束，以及关键中心与护盾字段缺失诊断。
- [ ] 为 `.ship` 接入 `collisionRadius` 小于 `shieldRadius`，以及碰撞半径未覆盖武器槽、甲板、引擎、边界点或护盾圆的几何诊断。
- [ ] 复用当前 Mod 与原版引用源，为 `.ship` 接入内置武器、联队、插件、战术系统、装配和皮肤相关 hull 的引用诊断，包含合法的 `skinHullId`。
- [ ] 为 `.wpn` 接入炮口/barrel offset 缺失、炮口坐标含小数、当前视图贴图路径缺失，以及武器 CSV 与 spec 关键引用不一致的诊断。
- [ ] 为 `.proj` 接入弹体贴图路径、碰撞/尺寸/速度等确定数值字段、被武器引用的弹体缺失和弹体文件孤立诊断。
- [ ] 为 `.variant` 接入 `variantId`、`hullId`、槽位、武器、插件、联队和模块/内置装配引用诊断，重复或缺必填字段接入现有读取 error 语义。
- [ ] 为 `.skin` 接入 `skinHullId`、`baseHullId`、内置武器、联队、插件、战术系统、slot change 和 engine change 引用诊断，hull 引用解析包含 `skinHullId`。
- [ ] 为 Faction / Mission 接入 CSV index 与实体文件或目录的 ID、路径和必填字段一致性诊断，验收 Mission 改名后 descriptor、mission_text 和目录资源的可定位性。

### Phase 6.4: 资源诊断

- [ ] 复用资源解析诊断被 spec、CSV 或 schema 引用的 PNG 缺失，为宽度或高度为奇数、hardpoint 武器贴图高度不为 4 的倍数产生 warning。
- [ ] 按实际引用按需读取图片及尺寸，以正式资源身份确定读取和失效范围。

### Phase 6.5: 诊断展示与同步

- [ ] 接入表格行/单元格、右侧字段速览、配置 schema、舰船/武器/弹体字段、资源预览、保存前汇总和工作区汇总的诊断呈现。
- [ ] 将 CSV 诊断映射到具体表、行和列，在右侧字段速览呈现当前行诊断，保存前汇总本表诊断。
- [ ] 订阅现有保存与文件 history replay 的结构化失效，刷新受影响诊断；二进制贴图变化刷新资源相关诊断。

### Phase 6.6: 校验覆盖检查

- [ ] 补齐 CSV schema 控件与诊断器映射、禁用行引用、含 skin 的 hull 引用、典型 `.ship/.wpn/.variant/.skin` 异常、贴图尺寸和保存前汇总的行为测试或静态检查。

## Phase 7: 定义右键行为

### Phase 7.1: 表格与详情右键

- [ ] 实现主表格行、单元格和右侧详情区的右键菜单，覆盖复制 ID、打开可用编辑器、删除记录、定位资源和复制字段值。
- [ ] 菜单动作接入现有动作、确认、保存边界和文件 history 链路。

### Phase 7.2: 配置页右键

- [ ] 实现配置列表和 schema 字段的复制 ID、复制字段、删除和定位文件菜单。
- [ ] Faction、Mission、Variant、Skin 菜单复用现有配置动作、保存与文件 history 链路。

### Phase 7.3: 编辑器画布右键

- [ ] 为舰船画布接入添加点、删除点、切换模式和复制坐标菜单，为武器画布接入添加 barrel、删除 barrel 和复制坐标菜单。
- [ ] 为弹体编辑器接入复制字段、重置字段和定位贴图菜单，复用现有草稿与资源动作。
- [ ] 明确菜单点击与画布右键拖动平移的动作边界，接入两种交互。

### Phase 7.4: 右键行为验收

- [ ] 整理表格、配置页和编辑器菜单的手动验收清单，覆盖动作、确认、保存、历史及画布平移。
- [ ] 回归输入框、文本域和弹窗中的原生右键行为。

## Phase 8: 重新梳理主界面快捷键

### Phase 8.1: 主窗口导航快捷键

- [ ] 定义并接入搜索、模块切换、记录选择、多 Mod 导航、总览页和设置页的导航快捷键。
- [ ] 将新增快捷键接入现有统一分发器，按当前视图和焦点状态分派。

### Phase 8.2: 主窗口编辑快捷键

- [ ] 统一并接入新建、删除和关闭工作区的命令键位及当前视图动作。
- [ ] 新增编辑命令复用现有 CSV 草稿历史、文件级 history、配置保存和确认链路。

### Phase 8.3: 输入焦点与提示

- [ ] 为新增命令补齐输入框、文本域、schema、CSV 单元格、文件编辑器与系统键位的焦点和冲突回归，回归现有保存与撤销重做策略。
- [ ] 提供主界面快捷键提示或设置入口。

## Phase 9: 高级配置

本阶段目标位于 Mod 的 `data/config/`，游戏配置与工具私有 settings 具有独立归属。

- 各目标接入现有 schema 加载器、表单、额外字段与字段控件，保留未知字段。
- 各目标接入现有配置保存、文件 history 和回放刷新链路，验收编辑、保存、撤销重做、未知字段保留和解析错误定位。

### Phase 9.1: 游戏全局设置

- [ ] 接入 `data/config/settings.json`，提供按战斗、生涯、市场和 UI 分类的 schema 表单，覆盖已知设置项。

### Phase 9.2: 战斗目标配置

- [ ] 接入 `data/config/battle_objectives.json`，以 schema 表单编辑战斗目标定义。

### Phase 9.3: 引擎样式配置

- [ ] 接入 `data/config/engine_styles.json`，以 schema 表单编辑样式，颜色、数值和贴图字段复用已有控件。

### Phase 9.4: 舰体样式配置

- [ ] 接入 `data/config/hull_styles.json`，以 schema 表单编辑舰体样式定义。

### Phase 9.5: 声音配置

- [ ] 接入 `data/config/sounds.json`，以 schema 表单编辑声音定义，路径字段复用文本或既有路径控件。

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
- [ ] CSV 列 Schema 系统：定义 CSV 列 Schema 格式（`schemas/csv/ships.schema.json` 等）。
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

- [ ] 按最终实现回查前后端模块边界、命名、状态归属、保存语义，以及 store、service、component、composable 和 shared API 的职责。
- [ ] 整理具有文件、符号、行号和完整链路证据的清理清单，按证据处理兼容包装、重复入口和死代码。
- [ ] 同步最终契约对应的 module map、模块文档、前后端 guideline 和 `README.md`。
- [ ] 完成前后端全量检查及关键入口、保存、回放、窗口与资源链路回归，交付验收结果和剩余问题证据台账。
