# OpenScreenTranslate

English | [简体中文](README.zh-CN.md)

> An open-source, AI-powered macOS menu bar app for quickly recognizing and translating text on your screen. To use translation, you must provide and configure your own API key (AK) from a supported AI provider.

OpenScreenTranslate is built with Tauri 2, Rust, ScreenCaptureKit, and Apple Vision.
It lives in the menu bar without a Dock icon and supports both screen-region translation
and manual text translation. OCR runs locally; only the text to be translated is sent to
the AI service you select.

## Features

- Select a screen region with a customizable global shortcut; press `Esc` to cancel
- Recognize multilingual text locally with Apple Vision
- Edit recognized text to correct OCR errors and translate again
- Open the manual translation window with a separate global shortcut
- Support DeepSeek, OpenAI, Anthropic Claude, and Google Gemini
- Configure a custom model name and full request URL for compatible self-hosted services
- Store API keys only in the macOS Keychain, never in ordinary configuration files
- Open Settings on first launch to guide AI provider configuration
- Optionally launch automatically when you log in to macOS

## Requirements

- macOS 14 or later
- Screen Recording permission (required only for screen-region translation)
- An API key for at least one supported AI provider, or a compatible endpoint

## Installation

### Install from a release

Download the latest `.dmg` from the repository's Releases page, open it, and drag
OpenScreenTranslate into the Applications folder. When using screen translation for the
first time, grant Screen Recording permission when macOS prompts you.

### Run from source

Development requires Node.js 20 or later, Rust stable, and Xcode Command Line Tools.

```bash
git clone https://github.com/MarcMQC/OpenScreenTranslate.git
cd openscreentranslate
npm install
npm run tauri dev
```

## Usage

1. Open Settings from the menu bar and configure an AI provider, model, request URL, and API key.
2. Use the Screen Capture & Translate shortcut to select content, or use the Translate shortcut to enter text manually.
3. Choose the source and target languages in the translation window. You can edit the recognized text if OCR needs correction.

New installations use `Command+1` for screen capture and translation and `Command+2` for
manual translation. Launch at login is disabled by default. The app checks Screen Recording
permission at startup and requests it when macOS has not yet recorded a choice.

## Development

Installation and development commands:

| Command | Purpose |
| --- | --- |
| `npm install` | Install frontend dependencies and the Tauri CLI |
| `npm ci` | Perform a reproducible clean install from `package-lock.json`, suitable for CI |
| `npm run tauri dev` | Start the desktop app in development mode |
| `npm run dev` | Start only the Vite frontend development server |
| `npm run build` | Run TypeScript checks and build the frontend |
| `npm run preview` | Preview the built frontend locally |
| `npm run tauri -- <command>` | Invoke the project's local Tauri CLI directly |

Validation and maintenance commands:

| Command | Purpose |
| --- | --- |
| `npm run check` | Run secret scanning, formatting checks, frontend build, Rust tests, and Clippy |
| `npm run security:check` | Scan for common secrets, private keys, and files that must not be committed |
| `npm run version:sync` | Synchronize the root `VERSION` into all build configurations |
| `npm run version:check` | Verify that every build configuration matches `VERSION` |
| `npm run settings:delete` | Permanently delete app settings and AI provider API keys from Keychain |
| `npm run reset:macos:screen-capture` | Reset the app's macOS Screen Recording permission record |

macOS build and release commands:

| Command | Purpose |
| --- | --- |
| `npm run build:macos:debug` | Build a Debug `.app` for local testing only |
| `npm run build:macos:app` | Build a local Release `.app` |
| `npm run release:macos:setup` | Store Apple notarization credentials securely in the macOS Keychain |
| `npm run release:macos` | Build, sign, notarize, and verify a DMG for the current architecture |
| `npm run release:macos:resume` | Resume waiting for and processing a previously submitted notarization |
| `npm run release:macos:universal` | Build a universal DMG for both Apple Silicon and Intel |

`package.json` also defines the following npm lifecycle hooks. npm runs them automatically
before their corresponding commands, so you normally should not invoke them directly:

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
docs/                 Maintainer documentation
```

Development builds log selection coordinates, Retina pixel conversion, OCR character counts,
translation timing, and token usage. They never log API keys or complete translated content.
Release builds retain only diagnostic error information.

### Version management

The root [`VERSION`](VERSION) file is the single source of truth for the project version.
For a new release, update only this file and run `npm run version:sync`. Development, build,
and Tauri commands also synchronize `package.json`, `package-lock.json`, Cargo, and Tauri
configuration automatically before running. `npm run check` verifies that all derived values match.

## Building and releasing

Build a local Debug app:

```bash
npm run build:macos:debug
```

The result is written to `src-tauri/target/debug/bundle/macos/OpenScreenTranslate.app`.
The script synchronizes `VERSION`, builds with the Debug configuration, and applies a local
ad-hoc signature. It does not create a DMG, use Developer ID signing, or submit the app for
Apple notarization, and is intended only for local testing. The local signature includes a
stable Bundle ID designated requirement, allowing later builds from the same script to match
the same system permission record.

If you granted permission to an app built by an older version of the script, reset its old
`cdhash` permission record once:

```bash
npm run reset:macos:screen-capture
```

Then quit OpenScreenTranslate completely, launch the new build, grant Screen Recording
permission again, and restart the app. A production build signed with Developer ID uses a
different trusted signing identity and requires its own permission on first installation.

Build a local Release app:

```bash
npm run build:macos:app
```

The result is written to `src-tauri/target/release/bundle/macos/OpenScreenTranslate.app`.
For the complete Developer ID signing, notarization, and universal DMG workflow, see the
[release guide](docs/RELEASING.md).

## Uninstallation and data removal

Quit the app completely, then move `OpenScreenTranslate.app` to the Trash. macOS does not
automatically remove app settings or API keys stored in Keychain. If you still have the source
directory, run:

```bash
npm run settings:delete
```

The command lists what it will remove and asks for confirmation. macOS manages Screen Recording
permission separately; run `npm run reset:macos:screen-capture` if you also need to reset it.

## Privacy and security

- OCR is performed locally with Apple Vision.
- Only text awaiting translation is sent to the AI service you select and configure.
- Each provider's API key is stored separately in the macOS Keychain.
- Never include API keys or other secrets in issues, logs, or screenshots.

Report security issues privately according to the [security policy](SECURITY.md).

### Before uploading to GitHub

```bash
npm run check
```

This command includes a high-confidence sensitive-information scan. You should still inspect
the files being committed and ensure they contain no `.env` files, certificates, private keys,
Apple notarization files, API keys, build artifacts, or personal data. Do not use `git add -f`
to force ignored files into a commit.

## Contributing

Issues and pull requests are welcome. Read the [contributing guide](CONTRIBUTING.md) and
[code of conduct](CODE_OF_CONDUCT.md) before getting started.

## License

This project is available under the [MIT License](LICENSE).
