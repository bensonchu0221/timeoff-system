# 部署架構與運維手冊

> 給維護這個系統的人（包含未來的 Claude / AI assistant）讀。
> 動任何 production 環境變數前，**請先把這份文件讀完**。

---

## 1. 部署流程一張圖

```
你在本機改 code
    ↓
git push origin main
    ↓
GitHub webhook
    ↓
Cloud Build trigger（在 GCP popinpoc1 專案）
    ↓
跑 docker build -t .../timeoff-system:<commit-sha> .
    ↓
push image 到 Artifact Registry
    asia-east1-docker.pkg.dev/popinpoc1/cloud-run-source-deploy/...
    ↓
gcloud run services update timeoff-system --image=<新 image> --labels=...
    ↓
Cloud Run 建立新 revision、滾動到 100% 流量
    ↓
線上服務跑新版（https://timeoff.pacnexus.net）
```

**每次 git push main 都會走完整套**，平均 build + deploy 約 4 分鐘。

---

## 2. 部署過程中「會」與「不會」被影響的東西

| 東西 | 部署時行為 | 持久 |
|---|---|---|
| Container image | 換新 SHA tag | ❌ 重建 |
| Cloud Run revision | 新建 | ❌ 重建 |
| 容器內 process / 記憶體 | 重啟 | ❌ 重建 |
| **Cloud Run env vars** | **完整保留** | ✅ 持久 |
| Cloud SQL 資料 | 不動 | ✅ 持久 |
| Cloud SQL Authorized Networks | 不動 | ✅ 持久 |
| Cloud Scheduler jobs | 不動 | ✅ 持久 |
| Google OAuth Client 設定 | 不動 | ✅ 持久 |
| LINE Channel webhook URL | 不動 | ✅ 持久（在 LINE 那邊存的） |

關鍵：**Cloud Run env vars 是儲存在服務狀態上的**，不是放在 image 裡。所以換 image 不影響 env vars。

---

## 3. Cloud Run env vars 操作機制（致命陷阱區）

`gcloud run services update` 有幾種 env flag，行為差很多：

| Flag | 行為 | 安全性 |
|---|---|---|
| 沒帶任何 env flag | env vars 完整保留 | ✅ 安全 |
| `--update-env-vars=K=V,K2=V2` | 加 / 改指定 keys，其他不動 | ✅ 推薦 |
| `--remove-env-vars=K1,K2` | 移除指定 keys | ⚠️ 確定要刪再用 |
| `--set-env-vars=K=V,K2=V2` | **完全取代** env 列表，沒列的全部消失 | 💀 危險 |
| `--clear-env-vars` | 全部清空 | 💀 災難 |

**鐵則**：要改 production env，**只用 `--update-env-vars`**。除非有明確意圖要重置，**永遠不要用 `--set-env-vars`**。

我們的 Cloud Build trigger 的 deploy step 沒帶任何 env flag，所以每次 deploy env 都保留。

---

## 4. 目前線上 env vars 完整清單

詳細用途見 `.env.example`。Keys 列表：

```
DATABASE_URL                # Cloud Run 用 unix socket: mysql://user:pwd@localhost/db?socket=/cloudsql/...
                            # 本機 .env 用 TCP: mysql://user:pwd@35.234.61.181:3306/db
                            # 兩者結構不同，切勿從本機直接同步上去！
AUTH_SECRET
AUTH_TRUST_HOST=true
AUTH_URL                    # https://timeoff.pacnexus.net
NEXTAUTH_URL                # 同上（兩個都要設，NextAuth v5 不同情境會讀不同的）
AUTH_GOOGLE_ID
AUTH_GOOGLE_SECRET
MAIL_PROVIDER=brevo
MAIL_API_KEY
FROM_EMAIL
SENDER_NAME
LINE_CHANNEL_ID
LINE_CHANNEL_SECRET
LINE_CHANNEL_ACCESS_TOKEN
LINE_BOT_BASIC_ID
CRON_SECRET
```

---

## 5. 常用運維操作（複製即用）

### 看現在 Cloud Run 跑什麼 image
```bash
gcloud run services describe timeoff-system --region=asia-east1 \
  --format="value(spec.template.spec.containers[0].image)"
```

### 看現在有哪些 env vars（只列 keys，不顯值，分號分隔）
```bash
gcloud run services describe timeoff-system --region=asia-east1 \
  --format="value(spec.template.spec.containers[0].env[].name)"
```

