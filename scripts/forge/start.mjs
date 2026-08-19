import process from "node:process";
import { api } from "@electron-forge/core";
import {
  DEVELOPMENT_RESTART_EXIT_CODE,
} from "../../desktop/main/app-restart.ts";
import {
  superviseForgeDevelopment,
} from "./development-supervisor.mjs";

const result = await superviseForgeDevelopment({
  input: process.stdin.isTTY ? process.stdin : undefined,
  restartExitCode: DEVELOPMENT_RESTART_EXIT_CODE,
  start: async () => await api.start({
    dir: process.cwd(),
    interactive: false,
  }),
});

if (result.signal !== null) {
  process.kill(process.pid, result.signal);
} else {
  process.exit(result.code ?? 1);
}
