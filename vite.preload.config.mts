import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { productSourceAliases } from "./config/product-source-aliases.mts";

const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: productSourceAliases(projectRoot),
    tsconfigPaths: true,
  },
  build: {
    emptyOutDir: false,
    outDir: resolve(projectRoot, ".vite", "build"),
    rollupOptions: {
      external: ["electron"],
      input: {
        "desktop-preload": resolve(
          projectRoot,
          "desktop",
          "preload",
          "desktop-preload.ts",
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
