# 贡献指南

感谢你关注 OpenScreenTranslate。Bug 修复、体验改进、文档和测试都很欢迎。

## 提交问题前

- 搜索现有 Issue，确认问题尚未被报告。
- Bug 请提供 macOS 版本、Mac 芯片架构、应用版本和可复现步骤。
- 日志、截图和示例配置中不得包含 API Key、Apple 账户信息或其他敏感数据。
- 功能建议请说明使用场景和期望结果，而不只描述具体实现。

## 本地开发

环境要求：

- macOS 14 或更高版本
- Node.js 20 或更高版本
- Rust stable
- Xcode Command Line Tools

```bash
npm install
npm run tauri dev
```

截图和 OCR 功能依赖 macOS 的 ScreenCaptureKit 与 Apple Vision，因此相关功能
只能在 macOS 上完整验证。

需要验证独立应用包、首次启动或系统权限行为时，可生成无需公证的本地 Debug
应用：

```bash
npm run build:macos:debug
```

需要验证 DMG 安装界面时，可生成使用本地 ad-hoc 签名且不提交 Apple 公证的测试镜像：

```bash
npm run build:macos:debug:dmg
```

Debug DMG 仅用于本机或受控测试，不可作为正式 Release 分发。

## 修改原则

- 保持设置页与翻译窗口的视觉风格一致。
- 不在日志、设置文件或前端状态中保存 API Key 明文。
- 新增 Tauri 命令时同步检查 capability 权限范围。
- 涉及截图权限、窗口行为或快捷键时，至少在开发构建和 `.app` 构建各验证一次。
- 尽量为 Rust 业务逻辑补充单元测试。

## 提交前检查

执行统一检查脚本：

```bash
npm run check
```

它会依次运行 Rust 格式检查、前端构建、Rust 测试和 Clippy。涉及应用交互的变更
还需要手动验证对应流程。敏感信息扫描也包含在该命令中；如需单独执行，可运行：

```bash
npm run security:check
```

## Pull Request

1. 保持每个 Pull Request 聚焦于一个问题。
2. 清楚说明改动原因、实现方式和验证结果。
3. UI 变更请附修改前后截图或录屏。
4. 行为变化请同步更新 README、CHANGELOG 或相关文档。
5. 确保提交中不包含构建产物、密钥、签名证书或公证凭据。

提交贡献即表示你同意按项目的 [MIT License](LICENSE) 发布你的贡献，并遵守
[行为准则](CODE_OF_CONDUCT.md)。
