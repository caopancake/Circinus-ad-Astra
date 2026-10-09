# 配置实体族编辑器

## 定义

配置实体族编辑器系统以参数化定义驱动装配与皮肤两族的列表、新建、删除、草稿编辑与单文件保存。

## 参考

`src/domain/config/config-entity-families.ts`：族定义 owner，拥有装配与皮肤的标识字段、伴随字段、文案、图标路径与媒体面。
`src/domain/config/config-records.ts`：统一 ConfigFamilyRecord 与 ConfigFamilyFile 的查询、保存投影 owner。
`src/app/composables/config/use-config-identity-reception.ts`：配置身份事件的等待、确认与列表接纳 owner。
`src/app/composables/config/use-config-family-view-model.ts`：族列表 ViewModel owner，拥有加载、新建、删除校验与资源引用。
`src/app/composables/config/use-config-family-editor-view-model.ts`：族编辑 ViewModel owner，拥有目标 Draft Session 接线与保存。
`src/app/components/config/ConfigEntityFamilyList.vue`：族列表组件。
`src/app/components/config/ConfigEntityFamilyEditor.vue`：族编辑组件。
`src/app/components/config/ConfigEntityFamilyView.vue`：族视图组合 owner。
`src/orchestrators/config-save.orchestrator.ts`：族保存动作归属的保存编排。
`src-tauri/src/services/editor_config/spec_entities.rs`：后端族实体 owner，按实体类型参数化保存、创建、删除与重命名。

## 边界

- 两族差异只允许存在于族定义数据；组件、ViewModel 与保存动作必须共用参数化实现，严禁为单族复制第二份实现。
- 列表与编辑 ViewModel 分别拥有选择、资源引用与目标 Draft Session；组件只渲染与触发。
- Rust 后端拥有文件目标、ID、扩展名、重命名、删除与 changeset；前端严禁推导磁盘路径或实体 ID。
- 单文件保存只允许写当前族声明的目标文件；dirty 时外部版本只允许暂存。
- 新建对话框的必填、ID 非法与冲突校验收敛在族 ViewModel，组件只触发。
- 镜像模式与画布骨架语义不适用于本模块；族编辑是纯表单域。

## 链路

### 族列表加载

1. 页面以族定义加载实体列表。
2. 后端返回实体数据与资源引用。
3. 列表按可视区渐进解析缩略图。
4. 装配列表额外解析舰船名称并按两行展示。

### 新建实体

1. 用户在新建对话框输入伴随字段与 ID。
2. 族 ViewModel 校验必填、ID 合法性与冲突。
3. 创建动作经保存编排写入索引与实体文件并登记历史。
4. 列表刷新并选中新实体。

### 编辑与保存

1. 选中实体加载目标草稿与表单。
2. 编辑经显式提交模型更新草稿。
3. 保存动作族返回 SavedConfig，承载正式实体与写盘 receipt。
4. 编辑会话接纳目标、内容与版本，列表接纳同一正式记录，再执行 receipt 同步。
5. dirty 时外部更新只暂存并提示。

### 删除实体

1. 用户发起删除并经确认。
2. 删除动作族移除实体文件与索引行并登记历史。
3. 列表刷新并清理选择。

## 规范

- 保存期间列表刷新必须服从目标交接；重命名后只允许更新正式目标和已写盘基线，必须保留后续草稿与字段交互状态。
- 保存动作返回正式记录时必须保持当前列表与选择，编辑会话接纳之后必须共同更新列表和选择；同一会话的活动控件必须保持挂载。
- 两族记录必须共同表达加载 id、target、data、baseVersions、path 与 relPath；列表与选择必须消费加载 id，字段编辑必须消费 data 中的下一 ID。
- ID、companion、标题与排序必须消费同一正式记录；字段、标题组合与 Hull 名称 hydration 差异必须归 family 定义。
- 外部改名期间必须保留当前编辑目标；确认跟随后必须共同接纳新目标、内容与版本，dirty 草稿与活动输入必须保留。
- 保存 receipt 必须与正式实体共同交给编辑会话；同步失败必须保留写盘基线，卸载后的提交只允许完成捕获目标的同步。
- 新 session 的族列表必须等待用户选择实体；列表内容、实际路径或基线版本凭据变化时必须通知编辑器接入，严禁只比较实体内容。
- 舰船名称与创建引用选项查询必须服从捕获 session 和请求代次；切换 session 必须同步清空引用投影。
- 装配列表首行必须显示 `ships.name · variant.displayName`，第二行显示 `variantId`；舰船名称必须由后端按当前 Mod `ship_data.csv` 优先、原版补集解析。
- 无法解析舰船名称时必须显示 `hullId`，严禁改变装配引用或持久化数据。
- 皮肤列表必须从实体列表保留缩略资源引用并按可视区渐进解析。
- 皮肤编辑器的内置武器移除选项必须由当前草稿 baseHullId 的后端舰体引用结果提供，选项值必须是槽 ID。
- 新建动作才允许加载舰体引用目录；目录项严禁预取缩略图。
- 重命名由后端验证并迁移目标文件与文件内容 ID，前端严禁拼接路径。
- 表单双向绑定必须经统一 Draft Session setter 提交；保存期间的新编辑必须保留，base 必须更新为实际保存快照。
- JSON、类型文本与颜色的原始输入必须登记到所属目标会话；外部版本载入必须确认放弃草稿与输入。
- 路径与文件内容 ID 必须由后端验证；前端扫描或推导一律拒绝。
- 编辑保存必须提交选中实体 query 返回的 relPath；command 必须核对会话索引归属，写 service 必须核对源文件内容 ID。
- 同 ID 保存必须保留源文件名与目录；ID 重命名必须在源目录生成新 ID 文件名，创建必须以显式 null relPath 使用默认路径。

## 陷阱

- 为单一实体族复制整套列表与编辑实现会让族差异漂移成两套行为。
- 在前端推导 `.variant` 或 `.skin` 文件路径会让保存目标脱离后端定义。
- 舰船名称解析失败时回写 `hullId` 到装配数据会破坏引用。
- 目录项预取缩略图会在打开新建对话框时产生资源风暴。
- dirty 时用外部版本直接覆盖表单会丢失未保存编辑。
