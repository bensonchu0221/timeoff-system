import { defineConfig } from "vitest/config"
import path from "path"

// 只跑需要真實 MySQL 的測試；DATABASE_URL 必須指向本機 Docker（見測試檔開頭的保護）
export default defineConfig({
  test: { include: ["src/**/*.db.test.ts"], testTimeout: 30_000, fileParallelism: false },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
})
