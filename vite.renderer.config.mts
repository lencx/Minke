import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(projectRoot, "desktop", "renderer"),
  publicDir: resolve(projectRoot, "public"),
  plugins: [react(), tailwindcss()],
  build: {
    outDir: resolve(projectRoot, ".vite", "renderer", "main_window"),
  },
  server: {
    port: 41783,
    strictPort: true,
  },
});
