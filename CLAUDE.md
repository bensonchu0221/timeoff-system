@AGENTS.md

## 環境變數（Env Vars）

實際值在本地 `.env`（gitignored），**不要把值寫進這裡**。

### 所有必要的 Key

| Key | 用途 |
|-----|------|
| `DATABASE_URL` | Cloud SQL / MySQL 連線字串 |
| `AUTH_SECRET` | NextAuth.js session 加密金鑰 |
| `AUTH_GOOGLE_ID` | Google OAuth Client ID |
| `AUTH_GOOGLE_SECRET` | Google OAuth Client Secret |
| `AUTH_TRUST_HOST` | NextAuth.js 信任 proxy host（**線上才需要**，設 `true`）|
| `AUTH_URL` | NextAuth.js 公開 URL（**線上才需要**）|
| `NEXTAUTH_URL` | 同上，部分版本需要重複設（**線上才需要**）|
| `MAIL_PROVIDER` | 郵件服務商，目前固定 `brevo` |
| `MAIL_API_KEY` | Brevo API Key |
| `FROM_EMAIL` | 寄件人信箱 |
| `SENDER_NAME` | 寄件人顯示名稱 |
| `LINE_CHANNEL_ID` | LINE Bot Channel ID |
| `LINE_CHANNEL_SECRET` | LINE Bot Channel Secret |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Bot Access Token |
| `LINE_BOT_BASIC_ID` | LINE Bot 的 `@` ID（顯示用）|
| `CRON_SECRET` | Cron job 驗證 token |

### 本地 vs 線上差異

- `DATABASE_URL`：本地用 IP 直連（`35.234.61.181:3306`），線上用 Cloud SQL Unix socket（`@localhost?socket=/cloudsql/...`）
- `AUTH_TRUST_HOST` / `AUTH_URL` / `NEXTAUTH_URL`：本地不需要，線上必須設

### 讀取線上 env vars

```bash
gcloud run services describe timeoff-system \
  --project=popinpoc1 --region=asia-east1 \
  --format="yaml(spec.template.spec.containers[0].env)"
```

更新線上 env 一律用 `--update-env-vars`（不要用 `--set-env-vars`，會清掉其他 key）。
