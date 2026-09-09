# LoomLoom Desktop

The Shengsuanyun LoomLoom desktop client, with chat, the cloud SkillBot Market, and local DSH workspaces.

## Install

### macOS

1. Download the [macOS Universal DMG](https://www.dshdesktop.cn/api/downloads/mac).
2. Open the DMG and drag LoomLoom Desktop into Applications.
3. Launch the app and complete Shengsuanyun sign-in.

### Windows

1. Download the [Windows x64 installer](https://www.dshdesktop.cn/api/downloads/windows).
2. Run the installer and follow the prompts.
3. Launch LoomLoom Desktop and complete Shengsuanyun sign-in.

Application data is stored in `~/.loomloom` by default and is kept separate from the original DSH data under `~/.dsh`.

## Start Using It

After installation:

1. Click “胜算云账户” in the lower-left corner and sign in.
2. Click “云端 SkillBot” in the left sidebar to open the Market.
3. Select a SkillBot, inspect its public inputs, and request a quote.
4. Review the quote, then click “Confirm and execute”.
5. Click a workspace or session in the sidebar to return to that chat.

## Run From Source

Requirements: Node.js `^22.19.0` or `>=24.0.0`, with Corepack enabled.

```bash
git clone https://github.com/gold3bear/loomloom-dsh-desktop.git
cd loomloom-dsh-desktop
git submodule update --init --recursive
corepack yarn install --immutable
corepack yarn dev
```

The development command builds the required packages and opens the desktop window. For code checks:

```bash
corepack yarn workspace dsh-plugin-loomloom typecheck
corepack yarn workspace dsh-plugin-loomloom test
corepack yarn check
```

## Documentation

- [First-run authentication](docs/loomloom-first-run-auth-spec.md)
- [Market navigation](docs/loomloom-market-navigation-spec.md)
- [Plugin development](docs/plugin-development.en.md)
- [User guide](docs/user-guide.en.md)

## License

This project is licensed under the [MIT License](LICENSE).

Built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).
