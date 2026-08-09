mod credential_store;
#[cfg(target_os = "macos")]
mod macos_capture;
mod translation;

use std::{
    collections::BTreeMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex,
    },
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Emitter, LogicalSize, Manager, Monitor, PhysicalPosition, State, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as AutostartManagerExt};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const SETTINGS_WINDOW_LABEL: &str = "main";
const CAPTURE_WINDOW_LABEL: &str = "capture";
const RESULT_WINDOW_LABEL: &str = "result";
const DEFAULT_CAPTURE_SHORTCUT: &str = "Command+1";
const DEFAULT_TRANSLATION_SHORTCUT: &str = "Command+2";
const TRAY_ICON_ID: &str = "main-tray";
const MENU_DISMISS_DELAY_MS: u64 = 120;
const MAX_SOURCE_TEXT_UTF16_UNITS: usize = 5000;
const TRAY_ICON: tauri::image::Image<'_> = tauri::include_image!("icons/tray-icon.png");
const SETTINGS_FILE_NAME: &str = "settings.json";

fn source_text_utf16_len(value: &str) -> usize {
    value.encode_utf16().count()
}

fn truncate_source_text(value: String) -> String {
    if source_text_utf16_len(&value) <= MAX_SOURCE_TEXT_UTF16_UNITS {
        return value;
    }

    let mut units = 0;
    value
        .chars()
        .take_while(|character| {
            let character_units = character.len_utf16();
            if units + character_units > MAX_SOURCE_TEXT_UTF16_UNITS {
                false
            } else {
                units += character_units;
                true
            }
        })
        .collect()
}

#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    target_language: String,
    #[serde(default = "legacy_onboarding_completed")]
    onboarding_completed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    launch_at_login: Option<bool>,
    #[serde(default, skip_serializing)]
    api_key_configured: bool,
    #[serde(default)]
    configured_providers: Vec<String>,
    #[serde(default = "default_translation_provider")]
    translation_provider: String,
    #[serde(default = "default_provider_request_configs")]
    provider_request_configs: BTreeMap<String, translation::ProviderRequestConfig>,
    #[serde(default)]
    request_urls_are_complete: bool,
    #[serde(default = "default_capture_shortcut")]
    capture_shortcut: String,
    #[serde(default = "default_translation_shortcut")]
    translation_shortcut: String,
}

fn default_capture_shortcut() -> String {
    DEFAULT_CAPTURE_SHORTCUT.to_string()
}

fn default_translation_shortcut() -> String {
    DEFAULT_TRANSLATION_SHORTCUT.to_string()
}

fn default_translation_provider() -> String {
    translation::DEFAULT_PROVIDER.to_string()
}

fn default_provider_request_configs() -> BTreeMap<String, translation::ProviderRequestConfig> {
    translation::SUPPORTED_PROVIDERS
        .into_iter()
        .map(|provider| {
            (
                provider.to_string(),
                translation::default_request_config(provider)
                    .expect("supported provider must have a default request config"),
            )
        })
        .collect()
}

// Settings written before onboarding existed belong to users who already configured the app.
// Fresh installs use AppSettings::default(), which explicitly starts incomplete.
fn legacy_onboarding_completed() -> bool {
    true
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            target_language: "zh-CN".to_string(),
            onboarding_completed: false,
            launch_at_login: Some(false),
            api_key_configured: false,
            configured_providers: Vec::new(),
            translation_provider: default_translation_provider(),
            provider_request_configs: default_provider_request_configs(),
            request_urls_are_complete: true,
            capture_shortcut: default_capture_shortcut(),
            translation_shortcut: default_translation_shortcut(),
        }
    }
}

