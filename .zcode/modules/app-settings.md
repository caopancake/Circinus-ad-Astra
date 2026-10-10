# 应用设置与主题

## 定义

应用设置与主题系统管理 settings 运行态、app-data 持久化、主题令牌与 editMode，并经唯一窗口壳向子窗口完整镜像。

## 参考

`src/app/WindowShell.vue`：唯一窗口壳，main 模式启动设置持久化、child 模式启动设置镜像并挂载主题 effect。
`src/app/components/SettingsPage.vue`：设置页组件，消费 accent 预设与历史上限常量。
`src/app/composables/settings/use-settings-view-model.ts`：设置页 ViewModel，拥有日志目录保存与清空动作。
`src/app/composables/settings/use-theme-dom-effect.ts`：主题 DOM 副作用 owner，watch 主题令牌并写 root dataset 与 CSS 变量。
`src/domain/settings/rules.ts`：设置校验 owner，拥有主题/accent/自定义色/历史上限/editMode/原样保存/日志级别/日志目录的读取校验与归一化。
`src/domain/settings/theme.ts`：主题令牌与色彩数学 owner，拥有 accent 预设、light/dark 中性色与 `createThemeColors` 纯函数。
`src/domain/settings/theme.ts:THEME_TOKEN_MAP`：ThemeColorTokens 与 CSS 自定义属性的一一映射 owner。
`src/orchestrators/settings-persistence.orchestrator.ts`：设置持久化与镜像 owner，负责保存、广播、接收镜像与 historyLimit 同步。
`src/services/app-settings.service.ts`：settings 读写签名与 command 参数装配主归属。
`src/stores/settings.store.ts`：settings 运行态 owner，只持状态、setter 与派生值；初始快照经统一初始化入口注入。

## 边界

- Naive provider 只消费主题令牌派生的覆盖对象，禁止传入 `var(...)` 或读取 DOM 计算色值。
- `historyLimit` 必须由后端设置同步到文件历史，前端持久化编排必须同步 CSV 草稿历史。
- settings 只写 app data，禁止 browser storage、workspace 或 Mod 目标；子窗口不读写文件、不补默认值。
- 主窗口拥有设置持久化权威；子窗口只能从 URL snapshot 初始化并监听完整 snapshot 事件镜像。
- 主题 DOM 副作用唯一归主题 effect，由唯一窗口壳挂载；主窗口与子窗口都经该 effect 生效。
- 主题令牌计算归 domain 纯函数，输入校验归 domain 校验规则，store 只持状态；store 内严禁写 DOM。
- CSS 自定义属性只能由 `THEME_TOKEN_MAP` 与主题 effect 共同接纳；明暗主题必须覆盖正式共享 token。
- 应用私有数据目录必须由 Tauri 标识 `com.caopancake.circinus-ad-astra` 解析。
- 日志目录保存由设置页 ViewModel 经持久化编排完成：后端成功返回规范化快照后才替换，并跳过当次回写。
- 编辑面必须拥有实际渲染模式；设置与镜像只允许提供请求模式，待提交输入涉及的控件替换必须确认放弃。

## 链路

### 主窗口设置保存

1. 用户修改任一设置项，store 状态变化。
2. 持久化编排侦听快照变化，同步 CSV historyLimit 并串行提交设置。
3. 快照经 settings service 写入后端 `settings.json`，后端同步文件历史上限。
4. 保存成功后向全部窗口广播同一 snapshot。
5. 保存失败只记录错误日志，不回滚内存状态。

### 子窗口设置镜像

1. 子窗口启动时以 URL snapshot 初始化 store。
2. 子窗口唯一窗口壳启动设置镜像监听。
3. 收到广播 snapshot 后经校验规则整体替换 store 状态。
4. 同步 `historyLimit` 到子窗口的 history store。
5. 各输入面按所属输入集合接纳 editMode；确认放弃后替换控件，取消保持当前模式。

### 日志目录保存

1. 设置页 ViewModel 调用持久化编排的日志目录保存。
2. 快照写入后端；后端校验目录并返回规范化完整快照。
3. 返回目录与内存不一致时更新对应目录字段，并跳过当次回写。
4. 广播规范化快照给全部窗口。

### 主题生效

1. 主题或 accent 变化触发派生主题令牌重算。
2. 主题 effect 把 root dataset 主题名与全部 CSS 变量写入 document。
3. 唯一窗口壳的 Naive provider 消费同一份令牌派生的覆盖对象。

## 规范

- `historyLimit` 取值必须在 1 到上限之间；设置页输入只允许触达统一上限常量。
- `logDirectory=null` 表示 app data；空白字符串无效。
- `logLevel` 只允许 `info`（默认档，丢弃 debug 条目）或 `debug`（详细档，全量保留）；缺省视为 info。
- `preserveOriginalJson` 必须是布尔值；缺省视为 true。该设置必须随完整 snapshot 持久化并镜像到子窗口，结构化 JSON 保存动作必须在开始时捕获本次使用的值。
- `starsectorRoot` 仅作默认目录提示，不构成路径授权。
- `theme/accent/editMode` 必须是正式枚举；非法值在初始化与替换时抛出。
- 保存失败不得静默：必须记录错误日志且不广播。
- 同一输入面的子控件必须消费同一实际模式；不同输入集合必须分别拥有模式交接，模式确认必须绑定目标与生命周期。
- 子窗口不得发送设置广播，镜像监听是单向接收。
- 自定义 accent 必须是 `#rrggbb` 形式；非法输入只拒绝不修正。
- 设置保存必须消费捕获的所属 store、快照和生命周期；释放后的成功与错误严禁接管新窗口投影或广播。
- 镜像监听与持久化监听释放后必须允许重新装配；迟到的监听注册必须立即解除，严禁接纳已释放窗口的设置。

## 陷阱

- 保存失败后继续广播会让其它窗口采纳未落盘状态。
- 在 store 内直接写 document 会让主题副作用脱离唯一窗口壳的挂载时机。
- 在子窗口直接读 `settings.json` 会与主窗口持久化权威分叉。
- 用部分字段 patch 应用镜像 snapshot 会让未广播字段残留旧值。
- 绕过校验规则直接写 store 内部字段会让非法枚举进入持久化链路。
- 让 provider 消费 `var(...)` 会让 Naive 在运行时推导具体颜色并读取 DOM 计算值。
