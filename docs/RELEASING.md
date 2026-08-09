# macOS 发布指南

本文面向 OpenScreenTranslate 的维护者，介绍本地 `.app` 构建、Developer ID
签名、Apple 公证和 DMG 发布流程。

## 构建本地 Debug 应用

```bash
npm run build:macos:debug
```

产物位于 `src-tauri/target/debug/bundle/macos/OpenScreenTranslate.app`。该脚本自动
同步根目录 `VERSION`，使用 Debug 配置构建，并只应用本机 ad-hoc 签名。它不会
生成 DMG、读取 Developer ID 身份或提交 Apple 公证，不可用于公开分发。本地签名
使用稳定的 Bundle ID designated requirement，避免每次构建都因 `cdhash` 变化而
丢失屏幕录制授权。

需要验证 DMG 背景、拖拽安装和首次启动流程时，运行：

```bash
npm run build:macos:debug:dmg
```

产物位于 `src-tauri/target/debug/bundle/dmg/`，文件名以 `_debug.dmg` 结尾，并附带
`.sha256` 文件。DMG 内的应用只使用稳定的本地 ad-hoc 签名；脚本不会读取
Developer ID 身份、访问公证钥匙串凭据或向 Apple 提交公证，因此不可公开分发。

从旧版 ad-hoc 构建迁移时，需要重置一次旧授权，再启动新构建并重新授权：

```bash
npm run reset:macos:screen-capture
```

## 构建本地应用

```bash
npm run build:macos:app
```

产物位于 `src-tauri/target/release/bundle/macos/OpenScreenTranslate.app`。
未设置 `APPLE_SIGNING_IDENTITY` 时，构建脚本会使用本机 ad-hoc 签名。每次重新
构建后，macOS 可能要求重新授予屏幕录制权限。公开分发必须使用稳定的
Developer ID Application 签名并完成公证。

## 准备 Developer ID Application 证书

1. 在“钥匙串访问”中选择“证书助理 → 从证书颁发机构请求证书”，生成 CSR。
2. 在 Apple Developer 的 Certificates, Identifiers & Profiles 页面创建
   `Developer ID Application` 证书并上传 CSR。
3. 下载 `.cer` 文件并双击，将证书安装到“登录”钥匙串。
4. 确认钥匙串中同时存在证书及对应私钥：

```bash
security find-identity -v -p codesigning
```

输出中应出现 `Developer ID Application: ... (TEAM_ID)`。只有证书而没有私钥
时，它不会成为有效签名身份。

## 配置公证凭据

先在 <https://account.apple.com> 的“登录与安全 → App 专用密码”中生成 App
专用密码，然后执行：

```bash
npm run release:macos:setup
```

脚本会询问 Apple 账户邮箱，并由 Apple `notarytool` 安全读取 App 专用密码。
默认钥匙串配置名为 `OpenScreenTranslate-notary`。凭据只保存在 macOS 钥匙串，
不会写入项目文件。只要 Apple 账户或 App 专用密码没有更换，此步骤只需执行一次；
之后运行发布命令不会再次询问邮箱和密码。

## 构建并公证 DMG

发布当前 Mac 架构版本：

```bash
npm run release:macos
```

同一时间只能运行一个 `release:macos` 或 `release:macos:resume` 进程。不要在多个
终端窗口中并发构建同一版本，否则进程可能同时覆盖同一路径下的 DMG，使本地文件
与 Apple 已接受的公证提交不再对应。

脚本会依次检查 Rust 格式、构建前端、运行 Rust 测试和 Clippy，然后执行 Tauri
release 构建、Developer ID 签名检查、Apple 公证、票据装订、Gatekeeper 验证，
并生成同名 `.dmg.sha256` 校验文件。

上传成功后，脚本会立即将 Apple 提交编号保存为同目录下的
`.dmg.notary-id` 文件。如果公证排队较久、等待超时，或者手动按 `Ctrl-C`
停止等待，可以随时续跑，不会重新构建或重复上传：

```bash
npm run release:macos:resume
```

`resume` 默认选择最近一次提交；也可以明确指定 DMG 和提交编号：

```bash
./scripts/release-macos-dmg.sh resume \
  --dmg /absolute/path/to/OpenScreenTranslate.dmg \
  --submission 00000000-0000-0000-0000-000000000000
```

Apple 返回 `Accepted` 后，脚本才会装订票据、执行最终 Gatekeeper 检查并生成
`.dmg.sha256`。只有终端显示 `Release is ready` 的 DMG 才能对外分发。

成功输出示例：

```text
Release is ready:
  DMG:    /absolute/path/to/OpenScreenTranslate_0.1.0_aarch64.dmg
  SHA256: /absolute/path/to/OpenScreenTranslate_0.1.0_aarch64.dmg.sha256
  Apple:  Accepted (submission-id)
```

发布脚本已执行票据、磁盘映像和 Gatekeeper 检查。需要再次人工确认时，可执行：

```bash
DMG="/absolute/path/to/OpenScreenTranslate_0.1.0_aarch64.dmg"
codesign --verify --strict --verbose=2 "$DMG"
xcrun stapler validate "$DMG"
spctl --assess --type open --context context:primary-signature --verbose=4 "$DMG"
```

生成同时支持 Apple Silicon 和 Intel 的 universal DMG：

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm run release:macos:universal
```

如果钥匙串中存在多个 Developer ID Application 证书，请明确指定签名身份：

```bash
APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAM_ID)" \
  npm run release:macos
```

Apple 公证偶尔会耗时较长。每次命令默认最多等待 6 小时，可通过
`OST_NOTARY_TIMEOUT` 调整：

```bash
OST_NOTARY_TIMEOUT=2h npm run release:macos
```

发布脚本默认执行全部质量检查。`--skip-checks` 仅用于已在同一份代码上单独完成
`npm run check` 的特殊情况，不建议在常规正式发布中使用：

```bash
./scripts/release-macos-dmg.sh release --skip-checks
```

## 发布前检查

- 更新根目录 `VERSION`，然后执行 `npm run version:sync`
- 更新 [CHANGELOG.md](../CHANGELOG.md)
- 执行 `npm run check`
- 在干净环境中验证 `.dmg` 安装、首次启动与屏幕录制授权
- 将 `.dmg` 和 `.dmg.sha256` 一同上传到 GitHub Release
- 在 Release Notes 中注明支持的 macOS 版本与重大变更

应用图标源文件为 `src-tauri/icons/app-icon-source.png`，macOS 构建使用
`src-tauri/icons/icon.icns`，菜单栏使用 `src-tauri/icons/tray-icon.png`。
