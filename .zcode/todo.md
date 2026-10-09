# Todo

## 批次验收

- 文档批次：运行 `format:check`、`encoding:check`、`node scripts/check-architecture.mjs` 与 `git diff --check`。
- 前端批次：运行 `format:check`、`encoding:check`、`lint`、`typecheck`、`test` 与 `build`。
- Rust 批次：运行 `cargo fmt --check`、`cargo clippy --all-targets -- -D warnings` 与 `cargo test`。
- 跨层、保存、路径、parser、workspace 或发布链路批次：运行前后端全部检查；视觉批次：验收亮暗主题、窄窗口、滚动、hover、focus、disabled 和文字布局。
- 每批记录命令、退出码、耗时、测试数量与失败位置，核对工作树、暂存区、编码、换行和用户修改的保留状态。

## Phase 1: 全量架构修复

本阶段以全项目审计的 22 个根因为入口，完成相关抽象、职责边界、状态所有权、持久化所有权、同构、迁移态和实现复杂度的全链路整改。

- [ ] 按业务不变量、状态与持久化所有权、独立变化需求、消费者收益和修改范围确定正式结构。
- [ ] 每个根因必须覆盖全部同类实现及消费者；执行中确认的相关架构问题必须登记证据、归属子阶段、整改目标和验收条件，并纳入本阶段。
- [ ] 每个子阶段必须贯通入口、输入、调用、状态写入、输出消费者、持久化、事件、错误和生命周期终点。
- [ ] 实现、公开类型、调用方、检查规则和相关现行文档必须按同一契约收束。
- [ ] 数据模型调整必须直接采用目标模型；严禁引入旧数据迁移、兼容包装或并存的过渡协议。

### Phase 1.1: 静态检查与架构约束收束

对应 **A04**。改动规模为中型重构，方向为共享解析入口和规则归属收束。

- [x] 统一依赖解析入口，将 alias、相对路径、省略扩展名和目录入口解析为实际文件节点，再执行层级、职责和循环判定。
- [x] 分别表达模块依赖边与导入符号信息，统一去重口径，使每条边界事实具有唯一检查归属。
- [x] 按正式能力核对读取、订阅、写入、缓存失效与会话操作的授权矩阵，明确组件、ViewModel、service、orchestrator、store 和共享运行时的职责。
- [x] 补齐实际检查入口的行为测试，覆盖路径形式、运行时与类型依赖、循环、合法调用、违规调用及报告数量。
- [x] 建立职责与接口变更时同步规则、授权矩阵和规范的持续维护契约。

后续子阶段调整职责或接口时，必须同步对应规则、授权矩阵和规范。

验收：同一实际依赖的判定保持一致；检查入口能够准确约束正式调用链。

### Phase 1.2: 活动输入与编辑会话收束

对应 **A01、A14**。改动规模为中型重构，方向为输入提交与未保存状态收束。

- [x] 统一对象、数组、JSON 文本、CSV native 输入和文本浮层的原始输入登记、提交、取消、错误定位及卸载释放协议。
- [x] 将输入绑定到所属编辑目标；CSV 输入明确携带 Mod、表、rowKey 和字段身份。
- [x] 让 dirty、保存捕获、关闭确认、目标切换和外部更新共同消费所属会话的活动输入状态。
- [x] 保存时先提交活动输入，再捕获正式草稿并生成保存参数；输入形状和领域转换由所属字段或规格定义提供。
- [x] 统一单元格、字段输入和草稿历史的提交动作边界。

验收：未失焦保存、非法输入保留、多控件提交、取消、切换、关闭、滚动和窗口化替换均保持正确输入与目标归属。

实现与验收证据：[Phase 1.2](plans/phase-1.2-report.md)、[验证记录](plans/phase-1.2-validation.md)。

### Phase 1.3: 快照接纳、保存与历史生命周期重构

对应 **A02、A08**。改动规模为重构级，方向为目标快照和基线交接收束。

- [x] 统一每个编辑目标的读取、保存完成、外部基线交接和卸载接纳顺序，将值、版本凭据和相关元数据作为同一快照处理。
- [x] 编辑会话统一拥有进行中的保存状态；一次保存捕获提交值和版本，完成后按实际提交快照更新基线，保存期间的新编辑继续参与 dirty。
- [x] 本地提交和明确基线交接推进读取接纳代次；消费者卸载时撤销其响应接纳权。
- [x] 将画布快照历史绑定目标与基线代次，基线交接同步处理历史、选择和预览。
- [x] 将画布和检查器编辑接入统一显式提交及历史登记入口，保留拖拽和镜像操作的动作粒度。

