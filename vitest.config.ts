import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  test: {
    // 只測 src 下的單元測試
    include: ["src/**/*.test.ts"],
    // 環境變數預設值（測試用）；個別測試可 override
    env: {
      LINE_CHANNEL_SECRET: "test-channel-secret",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
})
