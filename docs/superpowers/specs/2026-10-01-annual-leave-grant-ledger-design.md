# 特休改為「發放紀錄存資料庫」（Grant Ledger）

日期：2026-10-01

## 背景 / 問題

特休目前每次查詢都由 `calcCalendarYearCumulative`（`src/lib/leave-utils.ts`）即時用公式重算：
到職首年 pro-rata + 每年 1/1 依年資發放 + override + opening + 手動調整。

問題：**公式一改，過去已發放的特休會被回溯改寫。** 實例：

- 首年 pro-rata 要從「天數制、進位」改為 HR 的「月份制、捨去」（Aaron 應為 2.5、Sophia 應為 3），
  但直接改公式會連帶把 Leo (小)、Nelly、Pierce（已離職）的首年從 5.5 改成 5。
- 改特休 `defaultDays` 會回溯重算所有未設 opening 員工的過往年度。
- 首年 pro-rata 公式在 `ledger-utils.ts` 另有一份複製，兩邊可能不一致。

## 目標 / 非目標

**目標**
- 特休每一次發放（首年、年度、期初、手動調整）都是資料庫中的一筆紀錄；公式只在「寫入當下」計算一次。
- 公司或法規改變公式時，只影響之後新寫入的發放，已發放的不變。
- 員工可在 12/1 起預約明年假；HR 可隨時為個人或全員提前發放明年特休。
- 遷移前後逐人零差異，有完整審核報表。

**非目標**
- 其他假別（病假、事假…）維持現行即時算（每年 1/1 歸零、直接用預設天數，無回溯問題）。
- 不改勞基法 §38 對照表與「年資 < 2 年 = defaultDays」的規則。
- 不做員工端的發放通知（員工自行上系統查看）。

## 已確認的決策

| 項目 | 決策 |
|---|---|
| 範圍 | 只有特休 |
| 資料表方案 | 方案 1：單一統一發放紀錄表；opening 與 `LeaveAdjustment`（特休）併入 |
| 首年公式（之後新人） | **A 算法**：剩餘完整月數 ÷ 12 × defaultDays，**捨去**到 0.5。1 號到職算當月；其他日期到職從下個月起算 |
| 既有員工 | 遷移時照抄現值（Leo (小)、Nelly、Pierce 維持 5.5）；Aaron、Sophia 遷移後另做一步改為 A 算法 |
| 年度發放時機 | 每年 **12/1** 排程寫入「明年」的年度發放，生效日 = 明年 1/1 |
| HR 提前發放 | 單人按鈕 + 全部發放按鈕，兩者都先預覽再確認；只能發今年或明年 |
| 防呆 | 資料庫唯一鍵保證每人每年只有一筆年度發放；排程與按鈕共用同一函式 |
| 排程通知 | 成功、失敗都用 LINE 通知**管理員**；不通知員工 |
| DB 層測試 | 暫時啟動 Docker 跑本機 MySQL 驗證唯一鍵與同時寫入，跑完關閉 |

## 1. 資料表

```prisma
enum AnnualLeaveGrantKind {
  PRORATA     // 到職首年按比例
  ANNUAL      // 年度發放（生效日 = 該年 1/1）
  OPENING     // 期初餘額（舊制遷移用）
  ADJUSTMENT  // HR 手動調整（可負）
}

enum AnnualLeaveGrantSource {
  HIRE         // 新人建檔 / 補填到職日
  SYSTEM_CRON  // 12/1 排程
  HR_BUTTON    // HR 單人或全部發放按鈕
  HR_MANUAL    // HR 手動調整、期初設定
  RECALC       // 到職日變更後重算
  MIGRATION    // 遷移回填
}

model AnnualLeaveGrant {
  id          String                 @id @default(uuid())
  userId      String
  kind        AnnualLeaveGrantKind
  year        Int?                   // PRORATA = 到職年；ANNUAL = 發放年；其餘 null
  effectiveAt DateTime               // UTC midnight
  amount      Float                  // 0.5 倍數；ADJUSTMENT 可負
  basis       Json?                  // 計算依據（顯示文字 + 數值），寫入當下固定
  reason      String?   @db.Text     // ADJUSTMENT 必填；系統發放自動帶入
  source      AnnualLeaveGrantSource
  createdById String?                // 系統寫入為 null
  periodKey   String?                // "PRORATA:2026" / "ANNUAL:2027"；OPENING/ADJUSTMENT = null；作廢時清為 null
  voidedAt    DateTime?
  voidedById  String?
  voidReason  String?   @db.Text
  createdAt   DateTime  @default(now())

  user      User  @relation("UserAnnualGrants", fields: [userId], references: [id])
  createdBy User? @relation("CreatedAnnualGrants", fields: [createdById], references: [id])
  voidedBy  User? @relation("VoidedAnnualGrants", fields: [voidedById], references: [id])

  @@unique([userId, periodKey])
  @@index([userId, effectiveAt])
}
```

