# 表格编辑

## 定义

表格编辑系统提供窗口化 CSV 表格 query、tables store、行身份、选择、列 schema 渲染与 dirty 维护。

## 参考

`src-tauri/src/commands/tables.rs`：CSV 读取与 patch command 主归属。
`src/app/components/tables/CsvGrid.vue`：表格网格 owner，拥有滚动窗口、列宽与行虚拟化。
`src/app/components/tables/CsvGridBody.vue`：表体 owner，拥有可见行窗口与选中行传递。
`src/app/components/tables/CsvGridCellEditor.vue`：单元格编辑 owner，按列控件类型分派编辑器。
`src/app/components/tables/CsvGridRow.vue`：行渲染与选中态 owner。
`src/app/components/tables/DataTable.vue`：表格工作区组合 owner。
`src/app/composables/tables/use-csv-floating-panel.ts`：浮层视口 owner，统一位置、宽度、上下翻转与 resize 释放。
`src/app/composables/tables/use-csv-row-preview.ts`：详情行预览、读取票据、失效重读与释放主归属。
`src/app/composables/tables/use-csv-table-inputs.ts`：表格输入上下文 owner，连接所属输入集合、活动单元格与值提交。
`src/app/composables/tables/use-csv-table-view-model.ts`：表格 ViewModel owner，连接 query、store、列 schema 与网格。
`src/domain/schema/schema-registry.ts`：列 schema 唯一加载入口。
`src/domain/tables/csv-grid-model.ts`：网格列模型 owner。
`src/domain/tables/table-row-key.ts`：行身份规则 owner。
`src/services/csv-table.service.ts`：窗口、行预览、资源装配和关联实际目标准备主归属。
`src/stores/tables.store.ts`：表格运行态 owner，拥有窗口行、选择、dirty、当前表与保存中状态。
`src/stores/tables.store.ts:initializeModTables`：按 session、Mod 和 manifest 一次建立表格状态与输入集合。
`src/stores/workspace.store.ts`：按 Mod、表与列持有持久化列宽的 owner。

## 边界

- 列 schema 只能从统一加载器的输出类型消费，严禁在组件内二次解析资产。
- 列宽必须使用结构化 `modRoot/table/column`，严禁拼接 key。
- 单元格提交必须消费完整 `CsvCellTarget`，包含 sessionId、modRoot、table、rowKey 与 column；历史必须沿用同一目标。
- 活动单元格身份必须唯一归 tables 运行态；原始输入必须归控件，输入集合必须按 session、Mod 与表隔离。
- Mod 表格运行态只能经 `initializeModTables` 建立；后台恢复与前台打开共享该入口，workspace 活动身份由导航 owner 接纳。
- 同根会话重新初始化必须释放旧输入集合与表格身份锁，新会话只允许消费所属读取与交接登记。
- 窗口接纳、搜索、过滤、外部更新、草稿释放与行选择必须消费显式所属目标；活动身份必须由 workspace 提供。
- 脏标记只允许经草稿变更边界写入，组件严禁直改 dirty 结构。
- 注释身份必须消费 CsvRow.isComment；首个表头列的正式值变化必须经草稿边界更新标记，恢复基线值时必须恢复所属原始标记。
- 行的 data、isComment、rowKey 与势力投影必须分别表达；业务内容与注释标记必须共同参与外部基线比较及 dirty 接纳。
- 行身份只使用 Rust rowKey 或前端临时 new key，严禁按数组索引、显示文本或过滤结果定位行。
- 表格组件严禁直接 IPC、写盘或维护 history；保存必须经保存编排，撤销重做必须经草稿历史。
- 身份交接表锁必须按会话、Mod 与表归属；控件、工具栏、快捷键与窗口读取必须共同消费锁定状态。
- 选中态以响应式 `selectedRowKey` 为唯一来源，行组件按 key 绑定选中样式，严禁 DOM class 手工同步。

## 链路

### 打开表格窗口

1. 表格进入时按需请求当前表的窗口行。
2. ViewModel 按完整目标接纳列宽并处理所属草稿保护。
3. CSV 读取能力装配 query identity 与 command，后端返回窗口与源索引。
4. store 按捕获目标写入行、表头与总数，网格按可视区渲染。

