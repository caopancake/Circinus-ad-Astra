# Circinus ad Astra

Windows 桌面版 Starsector Mod 配置工具，使用 Tauri 2 + Vue 3 + TypeScript + Rust 构建。

> 项目处于 `0.1.0` 的早期公开阶段。请在修改 Mod 前自行备份，并通过 Issue 提供可复现步骤反馈问题。
> <img width="2133" height="1160" alt="image" src="https://github.com/user-attachments/assets/a2e8da40-76b6-416e-852d-5b6ba7037d84" />
> <img width="2133" height="1160" alt="image" src="https://github.com/user-attachments/assets/b8c95e7a-5966-477b-b578-b88440466cbd" />
> <img width="1450" height="950" alt="image" src="https://github.com/user-attachments/assets/5dadc1d7-fd2a-49c0-917e-fb76d9dc29b0" />
> <img width="2133" height="1160" alt="image" src="https://github.com/user-attachments/assets/45d798fa-b9ce-41a8-b293-ce776b9a320a" />
> <img width="2133" height="1160" alt="image" src="https://github.com/user-attachments/assets/09f709cf-002f-4027-94a8-dbf941c405d3" />
> <img width="2133" height="1160" alt="image" src="https://github.com/user-attachments/assets/e7b3a0d9-0779-489f-a1d7-4e6c94f49181" />
> <img width="2133" height="1160" alt="image" src="https://github.com/user-attachments/assets/521a8b90-08ab-4316-9a98-fd5e4492d528" />

## 功能

- 打开 Starsector 游戏目录或单独的 Mod 目录；同一工作区可切换多个已加载 Mod
- 创建最小 Mod 模板，并在检测到游戏目录时直接创建到 `mods/` 下
- 编辑已注册的 CSV 表、`mod_info.json`、Faction、Mission、Variant、Skin 与通用文本文件
- 提供舰船、武器、弹体和战术系统编辑器，以及武器发射预览
- 当前 Mod 优先、原版回退的引用查询与贴图缩略图；支持导入、覆盖 PNG 贴图
- 通过 changeset 记录保存历史，并支持撤销、重做和目标级刷新

## 开始使用

1. 从 GitHub Release 下载 Windows 可执行文件，或按下文“开发”步骤运行源码。
2. 在总览页选择 Starsector 游戏目录；也可以直接打开一个 Mod 根目录。
3. 从顶部 Mod 页签进入已加载 Mod，再从左侧导航打开表格、配置或专用编辑器。
4. 保存只会写入当前编辑目标所属的 Mod 文件；保存前仍建议保留 Mod 备份。

## 运行与开发环境

- 运行环境：Windows；使用原版回退资源时需要本机已安装的 Starsector。
- 源码开发必须使用 Node.js（含 npm）与 `rust-toolchain.toml` 固定的 Rust 1.95.0 MSVC 工具链；Cargo 声明的最低 Rust 版本为 1.90。
- 依赖版本以 [package.json](./package.json) 和 [src-tauri/Cargo.toml](./src-tauri/Cargo.toml) 为准。

## 技术栈

- Tauri 2
- Rust
- Vue 3
- Pinia
- TypeScript
- Naive UI
- Canvas 2D

## 开发

```powershell
npm install
npm.cmd run tauri -- dev
```

## 构建

```powershell
npm.cmd run tauri -- build --no-bundle
```

该命令会经 `tauri.conf.json` 的 `beforeBuildCommand` 自动执行 `npm run build`（先 `vue-tsc` 类型检查，再 vite 构建前端产物）。

构建完成后产物位于：

```text
src-tauri\target\release\circinus-ad-astra.exe
```

项目只发布单文件 exe，不生成安装包；`tauri.conf.json` 的 bundle 安装包打包已显式关闭。

仓库也提供 [build.ps1](./build.ps1) 与 [build.bat](./build.bat)。这两个便捷脚本会结束正在运行的 `circinus-ad-astra` 进程并清理 `dist/`，仅应在确认可中断当前程序时使用。为了兼容性考虑，bat 脚本是必须的。

## 验证

```powershell
npm.cmd run format:check
npm.cmd run encoding:check
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test
npm.cmd run build
cargo fmt --manifest-path src-tauri\Cargo.toml --check
cargo clippy --manifest-path src-tauri\Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri\Cargo.toml
```

## 仓库结构

| 路径         | 职责                                                   |
| ------------ | ------------------------------------------------------ |
| `src/`       | Vue 前端、工作区、表格、配置表单与专用编辑器           |
| `src-tauri/` | Tauri 命令、ProjectSession、解析、文件变更集与资源服务 |
| `schemas/`   | 配置字段与 CSV 列 schema                               |
| `scripts/`   | 架构、编码和命名检查                                   |
| `.zcode/`    | 维护者的模块契约、术语和任务记录                       |

## 贡献

欢迎提交 Issue 和 Pull Request。提交前请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)，并确保改动不绕过 Mod 隔离、Rust 文件边界或 changeset 保存链路。

## 文档

- [CHANGELOG.md](./CHANGELOG.md)：已发布版本的用户可见变更
- [CONTRIBUTING.md](./CONTRIBUTING.md)：问题反馈、开发与 Pull Request 约定
- [AGENTS.md](./AGENTS.md) 与 [.zcode/](./.zcode/)：维护者和自动化协作约定

## 许可

GPL-3.0，见 [LICENSE](./LICENSE)。
