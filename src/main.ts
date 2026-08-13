import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import appIconUrl from "../src-tauri/icons/128x128.png";

const MAX_SOURCE_TEXT_LENGTH = 5000;

type Point = {
  x: number;
  y: number;
};

type Selection = Point & {
  width: number;
  height: number;
};

type ProviderId = "deepseek" | "openai" | "anthropic" | "gemini" | "compatible";
type LanguageCode =
  | "zh-CN"
  | "zh-TW"
  | "en"
  | "ja"
  | "ko"
  | "fr"
  | "de"
  | "es"
  | "ru"
  | "pt";
type SourceLanguageCode = "auto" | LanguageCode;

type ProviderRequestConfig = {
  model: string;
  baseUrl: string;
};

type TranslationSettings = {
  targetLanguage: LanguageCode;
  provider: ProviderId;
  configuredProviders: ProviderId[];
  providerConfigs: Record<ProviderId, ProviderRequestConfig>;
};

type StartupReadiness = {
  screenCapturePermissionGranted: boolean;
  apiKeyConfigured: boolean;
  onboardingCompleted: boolean;
  provider: ProviderId;
};

type ShortcutStatus = {
  shortcut: string;
  registered: boolean;
  error: string | null;
};

type SourceTextSnapshot = {
  text: string;
  manualInput: boolean;
};

type TranslationSnapshot = {
  requestId: number;
  translationGeneration: number;
  status: "processing" | "ready" | "empty" | "error";
  text: string | null;
  error: string | null;
  sourceLanguage: SourceLanguageCode;
  targetLanguage: LanguageCode;
  manualInput: boolean;
};

type TranslationProgress = {
  requestId: number;
  translationGeneration: number;
  text: string;
};

type TranslationRequestToken = {
  requestId: number;
  translationGeneration: number;
};

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`required element is missing: ${selector}`);
  }
  return element;
}

const app = requireElement<HTMLDivElement>("#app");
const APP_VERSION = __APP_VERSION__;
const DEFAULT_CAPTURE_SHORTCUT = "super+Digit1";
const DEFAULT_TRANSLATION_SHORTCUT = "super+Digit2";
const TRANSLATION_LANGUAGES: Array<{ value: LanguageCode; label: string }> = [
  { value: "zh-CN", label: "简体中文" },
  { value: "zh-TW", label: "繁体中文" },
  { value: "en", label: "英语" },
  { value: "ja", label: "日语" },
  { value: "ko", label: "韩语" },
  { value: "fr", label: "法语" },
  { value: "de", label: "德语" },
  { value: "es", label: "西班牙语" },
  { value: "ru", label: "俄语" },
  { value: "pt", label: "葡萄牙语" },
];

function languageOptions(includeAuto = false): string {
  return [
    ...(includeAuto ? [{ value: "auto", label: "自动检测" }] : []),
    ...TRANSLATION_LANGUAGES,
  ]
    .map(({ value, label }) => `<option value="${value}">${label}</option>`)
    .join("");
}
const PROVIDER_ICONS: Record<ProviderId, string> = {
  deepseek: `<svg viewBox="0 0 24 24" role="img" aria-label="DeepSeek"><path d="M23.748 4.651c-.254-.124-.364.113-.512.233-.051.04-.094.09-.137.137-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.155-.708-.311-.955-.65-.172-.24-.219-.509-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.094.172.187.129.323-.082.28-.18.553-.266.833-.055.179-.137.218-.328.14a5.5 5.5 0 0 1-1.737-1.179c-.857-.828-1.631-1.743-2.597-2.46a12 12 0 0 0-.689-.47c-.985-.957.13-1.743.387-1.836.27-.098.094-.433-.778-.428-.872.003-1.67.295-2.687.685a3 3 0 0 1-.465.136 9.6 9.6 0 0 0-2.883-.101c-1.885.21-3.39 1.1-4.497 2.622C.082 8.776-.231 10.854.152 13.02c.403 2.284 1.568 4.175 3.36 5.653 1.857 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.132-.284 4.994-1.86.47.234.962.328 1.78.398.629.058 1.235-.031 1.705-.129.735-.155.684-.836.418-.961-2.155-1.004-1.682-.595-2.112-.926 1.095-1.295 2.768-3.598 3.284-6.733.05-.346.115-.834.108-1.114-.004-.171.035-.238.23-.257a4.2 4.2 0 0 0 1.545-.475c1.397-.763 1.96-2.016 2.093-3.517.02-.23-.004-.467-.247-.588M11.58 18.168c-2.088-1.642-3.101-2.183-3.52-2.16-.39.024-.32.472-.234.763.09.288.207.487.371.74.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.168-1.361-.801-2.5-1.86-3.301-3.306-.775-1.393-1.225-2.888-1.299-4.482-.02-.385.094-.522.477-.592a4.7 4.7 0 0 1 1.53-.038c2.131.311 3.946 1.264 5.467 2.774.868.86 1.525 1.887 2.202 2.89.72 1.066 1.494 2.082 2.48 2.915.348.291.626.513.892.677-.802.09-2.14.109-3.055-.615zm1.001-6.44a.306.306 0 0 1 .415-.287.3.3 0 0 1 .113.074.3.3 0 0 1 .086.214c0 .17-.136.307-.308.307a.303.303 0 0 1-.306-.307m3.11 1.596c-.2.081-.4.151-.591.16a1.25 1.25 0 0 1-.798-.254c-.274-.23-.47-.358-.551-.758a1.7 1.7 0 0 1 .015-.588c.07-.327-.007-.537-.238-.727-.188-.156-.426-.199-.689-.199a.6.6 0 0 1-.254-.078.253.253 0 0 1-.114-.358 1 1 0 0 1 .192-.21c.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.392.451.462.576.685.915.176.264.336.536.446.848.066.194-.02.353-.25.45"/></svg>`,
  openai: `<svg viewBox="146 227 268 265" role="img" aria-label="OpenAI"><path d="M249.176 323.434V298.276c0-2.118.795-3.707 2.649-4.767l50.581-29.128c6.884-3.972 15.094-5.826 23.567-5.826 31.777 0 51.904 24.63 51.904 50.844 0 1.854 0 3.972-.266 6.091l-52.433-30.719c-3.177-1.852-6.356-1.852-9.533 0l-66.469 38.663Zm118.107 97.981v-60.114c0-3.709-1.589-6.356-4.767-8.209l-66.468-38.662 21.715-12.448c1.854-1.057 3.443-1.057 5.295 0l50.581 29.13c14.566 8.474 24.364 26.48 24.364 43.957 0 20.126-11.916 38.664-30.72 46.343v.003Zm-133.73-52.963-21.715-12.71c-1.852-1.058-2.648-2.647-2.648-4.767v-58.257c0-28.335 21.715-49.786 51.111-49.786 11.122 0 21.447 3.709 30.189 10.328l-52.169 30.189c-3.175 1.854-4.766 4.502-4.766 8.21v76.796l-.002-.003Zm46.739 27.01-31.116-17.477v-37.072l31.116-17.477 31.115 17.477v37.072l-31.115 17.477Zm19.994 80.506c-11.123 0-21.449-3.709-30.189-10.328l52.167-30.191c3.177-1.852 4.766-4.5 4.766-8.21v-76.794l21.981 12.71c1.854 1.058 2.649 2.647 2.649 4.767v58.257c0 28.335-21.981 49.786-51.374 49.786v.003Zm-62.761-59.053-50.581-29.13c-14.566-8.475-24.362-26.48-24.362-43.958 0-20.391 12.181-38.663 30.981-46.342v60.376c0 3.71 1.591 6.356 4.767 8.21l66.205 38.396-21.715 12.448c-1.853 1.057-3.443 1.057-5.295 0Zm-2.911 43.428c-29.925 0-51.904-22.51-51.904-50.315 0-2.118.266-4.236.528-6.356l52.167 30.191c3.177 1.852 6.358 1.852 9.533 0l66.469-38.397v25.156c0 2.12-.795 3.709-2.649 4.767l-50.579 29.13c-6.886 3.972-15.096 5.824-23.568 5.824h.003Zm65.672 31.511c32.043 0 58.787-22.772 64.881-52.962 29.658-7.681 48.725-35.486 48.725-63.819 0-18.538-7.944-36.544-22.244-49.521 1.324-5.561 2.118-11.122 2.118-16.682 0-37.867-30.718-66.204-66.204-66.204-7.149 0-14.034 1.057-20.918 3.443-11.919-11.652-28.337-19.067-46.343-19.067-32.043 0-58.788 22.773-64.881 52.962-29.659 7.681-48.726 35.486-48.726 63.82 0 18.538 7.944 36.544 22.244 49.52-1.325 5.562-2.119 11.123-2.119 16.683 0 37.867 30.719 66.204 66.205 66.204 7.148 0 14.034-1.058 20.919-3.443 11.916 11.653 28.335 19.066 46.343 19.066Z"/></svg>`,
  anthropic: `<svg viewBox="0 0 24 24" role="img" aria-label="Anthropic"><path d="M17.304 3.541h-3.672l6.696 16.918H24Zm-10.608 0L0 20.459h3.744l1.37-3.553h7.005l1.369 3.553h3.744L10.536 3.541Zm-.371 10.223 2.291-5.945 2.292 5.945Z"/></svg>`,
  gemini: `<svg viewBox="0 0 24 24" role="img" aria-label="Google Gemini"><path d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81"/></svg>`,
  compatible: `<svg viewBox="0 0 24 24" role="img" aria-label="兼容服务"><path d="M4 5h9v2H4zm12-2h4v6h-4zM4 11h16v2H4zm7 6h9v2h-9zM4 15h4v6H4z"/></svg>`,
};
const AI_PROVIDERS: Array<{
  id: ProviderId;
  name: string;
  shortName: string;
  model: string;
  baseUrl: string;
}> = [
  {
    id: "deepseek",
    name: "DeepSeek",
    shortName: "DeepSeek",
    model: "deepseek-v4-flash",
    baseUrl: "https://api.deepseek.com/chat/completions",
  },
  {
    id: "openai",
    name: "OpenAI",
    shortName: "OpenAI",
    model: "gpt-5.6-terra",
    baseUrl: "https://api.openai.com/v1/responses",
  },
  {
    id: "anthropic",
    name: "Anthropic Claude",
    shortName: "Claude",
    model: "claude-sonnet-5",
    baseUrl: "https://api.anthropic.com/v1/messages",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    shortName: "Gemini",
    model: "gemini-3.5-flash",
    baseUrl:
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent",
  },
  {
    id: "compatible",
    name: "兼容服务",
    shortName: "兼容服务",
    model: "",
    baseUrl: "",
  },
];

