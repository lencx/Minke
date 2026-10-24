import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { productSourceAliases } from "./config/product-source-aliases.mts";

const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(projectRoot, "desktop", "renderer"),
  publicDir: resolve(projectRoot, "public"),
  resolve: {
    alias: productSourceAliases(projectRoot),
    tsconfigPaths: true,
  },
  build: {
    outDir: resolve(projectRoot, ".vite", "renderer", "main_window"),
    emptyOutDir: true,
  },
  server: {
    port: 41783,
    strictPort: false,
  },
});