### 改 / 加 env var（安全做法）
```bash
gcloud run services update timeoff-system --region=asia-east1 \
  --update-env-vars="^|^KEY1=VAL1|KEY2=VAL2"
# 用 ^|^ 自訂分隔符，value 內含逗號也安全
```

### 看 Cloud Build 最近狀態
```bash
gcloud builds list --limit=5 \
  --format="table(id,status,createTime,substitutions.COMMIT_SHA.scope(commits))"
```

### 等某次 build 完成
```bash
until [ "$(gcloud builds describe <BUILD_ID> --format='value(status)')" != "WORKING" ]; do
  sleep 15
done
```

### 手動觸發 Cloud Scheduler
```bash
gcloud scheduler jobs run timeoff-daily-leave-roster --location=asia-east1
gcloud scheduler jobs run timeoff-daily-pending-reminder --location=asia-east1
```

### 直接 curl 測 cron endpoint（要先 source .env 拿 CRON_SECRET）
```bash
set -a && source .env && set +a
curl -sS -H "x-cron-secret: $CRON_SECRET" \
  https://timeoff.pacnexus.net/api/cron/daily-leave-roster
```

### 跑單元測試
```bash
npm test              # 一次性跑完所有測試
npm run test:watch    # watch 模式，改檔自動重跑
npm run test:coverage # 跑完顯示 coverage 報表
```

測試檔放在 `src/**/*.test.ts`，跟原始碼同層。目前範圍：純邏輯函式（`date-format.ts` / `line.ts` / `leave-utils.calculateDurationDays`）。整合測試（DB / 外部 API）尚未涵蓋。

### 改資料庫結構（⚠️ 禁止用 `prisma db push`）

`timeoff` 資料庫**不只有本專案的表**：另一個內部 SOP 系統也在這個 DB 裡建了 14 張 `sop_*` 表，並在 `User` 表加了 `sopRole` 欄位（2026-10-01 實測）。這些都不在 `prisma/schema.prisma` 裡。

`npx prisma db push`（含 `--accept-data-loss`）會把 schema 以外的東西當成要移除 → **DROP 全部 `sop_*` 表與 `User.sopRole`**，等於刪掉別的系統的資料。**不要用。**

安全做法（只執行本次需要的語句）：
```bash
# 1. 產生「資料庫現況 → schema 檔」的完整差異 SQL（唯讀，不會改 DB）
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma --script > /tmp/full-diff.sql

# 2. 只挑出本次要的 CREATE / ALTER 語句另存（不可包含任何 sop_* 或 sopRole 相關、不可有 DROP）
#    人工檢查後存成 /tmp/apply.sql

# 3. 給使用者看過、同意後才執行（本地與線上共用同一個 DB，這一步就是改正式 DB）
npx prisma db execute --file /tmp/apply.sql --schema prisma/schema.prisma
```

⚠️ **本機 .env 的 `DATABASE_URL` 指向 Cloud SQL 的 public IP（不是 unix socket）**，需要：
1. 你的對外 IP 在 Cloud SQL Authorized Networks 內
2. 加白名單：`gcloud sql instances patch internal-tool --authorized-networks=<舊清單>,<你的IP>/32`
3. ⚠️ `--authorized-networks` 是「全部取代」，**務必先列舊清單再追加**

---

## 6. 已設好的 Cloud Scheduler jobs

| Job 名稱 | 排程 | URL |
|---|---|---|
| `timeoff-daily-leave-roster` | `0 10 * * *` Asia/Taipei | `/api/cron/daily-leave-roster` |
| `timeoff-daily-pending-reminder` | `0 11 * * *` Asia/Taipei | `/api/cron/daily-pending-reminder` |
| `timeoff-escalate-pending` | `0 9-18 * * 1-5` Asia/Taipei（平日 09–18 每小時） | `/api/cron/escalate-pending` |
| `timeoff-annual-leave-grant` | `0 6 1 12 *` Asia/Taipei（每年 12/1 06:00） | `/api/cron/annual-leave-grant` |
| `timeoff-sync-holidays` | `0 6 1 9 *` Asia/Taipei（每年 9/1 06:00） | `/api/cron/sync-holidays` |

五個都在 `asia-east1`，用 `x-cron-secret` header 驗證。