function providerMetadata(provider: ProviderId) {
  return AI_PROVIDERS.find((candidate) => candidate.id === provider) ?? AI_PROVIDERS[0];
}

function defaultProviderConfigs(): Record<ProviderId, ProviderRequestConfig> {
  return Object.fromEntries(
    AI_PROVIDERS.map((provider) => [
      provider.id,
      { model: provider.model, baseUrl: provider.baseUrl },
    ]),
  ) as Record<ProviderId, ProviderRequestConfig>;
}

function shortcutLabels(shortcut: string): string[] {
  const modifierOrder: Record<string, number> = {
    COMMAND: 0,
    CMD: 0,
    SUPER: 0,
    META: 0,
    CONTROL: 1,
    CTRL: 1,
    OPTION: 2,
    ALT: 2,
    SHIFT: 3,
  };
  return shortcut
    .split("+")
    .sort(
      (left, right) =>
        (modifierOrder[left.trim().toUpperCase()] ?? 10) -
        (modifierOrder[right.trim().toUpperCase()] ?? 10),
    )
    .map((part) => {
      const token = part.trim();
      const normalized = token.toUpperCase();
      const labels: Record<string, string> = {
        COMMAND: "⌘",
        CMD: "⌘",
        SUPER: "⌘",
        META: "⌘",
        CONTROL: "⌃",
        CTRL: "⌃",
        OPTION: "⌥",
        ALT: "⌥",
        SHIFT: "⇧",
        SPACE: "Space",
        ENTER: "↩",
        ESCAPE: "Esc",
        ESC: "Esc",
        ARROWUP: "↑",
        ARROWDOWN: "↓",
        ARROWLEFT: "←",
        ARROWRIGHT: "→",
      };
      if (labels[normalized]) return labels[normalized];
      if (normalized.startsWith("KEY")) return token.slice(3).toUpperCase();
      if (normalized.startsWith("DIGIT")) return token.slice(5);
      return token;
    });
}

function renderShortcutKeys(element: HTMLElement, shortcut: string) {
  element.replaceChildren(
    ...shortcutLabels(shortcut).map((label) => {
      const key = document.createElement("kbd");
      key.textContent = label;
      return key;
    }),
  );
}

