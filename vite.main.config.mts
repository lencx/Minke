import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      external: ["sys"],
    },
  },
});
