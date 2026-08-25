import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  build: {
    emptyOutDir: false,
    outDir: resolve(projectRoot, ".vite", "build"),
    rollupOptions: {
      external: ["electron"],
      input: {
        "tabs-web-preload": resolve(
          projectRoot,
          "desktop",
          "preload",
          "tabs-web-preload.ts",
        ),
      },
      output: {
        codeSplitting: false,
        entryFileNames: "[name].js",
        format: "cjs",
      },
    },
  },
});