#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TranslationSettings {
    target_language: String,
    provider: String,
    model: String,
    base_url: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TranslationSettingsSnapshot {
    target_language: String,
    provider: String,
    configured_providers: Vec<String>,
    provider_configs: BTreeMap<String, translation::ProviderRequestConfig>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct StartupReadiness {
    screen_capture_permission_granted: bool,
    api_key_configured: bool,
    onboarding_completed: bool,
    provider: String,
}

#[derive(Default)]
struct SettingsState(Mutex<AppSettings>);

#[derive(Default)]
struct ShortcutRuntimeState(Mutex<ShortcutRegistration>);

#[derive(Default)]
struct TranslationShortcutRuntimeState(Mutex<ShortcutRegistration>);

#[derive(Default)]
struct StartupWindowState(AtomicBool);

#[derive(Default)]
struct ShortcutRegistration {
    registered_shortcut: Option<String>,
    error: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CaptureShortcutStatus {
    shortcut: String,
    registered: bool,
    error: Option<String>,
}

struct OcrResult {
    request_id: u64,
    source_text: String,
    manual_input: bool,
    source_language: String,
    target_language: String,
    translation_generation: u64,
    translation_text: Option<String>,
    translation_error: Option<String>,
}

fn manual_translation_result(request_id: u64, target_language: String) -> OcrResult {
    OcrResult {
        request_id,
        source_text: String::new(),
        manual_input: true,
        source_language: "auto".to_string(),
        target_language,
        translation_generation: 0,
        translation_text: Some(String::new()),
        translation_error: None,
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TranslationSnapshot {
    status: String,
    text: Option<String>,
    error: Option<String>,
    source_language: String,
    target_language: String,
    manual_input: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SourceTextSnapshot {
    text: String,
    manual_input: bool,
}

#[derive(Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CaptureSelection {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    viewport_width: f64,
    viewport_height: f64,
}

#[derive(Default)]
struct CaptureState {
    ocr_result: Mutex<Option<OcrResult>>,
    in_progress: AtomicBool,
    ocr_in_progress: AtomicBool,
    permission_prompt_requested: AtomicBool,
    next_request_id: AtomicU64,
}

fn settings_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join(SETTINGS_FILE_NAME))
        .map_err(|error| format!("无法确定设置文件位置：{error}"))
}

fn should_show_onboarding_on_launch(
    onboarding_completed: bool,
    screen_capture_permission_granted: bool,
    api_key_configured: bool,
) -> bool {
    !onboarding_completed || !screen_capture_permission_granted || !api_key_configured
}

fn desired_launch_at_login(saved_value: Option<bool>) -> bool {
    saved_value.unwrap_or(false)
}

fn load_app_settings(app: &tauri::AppHandle) -> Result<AppSettings, String> {
    let path = settings_file_path(app)?;
    match std::fs::read_to_string(&path) {
        Ok(json) => {
            let settings = serde_json::from_str(&json)
                .map_err(|error| format!("无法解析设置文件 {}：{error}", path.display()))?;
            Ok(normalize_app_settings(settings))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(AppSettings::default()),
        Err(error) => Err(format!("无法读取设置文件 {}：{error}", path.display())),
    }
}

fn normalize_app_settings(mut settings: AppSettings) -> AppSettings {
    if !translation::is_supported_target_language(&settings.target_language) {
        settings.target_language = "zh-CN".to_string();
    }
    if settings.api_key_configured
        && !settings
            .configured_providers
            .iter()
            .any(|provider| provider == translation::DEFAULT_PROVIDER)
    {
        settings
            .configured_providers
            .push(translation::DEFAULT_PROVIDER.to_string());
    }
    settings.api_key_configured = false;
    settings
        .configured_providers
        .retain(|provider| translation::is_supported_provider(provider));
    settings.configured_providers.sort();
    settings.configured_providers.dedup();
    if !translation::is_supported_provider(&settings.translation_provider) {
        settings.translation_provider = default_translation_provider();
    }
    if !settings.request_urls_are_complete {
        for (provider, config) in &mut settings.provider_request_configs {
            translation::migrate_legacy_base_url(provider, config);
        }
        settings.request_urls_are_complete = true;
    }
    settings
        .provider_request_configs
        .retain(|provider, _| translation::is_supported_provider(provider));
    for provider in translation::SUPPORTED_PROVIDERS {
        let reset_to_default = settings
            .provider_request_configs
            .get(provider)
            .is_none_or(|config| translation::validate_request_config(config).is_err());
        if reset_to_default {
            settings.provider_request_configs.insert(
                provider.to_string(),
                translation::default_request_config(provider)
                    .expect("supported provider must have a default request config"),
            );
        }
    }
    settings
}

fn persist_app_settings(app: &tauri::AppHandle, settings: &AppSettings) -> Result<(), String> {
    let path = settings_file_path(app)?;
    let directory = path
        .parent()
        .ok_or_else(|| "设置文件没有父目录".to_string())?;
    std::fs::create_dir_all(directory)
        .map_err(|error| format!("无法创建设置目录 {}：{error}", directory.display()))?;

    let json = serde_json::to_string_pretty(settings)
        .map_err(|error| format!("无法序列化设置：{error}"))?;
    let temporary_path = path.with_extension("json.tmp");
    std::fs::write(&temporary_path, json)
        .map_err(|error| format!("无法写入临时设置文件：{error}"))?;
    std::fs::rename(&temporary_path, &path)
        .map_err(|error| format!("无法保存设置文件 {}：{error}", path.display()))
}

fn validate_translation_settings(settings: &TranslationSettings) -> Result<(), String> {
    if !translation::is_supported_target_language(&settings.target_language) {
        return Err("不支持所选的目标语言".to_string());
    }
    if !translation::is_supported_provider(&settings.provider) {
        return Err("不支持所选的 AI 供应商".to_string());
    }
    translation::validate_request_config(&translation::ProviderRequestConfig {
        model: settings.model.clone(),
        base_url: settings.base_url.clone(),
    })?;
    Ok(())
}

fn normalize_capture_shortcut(value: &str) -> Result<String, String> {
    let shortcut = value
        .trim()
        .parse::<Shortcut>()
        .map_err(|error| format!("无法识别这个快捷键：{error}"))?;
    let primary_modifiers = Modifiers::SUPER | Modifiers::CONTROL | Modifiers::ALT;
    if !shortcut.mods.intersects(primary_modifiers) {
        return Err("快捷键必须包含 Command、Control 或 Option".to_string());
    }
    Ok(shortcut.to_string())
}

#[derive(Clone, Copy)]
enum ShortcutKind {
    Capture,
    Translation,
}

fn shortcut_runtime_snapshot(
    app: &tauri::AppHandle,
    kind: ShortcutKind,
) -> Result<(Option<String>, Option<String>), String> {
    let snapshot = match kind {
        ShortcutKind::Capture => {
            let runtime = app.state::<ShortcutRuntimeState>();
            let state = runtime
                .0
                .lock()
                .map_err(|_| "快捷键状态锁已损坏".to_string())?;
            (state.registered_shortcut.clone(), state.error.clone())
        }
        ShortcutKind::Translation => {
            let runtime = app.state::<TranslationShortcutRuntimeState>();
            let state = runtime
                .0
                .lock()
                .map_err(|_| "快捷键状态锁已损坏".to_string())?;
            (state.registered_shortcut.clone(), state.error.clone())
        }
    };
    Ok(snapshot)
}

fn set_shortcut_runtime_state(
    app: &tauri::AppHandle,
    kind: ShortcutKind,
    registered_shortcut: Option<String>,
    error: Option<String>,
) -> Result<(), String> {
    match kind {
        ShortcutKind::Capture => {
            let runtime = app.state::<ShortcutRuntimeState>();
            let mut state = runtime
                .0
                .lock()
                .map_err(|_| "快捷键状态锁已损坏".to_string())?;
            state.registered_shortcut = registered_shortcut;
            state.error = error;
        }
        ShortcutKind::Translation => {
            let runtime = app.state::<TranslationShortcutRuntimeState>();
            let mut state = runtime
                .0
                .lock()
                .map_err(|_| "快捷键状态锁已损坏".to_string())?;
            state.registered_shortcut = registered_shortcut;
            state.error = error;
        }
    }
    Ok(())
}

fn update_tray_shortcut(
    app: &tauri::AppHandle,
    kind: ShortcutKind,
    shortcut: &str,
) -> Result<(), String> {
    let settings = app
        .state::<SettingsState>()
        .0
        .lock()
        .map_err(|_| "设置状态锁已损坏".to_string())?
        .clone();
    let (capture_shortcut, translation_shortcut) = match kind {
        ShortcutKind::Capture => (shortcut, settings.translation_shortcut.as_str()),
        ShortcutKind::Translation => (settings.capture_shortcut.as_str(), shortcut),
    };
    let tray = app
        .tray_by_id(TRAY_ICON_ID)
        .ok_or_else(|| "菜单栏图标尚未初始化".to_string())?;
    let menu = create_tray_menu(app, capture_shortcut, translation_shortcut)
        .map_err(|error| format!("无法更新菜单栏快捷键：{error}"))?;
    tray.set_menu(Some(menu))
        .map_err(|error| format!("无法更新菜单栏菜单：{error}"))
}

fn replace_shortcut(
    app: &tauri::AppHandle,
    requested_shortcut: &str,
    kind: ShortcutKind,
) -> Result<String, String> {
    let shortcut = normalize_capture_shortcut(requested_shortcut)?;
    let previous = shortcut_runtime_snapshot(app, kind)?.0;

    if previous.as_deref() == Some(shortcut.as_str()) {
        set_shortcut_runtime_state(app, kind, Some(shortcut.clone()), None)?;
        update_tray_shortcut(app, kind, &shortcut)?;
        return Ok(shortcut);
    }

    if let Some(previous) = previous.as_deref() {
        app.global_shortcut()
            .unregister(previous)
            .map_err(|error| format!("无法注销原快捷键：{error}"))?;
    }

    match app.global_shortcut().register(shortcut.as_str()) {
        Ok(()) => {
            set_shortcut_runtime_state(app, kind, Some(shortcut.clone()), None)?;
            if let Err(menu_error) = update_tray_shortcut(app, kind, &shortcut) {
                let _ = app.global_shortcut().unregister(shortcut.as_str());
                let restored = if let Some(previous) = previous.as_deref() {
                    match app.global_shortcut().register(previous) {
                        Ok(()) => {
                            let _ = update_tray_shortcut(app, kind, previous);
                            Some(previous.to_string())
                        }
                        Err(_) => None,
                    }
                } else {
                    None
                };
                set_shortcut_runtime_state(app, kind, restored, Some(menu_error.clone()))?;
                return Err(menu_error);
            }
            Ok(shortcut)
        }
        Err(error) => {
            let registration_error =
                format!("快捷键可能已被其他应用或另一项操作占用，请选择其他组合：{error}");
            let mut rollback_error = None;
            let restored = if let Some(previous) = previous.as_deref() {
                match app.global_shortcut().register(previous) {
                    Ok(()) => {
                        if let Err(error) = update_tray_shortcut(app, kind, previous) {
                            rollback_error = Some(error);
                        }
                        Some(previous.to_string())
                    }
                    Err(error) => {
                        rollback_error = Some(format!("原快捷键也无法恢复：{error}"));
                        None
                    }
                }
            } else {
                None
            };

            let error = match rollback_error {
                Some(rollback_error) => format!("{registration_error}；{rollback_error}"),
                None => registration_error,
            };
            set_shortcut_runtime_state(app, kind, restored, Some(error.clone()))?;
            Err(error)
        }
    }
}

fn replace_capture_shortcut(
    app: &tauri::AppHandle,
    requested_shortcut: &str,
) -> Result<String, String> {
    replace_shortcut(app, requested_shortcut, ShortcutKind::Capture)
}

fn replace_translation_shortcut(
    app: &tauri::AppHandle,
    requested_shortcut: &str,
) -> Result<String, String> {
    replace_shortcut(app, requested_shortcut, ShortcutKind::Translation)
}

fn launch_at_login_enabled(app: &tauri::AppHandle) -> Result<bool, String> {
    app.autolaunch()
        .is_enabled()
        .map_err(|error| format!("无法读取登录启动状态：{error}"))
}

fn apply_launch_at_login(app: &tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let manager = app.autolaunch();
    if enabled {
        manager
            .enable()
            .map_err(|error| format!("无法开启登录时自动启动：{error}"))?;
    } else {
        manager
            .disable()
            .map_err(|error| format!("无法关闭登录时自动启动：{error}"))?;
    }

    let actual = manager
        .is_enabled()
        .map_err(|error| format!("无法确认登录启动状态：{error}"))?;
    if actual == enabled {
        Ok(())
    } else {
        Err("系统没有保存登录启动设置".to_string())
    }
}

fn show_settings(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window(SETTINGS_WINDOW_LABEL) else {
        eprintln!("settings window is not available");
        return;
    };

    if let Err(error) = window.unminimize() {
        eprintln!("failed to unminimize settings window: {error}");
    }
    if let Err(error) = window.show() {
        eprintln!("failed to show settings window: {error}");
    }
    if let Err(error) = window.set_focus() {
        eprintln!("failed to focus settings window: {error}");
    }
}

#[tauri::command]
fn set_main_window_layout(app: tauri::AppHandle, onboarding: bool) -> Result<(), String> {
    let window = app
        .get_webview_window(SETTINGS_WINDOW_LABEL)
        .ok_or_else(|| "设置窗口不可用".to_string())?;
    let (width, height) = if onboarding {
        (780.0, 540.0)
    } else {
        (560.0, 640.0)
    };

    window
        .set_size(LogicalSize::new(width, height))
        .map_err(|error| format!("无法调整窗口大小：{error}"))?;
    window
        .center()
        .map_err(|error| format!("无法居中窗口：{error}"))
}

fn distance_squared_to_monitor(cursor: PhysicalPosition<f64>, monitor: &Monitor) -> f64 {
    let position = monitor.position();
    let size = monitor.size();
    let left = f64::from(position.x);
    let top = f64::from(position.y);
    let right = left + f64::from(size.width);
    let bottom = top + f64::from(size.height);

    let dx = if cursor.x < left {
        left - cursor.x
    } else if cursor.x > right {
        cursor.x - right
    } else {
        0.0
    };
    let dy = if cursor.y < top {
        top - cursor.y
    } else if cursor.y > bottom {
        cursor.y - bottom
    } else {
        0.0
    };

    dx * dx + dy * dy
}

fn monitor_nearest_cursor(app: &tauri::AppHandle) -> tauri::Result<Option<Monitor>> {
    let cursor = app.cursor_position()?;

    if let Some(monitor) = app.monitor_from_point(cursor.x, cursor.y)? {
        return Ok(Some(monitor));
    }

    #[cfg(debug_assertions)]
    eprintln!("cursor is outside monitor bounds; using nearest monitor");

    let monitors = app.available_monitors()?;
    Ok(monitors.into_iter().min_by(|left, right| {
        distance_squared_to_monitor(cursor, left)
            .total_cmp(&distance_squared_to_monitor(cursor, right))
    }))
}

fn show_capture_overlay(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window(CAPTURE_WINDOW_LABEL) else {
        eprintln!("capture window is not available");
        return;
    };

    let monitor = monitor_nearest_cursor(app).or_else(|error| {
        eprintln!("failed to find monitor near cursor: {error}");
        app.primary_monitor()
    });

    match monitor {
        Ok(Some(monitor)) => {
            if let Err(error) = window.set_position(*monitor.position()) {
                eprintln!("failed to position capture window: {error}");
            }
            if let Err(error) = window.set_size(*monitor.size()) {
                eprintln!("failed to size capture window: {error}");
            }
        }
        Ok(None) => eprintln!("no monitor is available for capture"),
        Err(error) => eprintln!("failed to query monitor: {error}"),
    }

    #[cfg(target_os = "macos")]
    match window.ns_window() {
        Ok(window_pointer) => macos_capture::present_capture_window(window_pointer),
        Err(error) => eprintln!("failed to access native capture window: {error}"),
    }

    #[cfg(not(target_os = "macos"))]
    {
        if let Err(error) = window.show() {
            eprintln!("failed to show capture window: {error}");
        }
        if let Err(error) = window.set_focus() {
            eprintln!("failed to focus capture window: {error}");
        }
    }

    #[cfg(debug_assertions)]
    match (window.inner_size(), window.scale_factor()) {
        (Ok(size), Ok(scale_factor)) => eprintln!(
            "capture overlay shown: physical={}x{}, scale={scale_factor:.2}",
            size.width, size.height
        ),
        _ => eprintln!("capture overlay shown; window metrics unavailable"),
    }
}

fn show_result_window(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window(RESULT_WINDOW_LABEL) else {
        eprintln!("result window is not available");
        return;
    };

    if let Err(error) = window.unminimize() {
        eprintln!("failed to unminimize result window: {error}");
    }
    if let Err(error) = window.show() {
        eprintln!("failed to show result window: {error}");
    }

    #[cfg(target_os = "macos")]
    match window.ns_window() {
        Ok(window_pointer) => macos_capture::present_capture_window(window_pointer),
        Err(error) => eprintln!("failed to access native result window: {error}"),
    }

    if let Err(error) = window.set_focus() {
        eprintln!("failed to focus result window: {error}");
    }
}

fn begin_manual_translation(app: &tauri::AppHandle) -> Result<(), String> {
    let target_language = app
        .state::<SettingsState>()
        .0
        .lock()
        .map_err(|_| "无法读取默认翻译语言".to_string())?
        .target_language
        .clone();
    let capture_state = app.state::<CaptureState>();
    let request_id = capture_state.next_request_id.fetch_add(1, Ordering::AcqRel) + 1;
    if capture_state.in_progress.swap(false, Ordering::AcqRel) {
        let _ = hide_capture_overlay(app);
    }
    *capture_state
        .ocr_result
        .lock()
        .map_err(|_| "OCR result mutex poisoned".to_string())? =
        Some(manual_translation_result(request_id, target_language));
    show_result_window(app);
    app.emit_to(RESULT_WINDOW_LABEL, "ocr-ready", ())
        .map_err(|error| format!("无法初始化翻译窗口：{error}"))
}

fn report_capture_status(app: &tauri::AppHandle, message: impl Into<String>) {
    let message = message.into();
    show_settings(app);

    if let Err(error) = app.emit_to(SETTINGS_WINDOW_LABEL, "capture-status", message) {
        eprintln!("failed to report capture status: {error}");
    }
}

#[cfg(target_os = "macos")]
fn begin_capture(app: &tauri::AppHandle) {
    let state = app.state::<CaptureState>();
    if !macos_capture::has_permission() {
        let should_request = !state
            .permission_prompt_requested
            .swap(true, Ordering::AcqRel);
        if should_request {
            let _ = macos_capture::request_permission();
        }
    }
    if !macos_capture::has_permission() {
        #[cfg(debug_assertions)]
        let permission_message = "当前 Debug App 的屏幕录制授权无效。若刚重新构建或替换过应用，请完全退出应用，运行 `npm run reset:macos:screen-capture`，重新启动并授权，然后再次重启应用。";
        #[cfg(not(debug_assertions))]
        let permission_message = "需要屏幕录制权限。请在“系统设置 → 隐私与安全性 → 屏幕与系统音频录制”中允许 OpenScreenTranslate，然后完全退出并重新打开应用。当前进程不会重复弹出授权窗口。";
        report_capture_status(app, permission_message);
        return;
    }

    if state.in_progress.swap(true, Ordering::AcqRel) {
        #[cfg(debug_assertions)]
        eprintln!("screen capture is already in progress");
        return;
    }

    show_capture_overlay(app);
}

#[cfg(not(target_os = "macos"))]
fn begin_capture(app: &tauri::AppHandle) {
    report_capture_status(app, "当前版本只支持 macOS 屏幕截图。");
}

fn begin_capture_after_menu(app: &tauri::AppHandle) {
    let app = app.clone();

    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(MENU_DISMISS_DELAY_MS));

        let callback_app = app.clone();
        if let Err(error) = app.run_on_main_thread(move || begin_capture(&callback_app)) {
            eprintln!("failed to schedule capture after tray menu: {error}");
        }
    });
}

