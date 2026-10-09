# 应用启动与窗口挂载

## 定义

应用启动与窗口挂载系统按 URL 窗口类型初始化依赖与 settings，再挂载唯一对应的 Vue 窗口根，并以唯一窗口壳承载设置持久化与主题注入。

## 参考

`src/main.ts`：启动入口 owner，解析 URL 窗口类型、加载 settings、初始化 settings store、创建 Vue 与 Pinia、注册 Naive UI，并按窗口类型异步加载唯一窗口根。
`src/app/WindowShell.vue`：唯一窗口壳 owner，以 main/child 模式区分设置持久化与设置镜像，统一挂载 Provider、主题与 Core 加载生命周期。
`src/app/App.vue`：主窗口根，以 main 模式包装唯一窗口壳并装配主窗口内容。
`src/app/EditorWindowApp.vue`：编辑器子窗口根，以 child 模式包装编辑器窗口内容。
`src/app/FileEditorApp.vue`：文件编辑器子窗口根，以 child 模式包装文件编辑器窗口内容。
`src/app/theme-overrides.ts`：Naive UI 主题覆盖构建 owner，消费主题令牌生成 provider 覆盖。
`src/app/naive-ui.runtime.ts`：Naive UI 按需注册 owner。
`src/services/app-settings.service.ts`：主窗口 settings 读取入口，经 shared API 调用后端。
`index.html`：`#app` 挂载点与启动错误呈现容器。
`src/assets/app-icon.svg`：标题栏透明罗盘图标资源。

## 边界

- URL 是窗口身份输入，不是未校验业务数据；缺失或非法必需参数只呈现启动错误，不挂载业务 UI。
- settings 读取只在主窗口进行；子窗口只能消费主窗口传入的完整 snapshot，严禁自行读盘或补默认值。
- 窗口创建、单例复用与跨窗口事件不归本模块；本模块只消费已建立的窗口身份参数。
- 每个窗口类型只允许加载唯一对应的根组件；不得静态导入所有窗口根扩大任一窗口的启动依赖。
- 共享窗口壳只允许装配 provider、设置、主题与 Core 生命周期，主窗口内容必须由主窗口根注入。
- 新增控件必须在启动注册表中显式登记；非 provider 控件按首次渲染异步解析。
- 主题令牌计算归 settings store，主题 DOM 写入归唯一窗口壳挂载的主题 effect；启动与挂载链路本身不写主题。
- 启动失败只允许写入 `#app` 的错误呈现容器，并尽力显示已创建窗口，不得静默白屏。

## 链路

### 主窗口启动

1. `main.ts` 解析 URL 参数得到窗口类型；主窗口无 `window` 参数。
2. 并行异步加载主窗口根组件与 `loadAppSettings()`。
3. settings 校验通过后 `initializeSettingsStore(settings)` 写入初始快照。
4. 创建 Vue 应用并安装 Pinia 与 Naive UI 按需注册。
5. 挂载主窗口根；根以 main 模式装配唯一窗口壳。
6. 唯一窗口壳启动设置持久化、主题 DOM effect 与 Core 根监听。
7. `showCurrentWindow()` 显示窗口。

### 子窗口启动

1. `main.ts` 解析 `window` 参数得到编辑器或文件编辑器类型。
2. 从 URL 解析主窗口传入的 settings snapshot；缺失时抛出启动错误。
3. 并行异步加载对应子窗口根组件并解析 settings。
4. `initializeSettingsStore(snapshot)` 写入初始快照。
5. 创建 Vue 应用并挂载子窗口根；根以 child 模式装配唯一窗口壳并启动设置镜像。
6. `showCurrentWindow()` 显示窗口。

### 启动失败

1. `bootstrap()` 任一步骤抛错进入统一失败处理。
2. `#app` 内替换为启动错误呈现，输出转义后的错误消息。
3. 尽力调用显示窗口命令，保证用户能看到失败状态。

## 规范

- 子窗口 settings snapshot 只允许从 URL 读取一次并经统一校验入口初始化，后续更新必须走设置镜像事件。
- 窗口根组件必须按窗口类型懒加载，严禁建立包含全部窗口根的公共入口模块。
- 启动链路的控件注册必须显式登记，禁止通过副作用自动注册控件。
- 主窗口与子窗口的模式差异必须由唯一窗口壳的 mode 参数表达，严禁出现第二份 Provider 栈。
- 每个窗口壳必须建立一次 Core 加载生命周期，释放时必须撤销所属监听及响应接纳。
- 启动错误呈现必须 HTML 转义消息内容，严禁拼接未转义文本。
- 标题栏必须使用 `src/assets/app-icon.svg`，图标区域必须保持 24 px × 24 px。

## 陷阱

- 把 Provider 栈复制进主窗口根或任一子窗口根会造成设置持久化与主题注入的双入口漂移。
- 在子窗口读取 settings 文件会绕过主窗口的 settings 持久化权威。
- 用静态 import 引入全部窗口根会让任一窗口的启动 bundle 承载无关窗口代码。
- 把 URL 参数当作已校验业务数据直接消费会让非法身份进入业务链路。
