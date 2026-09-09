# LoomLoom Desktop

胜算云 LoomLoom 的桌面客户端，内置聊天、云端 SkillBot 市场和本地 DSH 工作区。

## 安装

### macOS

1. 下载 [macOS Universal DMG](https://www.dshdesktop.cn/api/downloads/mac)。
2. 打开 DMG，将 LoomLoom Desktop 拖入 Applications。
3. 首次启动后完成胜算云登录。

### Windows

1. 下载 [Windows x64 安装程序](https://www.dshdesktop.cn/api/downloads/windows)。
2. 运行安装程序并按提示完成安装。
3. 启动 LoomLoom Desktop，完成胜算云登录。

应用数据默认存放在 `~/.loomloom`，不会与原版 DSH 的 `~/.dsh` 数据混用。

## 启动

安装完成后，直接从 Applications、开始菜单或桌面快捷方式启动。

启动后：

1. 点击左下角“胜算云账户”完成登录。
2. 点击左侧“云端 SkillBot”打开市场。
3. 点击任意 SkillBot 查看详情、填写公开输入并获取报价。
4. 确认报价后，再点击“确认并执行”。
5. 点击左侧工作区或会话，即可返回对应聊天。

## 从源码启动

环境要求：Node.js `^22.19.0` 或 `>=24.0.0`，Corepack。

```bash
git clone https://github.com/gold3bear/loomloom-dsh-desktop.git
cd loomloom-dsh-desktop
git submodule update --init --recursive
corepack yarn install --immutable
corepack yarn dev
```

开发服务启动后会自动打开桌面窗口。若只需要检查代码：

```bash
corepack yarn workspace dsh-plugin-loomloom typecheck
corepack yarn workspace dsh-plugin-loomloom test
corepack yarn check
```

## 相关文档

- [首次登录与认证规格](docs/loomloom-first-run-auth-spec.md)
- [SkillBot 市场导航规格](docs/loomloom-market-navigation-spec.md)
- [插件开发文档](docs/plugin-development.md)
- [用户指南](docs/user-guide.md)

## License

本项目遵循 [MIT License](LICENSE)。

本项目基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 构建。