fn begin_manual_translation_after_menu(app: &tauri::AppHandle) {
    let app = app.clone();

    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(MENU_DISMISS_DELAY_MS));
        let callback_app = app.clone();
        if let Err(error) = app.run_on_main_thread(move || {
            if let Err(error) = begin_manual_translation(&callback_app) {
                eprintln!("failed to open translation window: {error}");
            }
        }) {
            eprintln!("failed to schedule translation window: {error}");
        }
    });
}

fn hide_capture_overlay(app: &tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(CAPTURE_WINDOW_LABEL)
        .ok_or_else(|| "capture window is not available".to_string())?;

    window
        .hide()
        .map_err(|error| format!("failed to hide capture window: {error}"))
}

fn selection_to_pixel_rect(
    selection: CaptureSelection,
    pixel_width: usize,
    pixel_height: usize,
) -> [f64; 4] {
    let scale_x = pixel_width as f64 / selection.viewport_width;
    let scale_y = pixel_height as f64 / selection.viewport_height;
    [
        selection.x * scale_x,
        selection.y * scale_y,
        selection.width * scale_x,
        selection.height * scale_y,
    ]
}

#[cfg(target_os = "macos")]
fn capture_selected_area(app: &tauri::AppHandle, selection: CaptureSelection) {
    let app = app.clone();
    std::thread::spawn(move || {
        // Give WindowServer time to remove the transparent selection window
        // before asking ScreenCaptureKit for the final frame.
        std::thread::sleep(std::time::Duration::from_millis(40));

        let output_path = std::env::temp_dir().join(format!(
            "openscreentranslate-capture-{}.png",
            std::process::id()
        ));
        let capture = macos_capture::capture_display_to_png(&output_path).and_then(|metadata| {
            let png = std::fs::read(&output_path)
                .map_err(|error| format!("failed to read captured PNG: {error}"))?;
            let crop_rect =
                selection_to_pixel_rect(selection, metadata.pixel_width, metadata.pixel_height);
            Ok((png, crop_rect))
        });

        if let Err(error) = std::fs::remove_file(&output_path) {
            if error.kind() != std::io::ErrorKind::NotFound {
                eprintln!("failed to remove temporary capture: {error}");
            }
        }

        app.state::<CaptureState>()
            .in_progress
            .store(false, Ordering::Release);

        match capture {
            Ok((png, crop_rect)) => {
                #[cfg(debug_assertions)]
                eprintln!(
                    "selection captured: crop=({:.0}, {:.0}, {:.0}, {:.0})",
                    crop_rect[0], crop_rect[1], crop_rect[2], crop_rect[3]
                );
                let callback_app = app.clone();
                if let Err(error) = app.run_on_main_thread(move || {
                    start_ocr(&callback_app, png, crop_rect);
                }) {
                    eprintln!("failed to schedule OCR after capture: {error}");
                }
            }
            Err(error) => {
                let callback_app = app.clone();
                if let Err(schedule_error) = app.run_on_main_thread(move || {
                    report_capture_status(&callback_app, format!("屏幕截图失败：{error}"));
                }) {
                    eprintln!("failed to report screen capture error: {schedule_error}");
                }
            }
        }
    });
}

