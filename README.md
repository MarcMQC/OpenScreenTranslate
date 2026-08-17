<p align="center">
  <img src="./src-tauri/icons/icon.png" width="128" height="128" alt="OpenScreenTranslate app icon">
</p>

<h1 align="center">OpenScreenTranslate</h1>

<p align="center">
  <strong>English</strong> | <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  An open-source, AI-powered macOS menu bar app for capturing, recognizing, and translating on-screen text.
</p>

<p align="center">
  <a href="https://github.com/MarcMQC/open-screen-translate/releases"><strong>Download the latest macOS DMG</strong></a>
</p>

To use translation features, you must obtain and configure an API key from a supported AI provider.

OpenScreenTranslate is built with Tauri 2, Rust, ScreenCaptureKit, and Apple Vision. It runs in the menu bar without a Dock icon and supports both screenshot translation and manual text translation. OCR is performed locally, and only the text to be translated is sent to the AI service selected by the user.

## Preview

<p align="center">
  <img src="./docs/assets/translation-window.png" width="900" alt="OpenScreenTranslate translation window">
</p>

<p align="center"><sub>Automatically detect the source language, edit recognized text, and stream the translation result.</sub></p>

## Features

- Select any screen region with a customizable global shortcut, or press `Esc` to cancel
- Recognize multilingual text locally with Apple Vision
- Merge visual line wraps introduced by OCR while preserving lightweight paragraph structure based on blank lines, sentence-ending punctuation, and lists
- Edit recognized text to correct OCR errors, then translate again
- Open the manual translation window with a separate global shortcut
- Stream translation results as they arrive, with a result window that smoothly adapts to the content height
- Use DeepSeek, OpenAI, Anthropic Claude, Google Gemini, or a custom compatible service
- Configure the model name and full request URL for every service
- Store API keys only in the macOS Keychain, never in regular configuration files
- Complete screen recording permission, AI provider, default language, shortcut, and launch preferences through first-run onboarding
- Launch automatically at macOS login

## Requirements

- macOS 14 or later
- Screen Recording permission
- An API key for at least one supported AI provider, or access to a compatible endpoint

## Installation

### Install from a release

