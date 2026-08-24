const ELECTRON_RUN_AS_NODE = "ELECTRON_RUN_AS_NODE";
const INTERACTIVE_NODE_OPTIONS = "MINKE_INTERACTIVE_NODE_OPTIONS";
const INTERACTIVE_NODE_PATH = "MINKE_INTERACTIVE_NODE_PATH";
const NODE_BOOTSTRAP = "MINKE_NODE_BOOTSTRAP";
const NODE_OPTIONS = "NODE_OPTIONS";
const NODE_PATH = "NODE_PATH";

function deleteEnvironmentName(
  environment: NodeJS.ProcessEnv,
  name: string,
): void {
  const normalized = name.toUpperCase();
  for (const key of Object.keys(environment)) {
    if (key.toUpperCase() === normalized) {
      delete environment[key];
    }
  }
}

function copiedEnvironment(
  inherited: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return { ...inherited };
}

function environmentValue(
  environment: NodeJS.ProcessEnv,
  name: string,
): string | undefined {
  const normalized = name.toUpperCase();
  for (const [key, value] of Object.entries(environment)) {
    if (key.toUpperCase() === normalized) return value;
  }
  return undefined;
}

function hasEnvironmentName(
  environment: NodeJS.ProcessEnv,
  name: string,
): boolean {
  const normalized = name.toUpperCase();
  return Object.keys(environment).some(
    (key) => key.toUpperCase() === normalized,
  );
}

function setEnvironmentName(
  environment: NodeJS.ProcessEnv,
  name: string,
  value: string | undefined,
): void {
  deleteEnvironmentName(environment, name);
  if (value !== undefined) environment[name] = value;
}

/**
 * A user shell receives the user's original Node environment, not the clean
 * bootstrap environment of the Electron-as-Node Harness process. Product-only
 * capture names are consumed at this boundary.
 */
export function interactiveShellEnvironment(
  inherited: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const environment = copiedEnvironment(inherited);
  const nodeOptions = hasEnvironmentName(
    environment,
    INTERACTIVE_NODE_OPTIONS,
  )
    ? environmentValue(environment, INTERACTIVE_NODE_OPTIONS)
    : environmentValue(environment, NODE_OPTIONS);
  const nodePath = hasEnvironmentName(
    environment,
    INTERACTIVE_NODE_PATH,
  )
    ? environmentValue(environment, INTERACTIVE_NODE_PATH)
    : environmentValue(environment, NODE_PATH);
  deleteEnvironmentName(environment, ELECTRON_RUN_AS_NODE);
  deleteEnvironmentName(environment, INTERACTIVE_NODE_OPTIONS);
  deleteEnvironmentName(environment, INTERACTIVE_NODE_PATH);
  setEnvironmentName(environment, NODE_OPTIONS, nodeOptions);
  setEnvironmentName(environment, NODE_PATH, nodePath);
  return environment;
}

/**
 * Native and third-party commands must not inherit Minke's Node bootstrap
 * controls. Callers add only command-specific variables after this boundary.
 */
export function externalCommandEnvironment(
  inherited: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const environment = interactiveShellEnvironment(inherited);
  deleteEnvironmentName(environment, NODE_BOOTSTRAP);
  deleteEnvironmentName(environment, NODE_OPTIONS);
  deleteEnvironmentName(environment, NODE_PATH);
  return environment;
}