function renderOnboarding(initialReadiness: StartupReadiness) {
  void invoke("set_main_window_layout", { onboarding: true });
  document.title = "OpenScreenTranslate · 初始设置";
  app.className = "onboarding";
  app.innerHTML = `
    <div class="onboarding-shell">
      <aside class="onboarding-sidebar">
        <img class="onboarding-brand-mark" src="${appIconUrl}" alt="" aria-hidden="true" />
        <nav class="onboarding-tabs" role="tablist" aria-label="初始化步骤">
          <button type="button" role="tab" data-step="0" aria-selected="true" aria-controls="onboarding-permission-panel">
            <span class="onboarding-tab-index">1</span><span>屏幕权限</span>
          </button>
          <button type="button" role="tab" data-step="1" aria-selected="false" aria-controls="onboarding-ai-panel" disabled>
            <span class="onboarding-tab-index">2</span><span>AI 配置</span>
          </button>
          <button type="button" role="tab" data-step="2" aria-selected="false" aria-controls="onboarding-preferences-panel" disabled>
            <span class="onboarding-tab-index">3</span><span>使用偏好</span>
          </button>
        </nav>
      </aside>

      <section class="onboarding-workspace">
        <div class="onboarding-step-viewport">
          <main class="onboarding-steps" style="--onboarding-step: 0">
            <section id="onboarding-permission-panel" class="onboarding-step permission-step" data-state="pending" role="tabpanel" aria-labelledby="permission-step-heading">
              <div class="onboarding-step-content">
                <div class="onboarding-step-heading">
                  <span class="onboarding-step-kicker">屏幕权限</span>
                  <h2 id="permission-step-heading">允许捕捉屏幕文字</h2>
                  <p>OpenScreenTranslate 只会在你主动截图时读取所选区域，不会在后台持续录制屏幕。</p>
                </div>
                <div class="onboarding-actions">
                  <button class="primary-button request-permission-button" type="button">授权屏幕录制</button>
                  <button class="secondary-button open-permission-settings-button" type="button">打开系统设置</button>
                </div>
                <div class="onboarding-status permission-message" data-state="pending" role="status" hidden></div>
              </div>
            </section>

            <section id="onboarding-ai-panel" class="onboarding-step ai-step" data-state="pending" role="tabpanel" aria-labelledby="ai-step-heading" aria-hidden="true">
              <div class="onboarding-step-content">
                <div class="onboarding-step-heading">
                  <span class="onboarding-step-kicker">AI 翻译</span>
                  <h2 id="ai-step-heading">连接你的 AI 服务</h2>
                  <p>选择服务并保存 API Key。Key 只会存入这台 Mac 的系统钥匙串。</p>
                </div>
                <form id="onboarding-ai-form" class="onboarding-ai-form">
                  <fieldset class="provider-fieldset">
                    <legend>服务供应商</legend>
                    <div class="provider-picker">
                      ${AI_PROVIDERS.map(
                        (provider) => `
                          <label class="provider-option onboarding-provider-option" data-provider="${provider.id}">
                            <input type="radio" name="onboardingProvider" value="${provider.id}" />
                            <span class="provider-symbol" aria-hidden="true">${PROVIDER_ICONS[provider.id]}</span>
                            <span>${provider.shortName}</span>
                            <span class="provider-check" aria-hidden="true">✓</span>
                          </label>
                        `,
                      ).join("")}
                    </div>
                  </fieldset>
                  <div class="onboarding-request-fields">
                    <label class="form-field">
                      <span>模型</span>
                      <input class="onboarding-model-input" type="text" autocomplete="off" spellcheck="false" maxlength="160" placeholder="输入模型名称" required />
                    </label>
                    <label class="form-field">
                      <span>完整请求 URL</span>
                      <input class="onboarding-base-url-input" type="url" autocomplete="off" spellcheck="false" placeholder="https://example.com/v1/chat/completions" required />
                    </label>
                  </div>
                  <div class="onboarding-ai-fields">
                    <label class="form-field">
                      <span class="onboarding-api-key-label">API Key</span>
                      <input class="onboarding-api-key-input" type="password" autocomplete="off" spellcheck="false" />
                    </label>
                  </div>
                  <div class="onboarding-status ai-message" data-state="pending" role="status" hidden></div>
                </form>
              </div>
            </section>

            <section id="onboarding-preferences-panel" class="onboarding-step preferences-step" data-state="optional" role="tabpanel" aria-labelledby="preferences-step-heading" aria-hidden="true">
              <div class="onboarding-step-content">
                <div class="onboarding-step-heading">
                  <span class="onboarding-step-kicker">使用偏好</span>
                  <h2 id="preferences-step-heading">设置你的使用方式</h2>
                  <p>确认快捷键与登录启动设置，之后也可以随时在设置中修改。</p>
                </div>
                <div class="onboarding-preferences">
                  <label class="toggle-setting onboarding-language-setting">
                    <span class="toggle-copy"><strong>默认翻译为</strong><small>截图和手动翻译默认使用的目标语言</small></span>
                    <span class="form-field select-field onboarding-language-control">
                      <select class="onboarding-target-language">${languageOptions()}</select>
                    </span>
                  </label>
                  <div class="onboarding-preference-row">
                    <span class="onboarding-preference-copy"><strong>截图并翻译</strong></span>
                    <span class="shortcut-display onboarding-capture-shortcut-display"><span class="shortcut-keys onboarding-capture-shortcut-keys"><kbd>⌘</kbd><kbd>1</kbd></span></span>
                    <button class="shortcut-edit-button onboarding-capture-shortcut-button" type="button" disabled>修改</button>
                    <small class="onboarding-shortcut-status onboarding-capture-shortcut-status"></small>
                  </div>
                  <div class="onboarding-preference-row">
                    <span class="onboarding-preference-copy"><strong>翻译</strong></span>
                    <span class="shortcut-display onboarding-translation-shortcut-display"><span class="shortcut-keys onboarding-translation-shortcut-keys"><kbd>⌘</kbd><kbd>2</kbd></span></span>
                    <button class="shortcut-edit-button onboarding-translation-shortcut-button" type="button" disabled>修改</button>
                    <small class="onboarding-shortcut-status onboarding-translation-shortcut-status"></small>
                  </div>
                  <label class="toggle-setting onboarding-autostart-setting">
                    <span class="toggle-copy"><strong>登录时自动启动</strong><small>登录 macOS 后自动在菜单栏运行</small></span>
                    <span class="switch-control">
                      <input class="onboarding-autostart-toggle" type="checkbox" role="switch" disabled />
                      <span class="switch-track" aria-hidden="true"></span>
                    </span>
                  </label>
                  <div class="onboarding-status onboarding-autostart-status" data-state="pending" role="status"></div>
                </div>
              </div>
            </section>
          </main>
        </div>

        <footer class="onboarding-footer" hidden>
          <span class="onboarding-completion-message" role="status" hidden></span>
          <button class="primary-button save-ai-button" type="submit" form="onboarding-ai-form" hidden>保存 AI 配置</button>
          <button class="primary-button complete-onboarding-button" type="button" disabled>开始使用</button>
        </footer>
      </section>
    </div>
  `;

  const permissionStep = requireElement<HTMLElement>(".permission-step");
  const permissionMessage = requireElement<HTMLDivElement>(".permission-message");
  const requestPermissionButton = requireElement<HTMLButtonElement>(".request-permission-button");
  const openPermissionSettingsButton = requireElement<HTMLButtonElement>(".open-permission-settings-button");
  const aiStep = requireElement<HTMLElement>(".ai-step");
  const preferencesStep = requireElement<HTMLElement>(".preferences-step");
  const stepViewport = requireElement<HTMLElement>(".onboarding-step-viewport");
  const stepsTrack = requireElement<HTMLElement>(".onboarding-steps");
  const tabButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>(".onboarding-tabs [role='tab']"),
  );
  const stepPanels = [permissionStep, aiStep, preferencesStep];
  const aiForm = requireElement<HTMLFormElement>(".onboarding-ai-form");
  const aiMessage = requireElement<HTMLDivElement>(".ai-message");
  const apiKeyLabel = requireElement<HTMLSpanElement>(".onboarding-api-key-label");
  const apiKeyInput = requireElement<HTMLInputElement>(".onboarding-api-key-input");
  const onboardingModelInput = requireElement<HTMLInputElement>(".onboarding-model-input");
  const onboardingBaseUrlInput = requireElement<HTMLInputElement>(".onboarding-base-url-input");
  const targetLanguage = requireElement<HTMLSelectElement>(".onboarding-target-language");
  const saveAiButton = requireElement<HTMLButtonElement>(".save-ai-button");
  const providerInputs = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[name="onboardingProvider"]'),
  );
  const completionMessage = requireElement<HTMLSpanElement>(".onboarding-completion-message");
  const completeButton = requireElement<HTMLButtonElement>(".complete-onboarding-button");
  const onboardingFooter = requireElement<HTMLElement>(".onboarding-footer");
  const autostartToggle = requireElement<HTMLInputElement>(".onboarding-autostart-toggle");
  const autostartStatus = requireElement<HTMLDivElement>(".onboarding-autostart-status");

  let readiness = initialReadiness;
  let selectedProvider = initialReadiness.provider;
  let configuredProviders = new Set<ProviderId>();
  const providerConfigs = defaultProviderConfigs();
  let aiDirty = false;
  const dirtyProviderConfigs = new Set<ProviderId>();
  let translationSettingsLoaded = false;
  let currentStep = !initialReadiness.screenCapturePermissionGranted
    ? 0
    : initialReadiness.apiKeyConfigured
      ? 2
      : 1;

  const syncActiveStepHeight = () => {
    stepViewport.style.height = `${stepPanels[currentStep].scrollHeight}px`;
  };

  const stepResizeObserver = new ResizeObserver(() => syncActiveStepHeight());
  for (const panel of stepPanels) stepResizeObserver.observe(panel);

  const aiConfigurationReady = () =>
    !aiDirty &&
    (configuredProviders.has(selectedProvider) ||
      (!translationSettingsLoaded &&
        selectedProvider === readiness.provider &&
        readiness.apiKeyConfigured));

  const setActiveStep = (requestedStep: number) => {
    const maximumStep = !readiness.screenCapturePermissionGranted
      ? 0
      : aiConfigurationReady()
        ? 2
        : 1;
    currentStep = Math.max(0, Math.min(requestedStep, maximumStep));
    stepsTrack.style.setProperty("--onboarding-step", String(currentStep));
    onboardingFooter.hidden = currentStep === 0;
    saveAiButton.hidden = currentStep !== 1;
    completeButton.hidden = currentStep !== 2;
    if (currentStep !== 2) completionMessage.hidden = true;

    for (const [index, tab] of tabButtons.entries()) {
      const selected = index === currentStep;
      tab.disabled = index > maximumStep;
      tab.setAttribute("aria-selected", String(selected));
      tab.dataset.state =
        index === 0 && readiness.screenCapturePermissionGranted
          ? "ready"
          : index === 1 && aiConfigurationReady()
            ? "ready"
            : selected
              ? "active"
              : "pending";
      stepPanels[index].setAttribute("aria-hidden", String(!selected));
      stepPanels[index].inert = !selected;
    }
    requestAnimationFrame(syncActiveStepHeight);
  };

  for (const tab of tabButtons) {
    tab.addEventListener("click", () => setActiveStep(Number(tab.dataset.step)));
  }

  const refreshAiDirtyState = () => {
    aiDirty =
      selectedProvider !== readiness.provider ||
      apiKeyInput.value.trim().length > 0 ||
      dirtyProviderConfigs.has(selectedProvider);
  };

  const setMessage = (
    element: HTMLElement,
    message: string,
    state: "ready" | "pending" | "error",
  ) => {
    element.textContent = message;
    element.dataset.state = state;
    element.hidden = false;
  };

  const updateCompletion = () => {
    const permissionReady = readiness.screenCapturePermissionGranted;
    const aiReady = aiConfigurationReady();

    permissionStep.dataset.state = permissionReady ? "ready" : "pending";
    requestPermissionButton.hidden = permissionReady;
    openPermissionSettingsButton.hidden = permissionReady;

    aiStep.dataset.state = aiReady ? "ready" : "pending";
    completeButton.disabled = !permissionReady || !aiReady;
    setActiveStep(currentStep);
  };

  const updatePermissionView = () => {
    if (readiness.screenCapturePermissionGranted) {
      permissionMessage.textContent = "";
      permissionMessage.dataset.state = "ready";
      permissionMessage.hidden = true;
    }
    updateCompletion();
    if (readiness.screenCapturePermissionGranted && currentStep === 0) {
      setActiveStep(aiConfigurationReady() ? 2 : 1);
    }
  };

  const refreshReadiness = async () => {
    readiness = await invoke<StartupReadiness>("get_startup_readiness");
    updatePermissionView();
  };

  requestPermissionButton.addEventListener("click", async () => {
    requestPermissionButton.disabled = true;
    setMessage(permissionMessage, "正在请求屏幕录制权限…", "pending");
    try {
      const granted = await invoke<boolean>("request_screen_capture_permission");
      readiness.screenCapturePermissionGranted = granted;
      updatePermissionView();
      if (!granted) {
        setMessage(
          permissionMessage,
          "请在系统提示中允许；如果已经拒绝，请打开系统设置后重新检测。",
          "pending",
        );
      }
    } catch (error) {
      setMessage(permissionMessage, `请求权限失败：${String(error)}`, "error");
    } finally {
      requestPermissionButton.disabled = false;
    }
  });

  openPermissionSettingsButton.addEventListener("click", async () => {
    try {
      await invoke("open_screen_capture_settings");
      setMessage(permissionMessage, "授权后返回此处并重新检测；部分系统版本需要重新打开应用。", "pending");
    } catch (error) {
      setMessage(permissionMessage, `无法打开系统设置：${String(error)}`, "error");
    }
  });

  window.addEventListener("focus", () => void refreshReadiness().catch(() => undefined));

  const storeProviderDraft = () => {
    providerConfigs[selectedProvider] = {
      model: onboardingModelInput.value,
      baseUrl: onboardingBaseUrlInput.value,
    };
  };

  const updateProviderView = () => {
    const provider = providerMetadata(selectedProvider);
    const requestConfig = providerConfigs[selectedProvider];
    const providerHasKey =
      configuredProviders.has(selectedProvider) ||
      (!translationSettingsLoaded &&
        selectedProvider === readiness.provider &&
        readiness.apiKeyConfigured);
    for (const input of providerInputs) {
      const inputProvider = input.value as ProviderId;
      input.checked = inputProvider === selectedProvider;
      input.closest(".provider-option")?.classList.toggle(
        "has-key",
        configuredProviders.has(inputProvider),
      );
    }
    apiKeyLabel.textContent = `${provider.name} API Key`;
    apiKeyInput.value = "";
    apiKeyInput.placeholder = providerHasKey
      ? `${provider.name} API Key 已保存在钥匙串，可留空`
      : `输入 ${provider.name} API Key`;
    onboardingModelInput.value = requestConfig.model;
    onboardingModelInput.placeholder = provider.model || "输入模型名称";
    onboardingBaseUrlInput.value = requestConfig.baseUrl;
    onboardingBaseUrlInput.placeholder =
      provider.baseUrl || "https://example.com/v1/chat/completions";
    aiMessage.textContent = "";
    aiMessage.hidden = true;
    updateCompletion();
  };

  for (const input of providerInputs) {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      storeProviderDraft();
      selectedProvider = input.value as ProviderId;
      refreshAiDirtyState();
      updateProviderView();
    });
  }
  apiKeyInput.addEventListener("input", () => {
    refreshAiDirtyState();
    aiMessage.hidden = true;
    updateCompletion();
  });
  for (const input of [onboardingModelInput, onboardingBaseUrlInput]) {
    input.addEventListener("input", () => {
      dirtyProviderConfigs.add(selectedProvider);
      storeProviderDraft();
      refreshAiDirtyState();
      aiMessage.hidden = true;
      updateCompletion();
    });
  }

  void invoke<TranslationSettings>("get_translation_settings")
    .then((settings) => {
      selectedProvider = settings.provider;
      readiness.provider = settings.provider;
      configuredProviders = new Set(settings.configuredProviders);
      translationSettingsLoaded = true;
      for (const provider of AI_PROVIDERS) {
        const config = settings.providerConfigs?.[provider.id];
        if (config) providerConfigs[provider.id] = { ...config };
      }
      targetLanguage.value = settings.targetLanguage;
      dirtyProviderConfigs.clear();
      aiDirty = false;
      updateProviderView();
    })
    .catch((error) => setMessage(aiMessage, `读取 AI 配置失败：${String(error)}`, "error"));

  aiForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    storeProviderDraft();
    if (!onboardingModelInput.checkValidity() || !onboardingBaseUrlInput.checkValidity()) {
      setMessage(aiMessage, "请填写有效的模型和完整请求 URL", "error");
      return;
    }
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey && !configuredProviders.has(selectedProvider)) {
      setMessage(aiMessage, `请输入 ${providerMetadata(selectedProvider).name} API Key`, "error");
      apiKeyInput.focus();
      return;
    }

    saveAiButton.disabled = true;
    setMessage(aiMessage, "正在保存 AI 配置…", "pending");
    try {
      if (apiKey) {
        await invoke("save_provider_api_key", { provider: selectedProvider, apiKey });
        configuredProviders.add(selectedProvider);
      }
      const requestConfig = providerConfigs[selectedProvider];
      await invoke("save_translation_settings", {
        settings: {
          targetLanguage: targetLanguage.value,
          provider: selectedProvider,
          model: requestConfig.model,
          baseUrl: requestConfig.baseUrl,
        },
      });
      readiness = await invoke<StartupReadiness>("get_startup_readiness");
      dirtyProviderConfigs.delete(selectedProvider);
      aiDirty = false;
      configuredProviders.add(selectedProvider);
      updateProviderView();
      setMessage(aiMessage, "AI 翻译配置已保存", "ready");
      setActiveStep(2);
    } catch (error) {
      setMessage(aiMessage, `保存失败：${String(error)}`, "error");
    } finally {
      saveAiButton.disabled = false;
    }
  });

  type OnboardingShortcutEditor = {
    currentShortcut: string;
    display: HTMLSpanElement;
    keys: HTMLSpanElement;
    button: HTMLButtonElement;
    status: HTMLElement;
    getCommand: string;
    setCommand: string;
  };
  const shortcutEditors: OnboardingShortcutEditor[] = [
    {
      currentShortcut: DEFAULT_CAPTURE_SHORTCUT,
      display: requireElement<HTMLSpanElement>(".onboarding-capture-shortcut-display"),
      keys: requireElement<HTMLSpanElement>(".onboarding-capture-shortcut-keys"),
      button: requireElement<HTMLButtonElement>(".onboarding-capture-shortcut-button"),
      status: requireElement<HTMLElement>(".onboarding-capture-shortcut-status"),
      getCommand: "get_capture_shortcut",
      setCommand: "set_capture_shortcut",
    },
    {
      currentShortcut: DEFAULT_TRANSLATION_SHORTCUT,
      display: requireElement<HTMLSpanElement>(".onboarding-translation-shortcut-display"),
      keys: requireElement<HTMLSpanElement>(".onboarding-translation-shortcut-keys"),
      button: requireElement<HTMLButtonElement>(".onboarding-translation-shortcut-button"),
      status: requireElement<HTMLElement>(".onboarding-translation-shortcut-status"),
      getCommand: "get_translation_shortcut",
      setCommand: "set_translation_shortcut",
    },
  ];
  let activeShortcutEditor: OnboardingShortcutEditor | null = null;

  const applyShortcutStatus = (editor: OnboardingShortcutEditor, status: ShortcutStatus) => {
    editor.currentShortcut = status.shortcut;
    renderShortcutKeys(editor.keys, status.shortcut);
    editor.button.disabled = false;
    setMessage(
      editor.status,
      status.registered ? "快捷键可用" : status.error ?? "快捷键不可用",
      status.registered ? "ready" : "error",
    );
  };

  const saveShortcut = async (editor: OnboardingShortcutEditor, shortcut: string) => {
    activeShortcutEditor = null;
    editor.display.classList.remove("is-recording");
    editor.button.disabled = true;
    setMessage(editor.status, "正在注册…", "pending");
    try {
      applyShortcutStatus(
        editor,
        await invoke<ShortcutStatus>(editor.setCommand, { shortcut }),
      );
    } catch (error) {
      renderShortcutKeys(editor.keys, editor.currentShortcut);
      editor.button.disabled = false;
      setMessage(editor.status, String(error), "error");
    }
  };

  for (const editor of shortcutEditors) {
    void invoke<ShortcutStatus>(editor.getCommand)
      .then((status) => applyShortcutStatus(editor, status))
      .catch((error) => setMessage(editor.status, `读取失败：${String(error)}`, "error"));
    editor.button.addEventListener("click", () => {
      if (activeShortcutEditor && activeShortcutEditor !== editor) {
        activeShortcutEditor.display.classList.remove("is-recording");
        renderShortcutKeys(activeShortcutEditor.keys, activeShortcutEditor.currentShortcut);
      }
      activeShortcutEditor = editor;
      editor.display.classList.add("is-recording");
      editor.keys.replaceChildren(document.createTextNode("请按组合键"));
      setMessage(editor.status, "按 Esc 取消；需包含 ⌘、⌃ 或 ⌥", "pending");
    });
  }

  window.addEventListener("keydown", (event) => {
    const editor = activeShortcutEditor;
    if (!editor) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.code === "Escape" && !event.metaKey && !event.ctrlKey && !event.altKey) {
      activeShortcutEditor = null;
      editor.display.classList.remove("is-recording");
      renderShortcutKeys(editor.keys, editor.currentShortcut);
      setMessage(editor.status, "已取消修改", "ready");
      return;
    }
    if (["MetaLeft", "MetaRight", "ControlLeft", "ControlRight", "AltLeft", "AltRight", "ShiftLeft", "ShiftRight"].includes(event.code)) return;
    if (!event.metaKey && !event.ctrlKey && !event.altKey) {
      setMessage(editor.status, "快捷键必须包含 ⌘、⌃ 或 ⌥", "error");
      return;
    }
    const modifiers = [
      event.metaKey ? "Command" : "",
      event.ctrlKey ? "Control" : "",
      event.altKey ? "Option" : "",
      event.shiftKey ? "Shift" : "",
    ].filter(Boolean);
    void saveShortcut(editor, [...modifiers, event.code].join("+"));
  });

  void invoke<boolean>("get_launch_at_login")
    .then((enabled) => {
      autostartToggle.checked = enabled;
      autostartToggle.disabled = false;
      setMessage(autostartStatus, enabled ? "已开启登录时自动启动" : "已关闭登录时自动启动", "ready");
    })
    .catch((error) => setMessage(autostartStatus, `读取启动设置失败：${String(error)}`, "error"));

  autostartToggle.addEventListener("change", async () => {
    const enabled = autostartToggle.checked;
    autostartToggle.disabled = true;
    setMessage(autostartStatus, "正在保存…", "pending");
    try {
      await invoke("set_launch_at_login", { enabled });
      setMessage(autostartStatus, enabled ? "已开启登录时自动启动" : "已关闭登录时自动启动", "ready");
    } catch (error) {
      autostartToggle.checked = !enabled;
      setMessage(autostartStatus, `保存失败：${String(error)}`, "error");
    } finally {
      autostartToggle.disabled = false;
    }
  });

  completeButton.addEventListener("click", async () => {
    completeButton.disabled = true;
    completeButton.textContent = "正在完成…";
    completionMessage.hidden = true;
    try {
      const requestConfig = providerConfigs[selectedProvider];
      await invoke("save_translation_settings", {
        settings: {
          targetLanguage: targetLanguage.value,
          provider: selectedProvider,
          model: requestConfig.model,
          baseUrl: requestConfig.baseUrl,
        },
      });
      await invoke("complete_onboarding");
      renderSettings();
    } catch (error) {
      completionMessage.textContent = `无法完成：${String(error)}`;
      completionMessage.hidden = false;
      completeButton.textContent = "开始使用";
      updateCompletion();
    }
  });

  updatePermissionView();
  updateProviderView();
  setActiveStep(currentStep);
}