#[cfg(not(target_os = "macos"))]
fn capture_selected_area(app: &tauri::AppHandle, _selection: CaptureSelection) {
    app.state::<CaptureState>()
        .in_progress
        .store(false, Ordering::Release);
    let _ = app.emit_to(
        RESULT_WINDOW_LABEL,
        "ocr-error",
        "当前版本只支持 macOS 截图",
    );
}

fn translate_ocr_result(
    app: &tauri::AppHandle,
    request_id: u64,
    translation_generation: u64,
    source_text: String,
    source_language: String,
    target_language: String,
) {
    let started_at = std::time::Instant::now();
    let translation_result = (|| {
        if source_text.trim().is_empty() {
            return Ok(translation::TranslationOutput {
                text: String::new(),
                prompt_tokens: None,
                completion_tokens: None,
            });
        }

        let (provider, request_config) = {
            let settings_state = app.state::<SettingsState>();
            let settings = settings_state
                .0
                .lock()
                .map_err(|_| "无法读取翻译设置".to_string())?;
            (
                settings.translation_provider.clone(),
                settings
                    .provider_request_configs
                    .get(&settings.translation_provider)
                    .cloned()
                    .unwrap_or(translation::default_request_config(
                        &settings.translation_provider,
                    )?),
            )
        };

        let provider_name = translation::provider_name(&provider)?;
        let api_key = credential_store::read_api_key(&provider)?
            .ok_or_else(|| format!("尚未配置 {provider_name} API Key，请先在设置中保存 Key"))?;

        translation::translate(
            &provider,
            &api_key,
            &source_text,
            &source_language,
            &target_language,
            &request_config,
        )
    })();

    let state = app.state::<CaptureState>();
    let mut current_result = match state.ocr_result.lock() {
        Ok(result) => result,
        Err(_) => {
            eprintln!("failed to store translation: OCR result mutex poisoned");
            return;
        }
    };
    let Some(result) = current_result.as_mut() else {
        return;
    };
    if result.request_id != request_id || result.translation_generation != translation_generation {
        #[cfg(debug_assertions)]
        eprintln!(
            "discarded superseded translation: request={request_id}, generation={translation_generation}"
        );
        return;
    }

    let event_name = match translation_result {
        Ok(output) => {
            if cfg!(debug_assertions) {
                eprintln!(
                    "translation completed: request={request_id}, source_chars={}, translated_chars={}, prompt_tokens={}, completion_tokens={}, elapsed_ms={}",
                    source_text.chars().count(),
                    output.text.chars().count(),
                    output
                        .prompt_tokens
                        .map_or_else(|| "unknown".to_string(), |tokens| tokens.to_string()),
                    output
                        .completion_tokens
                        .map_or_else(|| "unknown".to_string(), |tokens| tokens.to_string()),
                    started_at.elapsed().as_millis()
                );
            }
            result.translation_text = Some(output.text);
            result.translation_error = None;
            "translation-ready"
        }
        Err(error) => {
            eprintln!(
                "translation failed: request={request_id}, elapsed_ms={}, error={error}",
                started_at.elapsed().as_millis()
            );
            result.translation_text = None;
            result.translation_error = Some(error);
            "translation-error"
        }
    };
    drop(current_result);

    if let Err(error) = app.emit_to(RESULT_WINDOW_LABEL, event_name, ()) {
        eprintln!("failed to notify translation result window: {error}");
    }
}

fn spawn_translation(
    app: &tauri::AppHandle,
    request_id: u64,
    translation_generation: u64,
    source_text: String,
    source_language: String,
    target_language: String,
) {
    let app = app.clone();
    std::thread::spawn(move || {
        translate_ocr_result(
            &app,
            request_id,
            translation_generation,
            source_text,
            source_language,
            target_language,
        );
    });
}

#[cfg(target_os = "macos")]
fn start_ocr(app: &tauri::AppHandle, source_png: Vec<u8>, crop_rect: [f64; 4]) {
    let state = app.state::<CaptureState>();
    if state.ocr_in_progress.swap(true, Ordering::AcqRel) {
        let _ = app.emit_to(RESULT_WINDOW_LABEL, "ocr-error", "已有 OCR 任务正在处理");
        return;
    }

    let request_id = state.next_request_id.fetch_add(1, Ordering::AcqRel) + 1;
    *state.ocr_result.lock().expect("OCR result mutex poisoned") = None;
    show_result_window(app);

    let app = app.clone();
    std::thread::spawn(move || {
        let process_id = std::process::id();
        let temp_directory = std::env::temp_dir();
        let input_path = temp_directory.join(format!("openscreentranslate-ocr-{process_id}.png"));
        let crop_path =
            temp_directory.join(format!("openscreentranslate-ocr-crop-{process_id}.png"));
        let text_path =
            temp_directory.join(format!("openscreentranslate-ocr-text-{process_id}.txt"));

        let ocr_result = std::fs::write(&input_path, source_png)
            .map_err(|error| format!("failed to prepare image for OCR: {error}"))
            .and_then(|()| {
                macos_capture::crop_and_recognize_text(
                    &input_path,
                    &crop_path,
                    &text_path,
                    crop_rect,
                )
            })
            .and_then(|()| {
                let source_text = truncate_source_text(
                    std::fs::read_to_string(&text_path)
                        .map_err(|error| format!("failed to read recognized text: {error}"))?,
                );
                let target_language = app
                    .state::<SettingsState>()
                    .0
                    .lock()
                    .map_err(|_| "无法读取默认翻译语言".to_string())?
                    .target_language
                    .clone();
                Ok(OcrResult {
                    request_id,
                    source_text,
                    manual_input: false,
                    source_language: "auto".to_string(),
                    target_language,
                    translation_generation: 1,
                    translation_text: None,
                    translation_error: None,
                })
            });

        for path in [&input_path, &crop_path, &text_path] {
            if let Err(error) = std::fs::remove_file(path) {
                if error.kind() != std::io::ErrorKind::NotFound {
                    eprintln!("failed to remove temporary OCR file: {error}");
                }
            }
        }

        match ocr_result {
            Ok(result) => {
                #[cfg(debug_assertions)]
                eprintln!(
                    "OCR completed: request={request_id}, characters={}",
                    result.source_text.chars().count()
                );

                let source_text = result.source_text.clone();
                let source_language = result.source_language.clone();
                let target_language = result.target_language.clone();
                let translation_generation = result.translation_generation;
                let capture_state = app.state::<CaptureState>();
                let mut current_result = capture_state
                    .ocr_result
                    .lock()
                    .expect("OCR result mutex poisoned");
                if current_result
                    .as_ref()
                    .is_some_and(|current| current.request_id > request_id)
                {
                    #[cfg(debug_assertions)]
                    eprintln!("discarded superseded OCR result: request={request_id}");
                    capture_state
                        .ocr_in_progress
                        .store(false, Ordering::Release);
                    return;
                }
                *current_result = Some(result);
                drop(current_result);
                if let Err(error) = app.emit_to(RESULT_WINDOW_LABEL, "ocr-ready", ()) {
                    eprintln!("failed to notify OCR result window: {error}");
                }
                app.state::<CaptureState>()
                    .ocr_in_progress
                    .store(false, Ordering::Release);
                spawn_translation(
                    &app,
                    request_id,
                    translation_generation,
                    source_text,
                    source_language,
                    target_language,
                );
            }
            Err(error) => {
                app.state::<CaptureState>()
                    .ocr_in_progress
                    .store(false, Ordering::Release);
                eprintln!("OCR failed: {error}");
                if let Err(emit_error) = app.emit_to(RESULT_WINDOW_LABEL, "ocr-error", error) {
                    eprintln!("failed to report OCR error: {emit_error}");
                }
            }
        }
    });
}

