# 表格编辑

## 定义

表格编辑系统提供窗口化 CSV 表格 query、tables store、行身份、选择、列 schema 渲染与 dirty 维护。

## 参考

`src/stores/tables.store.ts`：表格运行态 owner，拥有窗口行、选择、dirty、列宽、当前表与保存中状态。
`src/app/components/tables/CsvGrid.vue`：表格网格 owner，拥有滚动窗口、列宽与行虚拟化。
`src/app/components/tables/CsvGridBody.vue`：表体 owner，拥有可见行窗口与选中行传递。
`src/app/components/tables/CsvGridRow.vue`：行渲染与选中态 owner。
`src/app/components/tables/CsvGridCellEditor.vue`：单元格编辑 owner，按列控件类型分派编辑器。
`src/app/components/tables/DataTable.vue`：表格工作区组合 owner。
`src/app/composables/tables/use-csv-table-view-model.ts`：表格 ViewModel owner，连接 query、store、列 schema 与网格。
`src/domain/tables/csv-grid-model.ts`：网格列模型 owner。
`src/domain/schema/schema-registry.ts`：列 schema 唯一加载入口。
`src/domain/tables/table-row-key.ts`：行身份规则 owner。

## 边界

- 行身份只使用 Rust rowKey 或前端临时 new key，严禁按数组索引、显示文本或过滤结果定位行。
- 表格组件严禁直接 IPC、写盘或维护 history；保存必须经保存编排，撤销重做必须经草稿历史。
- 列 schema 只能从统一加载器的输出类型消费，严禁在组件内二次解析资产。
- 选中态以响应式 `selectedRowKey` 为唯一来源，行组件按 key 绑定选中样式，严禁 DOM class 手工同步。
- 脏标记只允许经草稿变更边界写入，组件严禁直改 dirty 结构。
- 列宽必须使用结构化 `modRoot/table/column`，严禁拼接 key。

## 链路

### 打开表格窗口

1. 表格进入时按需请求当前表的窗口行。
2. query service 调后端返回窗口与源索引。
3. store 写入行、表头与总数，网格按可视区渲染。

### 编辑单元格

1. 用户激活单元格，网格挂载对应编辑控件。
2. 编辑控件按列 schema 选择输入、选择器或引用选择。
3. 提交经 store 的单元格变更边界写入行值并标记 dirty。
4. dirty 行在网格中以脏样式渲染并进入保存范围。

### 选择行

1. 用户点击行触发选择事件。
2. store 更新 `selectedRowKey`。
3. 行组件按响应式选中态渲染高亮，右侧详情同步刷新。

### 过滤与搜索

1. 用户输入搜索文本或切换势力过滤。
2. store 重算过滤行数并约束窗口请求。
3. 全部行被过滤或无可显示列时显示对应说明。

## 规范

- 表格窗口必须按可视区请求行，严禁一次加载全表。
- 单元格编辑必须在提交边界一次性写值，中间输入不得进入 dirty。
- 前端新增行只允许使用临时 new key，保存后以后端 rowKey map 替换。
- 缺失列 schema 的列只做文本编辑，严禁猜测控件类型。
- 固定枚举选项必须与目标 Starsector 版本的加载器枚举完全一致。
- 虚拟行（间隔与占位）不参与选择、编辑与 dirty。
- 列宽调整必须即时反映渲染宽度并进入持久化投影。

## 陷阱

- 用数组索引定位行会让排序、过滤与删除后写错行。
- 直接把过滤后行数组当作编辑数据源会让 dirty 写到不可见行。
- 让编辑控件直接调用保存会让局部输入绕过 dirty 与历史链路。
- 用 DOM class 维护选中会让虚拟滚动后高亮错位。
- 缺失列 schema 时启用引用或枚举控件会让无来源列发起空查询。