function renderSettings() {
  void invoke("set_main_window_layout", { onboarding: false });
  document.title = "OpenScreenTranslate · 设置";
  app.className = "settings";
  app.innerHTML = `
    <section class="settings-section shortcut-settings-section" aria-labelledby="shortcut-settings-heading">
      <div class="section-heading">
        <h2 id="shortcut-settings-heading">快捷键</h2>
      </div>
      <dl class="shortcut-card" aria-label="全局快捷键设置">
        <div>
          <div class="shortcut-copy">
            <div class="shortcut-title-row">
              <dt>截图并翻译</dt>
              <span
                class="permission-status capture-permission-status"
                data-state="pending"
                aria-label="正在检查屏幕录制权限"
                title="正在检查屏幕录制权限"
              ></span>
            </div>
          </div>
          <dd>
            <span class="shortcut-display capture-shortcut-display" aria-label="当前截图快捷键">
              <span class="shortcut-keys capture-shortcut-keys"><kbd>⌘</kbd><kbd>1</kbd></span>
            </span>
            <button class="shortcut-edit-button capture-shortcut-edit-button" type="button">修改快捷键</button>
          </dd>
        </div>
        <div>
          <div class="shortcut-copy">
            <div class="shortcut-title-row">
              <dt>翻译</dt>
              <span
                class="permission-status translation-availability-status"
                data-state="pending"
                aria-label="正在检查翻译快捷键"
                title="正在检查翻译快捷键"
              ></span>
            </div>
          </div>
          <dd>
            <span class="shortcut-display translation-shortcut-display" aria-label="当前翻译快捷键">
              <span class="shortcut-keys translation-shortcut-keys"><kbd>⌘</kbd><kbd>2</kbd></span>
            </span>
            <button class="shortcut-edit-button translation-shortcut-edit-button" type="button">修改快捷键</button>
          </dd>
        </div>
      </dl>
      <div class="shortcut-status capture-shortcut-status" data-state="pending" hidden></div>
      <div class="shortcut-status translation-shortcut-status" data-state="pending" hidden></div>
    </section>

    <section class="settings-section" aria-labelledby="general-settings-heading">
      <div class="section-heading">
        <div>
          <h2 id="general-settings-heading">常规</h2>
        </div>
      </div>

      <label class="toggle-setting">
        <span class="toggle-copy">
          <strong>登录时自动启动</strong>
          <small>登录 macOS 后自动在菜单栏运行</small>
        </span>
        <span class="switch-control">
          <input
            class="launch-at-login-toggle"
            type="checkbox"
            role="switch"
            aria-label="登录时自动启动"
            disabled
          />
          <span class="switch-track" aria-hidden="true"></span>
        </span>
      </label>
      <div class="autostart-status" data-state="pending" hidden></div>
    </section>

    <section class="settings-section" aria-labelledby="translation-settings-heading">
      <div class="section-heading">
        <div>
          <h2 id="translation-settings-heading">AI 翻译</h2>
        </div>
        <span class="model-badge">deepseek-v4-flash</span>
      </div>

      <form class="translation-form">
        <fieldset class="provider-fieldset">
          <legend>服务供应商</legend>
          <div class="provider-picker">
            ${AI_PROVIDERS.map(
              (provider) => `
                <label class="provider-option" data-provider="${provider.id}">
                  <input type="radio" name="provider" value="${provider.id}" />
                  <span class="provider-symbol" aria-hidden="true">${PROVIDER_ICONS[provider.id]}</span>
                  <span>${provider.shortName}</span>
                  <span class="provider-check" aria-hidden="true">✓</span>
                </label>
              `,
            ).join("")}
          </div>
        </fieldset>

        <details class="request-config" open>
          <summary>
            <span>模型与接口</span>
          </summary>
          <div class="request-config-body">
            <label class="form-field">
              <span>模型</span>
              <input
                class="model-input"
                type="text"
                name="model"
                autocomplete="off"
                spellcheck="false"
                maxlength="160"
                required
              />
            </label>
            <label class="form-field">
              <span>完整请求 URL</span>
              <input
                class="base-url-input"
                type="url"
                name="baseUrl"
                autocomplete="off"
                spellcheck="false"
                required
              />
            </label>
          </div>
        </details>

        <label class="form-field">
          <span class="api-key-label">DeepSeek API Key</span>
          <span class="api-key-control">
            <input
              class="api-key-input"
              type="password"
              name="apiKey"
              autocomplete="off"
              spellcheck="false"
              placeholder="输入 DeepSeek API Key"
            />
            <button class="delete-key-button" type="button">移除</button>
          </span>
        </label>

        <label class="form-field select-field">
          <span>默认翻译为</span>
          <select class="target-language-select" name="targetLanguage">
            ${languageOptions()}
          </select>
        </label>

        <div class="settings-status" data-state="pending" hidden></div>
      </form>
    </section>

    <section class="settings-section" aria-labelledby="about-heading">
      <div class="section-heading">
        <h2 id="about-heading">关于</h2>
        <span class="version-badge">v${APP_VERSION}</span>
      </div>
      <p class="about-description">OpenScreenTranslate 是一款开源的 macOS 菜单栏截图翻译工具，帮助你快速识别并翻译屏幕文本。</p>
    </section>
  `;

  const statusElement = requireElement<HTMLSpanElement>(".capture-permission-status");
  const launchAtLoginElement = requireElement<HTMLInputElement>(".launch-at-login-toggle");
  const autostartStatusElement = requireElement<HTMLDivElement>(".autostart-status");
  const formElement = requireElement<HTMLFormElement>(".translation-form");
  const providerInputs = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[name="provider"]'),
  );
  const modelBadgeElement = requireElement<HTMLSpanElement>(".model-badge");
  const modelInputElement = requireElement<HTMLInputElement>(".model-input");
  const baseUrlInputElement = requireElement<HTMLInputElement>(".base-url-input");
  const apiKeyLabelElement = requireElement<HTMLSpanElement>(".api-key-label");
  const apiKeyElement = requireElement<HTMLInputElement>(".api-key-input");
  const targetLanguageElement = requireElement<HTMLSelectElement>(".target-language-select");
  const deleteKeyElement = requireElement<HTMLButtonElement>(".delete-key-button");
  const settingsStatusElement = requireElement<HTMLDivElement>(".settings-status");

  type ShortcutEditor = {
    currentShortcut: string;
    display: HTMLSpanElement;
    keys: HTMLSpanElement;
    button: HTMLButtonElement;
    status: HTMLDivElement;
    availability?: HTMLSpanElement;
    getCommand: string;
    setCommand: string;
  };

  const captureShortcutEditor: ShortcutEditor = {
    currentShortcut: DEFAULT_CAPTURE_SHORTCUT,
    display: requireElement<HTMLSpanElement>(".capture-shortcut-display"),
    keys: requireElement<HTMLSpanElement>(".capture-shortcut-keys"),
    button: requireElement<HTMLButtonElement>(".capture-shortcut-edit-button"),
    status: requireElement<HTMLDivElement>(".capture-shortcut-status"),
    getCommand: "get_capture_shortcut",
    setCommand: "set_capture_shortcut",
  };
  const translationShortcutEditor: ShortcutEditor = {
    currentShortcut: DEFAULT_TRANSLATION_SHORTCUT,
    display: requireElement<HTMLSpanElement>(".translation-shortcut-display"),
    keys: requireElement<HTMLSpanElement>(".translation-shortcut-keys"),
    button: requireElement<HTMLButtonElement>(".translation-shortcut-edit-button"),
    status: requireElement<HTMLDivElement>(".translation-shortcut-status"),
    availability: requireElement<HTMLSpanElement>(".translation-availability-status"),
    getCommand: "get_translation_shortcut",
    setCommand: "set_translation_shortcut",
  };
  const shortcutEditors = [captureShortcutEditor, translationShortcutEditor];
  let activeShortcutEditor: ShortcutEditor | null = null;

  const updateShortcutStatus = (
    editor: ShortcutEditor,
    message: string,
    state: "ready" | "pending" | "error",
  ) => {
    editor.status.textContent = state === "error" ? message : "";
    editor.status.dataset.state = state;
    editor.status.hidden = state !== "error";
    if (editor.availability) {
      editor.availability.dataset.state = state;
      editor.availability.setAttribute("aria-label", message);
      editor.availability.title = message;
    }
  };

  const applyShortcutStatus = (editor: ShortcutEditor, status: ShortcutStatus) => {
    editor.currentShortcut = status.shortcut;
    renderShortcutKeys(editor.keys, editor.currentShortcut);
    editor.button.disabled = false;
    if (status.registered) {
      updateShortcutStatus(editor, "快捷键可用", "ready");
    } else {
      updateShortcutStatus(
        editor,
        status.error ?? "快捷键当前不可用，请选择其他组合",
        "error",
      );
    }
  };

  const saveShortcut = async (editor: ShortcutEditor, shortcut: string) => {
    activeShortcutEditor = null;
    editor.display.classList.remove("is-recording");
    editor.button.disabled = true;
    updateShortcutStatus(editor, "正在注册快捷键…", "pending");
    try {
      const status = await invoke<ShortcutStatus>(editor.setCommand, {
        shortcut,
      });
      applyShortcutStatus(editor, status);
    } catch (error) {
      renderShortcutKeys(editor.keys, editor.currentShortcut);
      editor.button.disabled = false;
      updateShortcutStatus(editor, String(error), "error");
    }
  };

  for (const editor of shortcutEditors) {
    void invoke<ShortcutStatus>(editor.getCommand)
      .then((status) => applyShortcutStatus(editor, status))
      .catch((error) => {
        editor.button.disabled = false;
        updateShortcutStatus(editor, `读取快捷键失败：${String(error)}`, "error");
      });

    editor.button.addEventListener("click", () => {
      if (activeShortcutEditor && activeShortcutEditor !== editor) {
        activeShortcutEditor.display.classList.remove("is-recording");
        renderShortcutKeys(
          activeShortcutEditor.keys,
          activeShortcutEditor.currentShortcut,
        );
      }
      activeShortcutEditor = editor;
      editor.display.classList.add("is-recording");
      editor.keys.replaceChildren(document.createTextNode("请按下组合键"));
      updateShortcutStatus(editor, "按 Esc 取消；快捷键需包含 ⌘、⌃ 或 ⌥", "pending");
    });
  }

  window.addEventListener("keydown", (event) => {
    const editor = activeShortcutEditor;
    if (!editor) return;
    event.preventDefault();
    event.stopPropagation();

    if (event.code === "Escape" && !event.metaKey && !event.ctrlKey && !event.altKey) {
      activeShortcutEditor = null;
      editor.display.classList.remove("is-recording");
      renderShortcutKeys(editor.keys, editor.currentShortcut);
      updateShortcutStatus(editor, "已取消修改", "ready");
      return;
    }

    if (["MetaLeft", "MetaRight", "ControlLeft", "ControlRight", "AltLeft", "AltRight", "ShiftLeft", "ShiftRight"].includes(event.code)) {
      return;
    }
    if (!event.metaKey && !event.ctrlKey && !event.altKey) {
      updateShortcutStatus(editor, "快捷键必须包含 ⌘、⌃ 或 ⌥", "error");
      return;
    }

    const modifiers = [
      event.metaKey ? "Command" : "",
      event.ctrlKey ? "Control" : "",
      event.altKey ? "Option" : "",
      event.shiftKey ? "Shift" : "",
    ].filter(Boolean);
    void saveShortcut(editor, [...modifiers, event.code].join("+"));
  });

  const updateStatus = (message: string, state: "ready" | "pending" | "error") => {
    statusElement.dataset.state = state;
    statusElement.setAttribute("aria-label", message);
    statusElement.title = message;
    if (state === "error") {
      updateShortcutStatus(captureShortcutEditor, message, "error");
    }
  };

  void invoke<boolean>("screen_capture_permission_granted")
    .then((granted) => {
      updateStatus(
        granted ? "屏幕录制权限可用" : "尚未获得屏幕录制权限，请根据系统提示授权",
        granted ? "ready" : "pending",
      );
    })
    .catch((error) => updateStatus(`权限检查失败：${String(error)}`, "error"));

  void listen<string>("capture-status", (event) => {
    updateStatus(event.payload, "error");
  });

  const updateAutostartStatus = (
    message: string,
    state: "ready" | "pending" | "error",
  ) => {
    autostartStatusElement.textContent = state === "error" ? message : "";
    autostartStatusElement.dataset.state = state;
    autostartStatusElement.hidden = state !== "error";
  };

  void invoke<boolean>("get_launch_at_login")
    .then((enabled) => {
      launchAtLoginElement.checked = enabled;
      launchAtLoginElement.disabled = false;
      updateAutostartStatus(
        enabled ? "已开启登录时自动启动" : "已关闭登录时自动启动",
        "ready",
      );
    })
    .catch((error) =>
      updateAutostartStatus(`读取登录启动状态失败：${String(error)}`, "error"),
    );

  launchAtLoginElement.addEventListener("change", async () => {
    const enabled = launchAtLoginElement.checked;
    launchAtLoginElement.disabled = true;
    updateAutostartStatus("正在保存登录启动设置…", "pending");

    try {
      await invoke("set_launch_at_login", { enabled });
      updateAutostartStatus(
        enabled ? "已开启登录时自动启动" : "已关闭登录时自动启动",
        "ready",
      );
    } catch (error) {
      launchAtLoginElement.checked = !enabled;
      updateAutostartStatus(`保存登录启动设置失败：${String(error)}`, "error");
    } finally {
      launchAtLoginElement.disabled = false;
    }
  });

  const updateSettingsStatus = (
    message: string,
    state: "ready" | "pending" | "error",
  ) => {
    settingsStatusElement.textContent = state === "error" ? message : "";
    settingsStatusElement.dataset.state = state;
    settingsStatusElement.hidden = state !== "error";
  };

  let selectedProvider: ProviderId = "deepseek";
  const configuredProviders = new Set<ProviderId>();
  const providerConfigs = defaultProviderConfigs();

  const storeRequestConfigDraft = () => {
    providerConfigs[selectedProvider] = {
      model: modelInputElement.value,
      baseUrl: baseUrlInputElement.value,
    };
  };

  const updateRequestConfigPreview = () => {
    const config = {
      model: modelInputElement.value,
      baseUrl: baseUrlInputElement.value,
    };
    modelBadgeElement.textContent = config.model.trim() || "未设置模型";
  };

  const updateKeyState = (configured: boolean) => {
    const provider = providerMetadata(selectedProvider);
    apiKeyElement.value = "";
    apiKeyElement.placeholder = configured
      ? `${provider.name} API Key 已保存在系统凭据库`
      : `输入 ${provider.name} API Key`;
    deleteKeyElement.disabled = !configured;
  };

  const updateProviderView = (provider: ProviderId, announce = true) => {
    selectedProvider = provider;
    const metadata = providerMetadata(provider);
    const requestConfig = providerConfigs[provider];
    modelInputElement.value = requestConfig.model;
    baseUrlInputElement.value = requestConfig.baseUrl;
    modelInputElement.placeholder = metadata.model || "输入模型名称";
    baseUrlInputElement.placeholder =
      metadata.baseUrl || "https://example.com/v1/chat/completions";
    updateRequestConfigPreview();
    apiKeyLabelElement.textContent = `${metadata.name} API Key`;
    for (const input of providerInputs) {
      const inputProvider = input.value as ProviderId;
      input.checked = inputProvider === provider;
      input.closest(".provider-option")?.classList.toggle(
        "has-key",
        configuredProviders.has(inputProvider),
      );
    }
    const configured = configuredProviders.has(provider);
    updateKeyState(configured);
    if (announce) {
      updateSettingsStatus(
        configured
          ? `${metadata.name} API Key 已配置`
          : `请填写 ${metadata.name} API Key`,
        configured ? "ready" : "pending",
      );
    }
  };

  type AutoSaveSnapshot = {
    revision: number;
    provider: ProviderId;
    targetLanguage: TranslationSettings["targetLanguage"];
    requestConfig: ProviderRequestConfig;
    apiKey?: string;
  };

  let autoSaveTimer: number | undefined;
  let latestSaveRevision = 0;
  let saveQueue = Promise.resolve();

  const captureAutoSaveSnapshot = (apiKey?: string): AutoSaveSnapshot | null => {
    storeRequestConfigDraft();
    if (!modelInputElement.checkValidity() || !baseUrlInputElement.checkValidity()) {
      updateSettingsStatus("请填写有效的模型和请求 URL", "error");
      return null;
    }

    return {
      revision: ++latestSaveRevision,
      provider: selectedProvider,
      targetLanguage: targetLanguageElement.value as TranslationSettings["targetLanguage"],
      requestConfig: { ...providerConfigs[selectedProvider] },
      apiKey,
    };
  };

  const refreshProviderKeyIndicators = () => {
    for (const input of providerInputs) {
      input.closest(".provider-option")?.classList.toggle(
        "has-key",
        configuredProviders.has(input.value as ProviderId),
      );
    }
  };

  const persistAutoSaveSnapshot = async (snapshot: AutoSaveSnapshot) => {
    if (snapshot.revision === latestSaveRevision) {
      updateSettingsStatus("正在自动保存…", "pending");
    }

    try {
      if (snapshot.apiKey) {
        await invoke("save_provider_api_key", {
          provider: snapshot.provider,
          apiKey: snapshot.apiKey,
        });
        configuredProviders.add(snapshot.provider);
        refreshProviderKeyIndicators();
        if (
          selectedProvider === snapshot.provider &&
          apiKeyElement.value.trim() === snapshot.apiKey
        ) {
          updateKeyState(true);
        }
      }

      await invoke("save_translation_settings", {
        settings: {
          targetLanguage: snapshot.targetLanguage,
          provider: snapshot.provider,
          model: snapshot.requestConfig.model,
          baseUrl: snapshot.requestConfig.baseUrl,
        },
      });

      if (snapshot.revision === latestSaveRevision) {
        const provider = providerMetadata(snapshot.provider);
        const configured = configuredProviders.has(snapshot.provider);
        updateSettingsStatus(
          configured
            ? "已自动保存，翻译配置已就绪"
            : `已自动保存，请填写 ${provider.name} API Key`,
          configured ? "ready" : "pending",
        );
      }
    } catch (error) {
      if (snapshot.revision === latestSaveRevision) {
        updateSettingsStatus(`自动保存失败：${String(error)}`, "error");
      }
    }
  };

  const enqueueAutoSave = (delay = 600, apiKey?: string) => {
    const snapshot = captureAutoSaveSnapshot(apiKey);
    if (!snapshot) return;

    if (autoSaveTimer !== undefined) {
      window.clearTimeout(autoSaveTimer);
      autoSaveTimer = undefined;
    }

    const enqueue = () => {
      saveQueue = saveQueue
        .catch(() => undefined)
        .then(() => persistAutoSaveSnapshot(snapshot));
    };

    if (delay === 0) {
      enqueue();
    } else {
      updateSettingsStatus("等待自动保存…", "pending");
      autoSaveTimer = window.setTimeout(() => {
        autoSaveTimer = undefined;
        enqueue();
      }, delay);
    }
  };

  for (const input of providerInputs) {
    input.addEventListener("change", () => {
      if (input.checked) {
        updateProviderView(input.value as ProviderId);
        enqueueAutoSave(0);
      }
    });
  }

  modelInputElement.addEventListener("input", () => {
    updateRequestConfigPreview();
    enqueueAutoSave();
  });
  baseUrlInputElement.addEventListener("input", () => {
    updateRequestConfigPreview();
    enqueueAutoSave();
  });
  targetLanguageElement.addEventListener("change", () => enqueueAutoSave(0));
  apiKeyElement.addEventListener("change", () => {
    const apiKey = apiKeyElement.value.trim();
    if (apiKey) enqueueAutoSave(0, apiKey);
  });
  void invoke<TranslationSettings>("get_translation_settings")
    .then((settings) => {
      targetLanguageElement.value = settings.targetLanguage;
      configuredProviders.clear();
      for (const provider of settings.configuredProviders) {
        configuredProviders.add(provider);
      }
      for (const provider of AI_PROVIDERS) {
        const config = settings.providerConfigs?.[provider.id];
        if (config) providerConfigs[provider.id] = { ...config };
      }
      updateProviderView(settings.provider, false);
      const configured = configuredProviders.has(settings.provider);
      updateSettingsStatus(
        configured ? "翻译配置已就绪" : `请填写 ${providerMetadata(settings.provider).name} API Key`,
        configured ? "ready" : "pending",
      );
    })
    .catch((error) =>
      updateSettingsStatus(`读取翻译设置失败：${String(error)}`, "error"),
    );

  formElement.addEventListener("submit", (event) => {
    event.preventDefault();
    enqueueAutoSave(0, apiKeyElement.value.trim() || undefined);
  });

  deleteKeyElement.addEventListener("click", async () => {
    deleteKeyElement.disabled = true;
    updateSettingsStatus("正在移除 API Key…", "pending");
    try {
      // If leaving the input queued an API Key save, let it finish first so the
      // explicit removal is guaranteed to be the final credential operation.
      await saveQueue.catch(() => undefined);
      const provider = providerMetadata(selectedProvider);
      await invoke("delete_provider_api_key", { provider: selectedProvider });
      configuredProviders.delete(selectedProvider);
      updateProviderView(selectedProvider, false);
      updateSettingsStatus(`${provider.name} API Key 已从系统凭据库移除`, "pending");
    } catch (error) {
      updateSettingsStatus(`移除失败：${String(error)}`, "error");
      deleteKeyElement.disabled = false;
    }
  });
}