验收：迟到读取、重复保存、保存失败、保存期间编辑、目标切换、卸载重入、外部基线后的撤销及值与版本同步。

实现与验收证据：[Phase 1.3](plans/phase-1.3-report.md)、[验证记录](plans/phase-1.3-validation.md)。

### Phase 1.4: 业务数据边界与规格构造重构

对应 **A18、A19**。改动规模为重构级，方向为数据职责拆分与格式构造收束。

- [x] 分开承载业务 JSON 内容和工具运行时元数据；CSV 明确表达行身份、插入位置及来源位置等工具字段。
- [x] 按正式元数据契约生成写入内容，完整保留业务 JSON 的顶层字段、嵌套字典键和数组内对象。
- [x] 为各类关联规格建立所属格式的正式创建构造，明确 ID、字段类型、必读字段和领域默认值。
- [x] 将 CSV 行转换为明确的规格创建参数；关联创建和来源缺失时的创建均消费正式构造。
- [x] 收束编辑器新建、关联 spec 新建及相关 schema 默认值的权威来源，核对游戏加载器的实际消费契约。
- [x] 武器创建参数、评分与关联确认统一限定 projectile、beam，pulse 备注与结构化保存约束贯通。
- [x] 前后端检查与真实组件交互验收具备可定位证据。

验收：业务字典键保留、工具元数据处理、规格必读字段、类型化内容、专用编辑保存及 CSV 与 spec 联合回放。

实现与验收证据：[Phase 1.4](plans/phase-1.4-report.md)、[验证记录](plans/phase-1.4-validation.md)。

### Phase 1.5: 实体记录、身份、实际目标与版本重构

对应 **A03、A06、A10、A11、A20**。改动规模为设计重构，方向为记录职责拆分与实体目标收束。

- [x] 收束 `ConfigFamilyFile`、Variant 和 Skin 的记录契约，明确加载身份、实际目标、可编辑内容、版本及列表展示信息的来源。
- [x] 统一两族 ID、标题、companion 和排序访问器，使用完整表达消费字段的类型；family 拥有展示、字段和 Hull 名称 hydration 差异。
- [x] 由后端实体查询提供实际已加载目标；文本编辑、专用编辑和 CSV 关联动作共同消费该目标；创建路径由所属领域定义产生。
- [x] 将规格内容 ID 编辑、导入和重命名接入正式身份交接动作，统一装配原身份、下一身份、关联记录、文件目标和窗口事件。
- [x] 势力索引路径通过所属根边界解析，加载、版本和保存共同消费授权目标。
- [x] 多文件实体由实际写入目标定义产生版本集合，统一 detail、list、identity 查询与保存凭据。
- [x] 窗口身份按 session、kind、Mod 路径、实体 ID 或文件路径分别归一化，并统一窗口实例与事件过滤的身份来源。
- [x] 保存准备统一保留同一物理目标的原读取凭据，追加独立创建或改名目标凭据；真实保存动作与大小写场景具备回归断言。
- [x] 浏览器真实实体族组件完成身份字段、加载路径、亮暗主题、窄窗口、滚动和焦点验收。
- [x] 十项全量检查通过，根因、连带问题、行为断言与命令证据完整归档。
- [ ] Tauri 原生多窗口完成并发打开、目标占用聚焦、跨窗口跟随、关闭等待及创建期间会话关闭的实机验收。

验收：两族记录显示、嵌套路径、文件名与 ID 不同、导入、重命名、删除、根归属、多文件版本冲突和跨窗口身份。

实现与验收证据：[Phase 1.5](plans/phase-1.5-report.md)、[验证记录](plans/phase-1.5-validation.md)。原生实机验收当前待核实，工具环境提供浏览器交互能力。

### Phase 1.6: 会话来源、实体投影与写后同步重构

对应 **A07、A09、A15**。包含重构级改动，以及 **A09 弹体来源修正这一局部改动**；方向为族状态拆分和提交投影收束。

