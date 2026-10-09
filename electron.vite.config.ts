import { defineConfig } from "electron-vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";

export default defineConfig({
  main: {},
  preload: {
    build: { rollupOptions: { output: { format: "cjs" } } },
  },
  renderer: {
    plugins: [vue()],
    resolve: { alias: { "@": resolve("src/renderer") } },
  },
});
