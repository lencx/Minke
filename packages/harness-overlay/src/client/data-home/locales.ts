export const dataHomeZh = {
  nav: "数据与存储",
  title: "数据与存储",
  description:
    "选择 DSH 的稳定数据目录，并决定合并现有数据或从全新目录开始。",
  currentLabel: "当前目录",
  currentHelp: "Minke 中的所有 DSH 进程都使用此路径。",
  externalHelp:
    "若也在终端中单独运行 DSH，请将外部 $DSH_HOME 设置为迁移后的同一路径。",
  targetLabel: "目标目录",
  optionCurrent: "保留当前目录",
  optionRecommended: "Minke 推荐",
  optionRecommendedHelp: "统一存放在 ~/.minke/harness",
  optionCustom: "自定义目录",
  customPlaceholder: "选择或输入数据目录",
  browse: "浏览…",
  modeLabel: "数据处理方式",
  modeMerge: "合并现有数据",
  modeRecommended: "推荐",
  modeMergeHelp:
    "将相关目录中的会话、插件和配置合并到目标目录；发生冲突时保留目标版本。",
  modeFresh: "作为全新目录使用",
  modeFreshHelp:
    "不复制任何现有数据；目标目录必须不存在或完全为空。",
  detectedTitle: "相关数据目录",
  detectedEmpty: "没有发现相关数据目录",
  candidateSummary: "{files} 个文件 · {size}",
  originActive: "当前",
  originConfigured: "已配置",
  originMinke: "Minke",
  originEnvironment: "$DSH_HOME",
  originDefault: "DSH 默认",
  previewMerge: "预览合并",
  reviewFresh: "检查新目录",
  previewing: "正在检查…",
  planTitle: "迁移预览",
  planCopy: "将复制 {files} 个文件（{size}）",
  planIdentical: "{files} 个相同文件将去重",
  planConflicts: "{files} 个冲突将保留目标版本",
  conflictPaths: "需手动检查的源文件",
  conflictMore: "另有 {files} 个冲突未在此处列出",
  freshPlanTitle: "新目录检查",
  freshPlanBody:
    "不会复制现有会话、插件或配置。重启后 Minke 将只使用 {path}。",
  riskTitle: "迁移风险",
  riskBody:
    "迁移会在重启后执行。不会删除源目录；同名且内容不同的文件不会覆盖，需稍后根据报告手动处理。",
  riskAccept: "我已了解风险，并确认迁移到此目录",
  freshRiskTitle: "切换影响",
  freshRiskBody:
    "旧数据不会删除，但切换后不会出现在 Minke 中；以后仍可切回原目录。",
  freshRiskAccept: "我确认不复制现有数据，并使用这个全新目录",
  migrate: "迁移并重启",
  activateFresh: "使用新目录并重启",
  scheduling: "正在安排迁移…",
  scheduled: "迁移已安排，Minke 即将重启。",
  freshScheduled: "新目录切换已安排，Minke 即将重启。",
  lastCompleted: "上次迁移已完成：复制 {files} 个文件，发现 {conflicts} 个冲突。",
  lastFreshCompleted: "上次已切换到全新目录，未复制旧数据。",
  lastFailed: "上次迁移失败：{error}",
  errorUnavailable:
    "当前 Minke 版本未提供数据目录服务。请完全退出后启动最新构建。",
  errorRead: "无法读取数据目录状态。",
  errorChoose: "无法选择数据目录。",
  errorPlan: "无法生成迁移预览。",
  errorFresh:
    "无法将该位置作为全新目录使用。请选择不存在或完全为空的专用目录。",
  errorSchedule: "无法安排数据迁移。",
} as const;

export type DataHomeLocaleKey = keyof typeof dataHomeZh;

export const dataHomeEn: Record<DataHomeLocaleKey, string> = {
  nav: "Data & Storage",
  title: "Data & Storage",
  description:
    "Choose a stable DSH data directory, then merge existing data or start with a fresh directory.",
  currentLabel: "Current directory",
  currentHelp: "Every DSH process launched by Minke uses this path.",
  externalHelp:
    "If you also run DSH outside Minke, set its $DSH_HOME to the same migrated path.",
  targetLabel: "Target directory",
  optionCurrent: "Keep current directory",
  optionRecommended: "Minke recommended",
  optionRecommendedHelp: "Keep everything under ~/.minke/harness",
  optionCustom: "Custom directory",
  customPlaceholder: "Choose or enter a data directory",
  browse: "Browse…",
  modeLabel: "Data handling",
  modeMerge: "Merge existing data",
  modeRecommended: "Recommended",
  modeMergeHelp:
    "Merge sessions, plugins, and configuration from known directories into the target. The target version wins conflicts.",
  modeFresh: "Use as a fresh directory",
  modeFreshHelp:
    "Copy no existing data. The target must not exist or must be completely empty.",
  detectedTitle: "Known data directories",
  detectedEmpty: "No related data directories were found",
  candidateSummary: "{files} files · {size}",
  originActive: "Current",
  originConfigured: "Configured",
  originMinke: "Minke",
  originEnvironment: "$DSH_HOME",
  originDefault: "DSH default",
  previewMerge: "Preview merge",
  reviewFresh: "Check fresh directory",
  previewing: "Checking…",
  planTitle: "Migration preview",
  planCopy: "{files} files ({size}) will be copied",
  planIdentical: "{files} identical files will be deduplicated",
  planConflicts: "{files} conflicts will keep the target version",
  conflictPaths: "Source files requiring manual review",
  conflictMore: "{files} additional conflicts are not listed here",
  freshPlanTitle: "Fresh directory check",
  freshPlanBody:
    "No existing sessions, plugins, or configuration will be copied. After restart, Minke will use only {path}.",
  riskTitle: "Migration risk",
  riskBody:
    "Migration runs after restart. Source directories are not deleted; files with the same name but different contents are not overwritten and may need manual reconciliation.",
  riskAccept: "I understand the risk and approve this target",
  freshRiskTitle: "What changes",
  freshRiskBody:
    "Existing data is not deleted, but it will not appear in Minke after the switch. You can switch back later.",
  freshRiskAccept:
    "I understand that existing data will not be copied",
  migrate: "Migrate and restart",
  activateFresh: "Use fresh directory and restart",
  scheduling: "Scheduling migration…",
  scheduled: "Migration is scheduled. Minke will restart shortly.",
  freshScheduled:
    "The fresh-directory switch is scheduled. Minke will restart shortly.",
  lastCompleted:
    "Last migration completed: {files} files copied, {conflicts} conflicts found.",
  lastFreshCompleted:
    "The last change switched to a fresh directory without copying existing data.",
  lastFailed: "Last migration failed: {error}",
  errorUnavailable:
    "This Minke version does not provide the data-directory service. Fully quit it, then launch the latest build.",
  errorRead: "Could not read data-directory status.",
  errorChoose: "Could not choose a data directory.",
  errorPlan: "Could not build the migration preview.",
  errorFresh:
    "This location cannot be used as a fresh directory. Choose a dedicated directory that does not exist or is completely empty.",
  errorSchedule: "Could not schedule data migration.",
};

export type DataHomeTranslate = (
  key: DataHomeLocaleKey,
  params?: Record<string, unknown>,
) => string;
