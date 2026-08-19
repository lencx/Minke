export const filesTabsZh = {
  "files.create.label": "文件管理器",
  "files.tab.new": "文件",
  "files.nav.back": "后退",
  "files.nav.forward": "前进",
  "files.nav.up": "上一级",
  "files.nav.openSystem": "在系统文件管理器中打开",
  "files.mode.group": "浏览模式",
  "files.mode.list": "列表模式",
  "files.mode.tree": "树形模式",
  "files.path.label": "文件路径",
  "files.path.placeholder": "输入绝对路径",
  "files.git.branch": "Git 分支：{branch}",
  "files.entry.open": "打开“{name}”",
  "files.entry.preview": "预览“{name}”",
  "files.entry.expand": "展开“{name}”",
  "files.entry.collapse": "折叠“{name}”",
  "files.tree.loading": "正在读取此文件夹",
  "files.tree.retry": "重试读取此文件夹",
  "files.state.loading": "正在读取“{path}”",
  "files.empty.title": "此文件夹为空",
  "files.empty.body": "这里暂时没有文件或文件夹。",
  "files.error.title": "无法打开此位置",
  "files.error.retry": "重试",
  "files.limit":
    "此文件夹项目过多，仅显示前 2,000 项。",
  "files.preview.label": "文件预览",
  "files.preview.close": "关闭预览",
  "files.preview.openSystem": "用系统默认应用打开",
  "files.preview.loading": "正在加载预览",
  "files.preview.retry": "重试预览",
  "files.preview.resize": "调整文件预览宽度",
  "files.preview.editor": "编辑“{name}”",
  "files.preview.mode.group": "源码查看模式",
  "files.preview.mode.source": "源码",
  "files.preview.mode.diff": "差异",
  "files.preview.diff.editor": "查看“{name}”相对 Git HEAD 的差异",
  "files.preview.diff.loading": "正在计算与 Git HEAD 的差异",
  "files.preview.diff.retry": "重试差异",
  "files.preview.diff.error": "无法加载差异：{error}",
  "files.preview.diff.binary": "二进制文件不支持源码差异。",
  "files.preview.diff.gitUnavailable":
    "系统中未找到 Git，无法加载源码差异。",
  "files.preview.diff.notRepository":
    "此文件不在 Git 仓库中，无法加载源码差异。",
  "files.preview.diff.tooLarge":
    "Git 基线超过 8 MB，无法加载源码差异。",
  "files.preview.dirty": "有未保存的更改",
  "files.preview.diskChanged":
    "文件已在磁盘上更改。为保护未保存内容，预览未自动重载。",
  "files.preview.saveError": "保存失败：{error}",
  "files.preview.discardConfirm":
    "“{name}”有未保存的更改，确定要放弃吗？",
  "files.preview.truncated": "文件较大，仅显示前 8 MB。",
  "files.preview.binary": "此二进制文件暂不支持预览。",
  "files.preview.tooLarge": "此图片超过 32 MB，无法在此处预览。",
} as const;

export type FilesTabsLocaleKey = keyof typeof filesTabsZh;
export type FilesTabsTranslate = (
  key: FilesTabsLocaleKey,
  params?: Record<string, unknown>,
) => string;

export const filesTabsEn: Record<
  FilesTabsLocaleKey,
  string
> = {
  "files.create.label": "File manager",
  "files.tab.new": "Files",
  "files.nav.back": "Back",
  "files.nav.forward": "Forward",
  "files.nav.up": "Up one level",
  "files.nav.openSystem": "Open in system file manager",
  "files.mode.group": "Browse mode",
  "files.mode.list": "List view",
  "files.mode.tree": "Tree view",
  "files.path.label": "File path",
  "files.path.placeholder": "Enter an absolute path",
  "files.git.branch": "Git branch: {branch}",
  "files.entry.open": "Open “{name}”",
  "files.entry.preview": "Preview “{name}”",
  "files.entry.expand": "Expand “{name}”",
  "files.entry.collapse": "Collapse “{name}”",
  "files.tree.loading": "Reading this folder",
  "files.tree.retry": "Try reading this folder again",
  "files.state.loading": "Reading “{path}”",
  "files.empty.title": "This folder is empty",
  "files.empty.body": "There are no files or folders here yet.",
  "files.error.title": "This location could not be opened",
  "files.error.retry": "Try again",
  "files.limit":
    "This folder has many items. Only the first 2,000 are shown.",
  "files.preview.label": "File preview",
  "files.preview.close": "Close preview",
  "files.preview.openSystem": "Open with default system application",
  "files.preview.loading": "Loading preview",
  "files.preview.retry": "Try preview again",
  "files.preview.resize": "Resize file preview",
  "files.preview.editor": "Edit “{name}”",
  "files.preview.mode.group": "Source reader mode",
  "files.preview.mode.source": "Source",
  "files.preview.mode.diff": "Diff",
  "files.preview.diff.editor":
    "Review changes to “{name}” from Git HEAD",
  "files.preview.diff.loading":
    "Computing changes from Git HEAD",
  "files.preview.diff.retry": "Try the diff again",
  "files.preview.diff.error": "Could not load diff: {error}",
  "files.preview.diff.binary":
    "Source diff is not available for binary files.",
  "files.preview.diff.gitUnavailable":
    "Git is unavailable, so the source diff cannot be loaded.",
  "files.preview.diff.notRepository":
    "This file is not in a Git repository.",
  "files.preview.diff.tooLarge":
    "The Git baseline is larger than 8 MB.",
  "files.preview.dirty": "Unsaved changes",
  "files.preview.diskChanged":
    "This file changed on disk. The preview was not reloaded to protect your unsaved changes.",
  "files.preview.saveError": "Save failed: {error}",
  "files.preview.discardConfirm":
    "“{name}” has unsaved changes. Discard them?",
  "files.preview.truncated":
    "This file is large. Only the first 8 MB are shown.",
  "files.preview.binary":
    "Preview is not available for this binary file.",
  "files.preview.tooLarge":
    "This image is larger than 32 MB and cannot be previewed here.",
};