- **防呆核心**：`@@unique([userId, periodKey])`。MySQL 唯一索引允許多筆 NULL，所以 OPENING / ADJUSTMENT 不受限。
- **作廢**：不硬刪。設 `voidedAt/voidedById/voidReason`，並把 `periodKey` 清為 null，才能重新寫入正確的一筆。
- `UserLeaveBalance`（特休 override）保留，語意為「個人年度額度設定」，只影響之後的年度發放。
- `User.annualLeaveOpening*` 四欄與 `LeaveAdjustment` 表：遷移後保留到穩定（過完 2027/1/1）再另行移除。

## 2. 寫入路徑

所有寫入集中在新模組（暫定 `src/lib/annual-grant.ts`）；公式只存在這裡。

### 2.1 計算函式（純函式）
- `calcProRataGrant(hireDate, defaultDays)` → A 算法，回傳 `{ amount, basis }`。
- `calcAnnualGrant(hireDate, year, defaultDays, overrides)` → 以 `year-01-01` 的完整年資：
  `< 2` → defaultDays；`>= 2` → `getStatutoryAnnualDays`；有適用 override 取 `max`。回傳 `{ amount, basis }`。
- `isEligibleForAnnual(user, year)` → 有 hireDate、到職年 < year、且 year-01-01 時未離職。

### 2.2 新人（PRORATA）
- 觸發：`createUser` 有填到職日；或 `updateUserHireDate` 從「無到職日」補填。
- 寫 PRORATA（生效日 = 到職日），並**補齊到目前開放年度**：開放年度 = 今天 ≥ 12/1 ? 明年 : 今年。
  例：12/5 建檔的新人同時補寫明年 ANNUAL；補建 2025 年到職者一次寫 2025 PRORATA + 2026 ANNUAL。
- 有 OPENING 的員工不寫 PRORATA。

### 2.3 年度發放（ANNUAL）— 排程與按鈕共用 `grantAnnualForYear(year, { userIds?, source, actorId? })`
- 回傳 `{ granted: [...], skipped: [...（已存在：何時、來源）], ineligible: [...] }`。
- 寫入用 `createMany({ skipDuplicates: true })` 或逐筆 create 並把 P2002 視為「略過」。
- 另有 `previewAnnualForYear(...)`：同樣的計算，不寫入，給預覽對話框用。

**12/1 排程**
- 新增 `/api/cron/annual-leave-grant`（`x-cron-secret` 驗證），呼叫 `grantAnnualForYear(明年, { source: SYSTEM_CRON })`。
- Cloud Scheduler：`0 6 1 12 *` Asia/Taipei，asia-east1。
- 失敗回 500 讓 Scheduler 重試；成功 / 失敗都 LINE 推播給所有在職 ADMIN（摘要：發放 N、略過 M、失敗原因）。
- 寫一筆稽核紀錄（actor 需為使用者 → 排程不寫 AuditLog，改寫 console log + 通知；按鈕路徑照常寫 AuditLog）。

**HR 按鈕**
- 全部發放：`/admin/leave-settings`，可選今年或明年（預設明年）。
- 單人發放：`/admin/users` 每列。
- 都是「預覽 → 確認」，限制年度 ∈ {今年, 明年}。
- 所有發放 / 作廢 / 重算 action 都要從 DB 驗證 ADMIN。

### 2.4 到職日變更後重算
- `updateUserHireDate` 儲存後，若該員工已有非作廢的 PRORATA/ANNUAL，回傳重算預覽（每筆舊值 → 新值）。
- HR 確認 → 舊筆作廢（`voidReason = "到職日由 X 改為 Y"`）、寫新筆（`source = RECALC`）。HR 也可選擇不重算。
- OPENING / ADJUSTMENT 不受影響。override 變更不自動重算（只影響之後年度）。

### 2.5 離職
- 設定離職日時，自動作廢 `effectiveAt > terminatedDate` 的 PRORATA/ANNUAL，完成訊息列出作廢項目。
- 復職不自動補發，由 HR 用單人按鈕補。

### 2.6 手動調整 / 期初
- 現有「手動調整」UI 改寫入 `kind = ADJUSTMENT`；刪除改為作廢（原因必填）。
- 期初設定改寫入 `kind = OPENING`（每人最多一筆非作廢的 OPENING，於 action 層檢查）。

## 3. 讀取路徑

`getUserLeaveBalance` 特休分支改為：
- **total** = Σ amount（`voidedAt IS NULL` 且 `effectiveAt <= asOf`）。
- **used / pending**：沿用現行規則（有 OPENING 時只算 `startDate >= OPENING.effectiveAt`；上限 = asOf 所在年 12/31），
  並修正跨年重複花額度（健檢中優先第 4 項）：送單時另外檢查「從請假年度到最遠一張已預約假單年度」每年年底的累計不可為負。
