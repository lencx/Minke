import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    emptyOutDir: false,
    outDir: resolve(projectRoot, ".vite", "build"),
    rollupOptions: {
      external: ["electron"],
      input: resolve(
        projectRoot,
        "desktop",
        "preload",
        "desktop-preload.ts",
      ),
      output: {
        entryFileNames: "desktop-preload.js",
        format: "cjs",
      },
    },
  },
});
