# Loomloom × DSH Desktop 仓库布局

## 目标布局

本工作区以 DSH Desktop fork 为未来产品主工程，旧 Loomloom Go/Tauri 应用仅作为迁移参考。推荐的最终目录如下：

```text
loomloom-dsh/
├── legacy-loomloom/                    # 旧项目；迁移完成前保留，只读参考优先
│   ├── main.go                          # 原 Go sidecar
│   ├── auth_ssy.go                      # 原胜算云授权实现
│   ├── assets/                          # 原生 Web UI
│   ├── src-tauri/                       # 原桌面壳
│   ├── dist/                            # 历史构建产物
│   └── BACKEND_API.md                   # 已知上游 API 契约
│
└── dsh-desktop/                        # Git fork；未来发布根目录
    ├── deepseek-harness/                # 固定上游 Git submodule：禁止修改
    ├── dsh-plugin-desktop/              # DSH Desktop 稳定包：不放 Loomloom 业务逻辑
    ├── dsh-plugin-desktop-beta/         # DSH Desktop Beta：不放 Loomloom 业务逻辑
    ├── dsh-plugin-loomloom/             # Loomloom 的唯一业务实现包
    │   ├── src/
    │   │   ├── index.ts                 # Host 插件入口与生命周期
    │   │   ├── loom-api.ts              # 胜算云 API Client
    │   │   ├── routes.ts                # loopback same-origin Host routes
    │   │   ├── auth/                    # 后续：OAuth、凭据与会话
    │   │   ├── tools/                   # 后续：DSH 聊天调用 SkillBot 的 tools
    │   │   └── client/                  # 后续：DSH Web Client UI
    │   ├── tests/
    │   ├── cordis.patch.yml             # 安装时插入 DSH bundle row
    │   └── README.md
    └── docs/
        ├── loomloom-integration-spec.md
        ├── loomloom-integration-plan.md
        ├── loomloom-first-run-auth-spec.md
        └── loomloom-repository-layout.md
```

目前旧项目仍位于工作区根目录，尚未移动到 `legacy-loomloom/`。这是有意保留的过渡状态：旧二进制、构建脚本和相对路径仍可能依赖现有根目录。待 DSH 开发环境和 Loomloom plugin MVP 均通过验收后，再进行一次单独、可回滚的移动。

## 所有权规则

| 路径 | 所有权 | 改动规则 |
|---|---|---|
| `dsh-desktop/deepseek-harness/` | 上游 DeepSeek Harness | 禁止修改；仅通过升级 submodule 更新 |
| `dsh-desktop/dsh-plugin-desktop*/` | DSH Desktop 上游桌面能力 | 不放 Loomloom 业务；只有确有通用桌面能力需求时按上游规范修改 |
| `dsh-desktop/dsh-plugin-loomloom/` | 本项目 | 所有胜算云、OAuth、SkillBot tools 与 Loomloom UI 仅在这里实现 |
| `dsh-desktop/docs/loomloom-*` | 本项目 | 规格、计划、协议记录与迁移决策 |
| 根目录旧 Go/Tauri 文件 | Legacy Loomloom | 仅修复阻塞迁移的缺陷；不再新增产品功能 |

## 凭据、构建产物与版本控制

- 不提交 Token、OAuth code、Cookie、`config.json`、本地 profile 或 DSH 用户数据。
- 新插件凭据应由 DSH credentials/settings 服务在用户数据目录保存，不能继续依赖 legacy `config.json`。
- DSH 构建产物只位于 `dsh-desktop/**/dist`（或 Electron Builder 配置指定目录），并保持 Git ignore；旧 `dist/` 仅保留历史发布物。
- `dsh-plugin-loomloom` 留在 DSH Desktop 根 Yarn workspace 内；不要在工作区根再建同名 `plugins/` 副本，以免出现两套不一致源码。

## 迁移顺序

1. 保持当前根目录不动，先完成 `dsh-desktop/dsh-plugin-loomloom` 的依赖安装、类型检查和 Host API 验收。
2. 完成胜算云授权重构，以及 DSH 聊天唤起并回收 SkillBot 结果。
3. 以测试清单验证新 DSH 客户端已经覆盖旧应用必要能力。
4. 创建 `legacy-loomloom/`，使用版本控制下的移动操作迁入原 Go/Tauri 文件；逐一更新仅用于 legacy 的构建脚本路径。
5. 新建顶层产品 README，并将 DSH Desktop 作为唯一发布入口；旧应用保留一个明确的 deprecation/read-only 说明。

移动 legacy 目录不应与插件功能、上游 submodule 更新或 DSH Desktop 版本升级混在同一变更中。