- **歷史假單**（`ledger-utils.ts`）：直接列出非作廢的發放紀錄 + 請假紀錄；說明文字取自 `basis`。移除 ledger 內複製的公式。
- 員工端餘額卡片：若有「已寫入但尚未生效」的 ANNUAL，加一行「YYYY 年度特休 N 天將於 1/1 生效」。

## 4. 遷移與審核

1. **新增資料表**：先用 `prisma migrate diff` 產生 SQL，確認只有 CREATE（不改不刪既有表欄），經同意後執行（本地與線上共用同一 DB）。
2. **回填**（腳本預設 dry-run）：全部員工含離職者。
   - 有 opening：1 筆 OPENING（原值、原日期）+ opening 之後的 ANNUAL + opening 之後的特休 ADJUSTMENT。
   - 無 opening：1 筆 PRORATA（**舊天數算法原值**）+ 至今每年 ANNUAL + 特休 ADJUSTMENT。
   - `source = MIGRATION`，`basis` 註明「遷移自即時公式」。
3. **逐人零差異審核報表**（CSV + 摘要，存檔給路徑）：每人 × 時間點（今天、2025/12/31、2026/12/31、每筆發放生效日前一天與當天），
   比對舊公式 vs 新表的 total / used / pending / remaining，以及歷史假單逐筆。**全部差異為 0 才可切換。**
   - 預期差異：asOf ≥ 2027/1/1（舊公式自動推算 2027，新表要等 12/1 或 HR 按鈕）。同時列出已預約 2027 特休的假單（目前 0 筆）。
4. **切換讀取**：部署新版；當天再跑一次審核報表。切換期間請 HR 暫停手動調整（以便必要時退回舊版）。
5. **Aaron、Sophia 改 A 算法**：作廢其 PRORATA（`voidReason = "首年改依月份計算（HR 確認）"`），寫新值 Aaron 2.5、Sophia 3。
   執行前顯示前後對照，執行後報表只有這兩人有差異。
6. **建立 12/1 Cloud Scheduler 排程**（約 US$0.10/月）。穩定後（過完 2027/1/1）另行移除舊欄位與 `LeaveAdjustment`。

所有寫入線上的步驟（1、2 寫入、4 部署、5、6）執行前都先取得同意。**須在 2026-12-01 前完成。**

## 5. 畫面

- `/admin/leave-settings`：新增「特休年度發放」區塊（狀態列 + 全部發放 + 預覽對話框：將發放 / 已發放略過 / 不符資格）；
  手動調整改為作廢、提示文字「首年與年度特休由系統自動發放，不需手動補」、數量提示改 `2 / -1`；
  Override 說明改為「只影響之後的年度發放」。
- `/admin/users`：「特休 Opening」欄改為「特休」欄（剩餘天數，展開顯示發放紀錄、單人發放、期初設定）；
  改到職日時的重算預覽；設定離職日時列出作廢項目。
- 員工端：餘額卡片外觀不變；歷史假單版面不變、說明改用 `basis`；作廢紀錄員工看不到。

## 6. 測試

1. **純計算**（vitest）：A 算法邊界（1/1→10、1/2→9、10/1→2.5、8/24→3、6/15→5、12/1→0.5、12/2→0、閏年）；
   年度發放年資邊界（2/3/5/10/25 年、2/29 到職、override 取大與適用年份）；資格判斷；餘額（作廢、未生效、opening 截點）；跨年重複花額度。
2. **寫入流程**（mock prisma）：重複執行全部略過、P2002 視為略過；新人補齊開放年度；離職作廢；重算預覽與執行；
   非 ADMIN 一律拒絕；排程端點 401 與通知呼叫。
3. **遷移等價性**：合成員工 × 多時間點，舊公式（保留為測試參考實作）vs 回填結果完全一致；加上第 4 節的真實資料審核報表。
4. **DB 層**：暫時啟動 Docker MySQL，套用 schema，驗證 `@@unique([userId, periodKey])` 擋重複、並行寫入只成功一筆、作廢後可重寫；跑完關閉 Docker。
5. **畫面**：瀏覽器檢查桌面與手機寬度；因 dev server 連線上 DB，只做檢視與預覽、不按確認寫入；測完關閉分頁與 dev server。

## 風險

| 風險 | 對策 |
|---|---|
| 12/1 排程沒跑 | Scheduler 重試 + 管理員通知 + 全部發放按鈕補發 |
| 遷移數字對不上 | 零差異審核報表為切換前提 |
| 切換後出問題 | 退回舊版部署；舊欄位與表在穩定前不刪；切換期間暫停手動調整 |
| 共用 DB 誤寫 | 只做 additive schema；所有寫入步驟先 dry-run、先取得同意 |
| 到職日改了忘記重算 | 存檔後主動跳重算預覽；員工特休欄可隨時重算 |