#[cfg(not(target_os = "macos"))]
fn start_ocr(app: &tauri::AppHandle, _source_png: Vec<u8>, _crop_rect: [f64; 4]) {
    let _ = app.emit_to(RESULT_WINDOW_LABEL, "ocr-error", "当前版本只支持 macOS OCR");
}

#[tauri::command]
fn cancel_selection(app: tauri::AppHandle) -> Result<(), String> {
    hide_capture_overlay(&app)?;
    app.state::<CaptureState>()
        .in_progress
        .store(false, Ordering::Release);
    Ok(())
}

#[tauri::command]
fn screen_capture_permission_granted() -> bool {
    #[cfg(target_os = "macos")]
    {
        macos_capture::has_permission()
    }

    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

#[tauri::command]
fn request_screen_capture_permission(app: tauri::AppHandle) -> bool {
    #[cfg(target_os = "macos")]
    {
        app.state::<CaptureState>()
            .permission_prompt_requested
            .store(true, Ordering::Release);
        let _ = macos_capture::request_permission();
        macos_capture::has_permission()
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        false
    }
}

#[tauri::command]
fn open_screen_capture_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        macos_capture::open_permission_settings()
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("当前版本只支持 macOS 屏幕录制权限设置".to_string())
    }
}

fn configured_providers_from_credentials() -> Result<Vec<String>, String> {
    translation::SUPPORTED_PROVIDERS
        .into_iter()
        .filter_map(|provider| match credential_store::read_api_key(provider) {
            Ok(Some(_)) => Some(Ok(provider.to_string())),
            Ok(None) => None,
            Err(error) => Some(Err(error)),
        })
        .collect()
}

fn startup_readiness(state: &SettingsState) -> Result<StartupReadiness, String> {
    let settings = state.0.lock().map_err(|_| "设置状态锁已损坏".to_string())?;
    let provider = settings.translation_provider.clone();
    let onboarding_completed = settings.onboarding_completed;
    drop(settings);

    let api_key_configured = credential_store::read_api_key(&provider)?.is_some();
    Ok(StartupReadiness {
        screen_capture_permission_granted: screen_capture_permission_granted(),
        api_key_configured,
        onboarding_completed,
        provider,
    })
}

#[tauri::command]
fn get_startup_readiness(state: State<'_, SettingsState>) -> Result<StartupReadiness, String> {
    startup_readiness(&state)
}

#[tauri::command]
fn complete_onboarding(
    app: tauri::AppHandle,
    state: State<'_, SettingsState>,
) -> Result<(), String> {
    let readiness = startup_readiness(&state)?;
    if !readiness.screen_capture_permission_granted {
        return Err("请先授予屏幕录制权限".to_string());
    }
    if !readiness.api_key_configured {
        return Err("请先配置当前 AI 服务的 API Key".to_string());
    }

    let mut current_settings = state.0.lock().map_err(|_| "设置状态锁已损坏".to_string())?;
    let mut settings = current_settings.clone();
    settings.onboarding_completed = true;
    persist_app_settings(&app, &settings)?;
    *current_settings = settings;

    if let Some(window) = app.get_webview_window(SETTINGS_WINDOW_LABEL) {
        if let Err(error) = window.hide() {
            eprintln!("failed to hide completed onboarding window: {error}");
        }
    }
    Ok(())
}

#[tauri::command]
fn get_translation_settings(
    state: State<'_, SettingsState>,
) -> Result<TranslationSettingsSnapshot, String> {
    let configured_providers = configured_providers_from_credentials()?;
    state
        .0
        .lock()
        .map_err(|_| "设置状态锁已损坏".to_string())
        .map(|settings| TranslationSettingsSnapshot {
            target_language: settings.target_language.clone(),
            provider: settings.translation_provider.clone(),
            configured_providers,
            provider_configs: settings.provider_request_configs.clone(),
        })
}

#[tauri::command]
fn save_translation_settings(
    app: tauri::AppHandle,
    state: State<'_, SettingsState>,
    settings: TranslationSettings,
) -> Result<(), String> {
    validate_translation_settings(&settings)?;

    let mut current_settings = state.0.lock().map_err(|_| "设置状态锁已损坏".to_string())?;
    let mut stored_settings = current_settings.clone();
    stored_settings.target_language = settings.target_language;
    stored_settings.translation_provider = settings.provider.clone();
    stored_settings.provider_request_configs.insert(
        settings.provider,
        translation::ProviderRequestConfig {
            model: settings.model.trim().to_string(),
            base_url: settings.base_url.trim().to_string(),
        },
    );
    persist_app_settings(&app, &stored_settings)?;
    *current_settings = stored_settings;
    Ok(())
}

#[tauri::command]
fn get_launch_at_login(app: tauri::AppHandle) -> Result<bool, String> {
    launch_at_login_enabled(&app)
}

#[tauri::command]
fn set_launch_at_login(
    app: tauri::AppHandle,
    state: State<'_, SettingsState>,
    enabled: bool,
) -> Result<(), String> {
    apply_launch_at_login(&app, enabled)?;

    let mut current_settings = state.0.lock().map_err(|_| "设置状态锁已损坏".to_string())?;
    let mut settings = current_settings.clone();
    settings.launch_at_login = Some(enabled);
    persist_app_settings(&app, &settings)?;
    *current_settings = settings;
    Ok(())
}

#[tauri::command]
fn get_capture_shortcut(
    settings_state: State<'_, SettingsState>,
    shortcut_state: State<'_, ShortcutRuntimeState>,
) -> Result<CaptureShortcutStatus, String> {
    let shortcut = settings_state
        .0
        .lock()
        .map_err(|_| "设置状态锁已损坏".to_string())?
        .capture_shortcut
        .clone();
    let registration = shortcut_state
        .0
        .lock()
        .map_err(|_| "快捷键状态锁已损坏".to_string())?;
    let normalized = normalize_capture_shortcut(&shortcut).ok();
    Ok(CaptureShortcutStatus {
        registered: normalized.as_deref() == registration.registered_shortcut.as_deref(),
        shortcut: normalized.unwrap_or(shortcut),
        error: registration.error.clone(),
    })
}