- [x] 初始化、缓存恢复与失效重建共同消费正式实体来源组合，保持 Mod 覆盖与 Core 补集一致。
- [x] 弹体初始化与单族失效重建共同消费 Mod 覆盖和 Core 补集；实际来源及 Mod 覆盖创建目标具备查询、保存与审计入口证据。
- [x] Variant 和 Skin 分别拥有索引、统计和诊断；manifest 按明确顺序聚合展示信息。
- [x] 单族失效更新所属族状态，联合变化按实际影响范围重建。
- [x] 由后端事务统一完成提交后的会话投影，提交结果携带已完成投影或明确待同步状态。
- [x] 前端统一接纳提交结果、文件历史、版本和 rowKey 映射，并完成缓存失效与窗口广播。
- [x] 刷新失败和广播失败按各自状态重试，复用已经完成的提交结果。
- [x] 再次保存于同一次操作中先同步原提交再保存新修改；关闭等待先重试同步再判断最新 dirty。
- [x] 配置本地身份、列表与正式快照共同接纳，真实组件保留保存期间的原控件和后续输入。
- [x] 浏览器完成同步失败、手动重试、再次保存、关闭等待及亮暗主题、窄窗口、滚动与焦点验收。
- [x] 十项全量检查通过，来源、投影、恢复、通知与连带交接问题具备可定位证据。

验收：Core 补集、新建与删除覆盖、单族诊断变化、投影构建次数、提交后查询、同步失败重试、跨窗口保存及文件回放。

实现与验收证据：[Phase 1.6](plans/phase-1.6-report.md)、[验证记录](plans/phase-1.6-validation.md)。原生多窗口实机验证沿用 Phase 1.5 的独立待核实登记。

### Phase 1.7: 导航、Core、Mission 与错误职责收束

对应 **A05、A12、A16、A17**。包含 **A05 导航目标修正这一微小改动**及中型职责重构，按独立职责分别形成提交。

- [ ] 表格状态动作显式接收目标 Mod，导航在统一边界交接活动身份与目标表，保持搜索、选择和列宽归属。
- [x] 表格导航按目标 Mod 切换目标表，活动输入在导航前交接；返回已有目标表时保留所属过滤与选择。
- [ ] Core 共享运行态由正式状态 owner 持有，读取请求、根切换接纳和错误策略由加载 owner 调度；字段与 graphics 分别拥有加载状态。
- [ ] Mission VM 统一拥有列表查询、响应接纳、刷新与正式选择；组件拥有局部输入和展示事件。
- [ ] 创建、保存和删除后的 Mission 列表与选择交接统一由动作边界完成。
- [ ] 错误分别提供稳定码、原始诊断、用户文案和结构化文件位置；包装、反馈、日志和恢复入口消费各自投影。

验收：跨 Mod 导航、Core 根切换与迟到响应、Mission CRUD 后列表与选择、dirty 切换确认、错误包装、日志和文件定位。

### Phase 1.8: 能力公开面、共享原语与样式收束

对应 **A13、A21、A22**。改动以公开面收束和局部清理为主，包含 **hydrate 合并、原语清理和主题 token 修正**。

- [ ] 逐项核对 12 个 service 文件中的 43 个纯转发或别名入口，将公开签名和 wire 组装收口到单一能力入口。
- [ ] 按缓存、领域映射、资源装配和错误策略的实际职责组织能力，同步全部消费者、公开类型、规则和规范。
- [ ] 精简 RuntimeCache 的公开协议与内部状态，保留正式缓存消费者需要的容量、访问顺序和 pending 能力。
- [ ] 清理两个独立 JSON 文本转换入口，合并同实现的 hydrate 调用，并明确 workspace 的活动身份所有权。
- [ ] 表格浮层的 5 条样式声明接入正式间距与阴影 token，补齐静态 CSS 和主题 DOM 注入的契约核对。
- [x] 表格浮层的 5 条间距与阴影声明使用正式 token；选择与文本浮层共用视口位置、宽度和 resize 生命周期。
- [ ] 全量回查各子阶段的类型断言、重复入口、状态交接、格式转换、命名、同构和消费者接线，完成相关现行文档同步。

验收：command 与 payload 映射、错误语义、缓存行为、工作区恢复、JSON 输入、亮暗主题和表格浮层交互。

### Phase 1 验收与文档验证

- [ ] 核对 22 个根因及执行中确认的相关问题的实现、全链路验收和可定位证据；各子阶段的正式契约、类型、消费者、规则与文档必须一致。
- [ ] 各实施子阶段按现行批次验收规则执行；跨层保存、路径、格式、版本和回放改动必须执行前后端全部检查。
- [ ] 文档修改必须运行 `format:check`、`encoding:check`、`node scripts/check-architecture.mjs` 与 `git diff --check`，记录命令、退出码及结果，并核对工作树、暂存区和 UTF-8 无 BOM 编码。

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
