import type { ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Binary,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  FileQuestion,
  FolderOpen,
  FolderSymlink,
  FolderTree,
  Image,
  Link,
  List,
  LoaderCircle,
  Save,
  X,
} from "@lucide/icons";
import {
  LucideIcon,
} from "@minke/harness-overlay/client/tabs/components/LucideIcon.tsx";
import {
  loadFileIcon,
  loadFolderIcon,
  type LoadedFileIcon,
} from "./file-icon-loader.ts";

type IconProps = { readonly size?: number };
type NamedIconProps = IconProps & {
  readonly name?: string;
};
type DirectoryIconProps = NamedIconProps & {
  readonly expanded?: boolean;
};

function VscodeIcon(props: {
  readonly icon: LoadedFileIcon;
  readonly size?: number;
}): ReactNode {
  const size = props.size ?? 16;
  // The SVG body comes only from the pinned local icon package.
  return (
    <svg
      className="minke-vscode-file-icon"
      width={size}
      height={size}
      viewBox={props.icon.viewBox}
      preserveAspectRatio="xMidYMid meet"
      focusable="false"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: props.icon.body }}
    />
  );
}

export function FilesIcon(props: IconProps): ReactNode {
  return <LucideIcon icon={FolderOpen} size={props.size} />;
}

export function DirectoryIcon(
  props: DirectoryIconProps,
): ReactNode {
  return (
    <VscodeIcon
      icon={loadFolderIcon(props.name ?? "", {
        expanded: props.expanded,
      })}
      size={props.size}
    />
  );
}

export function FileIcon(props: NamedIconProps): ReactNode {
  return (
    <VscodeIcon
      icon={loadFileIcon(props.name ?? "")}
      size={props.size}
    />
  );
}

export function SymlinkIcon(props: IconProps): ReactNode {
  return <LucideIcon icon={Link} size={props.size} />;
}

export function OtherFileIcon(props: IconProps): ReactNode {
  return <LucideIcon icon={FileQuestion} size={props.size} />;
}

export function BackIcon(props: IconProps): ReactNode {
  return <LucideIcon icon={ArrowLeft} size={props.size} />;
}

export function ForwardIcon(props: IconProps): ReactNode {
  return <LucideIcon icon={ArrowRight} size={props.size} />;
}

export function UpIcon(props: IconProps): ReactNode {
  return <LucideIcon icon={ArrowUp} size={props.size} />;
}

export function OpenSystemIcon(props: IconProps): ReactNode {
  return <LucideIcon icon={ExternalLink} size={props.size} />;
}

export function OpenFolderIcon(props: IconProps): ReactNode {
  return <LucideIcon icon={FolderSymlink} size={props.size} />;
}

export function EnterDirectoryIcon(
  props: IconProps,
): ReactNode {
  return <LucideIcon icon={ChevronRight} size={props.size} />;
}

export function CollapseDirectoryIcon(
  props: IconProps,
): ReactNode {
  return <LucideIcon icon={ChevronDown} size={props.size} />;
}

export function ListModeIcon(props: IconProps): ReactNode {
  return <LucideIcon icon={List} size={props.size} />;
}

export function TreeModeIcon(props: IconProps): ReactNode {
  return <LucideIcon icon={FolderTree} size={props.size} />;
}

export function ClosePreviewIcon(props: IconProps): ReactNode {
  return <LucideIcon icon={X} size={props.size} />;
}

export function SavePreviewIcon(props: IconProps): ReactNode {
  return <LucideIcon icon={Save} size={props.size} />;
}

export function SavingPreviewIcon(props: IconProps): ReactNode {
  return <LucideIcon icon={LoaderCircle} size={props.size} />;
}

export function SavedPreviewIcon(props: IconProps): ReactNode {
  return <LucideIcon icon={Check} size={props.size} />;
}

export function TextPreviewIcon(props: IconProps): ReactNode {
  return <LucideIcon icon={FileText} size={props.size} />;
}

export function ImagePreviewIcon(props: IconProps): ReactNode {
  return <LucideIcon icon={Image} size={props.size} />;
}

export function UnsupportedPreviewIcon(
  props: IconProps,
): ReactNode {
  return <LucideIcon icon={Binary} size={props.size} />;
}
