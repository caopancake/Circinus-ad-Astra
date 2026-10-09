# 战术系统编辑器

## 定义

战术系统编辑器系统在独立窗口以 schema 表单编辑 `.system` spec，并按 type 条件呈现字段。

## 参考

`scripts/architecture/rules/editor-module-boundary.mjs`：编辑器组件边界规则 owner。
`src/app/components/editors/SystemEditor.vue`：编辑器组件 owner，拥有表单、显式提交与条件区段。
`src/app/composables/editors/use-editor-window-view-model.ts`：窗口 ViewModel owner，维护目标 Draft Session。
`src/app/composables/editors/use-object-field.ts`：对象字段绑定 owner。
`src/domain/editors/lib/normalize.ts`：`.system` 规格归一化 owner。
`src/domain/schema/schema.types.ts`：schema 输出类型 owner。
`src/shared/ui/JsonFieldEditor.vue`：额外字段结构化编辑 owner。

## 边界

- draft 提交为显式模型：全部表单变更路径（字段输入、颜色、type 切换、无人机行为 JSON、额外字段结构化编辑）显式提交，严禁深度同步 watch。
- 保存必须经编辑器写链路完成 changeset、文件历史与 session refresh；写后必须触发 refresh。
- 无人机行为必须声明数组形状，aiHints 必须声明对象形状；JSON 原文与颜色调整必须登记到所属目标会话。
- 系统表单必须按游戏字段消费契约展示共享视觉属性与类型行为区段；type 切换必须保留全部已有字段。
- 组件严禁猜测 type、直连 IPC 或用外部更新覆盖 dirty draft。
- 额外字段编辑复用统一结构化字段编辑器；组件只保留结构化键表与合并回写。

## 链路

### 打开与表单渲染

1. 窗口按 `.system` 目标打开并加载 bundle。
2. 编辑器以归一化规格建立本地草稿。
3. 按 type 条件渲染行为、音效、视觉与伤害区段。

### 字段编辑

1. 字段输入经设置函数写入草稿并显式提交。
2. 颜色与枚举经计算属性 setter 提交。
3. type 切换先提交活动输入，再更新类型值并提交完整草稿。
4. 无人机行为 JSON 在提交边界解析并提交。

### 额外字段

1. 组件收集非结构化键组成额外字段模型。
2. 结构化编辑器增删或修改额外字段。
3. 合并结构化字段与额外业务字段后提交完整草稿。

### 保存

1. 保存经窗口 ViewModel 进入编辑器写链路。
2. 会话接纳实际写盘内容与版本，再执行文件历史和 session refresh。
3. dirty 时外部更新暂存并提示。

## 规范

- Smart 数值原文必须登记到所属会话；保存期间的新编辑必须按实际写盘基线保留，外部基线与重置必须共同交接本地规格和输入。
- 保存必须先提交所属活动输入；非法输入必须保留原文与正式类型并定位，外部版本载入必须确认放弃后接纳。
- 全部业务键必须原样保留；保存必须消费实际 `.system` 目标，ID 修改必须由所属事务更新唯一关联 CSV 行。
- 未知字段必须完整保留并进入额外字段编辑，严禁静默丢弃。
- 独立窗口的 query 与保存必须携带完整窗口身份。
- 系统新建与缺失规格草稿必须消费共享模板构造，type 必须为 STAT_MOD、aiType 必须为 NONE。
- 系统类型必须覆盖游戏正式 11 项枚举；共享引擎、护盾和透明度属性必须在全部类型可编辑。
- 颜色字段必须保持四通道数组形状；数值字段保留其步长语义。

## 陷阱

- 共享视觉属性必须依据游戏系统基类的消费契约归属，严禁按 type 删除。
- 用整段 JSON 文本编辑额外字段会让合法字段被误删。
- 类型行为区段必须保留当前未展示的配置字段，严禁把展示条件作为写盘删除依据。
- 在组件内直连 IPC 会绕过窗口 ViewModel 与保存链路。
- 静默吞掉 JSON 解析失败会让用户误以为已保存。
