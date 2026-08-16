import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import {
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type {
  TerminalTabsController,
} from "./controller.ts";
import type {
  TerminalTabsTranslate,
} from "./locales.ts";
import type {
  TerminalTab,
} from "./types.ts";
import type {
  TerminalSettingsRuntime,
} from "./settings/runtime.ts";
import {
  applyTerminalRenderingSettings,
  terminalRenderingOptions,
} from "./settings/rendering.ts";

function themeFontFamilyFrom(host: HTMLElement): string {
  return (
    host.ownerDocument.defaultView
      ?.getComputedStyle(host)
      .getPropertyValue("--ds-font-family-code") ?? ""
  );
}

function themeFrom(host: HTMLElement) {
  const styles = host.ownerDocument.defaultView?.getComputedStyle(host);
  const token = (name: string, fallback: string): string => {
    const value = styles?.getPropertyValue(name).trim();
    return value === undefined || value === "" ? fallback : value;
  };
  return {
    background: token("--dsw-alias-bg-base", "#0f1115"),
    foreground: token("--dsw-alias-label-primary", "#f4f4f5"),
    cursor: token("--dsw-alias-brand-primary", "#7c8cff"),
    cursorAccent: token("--dsw-alias-bg-base", "#0f1115"),
    selectionBackground: token(
      "--dsw-alias-interactive-bg-hover",
      "#303440",
    ),
  };
}

function exitLabel(
  t: TerminalTabsTranslate,
  exitCode: number | undefined,
): string {
  return t("terminal.state.exited", {
    code: exitCode ?? "?",
  });
}

export function TerminalView(props: {
  tab: TerminalTab;
  active: boolean;
  controller: TerminalTabsController;
  settings: TerminalSettingsRuntime;
  t: TerminalTabsTranslate;
}): ReactNode {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const settingsSnapshot = useSyncExternalStore(
    props.settings.subscribe,
    props.settings.getSnapshot,
    props.settings.getSnapshot,
  );

  useEffect(() => {
    const host = hostRef.current;
    const view = host?.ownerDocument.defaultView;
    if (host === null || view === null || view === undefined) return;
    const terminalSettings = props.settings.getSnapshot().settings;
    const rendering = terminalRenderingOptions(
      terminalSettings,
      themeFontFamilyFrom(host),
    );
    const terminal = new Terminal({
      allowTransparency: false,
      cursorBlink: true,
      cursorStyle: "block",
      ...rendering,
      scrollback: 5_000,
      screenReaderMode: true,
      theme: themeFrom(host),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    terminalRef.current = terminal;
    fitRef.current = fit;

    let frame: number | undefined;
    const fitTerminal = (): void => {
      if (
        host.clientWidth <= 0 ||
        host.clientHeight <= 0
      ) {
        return;
      }
      try {
        fit.fit();
        props.controller.resize(
          props.tab.id,
          terminal.cols,
          terminal.rows,
        );
      } catch {
        // A hidden tab can become zero-sized between measurement and fit.
      }
    };
    const scheduleFit = (): void => {
      if (frame !== undefined) view.cancelAnimationFrame(frame);
      frame = view.requestAnimationFrame(() => {
        frame = undefined;
        fitTerminal();
      });
    };
    const resize = new view.ResizeObserver(scheduleFit);
    resize.observe(host);
    const theme = new view.MutationObserver(() => {
      terminal.options.theme = themeFrom(host);
      applyTerminalRenderingSettings(
        terminal,
        props.settings.getSnapshot().settings,
        themeFontFamilyFrom(host),
      );
      scheduleFit();
    });
    theme.observe(host.ownerDocument.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "style"],
    });
    const input = terminal.onData((data) => {
      props.controller.write(props.tab.id, data);
    });
    const unsubscribe = props.controller.subscribe(props.tab.id, {
      data: (data) => terminal.write(data),
      exit: (exitCode) => {
        terminal.write(
          `\r\n\x1b[2m${exitLabel(props.t, exitCode)}\x1b[0m\r\n`,
        );
      },
    });
    scheduleFit();

    return () => {
      if (frame !== undefined) view.cancelAnimationFrame(frame);
      unsubscribe();
      input.dispose();
      theme.disconnect();
      resize.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [props.controller, props.settings, props.tab.id, props.t]);

  useEffect(() => {
    const host = hostRef.current;
    const terminal = terminalRef.current;
    const fit = fitRef.current;
    const view = host?.ownerDocument.defaultView;
    if (
      host === null ||
      host === undefined ||
      terminal === null ||
      fit === null ||
      view === null ||
      view === undefined
    ) {
      return;
    }
    applyTerminalRenderingSettings(
      terminal,
      settingsSnapshot.settings,
      themeFontFamilyFrom(host),
    );
    const frame = view.requestAnimationFrame(() => {
      try {
        fit.fit();
        props.controller.resize(
          props.tab.id,
          terminal.cols,
          terminal.rows,
        );
      } catch {
        // The panel can close during the scheduled settings update.
      }
    });
    return () => {
      view.cancelAnimationFrame(frame);
    };
  }, [
    props.controller,
    props.tab.id,
    settingsSnapshot.settings.fontFamily,
    settingsSnapshot.settings.fontSize,
    settingsSnapshot.settings.lineHeight,
  ]);

  useEffect(() => {
    if (!props.active) return;
    const host = hostRef.current;
    const terminal = terminalRef.current;
    const fit = fitRef.current;
    if (host === null || terminal === null || fit === null) return;
    host.ownerDocument.defaultView?.requestAnimationFrame(() => {
      try {
        fit.fit();
        props.controller.resize(
          props.tab.id,
          terminal.cols,
          terminal.rows,
        );
        terminal.focus();
      } catch {
        // The panel can close during the scheduled activation frame.
      }
    });
  }, [props.active, props.controller, props.tab.id]);

  return (
    <div
      id={`minke-tab-view-${props.tab.id}`}
      className="minke-tabs-view minke-terminal-view"
      role="tabpanel"
      aria-labelledby={`minke-tab-${props.tab.id}`}
      hidden={!props.active}
    >
      <div
        ref={hostRef}
        className="minke-terminal-host"
        aria-label={props.t("terminal.view.label")}
      />
      {props.tab.payload.status === "starting" && (
        <div className="minke-terminal-state" role="status">
          {props.t("terminal.state.starting")}
        </div>
      )}
      {props.tab.payload.status === "error" && (
        <div
          className="minke-terminal-state"
          data-error
          role="alert"
        >
          <span>
            <strong>{props.t("terminal.state.failed")}</strong>
            {props.tab.payload.error}
          </span>
        </div>
      )}
    </div>
  );
}
