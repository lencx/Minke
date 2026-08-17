/**
 * Overlay styling convention:
 * - keep static rules in an adjacent `.css` file imported as text;
 * - install that text through `defineOverlayStyle` inside a capability effect;
 * - put runtime values on the narrow owning element with `bindCssVars`;
 * - represent UI state with attributes instead of rebuilding CSS text.
 */
const OVERLAY_PLUGIN_ID = "@lencx/minke-harness-overlay";

type OverlayStyleSource = string | readonly string[];
type OverlayStyleInstaller = (root?: Document) => () => void;

interface InstalledStyle {
  readonly node: HTMLStyleElement;
  readonly source: string;
  references: number;
}

interface CssVariableBaseline {
  readonly hadDeclaration: boolean;
  readonly priority: string;
  readonly value: string;
}

interface CssVariableBinding {
  active: boolean;
  readonly priority: string;
  readonly value: string;
}

interface CssVariableStack {
  readonly baseline: CssVariableBaseline;
  readonly bindings: CssVariableBinding[];
}

type CssVariableName = `--minke-${string}`;
type CssVariableTarget = {
  readonly style: CSSStyleDeclaration;
};

const documentStyles = new WeakMap<
  Document,
  Map<string, InstalledStyle>
>();
const targetVariables = new WeakMap<
  CssVariableTarget,
  Map<CssVariableName, CssVariableStack>
>();

function normalizeStyleSource(source: OverlayStyleSource): string {
  return typeof source === "string" ? source : source.join("\n");
}

function styleParent(root: Document): HTMLElement {
  const parent = root.head ?? root.documentElement;
  if (!parent) {
    throw new Error(
      "Cannot install overlay styles before a document root exists",
    );
  }
  return parent;
}

function hasStyleDeclaration(
  style: CSSStyleDeclaration,
  name: string,
  value: string,
  priority: string,
): boolean {
  if (
    typeof style.item === "function" &&
    typeof style.length === "number"
  ) {
    for (let index = 0; index < style.length; index += 1) {
      if (style.item(index) === name) {
        return true;
      }
    }
  }
  return value !== "" || priority !== "";
}

function restoreVariable(
  style: CSSStyleDeclaration,
  name: CssVariableName,
  baseline: CssVariableBaseline,
): void {
  if (baseline.hadDeclaration) {
    style.setProperty(
      name,
      baseline.value,
      baseline.priority,
    );
    return;
  }
  style.removeProperty(name);
}

export function defineOverlayStyle(
  id: string,
  source: OverlayStyleSource,
): OverlayStyleInstaller {
  if (id.trim() === "") {
    throw new Error("Overlay style ids must not be empty");
  }
  const normalizedSource = normalizeStyleSource(source);

  return (root = document) => {
    let styles = documentStyles.get(root);
    if (!styles) {
      styles = new Map();
      documentStyles.set(root, styles);
    }

    let installed = styles.get(id);
    if (installed) {
      if (installed.source !== normalizedSource) {
        throw new Error(
          `Overlay style "${id}" is already installed with a different source`,
        );
      }
      installed.references += 1;
    } else {
      const node = root.createElement("style");
      node.dataset.plugin = OVERLAY_PLUGIN_ID;
      node.dataset.minkeStyle = id;
      node.textContent = normalizedSource;
      styleParent(root).append(node);
      installed = {
        node,
        references: 1,
        source: normalizedSource,
      };
      styles.set(id, installed);
    }

    let active = true;
    return () => {
      if (!active) return;
      active = false;

      const current = styles.get(id);
      if (!current) return;
      current.references -= 1;
      if (current.references > 0) return;

      current.node.remove();
      styles.delete(id);
      if (styles.size === 0) {
        documentStyles.delete(root);
      }
    };
  };
}

export function bindCssVars(
  target: CssVariableTarget,
  variables: Readonly<Record<CssVariableName, string>>,
): () => void {
  const entries = Object.entries(variables);
  for (const [name] of entries) {
    if (!name.startsWith("--minke-")) {
      throw new Error(
        `Overlay CSS variables must use the --minke- prefix: ${name}`,
      );
    }
  }

  let stacks = targetVariables.get(target);
  if (!stacks) {
    stacks = new Map();
    targetVariables.set(target, stacks);
  }

  const bindings: Array<
    readonly [CssVariableName, CssVariableBinding]
  > = [];
  for (const [rawName, value] of entries) {
    const name = rawName as CssVariableName;
    let stack = stacks.get(name);
    if (!stack) {
      const previousValue = target.style.getPropertyValue(name);
      const previousPriority =
        target.style.getPropertyPriority(name);
      stack = {
        baseline: {
          hadDeclaration: hasStyleDeclaration(
            target.style,
            name,
            previousValue,
            previousPriority,
          ),
          priority: previousPriority,
          value: previousValue,
        },
        bindings: [],
      };
      stacks.set(name, stack);
    }

    const binding = {
      active: true,
      priority: "",
      value,
    };
    stack.bindings.push(binding);
    bindings.push([name, binding]);
    target.style.setProperty(name, value);
  }

  let active = true;
  return () => {
    if (!active) return;
    active = false;

    for (const [name, binding] of bindings) {
      const stack = stacks.get(name);
      if (!stack) continue;
      binding.active = false;
      const remaining = stack.bindings.filter(
        (candidate) => candidate.active,
      );
      stack.bindings.splice(
        0,
        stack.bindings.length,
        ...remaining,
      );
      const latest = remaining.at(-1);
      if (latest) {
        target.style.setProperty(
          name,
          latest.value,
          latest.priority,
        );
        continue;
      }

      restoreVariable(target.style, name, stack.baseline);
      stacks.delete(name);
    }

    if (stacks.size === 0) {
      targetVariables.delete(target);
    }
  };
}
