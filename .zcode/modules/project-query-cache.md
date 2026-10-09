# 项目查询与缓存

## 定义

项目查询与缓存模块提供按 session 隔离的类型化实体读取、缓存失效和请求生命周期。

## 参考

`src-tauri/src/commands/entity_query.rs`：实体读取 command 的参数及返回模型主归属。
`src/app/composables/use-query-read-owner.ts`：消费者等待、请求通道与释放主归属。
`src/services/entity-query.service.ts`：详情、列表、实际目标、身份意图及草稿资源能力主归属。
`src/services/query-cache.service.ts`：六类缓存、single-flight、失效匹配与实时读取 owner。
`src/shared/lib/query-snapshot.ts`：只读记录到所属独立可写快照的交接。
`src/shared/runtime/cache.ts`：类型化 LRU 与 pending 原语主归属。
`src/shared/runtime/read-request.ts`：请求失效、消费者等待与错误主归属。
`src/shared/types/query-cache.types.ts`：queryKind、参数、返回类型及深度只读模型主归属。

## 边界

- 只读记录必须由所属配置、表格、编辑器及保存准备边界复制后写入草稿。
- 实体能力必须拥有五个 command、参数及返回类型；领域 mapper 必须拥有记录转换。
- 查询参数、queryKind 和返回类型必须静态关联，共享存储的类型擦除必须集中于单一内部边界。
- 缓存必须拥有 LRU、single-flight、项目失效和通知；展示 owner 必须拥有目标与读取接纳权。
- 每次读取必须由一张 ReadTicket 同时持有 query identity、AbortSignal、Promise、接纳状态和结束原因；消费者不得另维护读取序号。
- 读取 owner 必须按通道登记 ReadTicket，释放必须结束所属等待；调度只合并尚未开始的触发。
- 项目失效必须由 ProjectSession 刷新编排消费，会话清理必须由工作区生命周期消费。

## 链路

### 实体及目标读取

1. 配置、编辑器或保存准备捕获 session 与实体身份。
2. entity-query 装配 command 与 payload，经 command.runtime 调用 Rust query。
3. 详情或列表消费所属缓存，目标、身份意图及草稿资源消费实时请求。
4. mapper 或编辑会话复制内容、目标和版本，按捕获票据接纳。

### 缓存与消费者生命周期

1. 所属读取能力构造 session、queryKind 和参数。
2. query-cache 命中缓存、合并在途请求或建立正式请求。
3. 请求完成后发布只读结果并释放 pending。
4. 项目失效或会话清理撤销请求并通知所属消费者。
5. 有效消费者重读当前目标，目标切换或卸载释放等待。

## 规范

- RuntimeCache 必须在创建时固定 key、value 和 pending 类型；get/set 必须更新访问顺序，peek/has/遍历必须保留顺序。
- 失效必须立即结束等待并提供 query.invalidated、捕获身份和结束原因，底层请求必须自然完成。
- 待同步投影必须在缓存命中与读取之前检查，当前草稿必须保持现行基线交接规则。
- 查询失败必须释放 pending，下一次读取必须重新执行所属 loader。
- 查询容量必须为 CSV 窗口 80、来源 240、行预览 400、Hull/详情/列表各 128，缓存键必须包含 session。
- 查询结果必须通过深度只读类型公开，可写快照必须具有独立嵌套内容和版本数组。
- 正常生命周期失效必须由 ReadTicket owner 消费，真实错误必须进入所属反馈。
- 消费者释放只允许结束自己的等待，共享在途请求必须继续服务其它消费者。
- 迟到成功、错误和收尾必须由 ReadTicket 的接纳状态核对；替代请求的 pending 与缓存必须保持正式归属。

## 陷阱

- 严禁以任意返回泛型搭配无关参数字典。
- 严禁由消费者取消全体共享请求。
- 严禁让缓存记录与可写草稿共享嵌套内容。
