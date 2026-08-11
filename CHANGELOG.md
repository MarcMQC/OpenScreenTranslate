# Changelog

本文件记录 OpenScreenTranslate 的重要变更。格式参考
[Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循
[Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- GitHub 开源项目基础文档、贡献模板和统一检查脚本
- 提交前高置信度敏感信息扫描及本地凭据文件忽略规则
- 首次安装启动时自动显示设置页面
- 应用启动时检测屏幕录制权限，并在缺失时主动发起系统授权请求
- 无需 Apple 公证的本地 Debug `.app` 构建脚本
- 修复本地 ad-hoc 构建因 `cdhash` 变化导致屏幕录制授权失效的问题
- 截图翻译和手动翻译的默认快捷键调整为 `Command+1` 与 `Command+2`
- 登录时自动启动改为默认关闭

### Fixed

- 防止登录启动与 macOS 应用恢复同时触发时创建两个菜单栏实例

## [0.1.0] - 2026-08-05

### Added

- macOS 菜单栏截图翻译与 Apple Vision OCR
- 可编辑原文的手动翻译窗口
- DeepSeek、OpenAI、Anthropic Claude 与 Google Gemini 支持
- 自定义模型、请求 URL、目标语言和全局快捷键
- macOS 钥匙串 API Key 存储
- 登录时自动启动
- macOS 应用签名、公证和 DMG 发布脚本