Download the latest `.dmg` from [GitHub Releases](https://github.com/MarcMQC/open-screen-translate/releases), open it, and drag OpenScreenTranslate into the Applications folder. On first launch, follow the onboarding steps to grant Screen Recording permission, configure an AI provider, and choose your preferences.

### Run from source

The development environment requires Node.js 20 or later, Rust stable, and Xcode Command Line Tools.

```bash
git clone https://github.com/MarcMQC/open-screen-translate.git
cd open-screen-translate
npm install
npm run tauri dev
```

## Usage

1. Complete first-run onboarding, including Screen Recording permission and an AI provider API key.
2. Use the “Capture and Translate” shortcut to select on-screen content, or use the “Translate” shortcut to enter text manually.
3. Adjust the source and target languages in the translation window. If recognition is inaccurate, edit the source text directly.

Text recognized from a screenshot receives lightweight formatting before translation. Line breaks caused by page width within the same sentence are merged automatically, while explicit blank lines, new sentences after sentence-ending punctuation, and list items are preserved as separate paragraphs whenever possible. This processing applies only to OCR results; manually entered formatting is left unchanged. Once translation begins, the translated text is filled in progressively as the AI service responds. The window grows within the available screen area, shrinks promptly for shorter content, and scrolls within the text area after long content reaches the height limit.

New installations use `Command+1` for screenshot translation and `Command+2` for manual translation. Launch at login is disabled by default. At startup, the app checks Screen Recording permission and the API key for the selected AI provider; onboarding opens again if either is missing.

## Development

Installation and development commands:

| Command | Purpose |
| --- | --- |
| `npm install` | Install frontend dependencies and the Tauri CLI |
| `npm ci` | Perform a clean, reproducible install from `package-lock.json`, suitable for CI |
| `npm run tauri dev` | Start the desktop app in development mode |
| `npm run dev` | Start only the Vite frontend development server |
| `npm run build` | Run TypeScript checks and build the frontend |
| `npm run preview` | Preview the built frontend locally |
| `npm run tauri -- <command>` | Invoke the project-local Tauri CLI directly |

Validation and maintenance commands:

| Command | Purpose |
| --- | --- |
| `npm run check` | Run secret scanning, formatting checks, the frontend build, Rust tests, and Clippy |
| `npm run security:check` | Scan for common keys, private keys, and sensitive files that should not be committed |
| `npm run version:sync` | Synchronize the root `VERSION` value with all build configuration files |
| `npm run version:check` | Verify that build configuration versions match `VERSION` |
| `npm run settings:delete` | Permanently delete app settings and AI provider API keys stored in the Keychain |
| `npm run reset:macos:screen-capture` | Reset the app's macOS Screen Recording permission record |

macOS build and release commands:

| Command | Purpose |
| --- | --- |
| `npm run build:macos:debug` | Build a Debug `.app` for local testing only |
| `npm run build:macos:debug:dmg` | Build a Debug DMG with local ad-hoc signing and no notarization |
| `npm run build:macos:app` | Build a local Release `.app` |
| `npm run release:macos:setup` | Store Apple notarization credentials securely in the macOS Keychain |
| `npm run release:macos` | Build, sign, notarize, and verify a DMG for the current architecture |
| `npm run release:macos:resume` | Resume waiting for and processing a previously submitted notarization job |
| `npm run release:macos:universal` | Build a universal DMG for both Apple Silicon and Intel |

`package.json` also defines the following npm lifecycle hooks. npm runs them automatically before their corresponding commands, so they usually do not need to be invoked manually:

| Automatic hook | Runs before | Purpose |
| --- | --- | --- |
| `predev` | `npm run dev` | Synchronize the project version |
| `prebuild` | `npm run build` | Synchronize the project version |
| `prebuild:macos:app` | `npm run build:macos:app` | Synchronize the project version |
| `prerelease:macos` | `npm run release:macos` | Synchronize the project version |
| `prerelease:macos:universal` | `npm run release:macos:universal` | Synchronize the project version |
| `pretauri` | `npm run tauri -- <command>` | Synchronize the project version |

Project structure:

```text
src/                  Frontend UI and interactions
src-tauri/src/        Tauri commands, translation, and credential storage
src-tauri/native/     Native ScreenCaptureKit and Apple Vision implementation
scripts/              Validation, signing, and release scripts
docs/                 Project maintenance documentation
```

Development builds log selection coordinates, Retina pixel conversion, OCR character counts, translation duration, and token usage, but never log API keys or complete translation content. Release builds retain only error diagnostics.

### Version management

The root [`VERSION`](VERSION) file is the single source of truth for the project version. To publish a new version, edit only that file and then run `npm run version:sync`. Development, build, and Tauri commands also synchronize `package.json`, `package-lock.json`, Cargo, and Tauri configuration automatically before running. `npm run check` verifies that all derived values are consistent.

## Build and release

Build a local Debug app:

```bash
npm run build:macos:debug
```

The output is written to `src-tauri/target/debug/bundle/macos/OpenScreenTranslate.app`. The script synchronizes `VERSION`, builds with the Debug configuration, and applies local ad-hoc signing. It does not generate a DMG, use Developer ID signing, or submit the app for Apple notarization, and is intended only for local testing. The local signature includes a stable Bundle ID designated requirement, allowing later builds produced by this script to continue matching the same system permission record.

To test the complete installation flow, build a Debug DMG without Developer ID signing or Apple notarization:

```bash
npm run build:macos:debug:dmg
```

The output is written to `src-tauri/target/debug/bundle/dmg/`, with a filename ending in `_debug.dmg`. The script applies the same local ad-hoc signature to the app inside the DMG and generates a `.sha256` checksum file. This artifact is only for local or controlled testing and must not be distributed publicly.

If you previously built and authorized the app with an older script, reset the old `cdhash` permission record once:

```bash
npm run reset:macos:screen-capture
```

Then quit OpenScreenTranslate completely, launch the new build, grant Screen Recording permission again, and quit and relaunch once more. Official Developer ID-signed builds use a different trusted signing identity and still require separate permission on first installation.

Build a local Release app:

```bash
npm run build:macos:app
```

The output is written to `src-tauri/target/release/bundle/macos/OpenScreenTranslate.app`. See the [release guide](docs/RELEASING.md) for the complete Developer ID signing, notarization, and universal DMG workflow.

## Uninstall and data cleanup

After quitting the app completely, move `OpenScreenTranslate.app` to the Trash to remove the application itself. macOS does not automatically delete app settings or API keys from the Keychain. If you still have the source directory, run:

```bash
npm run settings:delete
```

The command lists the deletion scope and asks for confirmation before proceeding. macOS manages the Screen Recording permission record separately; run `npm run reset:macos:screen-capture` when needed.

## Privacy and security

- OCR is performed locally with Apple Vision
- Only the text to be translated is sent to the AI service selected and configured by the user
- API keys for each provider are stored separately in the macOS Keychain
- Never include API keys or other sensitive information in issues, logs, or screenshots

Report security issues privately by following the [security policy](SECURITY.md).

### Before pushing to GitHub

```bash
npm run check
```

This command includes high-confidence secret scanning. You should still manually verify that the commit does not contain `.env` files, certificates, private keys, Apple notarization files, API keys, build artifacts, or personal data. Do not use `git add -f` to force-add files excluded by `.gitignore`.

## Contributing

Issues and pull requests are welcome. Read the [contribution guide](CONTRIBUTING.md) and [code of conduct](CODE_OF_CONDUCT.md) before getting started.

## License

This project is open source under the [MIT License](LICENSE).