### 编辑单元格

1. 用户激活单元格，所属输入集合提交前一个编辑动作。
2. tables 记录完整活动身份，网格挂载对应编辑控件。
3. 控件登记原始输入并按列 schema 选择输入、选择器或引用选择。
4. 提交经目标化单元格变更边界写入行值并登记一次历史。
5. 已提交行差异进入行脏标记，活动输入差异进入表与 Mod 未保存判定。

### 选择行

1. 用户点击行触发选择事件。
2. store 按捕获 Mod 与表更新 `selectedRowKey`。
3. 行组件按响应式选中态渲染高亮，右侧详情同步刷新。

### 过滤与搜索

1. 用户输入搜索文本或切换势力过滤。
2. ViewModel 提交所属输入并复核目标，更新过滤状态。
3. 查询接纳消费草稿与活动输入保护状态。
4. 全部行被过滤或无可显示列时显示对应说明。

## 规范

- CSV native 输入必须逐字符保留空串、前导零与数字表示，领域转换必须归所属消费者。
- Esc 必须取消本次输入；文本浮层、native 输入与选择器必须共用所属集合的保存提交入口。
- 下划线开头的文件列必须按普通业务列显示、编辑和保存；行身份只允许消费记录的 rowKey。
- 业务 CSV 字段必须归 `CsvDraftRow.data`；rowKey、factionId、sourceRowIndex 与 insertAt 必须分别归所属行记录，严禁写入业务字典。
- 草稿与 dirty 单元格字典必须保留全部自有列键；缺失列必须以空值展示，严禁消费对象原型上的属性。
- 保存期间的表格失效必须合并为后续权威读取；查询必须共同比较原始行基线与版本，自身保存回声只允许更新所属投影。
- 列宽覆盖与测量锁定必须绑定 session、Mod 与表；目标变化必须先接纳所属列宽再处理 dirty 与读取。
- 列宽调整必须即时反映渲染宽度并进入持久化投影。
- 前端新增行只允许使用临时 new key，保存后以后端 rowKey map 替换。
- 单元格编辑必须在动作提交边界一次性写值与登记历史；中间输入必须参与未保存判定，行脏标记只允许表达已提交行差异。
- 同值同版本的窗口接纳必须按 rowKey 更新势力与来源位置投影，并保留正式草稿、dirty 与活动输入。
- 固定枚举选项必须与目标 Starsector 版本的加载器枚举完全一致。
- 搜索必须属于选择器界面状态；自定义值必须使用显式输入入口并登记待提交状态；多选必须以整个编辑动作一次提交。
- 查询窗口必须提供实际 sourceRowIndex；网格 rowIndex 只允许表达当前显示位置。
- 滚动、单元格切换与窗口化替换必须先提交所属输入；同目标模型更新必须保持控件，rowKey 映射必须保留活动输入的归属。
- 窗口读取必须捕获 session、Mod、表、过滤、状态实例与读取代次；本地动作、保存、重载和卸载必须撤销较早响应与错误的接纳权。
- 缺失列 schema 的列只做文本编辑，严禁猜测控件类型。
- 虚拟行（间隔与占位）不参与选择、编辑与 dirty。
- 行预览必须消费捕获的 session、表和 rowKey，目标变化及卸载必须释放等待；资源或行预览失效必须合并后读取当前目标。
- 表格窗口、来源集合与行预览必须分别经所属通道接纳结果和错误；来源集合必须在全部目录返回后共同发布。
- 表格窗口必须按可视区请求行，严禁一次加载全表。
- 选择与文本浮层必须共用视口计算；浮层宽度与水平位置必须服从当前窗口，resize 监听必须随控件释放。

## 陷阱

- 用 DOM class 维护选中会让虚拟滚动后高亮错位。
- 用数组索引定位行会让排序、过滤与删除后写错行。
- 直接把过滤后行数组当作编辑数据源会让 dirty 写到不可见行。
- 缺失列 schema 时启用引用或枚举控件会让无来源列发起空查询。
- 让编辑控件直接调用保存会让局部输入绕过 dirty 与历史链路。
