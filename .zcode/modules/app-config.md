# 工具配置维护

## 定义

工具配置维护模块提供工具私有目录的打开和配置清理能力。

## 参考

`src-tauri/src/commands/app_config.rs`：配置维护 command。
`src-tauri/src/services/app_config.rs`：实际工具配置清理范围。
`src-tauri/src/services/app_paths.rs`：工具 app-data 根解析主归属。
`src/app/composables/settings/use-app-config-actions.ts`：维护动作、危险确认和完成接纳主归属。
`src/app/composables/settings/use-settings-view-model.ts`：设置页消费配置动作并刷新日志投影。
`src/services/app-config.service.ts`：配置目录与清理 command 装配。

## 边界

- app_paths 必须统一提供工具根，能力入口必须返回正式执行结果。
- 工具目录必须通过应用标识解析，严禁使用 Mod 路径。
- 配置动作 composable 必须接纳动作结果并重载窗口，错误必须由统一反馈呈现。
- 配置清理只允许消费 app-data 根，日志维护必须消费日志能力。
- 配置清理必须由后端拥有实际范围，前端必须先确认危险动作。

## 链路

### 打开目录

1. 设置页发起打开动作。
2. 能力调用 open_config_dir。
3. Rust 解析并建立工具目录，调用所属系统打开能力。

### 清理配置

1. 设置页提交危险确认。
2. 能力调用 clear_config_files。
3. Rust 枚举工具根内容，保留正式日志文件并清理其余文件与子目录。
4. 动作成功后刷新日志状态并重载窗口。

## 规范

- 所属文件必须具有唯一模块主归属，状态交接必须消费设置页动作入口。
- 打开目录必须通过系统能力，严禁前端拼接 app-data 路径。
- 正式 LOG_FILE 必须保留，工具目录缺失必须按空清理结果完成。
- 清理严禁触及 Mod、Core 或用户指定的外部日志目录。
- 清理失败必须保留原始诊断并呈现一次错误，重载必须在成功后执行。
- 清理范围必须包括工具根内 settings、workspace 及派生工具子目录，确认必须表达该实际范围。

## 陷阱

- 严禁在前端枚举或删除工具配置文件。
- 严禁在清理失败后呈现成功并重载窗口。
- 严禁把工具清理包装为 Mod 保存动作。
