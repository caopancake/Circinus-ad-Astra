# 表格编辑

## 定义

表格编辑系统提供窗口化 CSV 表格 query、tables store、行身份、选择、列 schema 渲染与 dirty 维护。

## 参考

`src/app/components/tables/CsvGrid.vue`：表格网格 owner，拥有滚动窗口、列宽与行虚拟化。
`src/app/components/tables/CsvGridBody.vue`：表体 owner，拥有可见行窗口与选中行传递。
`src/app/components/tables/CsvGridCellEditor.vue`：单元格编辑 owner，按列控件类型分派编辑器。
`src/app/components/tables/CsvGridRow.vue`：行渲染与选中态 owner。
`src/app/components/tables/DataTable.vue`：表格工作区组合 owner。
`src/app/composables/tables/use-csv-floating-panel.ts`：浮层视口 owner，统一位置、宽度、上下翻转与 resize 释放。
`src/app/composables/tables/use-csv-table-inputs.ts`：表格输入上下文 owner，连接所属输入集合、活动单元格与值提交。
`src/app/composables/tables/use-csv-table-view-model.ts`：表格 ViewModel owner，连接 query、store、列 schema 与网格。
`src/domain/schema/schema-registry.ts`：列 schema 唯一加载入口。
`src/domain/tables/csv-grid-model.ts`：网格列模型 owner。
`src/domain/tables/table-row-key.ts`：行身份规则 owner。
`src/stores/tables.store.ts`：表格运行态 owner，拥有窗口行、选择、dirty、列宽、当前表与保存中状态。

## 边界

- 列 schema 只能从统一加载器的输出类型消费，严禁在组件内二次解析资产。
- 列宽必须使用结构化 `modRoot/table/column`，严禁拼接 key。
- 单元格提交必须消费完整 `CsvCellTarget`，包含 sessionId、modRoot、table、rowKey 与 column；历史必须沿用同一目标。
- 活动单元格身份必须唯一归 tables 运行态；原始输入必须归控件，输入集合必须按 session、Mod 与表隔离。
- 脏标记只允许经草稿变更边界写入，组件严禁直改 dirty 结构。
- 行身份只使用 Rust rowKey 或前端临时 new key，严禁按数组索引、显示文本或过滤结果定位行。
- 表格组件严禁直接 IPC、写盘或维护 history；保存必须经保存编排，撤销重做必须经草稿历史。
- 选中态以响应式 `selectedRowKey` 为唯一来源，行组件按 key 绑定选中样式，严禁 DOM class 手工同步。

## 链路

### 打开表格窗口

1. 表格进入时按需请求当前表的窗口行。
2. query service 调后端返回窗口与源索引。
3. store 写入行、表头与总数，网格按可视区渲染。

### 编辑单元格

1. 用户激活单元格，所属输入集合提交前一个编辑动作。
2. tables 记录完整活动身份，网格挂载对应编辑控件。
3. 控件登记原始输入并按列 schema 选择输入、选择器或引用选择。
4. 提交经目标化单元格变更边界写入行值并登记一次历史。
5. 已提交行差异进入行脏标记，活动输入差异进入表与 Mod 未保存判定。

### 选择行

1. 用户点击行触发选择事件。
2. store 更新 `selectedRowKey`。
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
- 保存期间的表格失效必须合并为后续权威读取；查询必须共同比较原始行基线与版本，自身保存回声只允许更新所属投影。
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
- 表格窗口必须按可视区请求行，严禁一次加载全表。
- 选择与文本浮层必须共用视口计算；浮层宽度与水平位置必须服从当前窗口，resize 监听必须随控件释放。

## 陷阱

- 用数组索引定位行会让排序、过滤与删除后写错行。
- 直接把过滤后行数组当作编辑数据源会让 dirty 写到不可见行。
- 让编辑控件直接调用保存会让局部输入绕过 dirty 与历史链路。
- 用 DOM class 维护选中会让虚拟滚动后高亮错位。
- 缺失列 schema 时启用引用或枚举控件会让无来源列发起空查询。
