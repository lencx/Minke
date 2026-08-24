export const localModelZh = {
  modelsTitle: "模型",
  autoStart: "自动启动",
  restartRequired: "立即生效",
  applying: "正在应用…",
  localTag: "本地",
  customTag: "自定义",
  noModels: "尚未检测到模型",
  commandNotFound: "未找到本地命令，可手动配置服务地址",
  configure: "配置",
  customProviderAction: "添加自定义提供方",
  customProviderTitle: "自定义提供方",
  customRoute: "提供方 ID",
  customDisplayName: "显示名称",
  customApi: "API 协议",
  baseURL: "Base URL",
  customized: "自定义设置",
  keyInput: "API 密钥",
  localSettings: "本地服务配置",
  optionalToken: "可选 API Token",
  optionalTokenPlaceholder: "仅在本地服务启用鉴权时填写",
  optionalTokenHint: "本地服务通常无需 Token；仅在服务已启用鉴权时填写。",
  readError: "无法读取自动启动设置；重新打开“模型”设置以重试。",
  writeError: "无法应用自动启动设置。",
} as const;

export type LocalModelLocaleKey = keyof typeof localModelZh;

export const localModelEn: Record<
  LocalModelLocaleKey,
  string
> = {
  modelsTitle: "Models",
  autoStart: "Auto-start",
  restartRequired: "Applies immediately",
  applying: "Applying…",
  localTag: "Local",
  customTag: "Custom",
  noModels: "No models detected",
  commandNotFound:
    "Local command not found; configure a service URL manually",
  configure: "Configure",
  customProviderAction: "Add a custom provider",
  customProviderTitle: "Custom provider",
  customRoute: "Provider ID",
  customDisplayName: "Display name",
  customApi: "API protocol",
  baseURL: "Base URL",
  customized: "Customized settings",
  keyInput: "API key",
  localSettings: "Local service settings",
  optionalToken: "Optional API token",
  optionalTokenPlaceholder:
    "Use only when local authentication is enabled",
  optionalTokenHint:
    "Usually unnecessary for a local service; use only when authentication is enabled.",
  readError: "Could not read auto-start settings. Reopen Models to retry.",
  writeError: "Could not apply auto-start settings.",
};

export type LocalModelTranslate = (
  key: LocalModelLocaleKey,
) => string;
