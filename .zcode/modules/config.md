# 配置系统

## 定义

配置系统管理 mod_info、Faction、Mission、Variant 与 Skin 的列表、目标草稿、实体 query/write 与文件级 history。

## 参考

`src/app/components/config/`：配置页面组件目录，拥有列表、编辑器、Mod 信息与文件历史视图。
`src/app/composables/config/use-config-mod-info-view-model.ts`：Mod 信息 ViewModel。
`src/app/composables/config/use-config-faction-view-model.ts`：势力列表与新建 ViewModel。
`src/app/composables/config/use-config-family-view-model.ts`：装配/皮肤族列表 ViewModel。
`src/app/composables/config/use-config-mission-view-model.ts`：战役列表与编辑 ViewModel。
`src/services/config-entity.service.ts`：配置实体读 service。
`src/services/config-resource.service.ts`：配置资源 service。
`src/orchestrators/config-save.orchestrator.ts`：配置保存编排 owner，拥有十个写动作族。
`src-tauri/src/services/editor_config/`：后端配置实体 owner，拥有 indexed 与 spec 实体的 query、write 与目录。
`src-tauri/src/domain/editor_config_definitions.rs`：实体定义与目录规则 owner。
`src-tauri/src/commands/editor_config.rs`：配置实体 command 边界。
`scripts/architecture/rules/config-module-boundary.mjs`：配置模块边界规则 owner。

## 边界

- 组件只负责表单、确认与可视区媒体注册；列表、选择、ResourceRef、目标 Draft Session 与外部更新暂存归各 ViewModel。
- domain 拥有默认值、ID/重命名/内部字段规则与 schema source；service 校验 query/write 模型；保存编排串联 write、refreshed entity、文件历史与 ProjectSession refresh。
- Rust command 必须校验 `sessionId + modRoot`；后端拥有索引、目标文件、目录、ID、changeset、重命名与删除校验；前端严禁扫描磁盘补实体。
- 保存只允许写该实体声明的目标文件；dirty 时外部更新必须暂存，严禁覆盖草稿。
- Faction、Mission、Skin、Variant 列表必须保留实体 query 返回的 ResourceRef。
- 对象选择在当前草稿 dirty 时必须先经统一确认放弃。
- 新建对话框的必填校验、ID 非法与冲突校验归各 ViewModel，组件只触发不捕获。
- 势力创建模板必须包含游戏加载所需的 logo、displayNameWithArticle、names、portraits 与 RGBA color，并使用正式 UI 颜色字段。
- 原版编辑权限由 `AppSettings.allowCoreEditing` 持久化，缺省为关闭；设置镜像必须同步该字段。

## 链路

### Mod 信息编辑

1. 页面经核心 schema 合并后渲染表单。
2. 编辑经显式提交模型写入目标草稿并更新 dirty。
3. 保存经写动作族写入 `mod_info.json` 变更并登记文件历史。
4. 刷新后提交 base 并同步列表。

### 实体列表与新建

1. 页面加载时查询实体列表与资源引用。
2. 新建对话框校验必填、ID 合法性与冲突。
3. 创建动作经保存编排写入索引与实体文件并登记历史。
4. 列表刷新并选中新实体。

### 实体编辑与删除

1. 选中实体加载目标草稿与 schema 表单。
2. 保存经写动作族写入并登记历史。
3. 重命名由后端校验并迁移目标文件。
4. 删除经确认后走删除动作族并清理选择。

### 可视区媒体

1. 列表滚动以滚动容器为 observer root。
2. 预读区内实体的图片资源按需批量解析。
3. 屏幕外资源严禁发起 data URL 查询。

## 规范

- `mod_info` 必须使用目标 Draft Session；Skin 与 Variant 的单文件目标、扩展名与 ID 以后端定义为准。
- 保存必须提交发起保存时的独立快照；请求期间的新编辑必须保留，base 必须更新为实际写盘版本，dirty 必须按该 base 与当前 draft 比较。
- 表单双向绑定必须经统一 Draft Session setter 提交；校验拒绝与保存取消必须返回 null，严禁提交成功基线或触发保存成功回调。
- 列表图片必须在上下各一个容器高度的预读区内按需解析，资源失效后可见图片必须重新解析。
- 内部字段与前端运行时字段严禁写入实体文件。
- 结构化 JSON 保存必须使用设置快照选择原样更新或规范化写入；原样更新无法安全完成时必须在写入前确认影响文件。
- 重命名必须同时更新索引行、实体文件与文件名，并保持 history 可回放。
- 各实体的打开入口必须命中对应后端实体定义的目录与扩展名。
- Skin 与 Variant 保存 payload 必须显式提供 nullable relPath；编辑必须使用选中实体路径，创建必须提供 null。

## 陷阱

- 让组件直接调用写 service 会绕过保存编排与文件历史。
- 保存后用请求前快照提交 base 会覆盖请求期间的新编辑。
- 前端扫描 Mod 目录补列表会让实体身份脱离后端索引。
- 删除实体不清理索引行会留下悬空索引引用。
- 列表对屏幕外图片发起 data URL 查询会造成 IPC 风暴。
