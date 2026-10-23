import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/test/setup.ts"],
    // 34 个 jsdom 文件并行时，默认 5s 会误杀本身全绿的用例；真挂死仍会到点失败。
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
