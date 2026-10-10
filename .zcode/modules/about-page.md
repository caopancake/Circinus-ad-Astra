# 关于页面

## 定义

关于页面是主窗口只读信息页，展示静态元信息与构建时内联的更新记录。

## 参考

`src/app/components/AboutPage.vue`：页面组件 owner，拥有静态元信息模板与 Markdown 渲染。
`src/app/AppContent.vue`：挂载入口，按当前视图挂载关于页面。
`src/stores/workspace.store.ts`：视图状态 owner，只持有 `currentView='about'`。
`src/app/TitleBar.vue`：标题栏入口，触发 `showAbout` 导航。

## 边界

- 输入仅构建时内联的 `CHANGELOG.md`；不运行时读取 Markdown、不接收用户、Mod 或后端文本。
- 页面不保存、不 IPC、不记日志；`v-html` 仅渲染仓库内联 changelog。
- 静态元信息只归组件模板；样式复用设置页骨架，Markdown 样式限制在 `.about-content`。
- 启动恢复一律回到 overview，严禁恢复到关于页。
- 页面不拥有 workspace 状态；`currentView` 的切换权威归 workspace store。

## 链路

### 打开关于页

1. 用户在标题栏菜单点击关于入口。
2. 标题栏调用导航动作，等待保存与草稿确认后接纳 `workspace.showAbout`。
3. AppContent 按 `currentView='about'` 挂载关于页面。
4. 组件以 marked 渲染构建时内联的 changelog。

### 离开关于页

1. 用户导航到其它全局页或 Mod 页。
2. workspace 切换 `currentView`，关于页卸载。

## 规范

- 渲染输入仅限仓库内联 changelog，严禁接收运行时字符串进入 `v-html`。
- Markdown 样式必须限定作用域，严禁污染全局排版。
- 页面必须保持只读：无编辑控件、无保存、无日志与 IPC 调用。
- changelog 内容更新只随仓库提交发生，页面不维护版本元数据副本。
- 页面路由必须经 workspace 视图状态，严禁引入独立路由记录。

## 陷阱

- 让关于页渲染运行时或用户文本会让 `v-html` 成为注入面。
- 在组件内运行时读取 changelog 文件会让构建产物依赖磁盘布局。
- 把关于页加入启动恢复会让工具无法回到工作区总览。
