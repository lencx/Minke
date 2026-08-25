import { dirname } from "node:path";
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
    sourcemap: false,
    rollupOptions: {
      external: ["sys"],
    },
  },
});
