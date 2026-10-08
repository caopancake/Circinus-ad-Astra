# 编辑会话原语

## 定义

编辑会话原语系统以目标身份管理 base、draft、dirty、revision 与 pending external 的前端编辑状态机，以及全仓未保存工作的唯一注册表。

## 参考

`src/domain/edit-session.ts`：编辑会话与撤销栈原语 owner，拥有 base/draft/dirty/revision/pending external 状态机与双栈状态工厂。
`src/app/composables/use-draft-session.ts`：通用 Draft Session 适配器 owner，保持 Ref API。
`src/app/composables/use-edit-target-draft-session.ts`：按目标管理的 Draft Session 适配器 owner。
`src/shared/runtime/field-inputs.ts`：目标输入集合 owner，拥有登记顺序、提交接纳、取消与释放。
`src/shared/runtime/raw-field-input.ts`：原始文本输入 owner，拥有原文、输入基线、转换与非法状态。
`src/app/composables/config/use-config-editor-draft-session.ts`：配置目标 Draft Session 组合 owner。
`src/stores/draft-sessions.store.ts`：未保存工作注册表 owner，按 `modRoot` 聚合会话登记与判定源。
`src/orchestrators/table-save.orchestrator.spec.ts`：表保存编排行为测试。

## 边界

- identity 必须完整包含所属 Mod 与实体或文件目标；切换目标前必须显式处理 dirty。
- dirty 时外部版本只暂存或提示，严禁覆盖；无 dirty 才能采用新 base。
- 草稿严禁持久化、直接 query、直接 write 或直接写 history。
- 未保存工作注册表必须响应式登记会话与判定源；配置会话必须聚合草稿与输入差异，CSV 判定源必须聚合全部表的草稿与输入差异；Mod 级消费方只允许查询该注册表。
- 输入集合必须归属编辑目标；控件必须拥有原文、错误状态与取消动作，领域必须拥有形状与转换，会话必须拥有提交顺序与接纳权。
- 切换或销毁 dirty 配置会话必须经统一确认；确认前不得改变选择、路由或工作区运行态。
- 只允许以 save 显式返回的持久化快照提交 base；请求期间草稿继续变化时必须保留当前 draft、更新实际写盘 base，并暂存保存版本。

## 链路

### 配置目标编辑

1. ViewModel 为选定实体创建或切换 Draft Session。
2. 表单双向赋值经适配器 setter 提交原语 draft，适配器投影 dirty。
3. 延迟提交控件登记原始输入，输入差异进入所属会话 dirty。
4. 主窗口存活期间按 `modRoot` 在注册表登记 dirty。
5. 保存先逐项提交输入，再捕获独立草稿与版本凭据。
6. 保存成功后以返回实体提交 base；请求期间的新草稿与原始输入保留。

### 外部更新接入

1. 外部刷新按目标身份与会话 revision 接入。
2. 无 dirty 时直接采用新 base。
3. 有 dirty 时外部版本仅暂存并提示可载入。
4. 用户确认放弃后替换 draft、取消所属原始输入并清除暂存。

### 未保存判定

1. 导航、移除 Mod 或关闭工作区前查询注册表。
2. 注册表聚合配置会话登记与 CSV 判定源。
3. 存在未保存工作时触发统一确认。
4. 确认放弃后才释放会话登记并继续销毁。

### 文本撤销栈

1. 文件编辑器以原语家族的撤销栈承载文本前后值。
2. undo/redo 通过栈操作返回目标文本。

## 规范

- 未完成字段输入必须参与 dirty、关闭确认和外部版本暂存；读取代次与本地保存代次必须共同决定迟到结果的接纳。
- 原始输入提交必须按登记顺序执行，每项成功后必须等待消费者投影；失败必须保留原文、定位字段并以 `commit-field-inputs` 动作上抛一次错误。
- 输入取消、目标变化与集合释放必须撤销当前提交接纳权；卸载必须解除登记，销毁会话必须释放集合与目标身份。
- 字段删除只允许取消对应稳定身份的输入子树；明确基线替换必须取消所属集合输入。
- 目标必须捕获 sessionId、modRoot、实体种类、ID 与实际路径；保存必须消费捕获目标，重命名必须在同一会话交接目标并保留后续输入。
- 保存必须提交发起保存时的独立草稿快照，严禁提交可变引用。
- 表单双向绑定必须经唯一适配器 setter 提交 draft，严禁直接替换投影状态或以深度 watch 同步业务副作用。
- dirty 派生必须由原语内部比较产生，严禁外部手工置位。
- 注入的相等比较与克隆必须覆盖全部业务值形态。
- 撤销栈 limit 必须由消费方显式设置，原语不自行读配置。
- 注册表严禁暴露内部会话结构，只暴露按 `modRoot` 的判定与登记能力。

## 陷阱

- 以 prop 变化直接覆盖 draft 会把外部刷新当成用户输入。
- dirty 时直接应用外部 base 会丢失未保存输入。
- 保存后无条件提交 base 会把过期快照当作最新草稿。
- 各模块自建 dirty 判定并集会让关闭确认结果互相矛盾。
- 撤销栈保存可变引用会让回放读到被编辑污染的值。