#[tauri::command]
fn set_capture_shortcut(
    app: tauri::AppHandle,
    state: State<'_, SettingsState>,
    shortcut: String,
) -> Result<CaptureShortcutStatus, String> {
    let previous = state
        .0
        .lock()
        .map_err(|_| "设置状态锁已损坏".to_string())?
        .capture_shortcut
        .clone();
    let shortcut = replace_capture_shortcut(&app, &shortcut)?;

    let mut current_settings = state.0.lock().map_err(|_| "设置状态锁已损坏".to_string())?;
    let mut settings = current_settings.clone();
    settings.capture_shortcut = shortcut.clone();
    if let Err(error) = persist_app_settings(&app, &settings) {
        drop(current_settings);
        let rollback_result = replace_capture_shortcut(&app, &previous);
        return match rollback_result {
            Ok(_) => Err(error),
            Err(rollback_error) => Err(format!("{error}；同时无法恢复原快捷键：{rollback_error}")),
        };
    }
    *current_settings = settings;

    Ok(CaptureShortcutStatus {
        shortcut,
        registered: true,
        error: None,
    })
}

#[tauri::command]
fn get_translation_shortcut(
    settings_state: State<'_, SettingsState>,
    shortcut_state: State<'_, TranslationShortcutRuntimeState>,
) -> Result<CaptureShortcutStatus, String> {
    let shortcut = settings_state
        .0
        .lock()
        .map_err(|_| "设置状态锁已损坏".to_string())?
        .translation_shortcut
        .clone();
    let registration = shortcut_state
        .0
        .lock()
        .map_err(|_| "快捷键状态锁已损坏".to_string())?;
    let normalized = normalize_capture_shortcut(&shortcut).ok();
    Ok(CaptureShortcutStatus {
        registered: normalized.as_deref() == registration.registered_shortcut.as_deref(),
        shortcut: normalized.unwrap_or(shortcut),
        error: registration.error.clone(),
    })
}

#[tauri::command]
fn set_translation_shortcut(
    app: tauri::AppHandle,
    state: State<'_, SettingsState>,
    shortcut: String,
) -> Result<CaptureShortcutStatus, String> {
    let previous = state
        .0
        .lock()
        .map_err(|_| "设置状态锁已损坏".to_string())?
        .translation_shortcut
        .clone();
    let shortcut = replace_translation_shortcut(&app, &shortcut)?;

    let mut current_settings = state.0.lock().map_err(|_| "设置状态锁已损坏".to_string())?;
    let mut settings = current_settings.clone();
    settings.translation_shortcut = shortcut.clone();
    if let Err(error) = persist_app_settings(&app, &settings) {
        drop(current_settings);
        let rollback_result = replace_translation_shortcut(&app, &previous);
        return match rollback_result {
            Ok(_) => Err(error),
            Err(rollback_error) => Err(format!("{error}；同时无法恢复原快捷键：{rollback_error}")),
        };
    }
    *current_settings = settings;

    Ok(CaptureShortcutStatus {
        shortcut,
        registered: true,
        error: None,
    })
}

#[tauri::command]
fn save_provider_api_key(
    app: tauri::AppHandle,
    state: State<'_, SettingsState>,
    provider: String,
    api_key: String,
) -> Result<(), String> {
    if !translation::is_supported_provider(&provider) {
        return Err("不支持所选的 AI 供应商".to_string());
    }
    credential_store::save_api_key(&provider, &api_key)?;

    let mut current_settings = state.0.lock().map_err(|_| "设置状态锁已损坏".to_string())?;
    let mut settings = current_settings.clone();
    if !settings
        .configured_providers
        .iter()
        .any(|configured| configured == &provider)
    {
        settings.configured_providers.push(provider);
        settings.configured_providers.sort();
    }
    persist_app_settings(&app, &settings)?;
    *current_settings = settings;
    Ok(())
}

#[tauri::command]
fn delete_provider_api_key(
    app: tauri::AppHandle,
    state: State<'_, SettingsState>,
    provider: String,
) -> Result<(), String> {
    if !translation::is_supported_provider(&provider) {
        return Err("不支持所选的 AI 供应商".to_string());
    }
    credential_store::delete_api_key(&provider)?;

    let mut current_settings = state.0.lock().map_err(|_| "设置状态锁已损坏".to_string())?;
    let mut settings = current_settings.clone();
    settings
        .configured_providers
        .retain(|configured| configured != &provider);
    persist_app_settings(&app, &settings)?;
    *current_settings = settings;
    Ok(())
}

#[tauri::command]
fn get_ocr_text(state: State<'_, CaptureState>) -> Result<SourceTextSnapshot, String> {
    let result = state
        .ocr_result
        .lock()
        .map_err(|_| "OCR result mutex poisoned".to_string())?;
    let result = result
        .as_ref()
        .ok_or_else(|| "OCR is still processing".to_string())?;

    Ok(SourceTextSnapshot {
        text: result.source_text.clone(),
        manual_input: result.manual_input,
    })
}

#[tauri::command]
fn get_translation_result(state: State<'_, CaptureState>) -> Result<TranslationSnapshot, String> {
    let result = state
        .ocr_result
        .lock()
        .map_err(|_| "OCR result mutex poisoned".to_string())?;
    let result = result
        .as_ref()
        .ok_or_else(|| "OCR is still processing".to_string())?;

    if let Some(error) = &result.translation_error {
        return Ok(TranslationSnapshot {
            status: "error".to_string(),
            text: None,
            error: Some(error.clone()),
            source_language: result.source_language.clone(),
            target_language: result.target_language.clone(),
            manual_input: result.manual_input,
        });
    }
    if let Some(text) = &result.translation_text {
        return Ok(TranslationSnapshot {
            status: if result.source_text.trim().is_empty() {
                "empty"
            } else {
                "ready"
            }
            .to_string(),
            text: Some(text.clone()),
            error: None,
            source_language: result.source_language.clone(),
            target_language: result.target_language.clone(),
            manual_input: result.manual_input,
        });
    }

    Ok(TranslationSnapshot {
        status: "processing".to_string(),
        text: None,
        error: None,
        source_language: result.source_language.clone(),
        target_language: result.target_language.clone(),
        manual_input: result.manual_input,
    })
}

#[tauri::command]
fn open_manual_translation(app: tauri::AppHandle) -> Result<(), String> {
    begin_manual_translation(&app)
}

#[tauri::command]
fn retranslate(
    app: tauri::AppHandle,
    settings_state: State<'_, SettingsState>,
    capture_state: State<'_, CaptureState>,
    source_text: String,
    source_language: String,
    target_language: String,
) -> Result<(), String> {
    if source_text_utf16_len(&source_text) > MAX_SOURCE_TEXT_UTF16_UNITS {
        return Err(format!("原文不能超过 {MAX_SOURCE_TEXT_UTF16_UNITS} 个字符"));
    }
    if !translation::is_supported_source_language(&source_language) {
        return Err("不支持所选的源语言".to_string());
    }
    if !translation::is_supported_target_language(&target_language) {
        return Err("不支持所选的目标语言".to_string());
    }

    {
        let mut current_settings = settings_state
            .0
            .lock()
            .map_err(|_| "设置状态锁已损坏".to_string())?;
        if current_settings.target_language != target_language {
            let mut settings = current_settings.clone();
            settings.target_language = target_language.clone();
            persist_app_settings(&app, &settings)?;
            *current_settings = settings;
        }
    }

    let (request_id, translation_generation, source_text) = {
        let mut current_result = capture_state
            .ocr_result
            .lock()
            .map_err(|_| "OCR result mutex poisoned".to_string())?;
        let result = current_result
            .as_mut()
            .ok_or_else(|| "OCR 仍在处理中".to_string())?;
        result.source_text = source_text;
        result.translation_generation = result.translation_generation.saturating_add(1);
        result.source_language = source_language.clone();
        result.target_language = target_language.clone();
        result.translation_text = None;
        result.translation_error = None;
        (
            result.request_id,
            result.translation_generation,
            result.source_text.clone(),
        )
    };

    spawn_translation(
        &app,
        request_id,
        translation_generation,
        source_text,
        source_language,
        target_language,
    );
    Ok(())
}