function renderCaptureOverlay() {
  document.title = "截图选区";
  document.documentElement.classList.add("capture-page");
  app.className = "capture-overlay";
  app.innerHTML = `
    <div class="capture-hint">
      <strong>拖动鼠标选择区域</strong>
      <span>松开确认 · Esc 取消</span>
    </div>
    <div class="selection" hidden>
      <span class="selection-size"></span>
    </div>
    <div class="capture-error" role="alert" hidden></div>
  `;

  const selectionElement = app.querySelector<HTMLDivElement>(".selection");
  const sizeElement = app.querySelector<HTMLSpanElement>(".selection-size");
  const errorElement = app.querySelector<HTMLDivElement>(".capture-error");

  if (!selectionElement || !sizeElement || !errorElement) {
    throw new Error("capture overlay elements are missing");
  }

  let pointerId: number | null = null;
  let origin: Point | null = null;
  let selection: Selection | null = null;

  const resetSelection = () => {
    pointerId = null;
    origin = null;
    selection = null;
    selectionElement.hidden = true;
    errorElement.hidden = true;
  };

  const updateSelection = (point: Point) => {
    if (!origin) return;

    const x = Math.min(origin.x, point.x);
    const y = Math.min(origin.y, point.y);
    const width = Math.abs(point.x - origin.x);
    const height = Math.abs(point.y - origin.y);
    selection = { x, y, width, height };

    selectionElement.hidden = false;
    selectionElement.style.transform = `translate(${x}px, ${y}px)`;
    selectionElement.style.width = `${width}px`;
    selectionElement.style.height = `${height}px`;
    sizeElement.textContent = `${Math.round(width)} × ${Math.round(height)}`;
  };

  app.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;

    resetSelection();
    pointerId = event.pointerId;
    origin = { x: event.clientX, y: event.clientY };
    app.setPointerCapture(event.pointerId);
    updateSelection(origin);
  });

  app.addEventListener("pointermove", (event) => {
    if (event.pointerId !== pointerId) return;
    updateSelection({ x: event.clientX, y: event.clientY });
  });

  app.addEventListener("pointerup", async (event) => {
    if (event.pointerId !== pointerId) return;

    updateSelection({ x: event.clientX, y: event.clientY });
    app.releasePointerCapture(event.pointerId);
    pointerId = null;
    origin = null;

    if (!selection || selection.width < 4 || selection.height < 4) {
      resetSelection();
      return;
    }

    try {
      await invoke("complete_selection", {
        selection: {
          ...selection,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        },
      });
      resetSelection();
    } catch (error) {
      errorElement.textContent = String(error);
      errorElement.hidden = false;
    }
  });

  window.addEventListener("keydown", async (event) => {
    if (event.key !== "Escape") return;

    event.preventDefault();
    resetSelection();
    try {
      await invoke("cancel_selection");
    } catch (error) {
      errorElement.textContent = String(error);
      errorElement.hidden = false;
    }
  });

  window.addEventListener("focus", () => {
    resetSelection();
    if (import.meta.env.DEV) {
      void invoke("log_capture_viewport", {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
      });
    }
  });
}

