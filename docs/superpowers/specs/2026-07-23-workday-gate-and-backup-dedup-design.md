# 每日提醒工作日 gate + 代理人通知去重

日期：2026-07-23

## 背景 / 問題

1. **非工作日仍推播**：小丹請假拉一個含六日的區間，每日提醒 cron（`daily-leave-roster`）
   只用 `startDate <= today <= endDate` 判斷，沒有判斷「今天是不是工作日」。因此週六、週日
   只要外部 cron 觸發就會推播「小丹今日請假」，但六日沒人上班，通知無意義。
   `daily-pending-reminder`（推給主管待審筆數）同樣沒有工作日判斷。
   - 註：`calculateDurationDays` 已正確排除六日與國定假日，**記錄層與天數計算都正確**，
     問題只在提醒層。請假記錄用區間（含六日）是正常設計，不動。

2. **代理人收到重複通知**：假單核准後，若被指定的代理人剛好是同部門成員，
   `sendApprovedNotifications` 會對同部門每人發「📅 部門請假提醒」，又對代理人發
   「🤝 代理人通知」，導致代理人收到 2 則。代理人通知的內容已完整涵蓋部門通知
   （誰、範圍、假別），部門通知是其子集。

## 方案

### A. 共用 helper `isTaipeiWorkDay(date)` — `src/lib/leave-utils.ts`
- 查 `Holiday` 表當天那筆（`findMany` where date = 該日，取首筆，沿用現有測試 mock）
- 預設：`getUTCDay()` 為 0/6 → `false`
- Holiday 表有該日 → 用 `isWorkDay` 覆蓋（補班日 true、國定假日 false）
- 規則須與 `calculateDurationDays` 內的逐日判斷一致，加註解標明兩者同步

### B. 兩支 cron 加工作日 gate
- `daily-leave-roster/route.ts`：認證後、算出 `today` 後，
  `if (!(await isTaipeiWorkDay(today))) return { pushed: 0, reason: "today is not a work day" }`
- `daily-pending-reminder/route.ts`：認證後加同樣 gate
  （需 import `todayStartUTCFromTaipei` + `isTaipeiWorkDay`）

### C. 代理人 = 同部門時去重 — `src/app/actions/leave.ts`
在 `sendApprovedNotifications` 同部門迴圈：
- teammates 的 `select` 補上 `id`
- 若 `t.id === backupId` → 跳過部門通知那則（email + LINE 都跳過）
- 代理人通知維持由 `notifyBackupAssigned` 發（用 `backupAssigned` 偏好）
- 結果：代理人只收 1 則代理人通知

**取捨**：合併後這則以 `backupAssigned` 偏好為準。若某人關了代理通知、卻開著部門通知，
這次就不會收到（罕見，且他本就選擇關掉代理相關）。採此預設，不另做 fallback。

## 刻意不動
- `calculateDurationDays`、請假記錄區間存法
- PENDING 申請階段（那時只發代理人通知，本就無重複）
- email 無每日名單提醒（roster/pending 只走 LINE）

## 測試
`leave-utils.test.ts` 補 `isTaipeiWorkDay`：平日 true / 六日 false / 補班日 true / 國定假日 false。