國定假日同步（`timeoff-sync-holidays`，2026-10-01 建立）：同步「明年＋今年」；明年未公布（來源 404）不算失敗；結果 LINE 通知 ADMIN。失敗時到「假別與額度設定 → 國定假日同步」手動同步。

### 特休年度發放（`timeoff-annual-leave-grant`，2026-10-01 建立）

- 特休自 2026-10-01 起改為「發放紀錄存資料庫」（`AnnualLeaveGrant` 表），不再即時用公式算。
- 每年 12/1 發「明年」的年度特休（生效日 = 明年 1/1）。重試 3 次、間隔 ≥ 5 分鐘、deadline 300s。
- **重跑安全**：每人每年只能有一筆（DB 唯一鍵 `userId + periodKey`），已發過的自動略過。
- 結果（成功 / 失敗）用 LINE 推給在職 ADMIN；不通知員工。
- 排程失敗或要提前發：後台「假別與額度設定 → 特休年度發放 → 預覽全部發放」，或「員工管理 → 特休欄 → 發放 YYYY」單人發放。
- 遷移相關：`scripts/annual-grant-backfill.ts`（回填，已執行）、`scripts/annual-grant-audit.ts`（零差異審核）、`src/lib/legacy-annual-calc.ts`（舊公式，只給審核用）。過完 2027/1/1 確認穩定後，可移除這些與 `User.annualLeaveOpening*` 四欄、`LeaveAdjustment` 表。

`escalate-pending`：找出當前審核階段已超過 2 天未處理的待審單，通知「目前該審的人」（一審→主管、二審→Boss），每階段各算 2 天、每階段只通知一次。

---

## 7. 第三方服務需手動維護的東西（不在 IaC 內，動了要記得對焦）

### Google OAuth Client
- Project：popinpoc1
- Client ID：`439393162392-ol5q9p1bs4g4u4kh9kuno9sd5001gqd6.apps.googleusercontent.com`
- 變更 redirect URI / 換 client secret 都要去 GCP Console → APIs & Services → Credentials 手動操作
- 換 secret 後要同步更新 Cloud Run 的 `AUTH_GOOGLE_SECRET`

### LINE Developers Console
- Channel：Messaging API
- Webhook URL：`https://timeoff.pacnexus.net/api/webhook/line`（變網址要回 console 同步）
- Channel access token 在 console Reissue 後**舊 token 立刻失效**，要同步更新 Cloud Run 的 `LINE_CHANNEL_ACCESS_TOKEN`

### Brevo (Email)
- API key 在 Brevo dashboard 管理
- Rotate 後要同步更新 Cloud Run 的 `MAIL_API_KEY`

### Cloud SQL（GCP）
- Instance：`internal-tool`（asia-east1-c）
- DB：`timeoff`
- 改使用者密碼：`gcloud sql users set-password popin --instance=internal-tool --password=<新密碼>`
- 改密碼後**必須同步**：
  - 本機 `.env` 的 `DATABASE_URL`
  - Cloud Run 的 `DATABASE_URL`（注意 unix socket 結構，不要從本機直接複製）

---

## 8. 給未來 AI assistant 的注意事項

如果你（未來的 Claude）在沒有上下文時被請來改這個專案，請：

1. **先讀這份文件**再下任何 `gcloud run services update` 指令
2. **絕對不要** `--set-env-vars` 或 `--clear-env-vars`，除非使用者明確說要重置
3. **不要假設環境變數需要重新設定** — 它們在 Cloud Run 上是持久的
4. 改 `DATABASE_URL` 前，先確認本機 vs Cloud Run 的結構差異
5. 變動白名單（Cloud SQL Authorized Networks）前，**先讀現有清單**再追加；`gcloud sql instances patch --authorized-networks` 是「全部取代」
6. 本專案沒有 migrations 目錄，且**禁止 `prisma db push`**（會刪掉同 DB 內 SOP 系統的 `sop_*` 表與 `User.sopRole`）；schema 改動依「改資料庫結構」小節，用 `migrate diff` 挑出語句再 `db execute`
7. `git push origin main` 會自動觸發 Cloud Build 部署 — push 前先 build / type check

---

## 9. 異動歷史

| 日期 | 重點 |
|---|---|
| 2026-05-17 | 加入 LINE Messaging API、同部門通知、Cloud Scheduler、Google OAuth 加 timeoff.pacnexus.net redirect URI |
| 2026-05-16 | Phase 1 上線（review messages, leave edits, iCal feed, batch approval, audit log） |