function renderResult() {
  document.title = "OPENSCREENTRANSLATE";
  app.className = "result-view";
  app.innerHTML = `
    <div class="result-titlebar-drag-region" aria-hidden="true"></div>
    <div class="result-language-bar" aria-label="翻译语言">
      <label class="language-select-control">
        <span>源语言</span>
        <select class="source-language-select">${languageOptions(true)}</select>
      </label>
      <span class="language-arrow" aria-hidden="true">→</span>
      <label class="language-select-control">
        <span>目标语言</span>
        <select class="result-target-language-select">${languageOptions()}</select>
      </label>
    </div>
    <section class="result-field">
      <span>原文</span>
      <div class="result-textarea-shell">
        <textarea class="source-text" aria-label="原文" maxlength="${MAX_SOURCE_TEXT_LENGTH}" placeholder="识别中…"></textarea>
        <span class="source-character-count" aria-live="polite">0/${MAX_SOURCE_TEXT_LENGTH}</span>
      </div>
    </section>
    <section class="result-field translation-field">
      <span class="translation-field-label">译文<span class="translation-streaming-label" aria-live="polite"></span></span>
      <div class="result-textarea-shell translation-textarea-shell" data-streaming="false">
        <textarea class="translation-text" aria-label="译文" readonly placeholder="等待原文…"></textarea>
        <div class="translation-text-measure" aria-hidden="true"></div>
        <span class="translation-stream-indicator" aria-hidden="true"></span>
        <button class="translation-copy-button" type="button" aria-label="复制译文" title="复制译文" disabled>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="8" y="8" width="11" height="11" rx="2"></rect>
            <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path>
          </svg>
        </button>
        <div class="result-toast" role="status" aria-live="polite" hidden></div>
      </div>
    </section>
    <div class="result-status" data-state="processing" hidden></div>
  `;

  const sourceLanguageElement = requireElement<HTMLSelectElement>(
    ".source-language-select",
  );
  const dragRegionElement = requireElement<HTMLDivElement>(
    ".result-titlebar-drag-region",
  );
  const targetLanguageElement = requireElement<HTMLSelectElement>(
    ".result-target-language-select",
  );
  const sourceElement = requireElement<HTMLTextAreaElement>(".source-text");
  const translationElement = requireElement<HTMLTextAreaElement>(".translation-text");
  const translationShellElement = requireElement<HTMLDivElement>(
    ".translation-textarea-shell",
  );
  const translationMeasureElement = requireElement<HTMLDivElement>(
    ".translation-text-measure",
  );
  const streamingLabelElement = requireElement<HTMLSpanElement>(
    ".translation-streaming-label",
  );
  const characterCountElement = requireElement<HTMLSpanElement>(
    ".source-character-count",
  );
  const copyButtonElement = requireElement<HTMLButtonElement>(
    ".translation-copy-button",
  );
  const statusElement = requireElement<HTMLDivElement>(".result-status");
  const toastElement = requireElement<HTMLDivElement>(".result-toast");
  let sourceReady = false;
  let sourceEditPending = false;
  let sourceEditTimer: ReturnType<typeof setTimeout> | undefined;
  let retranslationRevision = 0;
  let activeTranslationToken: TranslationRequestToken | null = null;
  let copyFeedbackTimer: ReturnType<typeof setTimeout> | undefined;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let toastHideTimer: ReturnType<typeof setTimeout> | undefined;
  let layoutFrame: number | undefined;
  let lastRequestedWindowHeight = 404;

  const RESULT_MIN_WINDOW_HEIGHT = 404;
  const RESULT_MIN_TRANSLATION_HEIGHT = 76;
  const RESULT_WINDOW_MAX_SCREEN_RATIO = 0.7;

  dragRegionElement.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    void getCurrentWindow().startDragging();
  });

  const sameTranslationToken = (
    left: TranslationRequestToken | null,
    right: TranslationRequestToken,
  ) =>
    left?.requestId === right.requestId &&
    left.translationGeneration === right.translationGeneration;

  const scheduleResultLayout = () => {
    if (layoutFrame !== undefined) cancelAnimationFrame(layoutFrame);
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = undefined;
      const availableScreenHeight = Math.max(
        RESULT_MIN_WINDOW_HEIGHT,
        window.screen.availHeight || window.innerHeight,
      );
      const maxWindowHeight = Math.max(
        RESULT_MIN_WINDOW_HEIGHT,
        Math.floor(availableScreenHeight * RESULT_WINDOW_MAX_SCREEN_RATIO),
      );
      const statusExtraHeight = statusElement.hidden ? 0 : statusElement.scrollHeight + 12;
      const maxTranslationHeight = Math.max(
        RESULT_MIN_TRANSLATION_HEIGHT,
        maxWindowHeight -
          RESULT_MIN_WINDOW_HEIGHT +
          RESULT_MIN_TRANSLATION_HEIGHT -
          statusExtraHeight,
      );
      const naturalHeight = Math.max(
        RESULT_MIN_TRANSLATION_HEIGHT,
        translationMeasureElement.scrollHeight,
      );
      const translationHeight = Math.min(naturalHeight, maxTranslationHeight);
      const heightValue = `${translationHeight}px`;
      translationElement.style.height = heightValue;
      translationShellElement.style.height = heightValue;
      translationElement.style.overflowY =
        naturalHeight > translationHeight ? "auto" : "hidden";

      const requestedWindowHeight = Math.min(
        maxWindowHeight,
        RESULT_MIN_WINDOW_HEIGHT +
          translationHeight -
          RESULT_MIN_TRANSLATION_HEIGHT +
          statusExtraHeight,
      );
      if (Math.abs(requestedWindowHeight - lastRequestedWindowHeight) >= 1) {
        lastRequestedWindowHeight = requestedWindowHeight;
        void invoke<number>("resize_result_window", { height: requestedWindowHeight }).catch(
          () => undefined,
        );
      }
    });
  };

  const resetTranslationLayout = () => {
    translationMeasureElement.textContent = "\u200b";
    translationElement.style.height = `${RESULT_MIN_TRANSLATION_HEIGHT}px`;
    translationShellElement.style.height = `${RESULT_MIN_TRANSLATION_HEIGHT}px`;
    translationElement.style.overflowY = "hidden";
    translationElement.scrollTop = 0;
    lastRequestedWindowHeight = RESULT_MIN_WINDOW_HEIGHT;
    void invoke<number>("resize_result_window", {
      height: RESULT_MIN_WINDOW_HEIGHT,
    }).catch(() => undefined);
  };

  const setStreamingState = (streaming: boolean) => {
    translationShellElement.dataset.streaming = String(streaming);
    translationElement.setAttribute("aria-busy", String(streaming));
    streamingLabelElement.textContent = streaming ? "正在生成" : "";
  };

  const setTranslationContent = (text: string, streaming: boolean) => {
    const distanceFromBottom =
      translationElement.scrollHeight -
      translationElement.clientHeight -
      translationElement.scrollTop;
    const shouldFollowOutput = distanceFromBottom < 32;
    translationElement.value = text;
    translationMeasureElement.textContent = `${text}\u200b`;
    translationElement.placeholder = text ? "" : streaming ? "翻译中…" : "";
    setStreamingState(streaming);
    scheduleResultLayout();
    if (shouldFollowOutput) {
      requestAnimationFrame(() => {
        translationElement.scrollTop = translationElement.scrollHeight;
      });
    }
  };

  const clearTranslationContent = (placeholder: string) => {
    translationElement.value = "";
    translationElement.placeholder = placeholder;
    translationMeasureElement.textContent = "\u200b";
    setStreamingState(false);
    scheduleResultLayout();
  };

  const updateResultStatus = (
    message: string,
    state: "processing" | "ready" | "empty" | "error",
  ) => {
    const shouldShow = state === "error";
    statusElement.textContent = shouldShow ? message : "";
    statusElement.dataset.state = state;
    statusElement.hidden = !shouldShow;
    scheduleResultLayout();
  };

  const showError = (message: string) => {
    updateResultStatus(message, "error");
  };

  const updateCharacterCount = () => {
    characterCountElement.textContent = `${sourceElement.value.length}/${MAX_SOURCE_TEXT_LENGTH}`;
  };

  const resetCopyFeedback = () => {
    copyButtonElement.dataset.copied = "false";
    copyButtonElement.ariaLabel = "复制译文";
    copyButtonElement.title = "复制译文";
  };

  const showToast = (message: string) => {
    if (toastTimer !== undefined) clearTimeout(toastTimer);
    if (toastHideTimer !== undefined) clearTimeout(toastHideTimer);
    toastElement.textContent = message;
    toastElement.hidden = false;
    requestAnimationFrame(() => {
      toastElement.dataset.visible = "true";
    });
    toastTimer = setTimeout(() => {
      toastElement.dataset.visible = "false";
      toastHideTimer = setTimeout(() => {
        toastElement.hidden = true;
      }, 160);
    }, 1500);
  };

  const updateCopyAvailability = () => {
    copyButtonElement.disabled = translationElement.value.length === 0;
    if (copyButtonElement.disabled) resetCopyFeedback();
  };

  const loadTranslation = async () => {
    if (sourceEditPending) return;
    try {
      const result = await invoke<TranslationSnapshot>("get_translation_result");
      const resultToken = {
        requestId: result.requestId,
        translationGeneration: result.translationGeneration,
      };
      const isNewTranslation = !sameTranslationToken(activeTranslationToken, resultToken);
      if (
        activeTranslationToken &&
        (resultToken.requestId < activeTranslationToken.requestId ||
          (resultToken.requestId === activeTranslationToken.requestId &&
            resultToken.translationGeneration <
              activeTranslationToken.translationGeneration))
      ) {
        return;
      }
      activeTranslationToken = resultToken;
      if (isNewTranslation) resetTranslationLayout();
      sourceLanguageElement.value = result.sourceLanguage;
      targetLanguageElement.value = result.targetLanguage;
      if (result.status === "ready") {
        setTranslationContent(result.text ?? "", false);
        updateResultStatus("", "ready");
      } else if (result.status === "empty") {
        clearTranslationContent(result.manualInput ? "等待输入…" : "无可翻译文本");
        updateResultStatus("未识别到文本", "empty");
      } else if (result.status === "error") {
        clearTranslationContent("翻译失败");
        showError(`翻译失败：${result.error ?? "未知错误"}`);
      } else {
        const streamedText = result.text ?? "";
        if (
          !isNewTranslation &&
          translationElement.value.length > streamedText.length
        ) {
          setStreamingState(true);
        } else {
          setTranslationContent(streamedText, true);
        }
        updateResultStatus("正在翻译…", "processing");
      }
      updateCopyAvailability();
    } catch {
      activeTranslationToken = null;
      resetTranslationLayout();
      clearTranslationContent("等待原文…");
      updateCopyAvailability();
    }
  };

  const requestRetranslation = async () => {
    if (!sourceReady) return;
    if (sourceEditTimer !== undefined) {
      clearTimeout(sourceEditTimer);
      sourceEditTimer = undefined;
    }
    const revision = ++retranslationRevision;
    sourceEditPending = true;
    activeTranslationToken = null;
    resetTranslationLayout();
    clearTranslationContent("翻译中…");
    setStreamingState(true);
    updateCopyAvailability();
    updateResultStatus("正在翻译…", "processing");
    try {
      const token = await invoke<TranslationRequestToken>("retranslate", {
        sourceText: sourceElement.value,
        sourceLanguage: sourceLanguageElement.value,
        targetLanguage: targetLanguageElement.value,
      });
      if (revision !== retranslationRevision) return;
      activeTranslationToken = token;
      sourceEditPending = false;
      await loadTranslation();
    } catch (error) {
      if (revision !== retranslationRevision) return;
      sourceEditPending = false;
      setStreamingState(false);
      showError(`重新翻译失败：${String(error)}`);
    }
  };

  const loadResult = async () => {
    if (sourceEditPending) return;
    try {
      const source = await invoke<SourceTextSnapshot>("get_ocr_text");
      sourceReady = true;
      sourceElement.value = source.text;
      sourceElement.placeholder = source.text
        ? ""
        : source.manualInput
          ? "请输入原文"
          : "未识别到文本";
      updateCharacterCount();
      updateResultStatus(
        source.text ? "正在翻译…" : source.manualInput ? "等待输入…" : "未识别到文本",
        source.text ? "processing" : "empty",
      );
      await loadTranslation();
    } catch {
      sourceReady = false;
      activeTranslationToken = null;
      resetTranslationLayout();
      sourceElement.value = "";
      sourceElement.placeholder = "识别中…";
      clearTranslationContent("等待原文…");
      updateCharacterCount();
      updateCopyAvailability();
      updateResultStatus("正在识别…", "processing");
    }
  };

  sourceLanguageElement.value = "auto";
  targetLanguageElement.value = "zh-CN";
  updateCharacterCount();
  updateCopyAvailability();
  void invoke<TranslationSettings>("get_translation_settings")
    .then((settings) => {
      if (!sourceReady) targetLanguageElement.value = settings.targetLanguage;
    })
    .catch(() => undefined);

  sourceLanguageElement.addEventListener("change", () => void requestRetranslation());
  targetLanguageElement.addEventListener("change", () => void requestRetranslation());
  sourceElement.addEventListener("input", () => {
    retranslationRevision += 1;
    activeTranslationToken = null;
    sourceReady = true;
    sourceEditPending = true;
    sourceElement.placeholder = sourceElement.value ? "" : "请输入原文";
    updateCharacterCount();
    resetTranslationLayout();
    clearTranslationContent("等待输入完成…");
    updateCopyAvailability();
    updateResultStatus("正在等待输入…", "processing");
    if (sourceEditTimer !== undefined) clearTimeout(sourceEditTimer);
    sourceEditTimer = setTimeout(() => {
      sourceEditTimer = undefined;
      void requestRetranslation();
    }, 500);
  });

  copyButtonElement.addEventListener("click", async () => {
    if (!translationElement.value) return;
    try {
      await invoke("copy_text_to_clipboard", { text: translationElement.value });
      if (copyFeedbackTimer !== undefined) clearTimeout(copyFeedbackTimer);
      copyButtonElement.dataset.copied = "true";
      copyButtonElement.ariaLabel = "已复制";
      copyButtonElement.title = "已复制";
      copyFeedbackTimer = setTimeout(resetCopyFeedback, 1200);
      showToast("译文已复制");
    } catch (error) {
      showError(`复制失败：${String(error)}`);
    }
  });

  void listen("ocr-ready", () => void loadResult());
  void listen<string>("ocr-error", (event) => {
    sourceReady = false;
    activeTranslationToken = null;
    resetTranslationLayout();
    clearTranslationContent("等待原文…");
    updateCopyAvailability();
    showError(`OCR 失败：${event.payload}`);
  });
  void listen<TranslationProgress>("translation-progress", (event) => {
    if (sourceEditPending) return;
    const progress = event.payload;
    if (
      activeTranslationToken &&
      !sameTranslationToken(activeTranslationToken, progress)
    ) {
      return;
    }
    activeTranslationToken = progress;
    setTranslationContent(progress.text, true);
    updateCopyAvailability();
    updateResultStatus("正在翻译…", "processing");
  });
  void listen("translation-ready", () => void loadTranslation());
  void listen("translation-error", () => void loadTranslation());
  window.addEventListener("focus", () => void loadResult());
}

const view = new URLSearchParams(window.location.search).get("view");

if (view === "capture") {
  renderCaptureOverlay();
  document.documentElement.dataset.ready = "true";
} else if (view === "result") {
  renderResult();
  document.documentElement.dataset.ready = "true";
} else {
  app.className = "startup-loading";
  app.innerHTML = `<div class="startup-loading-indicator" role="status">正在检查初始化状态…</div>`;
  void invoke<StartupReadiness>("get_startup_readiness")
    .then((readiness) => {
      if (
        !readiness.onboardingCompleted ||
        !readiness.screenCapturePermissionGranted ||
        !readiness.apiKeyConfigured
      ) {
        renderOnboarding(readiness);
      } else {
        renderSettings();
      }
    })
    .catch(() => renderSettings())
    .finally(() => {
      document.documentElement.dataset.ready = "true";
    });
}
