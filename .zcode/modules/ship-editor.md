# 舰船编辑器

## 定义

舰船编辑器系统在独立窗口以画布与表单编辑一个 `.ship` 规格。

## 参考

`scripts/architecture/rules/editor-module-boundary.mjs`：编辑器组件边界规则 owner。
`src/app/components/editors/ShipEditor.vue`：编辑器组件 owner，注入画布 hooks 并拥有实体语义、检查器表单与贴图。
`src/app/composables/canvas/use-canvas-editor.ts` 同族：画布交互骨架（见画布骨架模块）。
`src/app/composables/editors/use-editor-window-view-model.ts`：窗口 ViewModel owner，维护目标 Draft Session 与 bundle。
`src/app/composables/editors/use-resource-reference.ts`：贴图引用选择 owner。
`src/domain/editors/lib/canvas-visuals.ts`：实体视觉绘制 owner。
`src/domain/editors/lib/mirror.ts`：镜像规则 owner。
`src/domain/editors/lib/normalize.ts`：`.ship` 规格归一化 owner。

## 边界

- dirty 时外部更新只暂存；画布严禁直读磁盘或 IPC，严禁以数组下标或显示文本替代正式 ID。
- 保存必须提交当前拖拽位置并结束指针动作；保存期间的新动作必须保留所属草稿与历史。
- 保存走编辑器写、changeset、文件历史与 session refresh；贴图浏览只解析 Mod 内相对路径写入引用字段，严禁写任何文件。
- 组件只允许提交 `.ship` 草稿；hullId 交接必须由所属身份事务更新实际规格及唯一关联 CSV 行，几何与集合必须消费正式规格规则。
- 检查器对实体字段的编辑必须经显式提交模型进入草稿并重绘画布；连续字段动作必须在统一动作边界登记一条撤销。
- 画布命中检测、选区同步、镜像轴与提交引擎全部注入自画布骨架；编辑器只提供目标、命中表、镜像规则、预览与场景绘制。
- 窗口 ViewModel query 舰船 bundle、资源与引用并维护目标 Draft Session；组件拥有画布交互与检查器 UI；窗口服务拥有单例身份。
- 缺失目标的导入内容必须进入待保存草稿，目标只允许在写盘成功后转为已有文件。

## 链路

### 打开与画布就绪

1. 窗口按 `.ship` 目标打开并加载 bundle。
2. 编辑器以归一化规格建立本地草稿并注入画布 hooks。
3. 骨架挂载窗口事件、resize 与快捷键分发。
4. 贴图数据到达后加载并自适应缩放。

### 画布编辑

1. 用户在总览、范围、边界、武器、甲板或引擎模式间切换。
2. 左键按模式拖动中心、护盾、半径、槽位、引擎或边界点。
3. Shift/Ctrl/Alt 组合执行新增、复制、半径或角度调整。
4. 空格开关镜像模式，配对元素成对生效。
5. 释放指针在动作边界提交一次 draft。

### 检查器编辑

1. 检查器表单逐字段编辑实体属性。
2. 每次输入提交 draft 并重绘受影响视觉。
3. T 键展开并滚动到当前模式对应区块。

### 保存

1. 保存经窗口 ViewModel 进入编辑器写链路。
2. 实际写盘快照接纳为 base，随后完成文件历史与 session refresh。
3. dirty 时外部版本暂存并提示。

## 规范

- builtInWeapons 必须以对象形状的 JSON 输入提交，原始输入必须登记到所属目标会话并参与保存、关闭与外部版本保护。
- 编辑器内部显示和编辑 `.ship` 的 `hullName`；编辑器外的舰船显示名称必须优先使用 `ship_data.csv` 的 `name`，仅在该名称缺失时才允许 `hullName`。
- 舰体引用、资源引用必须以后端 ResourceRef 或后端校验的相对路径表达。
- 同 ID 保存必须使用实际已加载路径；修改 hullId 必须保留原目录并同步所属 CSV 的 ID 字段与文件历史。
- 舰船新建与关联创建必须消费共享模板构造；ID 与 hullName 必须由明确创建参数装配，builtInWeapons 必须保留全部原始槽位键。
- 贴图尺寸同步必须以实际加载贴图为准，且仅在用户显式触发时写回宽高。
- 贴图选择为纯引用：只接受 Mod 根内 png，相对路径原样作为 `spriteName`，不复制、不改名、不整理目录。
- 镜像新增、调整与删除成对生效；中轴元素退化为单件；center/shield/半径标量与检查器数值输入不参与镜像联动。
- 镜像模式按空格开关，覆盖武器槽（含甲板）、引擎与碰撞边界；配对只按几何条件实时计算，禁止按下标或 ID 记忆。

## 陷阱

- 在编辑器内重建命中或选区会让画布语义偏离统一骨架。
- 镜像配对按下标记忆会让删除后错配对侧元素。
- 直接修改 ship CSV 行会让 CSV 权威与规格文件分叉。
- 贴图浏览复制文件进 Mod 会破坏纯引用边界。
- dirty 时应用外部版本会覆盖未保存画布编辑。