#[tauri::command]
fn copy_text_to_clipboard(text: String) -> Result<(), String> {
    if text.is_empty() {
        return Err("没有可复制的译文".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        macos_capture::copy_text_to_clipboard(&text)
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("当前版本只支持 macOS 剪贴板".to_string())
    }
}

#[tauri::command]
fn log_capture_viewport(_width: f64, _height: f64, _device_pixel_ratio: f64) {
    #[cfg(debug_assertions)]
    eprintln!("capture viewport ready: css={_width:.1}x{_height:.1}, dpr={_device_pixel_ratio:.2}");
}

#[tauri::command]
fn complete_selection(
    app: tauri::AppHandle,
    state: State<'_, CaptureState>,
    selection: CaptureSelection,
) -> Result<(), String> {
    if !state.in_progress.load(Ordering::Acquire) {
        return Err("当前没有进行中的截图选区".to_string());
    }
    let CaptureSelection {
        x,
        y,
        width,
        height,
        viewport_width,
        viewport_height,
    } = selection;
    let values = [x, y, width, height, viewport_width, viewport_height];
    if values.iter().any(|value| !value.is_finite())
        || width < 1.0
        || height < 1.0
        || viewport_width < 1.0
        || viewport_height < 1.0
    {
        return Err("invalid capture selection".to_string());
    }

    hide_capture_overlay(&app)?;
    capture_selected_area(&app, selection);
    Ok(())
}

fn create_tray_menu(
    app: &tauri::AppHandle,
    capture_shortcut: &str,
    translation_shortcut: &str,
) -> tauri::Result<Menu<tauri::Wry>> {
    let capture = MenuItem::with_id(app, "capture", "截图并翻译", true, Some(capture_shortcut))?;
    let translate = MenuItem::with_id(app, "translate", "翻译", true, Some(translation_shortcut))?;
    let capture_separator = PredefinedMenuItem::separator(app)?;
    let settings = MenuItem::with_id(app, "settings", "设置…", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    Menu::with_items(
        app,
        &[
            &capture,
            &translate,
            &capture_separator,
            &settings,
            &separator,
            &quit,
        ],
    )
}

fn build_tray(
    app: &tauri::App,
    capture_shortcut: &str,
    translation_shortcut: &str,
) -> tauri::Result<()> {
    let menu = create_tray_menu(app.handle(), capture_shortcut, translation_shortcut)?;

    let _tray = TrayIconBuilder::with_id(TRAY_ICON_ID)
        .icon(TRAY_ICON)
        .icon_as_template(true)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .tooltip("OpenScreenTranslate")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "capture" => begin_capture_after_menu(app),
            "translate" => begin_manual_translation_after_menu(app),
            "settings" => show_settings(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    #[cfg(debug_assertions)]
    eprintln!("tray icon created");

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut app = tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let pressed = shortcut.to_string();
                        let is_translation =
                            shortcut_runtime_snapshot(app, ShortcutKind::Translation)
                                .ok()
                                .and_then(|snapshot| snapshot.0)
                                .is_some_and(|registered| registered == pressed);
                        if is_translation {
                            if let Err(error) = begin_manual_translation(app) {
                                eprintln!("failed to open translation window: {error}");
                            }
                        } else {
                            begin_capture(app);
                        }
                    }
                })
                .build(),
        )
        .manage(CaptureState::default())
        .manage(SettingsState::default())
        .manage(ShortcutRuntimeState::default())
        .manage(TranslationShortcutRuntimeState::default())
        .manage(StartupWindowState::default())
        .invoke_handler(tauri::generate_handler![
            cancel_selection,
            complete_onboarding,
            complete_selection,
            copy_text_to_clipboard,
            delete_provider_api_key,
            get_capture_shortcut,
            get_ocr_text,
            get_startup_readiness,
            get_translation_shortcut,
            get_translation_result,
            get_translation_settings,
            get_launch_at_login,
            log_capture_viewport,
            open_screen_capture_settings,
            open_manual_translation,
            retranslate,
            request_screen_capture_permission,
            save_provider_api_key,
            save_translation_settings,
            set_capture_shortcut,
            set_launch_at_login,
            set_main_window_layout,
            set_translation_shortcut,
            screen_capture_permission_granted
        ])
        .setup(|app| {
            let is_first_launch = match settings_file_path(app.handle()) {
                Ok(path) => !path.exists(),
                Err(error) => {
                    eprintln!("failed to determine whether this is the first launch: {error}");
                    false
                }
            };
            let mut settings = match load_app_settings(app.handle()) {
                Ok(settings) => settings,
                Err(error) => {
                    eprintln!("failed to load translation settings: {error}");
                    AppSettings::default()
                }
            };

            // Missing values from older settings use the disabled default. Explicit user choices
            // are preserved and reconciled with the macOS login item state.
            let launch_at_login_was_missing = settings.launch_at_login.is_none();
            let launch_at_login = desired_launch_at_login(settings.launch_at_login);
            settings.launch_at_login = Some(launch_at_login);
            match launch_at_login_enabled(app.handle()) {
                Ok(actual) if actual != launch_at_login => {
                    if let Err(error) = apply_launch_at_login(app.handle(), launch_at_login) {
                        eprintln!("failed to apply saved autostart setting: {error}");
                    }
                }
                Ok(_) => {}
                Err(error) => eprintln!("failed to read saved autostart setting: {error}"),
            }

            // Persist defaults on first launch and initialize older autostart settings.
            if is_first_launch || launch_at_login_was_missing {
                if let Err(error) = persist_app_settings(app.handle(), &settings) {
                    eprintln!("failed to persist first-launch settings: {error}");
                }
            }

            let capture_shortcut = settings.capture_shortcut.clone();
            let translation_shortcut = settings.translation_shortcut.clone();
            let screen_capture_permission_granted = screen_capture_permission_granted();
            let api_key_configured = credential_store::read_api_key(&settings.translation_provider)
                .map(|key| key.is_some())
                .unwrap_or_else(|error| {
                    eprintln!("failed to read the selected provider credential: {error}");
                    false
                });
            let show_onboarding = should_show_onboarding_on_launch(
                settings.onboarding_completed,
                screen_capture_permission_granted,
                api_key_configured,
            );
            *app.state::<SettingsState>()
                .0
                .lock()
                .map_err(|_| "settings state mutex poisoned")? = settings;

            #[cfg(target_os = "macos")]
            {
                let capture_window = app
                    .get_webview_window(CAPTURE_WINDOW_LABEL)
                    .ok_or("capture window is not available during setup")?;
                macos_capture::configure_capture_window(capture_window.ns_window()?);

                let result_window = app
                    .get_webview_window(RESULT_WINDOW_LABEL)
                    .ok_or("result window is not available during setup")?;
                macos_capture::configure_result_window(result_window.ns_window()?);
            }

            build_tray(app, &capture_shortcut, &translation_shortcut)?;
            match replace_capture_shortcut(app.handle(), &capture_shortcut) {
                Ok(_shortcut) => {
                    #[cfg(debug_assertions)]
                    eprintln!("global shortcut registered: {_shortcut}");
                }
                Err(error) => {
                    // A shortcut conflict must not prevent the tray app from starting. The
                    // settings page reports the failure and lets the user choose another one.
                    set_shortcut_runtime_state(
                        app.handle(),
                        ShortcutKind::Capture,
                        None,
                        Some(error.clone()),
                    )?;
                    eprintln!("capture shortcut unavailable: {error}");
                }
            }
            match replace_translation_shortcut(app.handle(), &translation_shortcut) {
                Ok(_shortcut) => {
                    #[cfg(debug_assertions)]
                    eprintln!("translation shortcut registered: {_shortcut}");
                }
                Err(error) => {
                    set_shortcut_runtime_state(
                        app.handle(),
                        ShortcutKind::Translation,
                        None,
                        Some(error.clone()),
                    )?;
                    eprintln!("translation shortcut unavailable: {error}");
                }
            }

            app.state::<StartupWindowState>()
                .0
                .store(show_onboarding, Ordering::Release);

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if matches!(
                    window.label(),
                    SETTINGS_WINDOW_LABEL | CAPTURE_WINDOW_LABEL | RESULT_WINDOW_LABEL
                ) {
                    api.prevent_close();
                    if let Err(error) = window.hide() {
                        eprintln!("failed to hide {} window: {error}", window.label());
                    }
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    #[cfg(target_os = "macos")]
    {
        // Builder::run is only a build/run shorthand. Set these on App while it still owns the
        // runtime so Tao's first activation policy is Accessory, before applicationDidFinishLaunching
        // and before Tauri creates any configured windows or invokes the setup callback.
        app.set_activation_policy(tauri::ActivationPolicy::Accessory);
        app.set_dock_visibility(false);
    }

    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Ready) {
            let show_onboarding = app_handle
                .state::<StartupWindowState>()
                .0
                .swap(false, Ordering::AcqRel);
            if show_onboarding {
                show_settings(app_handle);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{
        desired_launch_at_login, manual_translation_result, normalize_app_settings,
        normalize_capture_shortcut, selection_to_pixel_rect, should_show_onboarding_on_launch,
        source_text_utf16_len, truncate_source_text, AppSettings, CaptureSelection,
        DEFAULT_CAPTURE_SHORTCUT, DEFAULT_TRANSLATION_SHORTCUT, MAX_SOURCE_TEXT_UTF16_UNITS,
    };

    #[test]
    fn onboarding_is_shown_until_every_required_condition_is_ready() {
        assert!(should_show_onboarding_on_launch(false, true, true));
        assert!(should_show_onboarding_on_launch(true, false, true));
        assert!(should_show_onboarding_on_launch(true, true, false));
        assert!(!should_show_onboarding_on_launch(true, true, true));
    }

    #[test]
    fn new_install_defaults_disable_launch_at_login() {
        assert!(!AppSettings::default().onboarding_completed);
        assert_eq!(AppSettings::default().launch_at_login, Some(false));
        assert!(!desired_launch_at_login(None));
        assert!(desired_launch_at_login(Some(true)));
    }

    #[test]
    fn source_text_is_truncated_to_the_request_limit() {
        let source = "译".repeat(MAX_SOURCE_TEXT_UTF16_UNITS + 1);
        let truncated = truncate_source_text(source);

        assert_eq!(
            source_text_utf16_len(&truncated),
            MAX_SOURCE_TEXT_UTF16_UNITS
        );
    }

    #[test]
    fn manual_translation_starts_with_an_editable_empty_source() {
        let result = manual_translation_result(42, "ja".to_string());

        assert_eq!(result.request_id, 42);
        assert!(result.manual_input);
        assert!(result.source_text.is_empty());
        assert_eq!(result.source_language, "auto");
        assert_eq!(result.target_language, "ja");
        assert_eq!(result.translation_text.as_deref(), Some(""));
        assert_eq!(result.translation_generation, 0);
    }

    #[test]
    fn settings_from_older_versions_are_marked_for_autostart_initialization() {
        let settings: AppSettings =
            serde_json::from_str(r#"{"targetLanguage":"en"}"#).expect("settings should parse");

        assert_eq!(settings.target_language, "en");
        assert!(settings.onboarding_completed);
        assert_eq!(settings.launch_at_login, None);
        assert!(!settings.api_key_configured);
        assert_eq!(settings.capture_shortcut, DEFAULT_CAPTURE_SHORTCUT);
        assert_eq!(settings.translation_shortcut, DEFAULT_TRANSLATION_SHORTCUT);
    }

    #[test]
    fn explicit_autostart_choice_survives_a_settings_round_trip() {
        let settings: AppSettings =
            serde_json::from_str(r#"{"targetLanguage":"zh-CN","launchAtLogin":false}"#)
                .expect("settings should parse");
        let serialized = serde_json::to_string(&settings).expect("settings should serialize");
        let restored: AppSettings =
            serde_json::from_str(&serialized).expect("settings should parse again");

        assert_eq!(restored.launch_at_login, Some(false));
    }

    #[test]
    fn capture_shortcuts_are_normalized_and_require_a_primary_modifier() {
        assert_eq!(
            normalize_capture_shortcut(DEFAULT_CAPTURE_SHORTCUT)
                .expect("default shortcut should be valid"),
            "super+Digit1"
        );
        assert_eq!(
            normalize_capture_shortcut(DEFAULT_TRANSLATION_SHORTCUT)
                .expect("default shortcut should be valid"),
            "super+Digit2"
        );
        assert_eq!(
            normalize_capture_shortcut("Shift+2").expect_err("shift alone should not be accepted"),
            "快捷键必须包含 Command、Control 或 Option"
        );
    }

    #[test]
    fn capture_selection_is_scaled_from_viewport_points_to_image_pixels() {
        let selection = CaptureSelection {
            x: 100.0,
            y: 75.0,
            width: 320.0,
            height: 180.0,
            viewport_width: 1440.0,
            viewport_height: 900.0,
        };

        assert_eq!(
            selection_to_pixel_rect(selection, 2880, 1800),
            [200.0, 150.0, 640.0, 360.0]
        );
    }

    #[test]
    fn legacy_deepseek_key_status_migrates_to_provider_list() {
        let settings: AppSettings = serde_json::from_str(
            r#"{"targetLanguage":"zh-CN","apiKeyConfigured":true,"translationProvider":"unknown"}"#,
        )
        .expect("legacy settings should parse");
        let settings = normalize_app_settings(settings);

        assert_eq!(settings.translation_provider, "deepseek");
        assert_eq!(settings.configured_providers, vec!["deepseek"]);
        assert!(!settings.api_key_configured);
        assert_eq!(settings.provider_request_configs.len(), 5);
        assert!(settings.request_urls_are_complete);
    }

    #[test]
    fn custom_provider_request_config_survives_normalization() {
        let settings: AppSettings = serde_json::from_str(
            r#"{
                "targetLanguage":"zh-CN",
                "translationProvider":"openai",
                "providerRequestConfigs": {
                    "openai": {
                        "model":"vendor/custom-model:fast",
                        "baseUrl":"https://gateway.example.com/openai/v1/responses"
                    }
                }
            }"#,
        )
        .expect("custom request config should parse");
        let settings = normalize_app_settings(settings);

        assert_eq!(settings.provider_request_configs.len(), 5);
        let openai = settings
            .provider_request_configs
            .get("openai")
            .expect("OpenAI config should remain available");
        assert_eq!(openai.model, "vendor/custom-model:fast");
        assert_eq!(
            openai.base_url,
            "https://gateway.example.com/openai/v1/responses"
        );
    }

    #[test]
    fn compatible_service_config_survives_normalization() {
        let settings: AppSettings = serde_json::from_str(
            r#"{
                "targetLanguage":"zh-CN",
                "translationProvider":"compatible",
                "providerRequestConfigs": {
                    "compatible": {
                        "model":"vendor/model-fast",
                        "baseUrl":"https://gateway.example.com/v1/chat/completions"
                    }
                }
            }"#,
        )
        .expect("compatible service config should parse");
        let settings = normalize_app_settings(settings);

        assert_eq!(settings.translation_provider, "compatible");
        assert_eq!(
            settings.provider_request_configs["compatible"].model,
            "vendor/model-fast"
        );
        assert_eq!(
            settings.provider_request_configs["compatible"].base_url,
            "https://gateway.example.com/v1/chat/completions"
        );
    }

    #[test]
    fn legacy_base_url_is_completed_exactly_once() {
        let settings: AppSettings = serde_json::from_str(
            r#"{
                "targetLanguage":"zh-CN",
                "translationProvider":"openai",
                "providerRequestConfigs": {
                    "openai": {
                        "model":"custom-model",
                        "baseUrl":"https://gateway.example.com/openai/v1"
                    }
                }
            }"#,
        )
        .expect("legacy Base URL should parse");
        let settings = normalize_app_settings(settings);
        let settings = normalize_app_settings(settings);

        assert!(settings.request_urls_are_complete);
        assert_eq!(
            settings.provider_request_configs["openai"].base_url,
            "https://gateway.example.com/openai/v1/responses"
        );
    }

    #[test]
    fn complete_custom_request_url_is_not_modified() {
        let settings: AppSettings = serde_json::from_str(
            r#"{
                "targetLanguage":"zh-CN",
                "translationProvider":"openai",
                "requestUrlsAreComplete":true,
                "providerRequestConfigs": {
                    "openai": {
                        "model":"self-hosted/model:fast",
                        "baseUrl":"https://models.example.com/my/custom/infer/?api-version=42"
                    }
                }
            }"#,
        )
        .expect("complete request URL should parse");
        let settings = normalize_app_settings(settings);

        assert_eq!(
            settings.provider_request_configs["openai"].base_url,
            "https://models.example.com/my/custom/infer/?api-version=42"
        );
    }
}
