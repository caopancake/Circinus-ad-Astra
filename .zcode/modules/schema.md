# 字段模式系统

## 定义

字段模式系统把正式 schema 映射为配置与编辑器字段渲染、校验、引用选择与额外字段编辑。

## 参考

`src/domain/schema/schema-registry.ts`：schema 资产唯一加载入口，拥有 5 个 spec 与 14 个 csv 列资产的运行时形状校验。
`src/domain/schema/schema.types.ts`：schema 输出类型 owner，拥有字段/控件闭合枚举与 FileSchema/FieldSchema/列 schema 形状。
`src/domain/schema/schema-values.ts`：字段值转换 owner，拥有解析、格式化、kv 条目与宽松 JSON 文本规则。
`src/domain/schema/schema-options.ts`：source 选项与 SelectOption 规则 owner。
`src/domain/schema/schema-sections.ts`：section 投影与折叠标识 owner。
`src/domain/schema/schema-core-fields.ts`：原版字段合并 owner。
`src/domain/schema/schema-runtime.ts`：runtime 上下文 owner。
`src/app/components/schema/SchemaFormRenderer.vue`：表单渲染 owner。
`src/app/components/schema/SchemaFieldRenderer.vue`：字段渲染 owner。
`src/app/components/schema/SchemaScalarInput.vue`：类型文本输入 owner，暂存原文并提交正式字段动作。
`src/shared/ui/JsonValueInput.vue`：JSON 原始输入 owner，按声明形状解析并提交。
`src/shared/ui/NumberValueInput.vue`：Smart 数值原文与正式值提交 owner。
`src/shared/lib/input-number.ts`：完整有限浮点与安全整数解析 owner。
`src/shared/ui/JsonFieldEditor.vue`：额外字段结构化编辑 owner。
`schemas/*.schema.json`、`schemas/csv/*.schema.json`、`schemas/well-known-labels.json`：schema 资产本体。
`src-tauri/src/domain/well_known_labels.rs`：well-known 标签资产唯一加载入口，编译期内嵌并校验版本头。

## 边界

- schema 资产只能经唯一加载入口消费，入口处执行逐属性运行时校验；资产外严禁二次强转。
- schema 资产与加载器必须使用 `circinus-ad-astra/` 版本标识前缀。
- 资产正式形态统一带 `$schema` 版本头：spec 资产为 `field-schema/v1` 加 `sections`（可选 `sources`），CSV 列资产为 `csv-columns/v1` 加与表注册表 key 一致的 `table` 与 `columns`。
- CSV 列 schema 文件命名依据为表注册表 key；游戏原文件名的映射唯一归后端表注册表所有，资产命名严禁复制第二套游戏文件名体系。
- well-known 标签资产只允许经后端唯一加载入口编译期内嵌消费，加载时必须校验版本头，严禁在查询逻辑内重建标签表。
- domain/schema runtime 拥有字段语义、source、归一化与纯转换；组件只渲染与提交字段事件。
- `csv:` source 目录必须只由 `(sessionId, source)` 标识，并完整返回当前 Mod 非注释唯一值与原版补集，保持 CSV 原始行顺序；实体声明的 source 以实体清单为值域，按 Mod 与原版分组去重，解析归后端实体注册表。
- `hull:builtInWeaponSlots` 必须以 session 与草稿 baseHullId 标识，经后端舰体引用查询返回继承与覆盖后的内置武器槽 ID；基础舰体变化与舰体引用失效必须重新查询。
- 引用 source 必须经统一 query/service 返回选项元数据与 ResourceRef；缩略图只在下拉展开或已选值变化时按需合批解析。
- JSON 对象与数组必须暂存原始输入并在提交边界校验类型；未完成输入必须计入 dirty、保留控件和原字段类型，并阻止保存及定位字段。
- 字段更新必须使用 `SchemaFieldUpdate` 的设置或删除动作；嵌套对象、kv 与数组对象必须沿正式字段路径消费同一动作。
- kv 行与数组条目必须使用结构化稳定 key；严禁按下标 key 后手工重排状态补偿。
- 前端严禁通过字段名猜语义、构造 ResourceRef、扫描文件或在 schema 组件内写盘。

## 链路

### 表单渲染

1. 配置或编辑器页面以合并后 schema 调用表单渲染器。
2. 表单渲染器按 section 投影遍历字段并挂载字段渲染器。
3. 表单输入面接纳设置模式，字段渲染器消费所属输入面的实际模式。
4. 延迟提交控件登记原文，在提交边界解析形状或类型。
5. 字段动作沿嵌套路径设置或删除键并进入 Draft Session。

### 引用与选项

1. 字段声明 source 时渲染器经 runtime 上下文请求选项目录。
2. 选项目录按 `(sessionId, source)` 查询并保持原表行序。
3. 目录外非空值以原始文本同时作为标签与值进入选项。
4. 资源类选项在展开或选中时按需解析缩略图。

### 额外字段

1. 表单渲染器收集模型中未定义字段组成额外字段模型。
2. 结构化编辑器按键类型分派输入控件并支持增删。
3. 更新以整体替换提交回表单模型。

## 规范

- 来源查询目标变化必须清理旧目录，失败必须经 AppFeedback 呈现一次并允许重试；Core 资源门面必须返回响应式 refs。
- 路径字段必须消费 pathBase；Mod 路径必须相对 Mod 根，Mission icon 必须相对任务目录，候选目录和选择器必须服从同一基准。
- 数组与 key-value 行必须由编辑会话内的稳定身份维护，增删必须对应更新行身份；深拷贝草稿严禁改变现存行节点、焦点和展开态。
- 字符串字段只允许提交字符串；Plain 整数必须按完整十进制和安全整数范围解析，浮点必须按完整有限十进制解析，非法文本必须逐字符保留。
- Plain 数字、布尔与 Smart 数字必须登记原文；非法输入必须保留正式字段类型并阻止提交，可选具名字段清空必须删除键，必填字段清空必须定位为错误。
- 颜色面板数值必须先校验原文，复合字段终结器必须随后提交颜色；显式取消必须恢复正式颜色与控件显示。
- 数组元素清理必须消费所属删除项动作；字段删除必须按稳定行身份取消所属输入子树。
- 颜色文本与面板调整必须登记为同一字段输入；保存必须提交有效颜色，取消必须恢复已提交颜色。
- 模式替换涉及待提交输入时必须确认放弃；取消必须保留当前输入面，确认必须取消输入并采用最新设置模式。
- plain editMode 只允许文本或 JSON 文本；smart editMode 才允许增强控件；含换行字符串必须使用 textarea。
- Smart 下拉的选项菜单与已选标签必须共用同一 SelectOption。
- 不可解析的手输值必须显示逐字符原始文本；空字符串表示未选择。
- 字段挂载严禁触发选项贴图批量读取；批量解析必须 single-flight 去重。
- 已选值必须按逐字符身份与目录比较，首尾空白完整保留。
- Bundled schema 注册时必须校验每个 `csv:` source 的表名属于正式 CSV 表注册表或实体注册表的 source 声明，无效 source 必须阻止注册。
- 未知字段与额外字段必须按正式 JSON 边界保留，严禁丢弃。
- schema 组件严禁写盘或直连 IPC。

## 陷阱

- 用字符串替换或正则修复 JSON 会产生不可解释的结构错误。
- 按下标渲染 kv 行并在删除时手工平移下拉状态会让展开态错行。
- 让字段挂载即批量解析贴图会造成 IPC 风暴。
- 把目录外手输值替换为空会让坏引用被静默清除。
- 在渲染组件内二次解析 schema 资产会让形状校验被绕过。
