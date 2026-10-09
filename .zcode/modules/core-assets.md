# Core 索引与加载

## 定义

Core 索引与加载模块按游戏根管理字段和图形目录的独立读取与投影生命周期。

## 参考

`src-tauri/src/commands/core_assets.rs`：Core command 主归属。
`src-tauri/src/services/project/resources/core_graphics.rs`：图形目录扫描主归属。
`src-tauri/src/services/schema/core_fields.rs`：字段索引扫描主归属。
`src/app/composables/use-core-assets.ts`：schema/graphics 门面与窗口生命周期主归属。
`src/orchestrators/core-assets.orchestrator.ts`：根代次、共享 Promise、接纳与失败日志。
`src/services/core-assets.service.ts`：Core 读取与缓存清理协议。
`src/stores/core-assets.store.ts`：根与两类状态主归属。

## 边界

- schema 合并必须归领域纯投影，失败时编辑面必须消费静态 schema 或空 graphics。
- store 必须拥有根、独立数据、状态和结构化错误，加载编排必须拥有 Promise 与代次。
- 字段与 graphics 读取必须由 Core 加载 owner 消费，缓存清理必须由工作区生命周期消费。
- 根来源必须 settings 优先、当前 manifest 补充；路径授权必须归后端。
- 每个 WindowShell 必须建立一次生命周期，释放必须撤销监听和响应接纳。

## 链路

### 读取与根变化

1. 窗口壳创建加载运行态与根监听。
2. 消费者请求所属资源，同根同代次复用 Promise。
3. 根变化清空投影并独立启动 fields 与 graphics。
4. 当前代次接纳值或错误，失败记录一次原始诊断。
5. 再次请求重试，窗口释放结束接纳权。

## 规范

- A-B-A、根清空及窗口释放必须通过代次撤销旧成功、错误和收尾。
- Core 根必须经正式根边界授权，严禁消费链接父链或逃逸路径。
- fields 与 graphics 必须独立就绪、加载和失败；一类失败严禁阻断另一类。
- 业务编辑草稿严禁写入 Core 加载运行态。
- 内存 Core 清理必须共同清理所属指纹缓存，持久化快照必须按根与源指纹校验。
- 同类重复调用必须等待所属在途请求自然结束。

## 陷阱

- 严禁在失效响应中向新根状态写入 loading 或错误。
- 严禁把根清空后的旧值保留为当前投影。
- 严禁由单个控件创建另一份 Core 加载 owner。
