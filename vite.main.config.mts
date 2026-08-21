import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      external: ["sys"],
    },
  },
});
