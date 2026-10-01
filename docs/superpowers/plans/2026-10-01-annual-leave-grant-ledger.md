# 特休發放紀錄存資料庫（Grant Ledger）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 特休從「每次查詢即時用公式重算」改為「每次發放寫一筆紀錄到 `AnnualLeaveGrant` 表」，公式只在寫入當下計算一次；遷移前後逐人零差異。

**Architecture:** 新增 `AnnualLeaveGrant` 表（PRORATA / ANNUAL / OPENING / ADJUSTMENT）。純計算放 `annual-grant-calc.ts`，DB 寫入集中在 `annual-grant.ts`（排程、HR 按鈕、新人、離職、重算全部呼叫這裡）。`getUserLeaveBalance` 與 `getLeaveLedger` 的特休分支改讀這張表。舊公式搬到 `legacy-annual-calc.ts`，只給遷移回填、審核報表與等價性測試使用。

**Tech Stack:** Next.js 16.2.5（App Router, server actions）、Prisma 6.19 + MySQL（Cloud SQL）、vitest 4、Cloud Scheduler、LINE Messaging API。

**Spec:** `docs/superpowers/specs/2026-10-01-annual-leave-grant-ledger-design.md`

## Global Constraints

- **本地 `.env` 與線上 Cloud Run 連同一個 Cloud SQL `timeoff` DB。** 任何會寫入 DB 的指令（`prisma db push`、回填 `--apply`、Aaron/Sophia 修正、在 dev server 按確認）執行前都必須先取得使用者同意。
- Schema 變更只能是 additive（只 CREATE 新表 / enum / 新 relation），不可修改或刪除既有表欄。
- 推到 `main` 會由 Cloud Build 自動部署到 Cloud Run → **merge 到 main = 切換讀取路徑**，必須在回填與零差異審核通過之後。全程在分支 `feat/annual-grant-ledger` 開發。
- 部署後要用 `gcloud run services describe timeoff-system --project=popinpoc1 --region=asia-east1` 確認線上 revision 的 commit-sha，push ≠ 已部署。
- 寫任何 Next.js 程式前先讀 `node_modules/next/dist/docs/` 對應章節（AGENTS.md 規定；此版本 API 與訓練資料不同）。
- 首年公式（之後新人）：`剩餘完整月數 ÷ 12 × defaultDays`，**捨去**到 0.5。1 號到職算當月；其他日期到職從下個月起算。
- 年度發放：以 `year-01-01` 的完整年資；`< 2` 年 = `defaultDays`；`>= 2` 年 = `getStatutoryAnnualDays`；有適用 override 取 `max`。
- 年度發放排程：每年 12/1 06:00 Asia/Taipei 發「明年」，生效日 = 明年 1/1。HR 按鈕只能發今年或明年。
- 排程結果（成功 / 失敗）只 LINE 通知在職 ADMIN，不通知員工。
- 其他假別維持即時算，不在本計畫範圍。
- GCP 花費預估 ≥ US$1 才需事先詢問；Cloud Scheduler 一個 job 約 US$0.10/月。
- 測試完要關閉自己開的瀏覽器分頁、dev server、Docker；回報時說明收掉了什麼。
- Commit 訊息結尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。

## Review Focus

1. **12/1 之後才建檔的新人**（或到職日在 12/1 之後）→ 必須同時拿到首年 PRORATA 與明年 ANNUAL，否則 1/1 後沒有特休。（Task 4 測試 `grantOnHire 在 12/5 建檔會補明年 ANNUAL`）
2. **有 OPENING 的員工被發年度特休** → OPENING 日期 ≥ 該年 1/1 時不可再發（已含在期初），否則重複。（Task 4 測試 `previewAnnualForYear 期初已含該年 → ineligible`）
3. **同一人同一年被排程與 HR 按鈕同時發放** → 只會成功一筆，另一筆回報「略過」而非錯誤。（Task 4 P2002 測試 + Task 5 真實 MySQL 並行測試）
4. **到職日改成另一個年份** → PRORATA 的 periodKey 年份改變，舊的 `PRORATA:舊年` 必須作廢、多出或少掉的 ANNUAL 年度也要處理。（Task 4 測試 `previewRecalc 到職年改變`）
5. **離職日剛好等於 1/1** → 該年 ANNUAL 不可發、已發的要作廢（離職日起視為離職）。（Task 2 `isEligibleForAnnual` 與 Task 4 `voidGrantsAfterTermination` 測試）

---

## File Structure

| 檔案 | 動作 | 責任 |
|---|---|---|
| `prisma/schema.prisma` | Modify | 新增 enum ×2、`AnnualLeaveGrant` model、User 三個 relation |
| `src/lib/annual-grant-calc.ts` | Create | 純計算：首年、年度、資格、開放年度、periodKey、總額加總 |
| `src/lib/annual-grant-calc.test.ts` | Create | 純計算測試 |
| `src/lib/legacy-annual-calc.ts` | Create | 舊公式（從 leave-utils / ledger-utils 搬來），只給遷移用 |
| `src/lib/backfill-plan.ts` | Create | 純函式：由舊資料產生回填列 |
| `src/lib/backfill-plan.test.ts` | Create | 遷移等價性測試 |
| `src/lib/annual-grant.ts` | Create | DB 服務：預覽 / 發放 / 新人 / 離職作廢 / 重算 / 調整 / 期初 / 讀取 |
| `src/lib/annual-grant.test.ts` | Create | 服務層 mock 測試 |
| `src/lib/annual-grant.db.test.ts` | Create | 真實 MySQL 測試（Docker） |
| `vitest.db.config.ts` | Create | 只跑 `*.db.test.ts` |
| `vitest.config.ts` | Modify | 預設排除 `*.db.test.ts` |
| `src/lib/leave-utils.ts` | Modify | 特休餘額改讀 grants；移除 `calcCalendarYearCumulative`；新增跨年檢查 |
| `src/lib/leave-utils.test.ts` | Modify | 搬走 `calcCalendarYearCumulative` 測試；新增特休餘額測試 |
| `src/lib/ledger-utils.ts` | Modify | 特休 ledger 改讀 grants |
| `src/app/actions/leave.ts` | Modify | applyLeave / updateLeave 加跨年額度檢查 |
| `src/lib/line.ts` | Modify | 新增 `sendLineAdminNotice` |
| `src/app/api/cron/annual-leave-grant/route.ts` | Create | 12/1 排程端點 |
| `src/app/api/cron/annual-leave-grant/route.test.ts` | Create | 端點測試 |
| `src/lib/audit.ts` | Modify | 新增 action / target 類型 |
| `src/lib/admin-guard.ts` | Create | 共用 `requireAdmin()` |
| `src/app/admin/users/actions.ts` | Modify | 修權限漏洞；建檔 / 改到職日 / 離職 / 期初 接到 grant 服務 |
| `src/app/admin/users/actions.test.ts` | Create | 權限與 grant 串接測試 |
| `src/app/admin/users/page.tsx` | Modify | 非 ADMIN 導回首頁；載入每人 grants |
| `src/app/admin/annual-grant-actions.ts` | Create | HR 按鈕、作廢、調整、單人發放、重算的 server actions |
| `src/app/admin/annual-grant-actions.test.ts` | Create | server action 測試 |
| `src/app/admin/leave-settings/AnnualGrantPanel.tsx` | Create | 全部發放區塊 + 預覽對話框 |
| `src/app/admin/leave-settings/page.tsx` | Modify | 加區塊；調整列表改讀 grants |
| `src/app/admin/leave-settings/Forms.tsx` | Modify | 調整表單改寫 grants；刪除改作廢 |
| `src/app/admin/users/AnnualLeaveCell.tsx` | Create | 員工「特休」欄：剩餘、發放紀錄、單人發放、期初、重算 |
| `src/app/admin/users/UserTable.tsx` | Modify | 換掉 `OpeningCell`；到職日 / 離職日回傳處理 |
| `src/app/components/BalanceSummary.tsx` | Modify | 顯示「YYYY 年度特休 N 天將於 1/1 生效」 |
| `src/app/page.tsx`、`src/app/apply/page.tsx` | Modify | 傳入即將生效的發放 |
| `scripts/annual-grant-backfill.ts` | Create | 回填（預設 dry-run） |
| `scripts/annual-grant-audit.ts` | Create | 逐人零差異審核報表 |
| `scripts/annual-grant-fix-prorata.ts` | Create | Aaron / Sophia 首年改 A 算法 |
| `DEPLOYMENT.md` | Modify | 新增排程與 runbook |

---

### Task 0: 建分支、修員工管理權限漏洞

健檢高優先第 1 項。先做，因為 Task 9 也要改 `src/app/admin/users/actions.ts`，而且目前任何登入員工都能呼叫這 12 個 action（含把自己升 ADMIN）。

**Files:**
- Create: `src/lib/admin-guard.ts`
- Modify: `src/app/admin/users/actions.ts:10-16`
- Modify: `src/app/admin/users/page.tsx:11-22`
- Test: `src/app/admin/users/actions.test.ts`

**Interfaces:**
- Produces: `requireAdmin(): Promise<string>`（回傳 actor userId；非 ADMIN 丟 `Error("Forbidden")`；impersonate 中丟錯）

- [ ] **Step 1: 建分支**

```bash
cd /Users/benson/Documents/project/internal/timeoff-system
git checkout -b feat/annual-grant-ledger
```

- [ ] **Step 2: 寫失敗測試**

`src/app/admin/users/actions.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockPrisma = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn() },
}))
const mockAuth = vi.hoisted(() => vi.fn())

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }))
vi.mock("@/auth", () => ({ auth: mockAuth }))
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => {}) }))
vi.mock("@/lib/impersonation", () => ({ assertNotImpersonating: vi.fn(async () => {}) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { updateUserRole, updateUserHireDate } from "./actions"

describe("admin/users actions 權限", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "u1", email: "emp@example.com" } })
  })

  it("一般員工呼叫 updateUserRole → Forbidden，且不寫 DB", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "u1", role: "EMPLOYEE" })
    await expect(updateUserRole("u1", "ADMIN")).rejects.toThrow("Forbidden")
    expect(mockPrisma.user.update).not.toHaveBeenCalled()
  })

  it("主管呼叫 updateUserHireDate → Forbidden", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "u1", role: "MANAGER" })
    await expect(updateUserHireDate("u2", "2026-01-01")).rejects.toThrow("Forbidden")
    expect(mockPrisma.user.update).not.toHaveBeenCalled()
  })

  it("未登入 → Unauthorized", async () => {
    mockAuth.mockResolvedValue(null)
    await expect(updateUserRole("u1", "ADMIN")).rejects.toThrow("Unauthorized")
  })

  it("ADMIN 可以呼叫", async () => {
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ id: "u1", role: "ADMIN" }) // requireAdmin
      .mockResolvedValueOnce({ role: "EMPLOYEE" })        // before
    mockPrisma.user.update.mockResolvedValue({})
    await expect(updateUserRole("u2", "MANAGER")).resolves.toMatchObject({ success: true })
  })
})
```

- [ ] **Step 3: 跑測試確認失敗**

Run: `npx vitest run src/app/admin/users/actions.test.ts`
Expected: 前兩個 case FAIL（目前沒有檢查 role，不會丟 Forbidden）

- [ ] **Step 4: 實作 `requireAdmin` 並套用**

`src/lib/admin-guard.ts`：

```ts
import { prisma } from "./db"
import { auth } from "@/auth"
import { assertNotImpersonating } from "./impersonation"

// 所有後台寫入 action 共用：從 DB 取最新 role，只允許 ADMIN。
// impersonate 中一律禁止寫入（session.user.id 會被換成目標員工）。
export async function requireAdmin(): Promise<string> {
  await assertNotImpersonating()
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")
  const me = await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, role: true } })
  if (me?.role !== "ADMIN") throw new Error("Forbidden")
  return me.id
}
```

`src/app/admin/users/actions.ts`：刪除第 10-16 行的 `requireActorId`，加 `import { requireAdmin } from "@/lib/admin-guard"`，並把檔案內所有 `await requireActorId()` 改成 `await requireAdmin()`：

```bash
sed -i '' 's/await requireActorId()/await requireAdmin()/g' src/app/admin/users/actions.ts
```

`src/app/admin/users/page.tsx` 第 14-22 行改為：

```ts
  const session = await auth()
  if (!session?.user?.id) redirect("/")
  const me = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } })
  if (me?.role !== "ADMIN") redirect("/")
```

- [ ] **Step 5: 跑測試確認通過**

Run: `npx vitest run src/app/admin/users/actions.test.ts && npx tsc --noEmit`
Expected: 4 passed；tsc 無錯誤

- [ ] **Step 6: Commit**

```bash
git add src/lib/admin-guard.ts src/app/admin/users/actions.ts src/app/admin/users/actions.test.ts src/app/admin/users/page.tsx
git commit -m "fix(security): 員工管理 action 與頁面限 ADMIN

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1: Schema — 新增 `AnnualLeaveGrant`（只改檔案，不推 DB）

**Files:**
- Modify: `prisma/schema.prisma`（新增 enum、model；User model 的 `leaveBalances` 那行下方加三個 relation）

**Interfaces:**
- Produces: Prisma model `annualLeaveGrant`，欄位見 Step 1；enum `AnnualLeaveGrantKind`、`AnnualLeaveGrantSource`。

- [ ] **Step 1: 修改 schema**

在 `model LeaveAdjustment` 之後加：

```prisma
// 特休發放紀錄：每一次發放（首年、年度、期初、手動調整）都是一筆。
// 公式只在寫入當下計算；之後公式改變不影響已寫入的紀錄。
enum AnnualLeaveGrantKind {
  PRORATA
  ANNUAL
  OPENING
  ADJUSTMENT
}

enum AnnualLeaveGrantSource {
  HIRE
  SYSTEM_CRON
  HR_BUTTON
  HR_MANUAL
  RECALC
  MIGRATION
}

model AnnualLeaveGrant {
  id          String                 @id @default(uuid())
  userId      String
  kind        AnnualLeaveGrantKind
  // PRORATA = 到職年；ANNUAL = 發放年；OPENING / ADJUSTMENT = null
  year        Int?
  // 生效日（UTC midnight）；生效日之後才計入餘額
  effectiveAt DateTime
  // 0.5 倍數；ADJUSTMENT 可為負
  amount      Float
  // 計算依據：{ rule, text, ...數值 }，寫入當下固定
  basis       Json?
  reason      String?                @db.Text
  source      AnnualLeaveGrantSource
  createdById String?
  // 防呆唯一鍵："PRORATA:2026" / "ANNUAL:2027"；OPENING / ADJUSTMENT = null；作廢時清為 null
  periodKey   String?
  voidedAt    DateTime?
  voidedById  String?
  voidReason  String?                @db.Text
  createdAt   DateTime               @default(now())

  user      User  @relation("UserAnnualGrants", fields: [userId], references: [id])
  createdBy User? @relation("CreatedAnnualGrants", fields: [createdById], references: [id])
  voidedBy  User? @relation("VoidedAnnualGrants", fields: [voidedById], references: [id])

  @@unique([userId, periodKey])
  @@index([userId, effectiveAt])
}
```

在 `model User` 的 `leaveBalances  UserLeaveBalance[]` 下一行加：

```prisma
  annualGrants        AnnualLeaveGrant[] @relation("UserAnnualGrants")
  createdAnnualGrants AnnualLeaveGrant[] @relation("CreatedAnnualGrants")
  voidedAnnualGrants  AnnualLeaveGrant[] @relation("VoidedAnnualGrants")
```

- [ ] **Step 2: 產生 client 並檢查型別**

Run: `npx prisma validate && npx prisma generate && npx tsc --noEmit`
Expected: `The schema at prisma/schema.prisma is valid`；tsc 無錯誤

**不要**執行 `prisma db push`（Task 13 才做，且需使用者同意）。

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(schema): 新增 AnnualLeaveGrant 特休發放紀錄表

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 純計算 `annual-grant-calc.ts`

**Files:**
- Create: `src/lib/annual-grant-calc.ts`
- Test: `src/lib/annual-grant-calc.test.ts`

**Interfaces:**
- Consumes: `getStatutoryAnnualDays(years: number): number`、`monthsBetween(start: Date, end: Date): number`（`src/lib/leave-utils.ts`）
- Produces:
  - `type GrantBasis = { rule: string; text: string; [k: string]: string | number }`
  - `type GrantCalc = { amount: number; basis: GrantBasis }`
  - `type Override = { year: number; totalQuota: number }`（呼叫端需依 year ASC 排序）
  - `floorToHalf(n: number): number`
  - `remainingFullMonths(hireDate: Date): number`
  - `calcProRataGrant(hireDate: Date, defaultDays: number): GrantCalc`
  - `calcAnnualGrant(hireDate: Date, year: number, defaultDays: number, overrides: Override[]): GrantCalc`
  - `annualIneligibleReason(u: { hireDate: Date | null; terminatedDate: Date | null }, year: number): string | null`
  - `openYearFor(todayTaipei: Date): number`
  - `allowedGrantYears(todayTaipei: Date): number[]`
  - `periodKey(kind: "PRORATA" | "ANNUAL", year: number): string`
  - `type GrantLike = { kind: string; effectiveAt: Date; amount: number }`
  - `sumGrantTotal(activeGrants: GrantLike[], asOf: Date): number`
  - `isAnnualLeaveTypeName(name: string): boolean`

- [ ] **Step 1: 寫失敗測試**

`src/lib/annual-grant-calc.test.ts`：

```ts
import { describe, it, expect, vi } from "vitest"

vi.mock("./db", () => ({ prisma: {} }))

import {
  floorToHalf, remainingFullMonths, calcProRataGrant, calcAnnualGrant,
  annualIneligibleReason, openYearFor, allowedGrantYears, periodKey, sumGrantTotal,
} from "./annual-grant-calc"

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

describe("calcProRataGrant（A 算法：剩餘完整月數 ÷ 12 × 10，捨去到 0.5）", () => {
  it.each([
    ["2026-01-01", 12, 10],
    ["2026-01-02", 11, 9],
    ["2026-06-15", 6, 5],
    ["2026-08-24", 4, 3],   // Sophia
    ["2026-10-01", 3, 2.5], // Aaron
    ["2026-12-01", 1, 0.5],
    ["2026-12-02", 0, 0],
    ["2028-02-29", 10, 8],  // 閏年 2/29（非 1 號 → 從 3 月起算 10 個月 → 8.33 → 8）
  ])("到職 %s → 剩 %i 個月 → %f 天", (hire, months, amount) => {
    expect(remainingFullMonths(d(hire))).toBe(months)
    const r = calcProRataGrant(d(hire), 10)
    expect(r.amount).toBe(amount)
    expect(r.basis.rule).toBe("PRORATA_MONTHS_V1")
    expect(r.basis.months).toBe(months)
    expect(r.basis.text).toBe(`到職首年：剩 ${months} 個月 × 10 ÷ 12 → ${amount} 天`)
  })
})

describe("floorToHalf", () => {
  it("捨去到 0.5，浮點誤差不吃掉整數", () => {
    expect(floorToHalf(3.33)).toBe(3)
    expect(floorToHalf(2.5)).toBe(2.5)
    expect(floorToHalf(7 / 12 * 12)).toBe(7)
  })
})

describe("calcAnnualGrant", () => {
  it.each([
    ["2025-03-01", 2027, 1, 10],  // 未滿 2 年 → defaultDays
    ["2024-08-14", 2027, 2, 10],  // 滿 2 年 → §38 10
    ["2023-08-14", 2027, 3, 14],  // 林仲軍：滿 3 年 → 14
    ["2021-12-31", 2027, 5, 15],
    ["2017-01-01", 2027, 10, 16],
    ["2000-01-01", 2027, 27, 30], // 25 年起封頂
  ])("到職 %s，%i 年 1/1 年資 %i → %f 天", (hire, year, yrs, amount) => {
    const r = calcAnnualGrant(d(hire), year, 10, [])
    expect(r.amount).toBe(amount)
    expect(r.basis.completedYears).toBe(yrs)
  })

  it("2/29 到職：隔年 1/1 年資用完整月數計算", () => {
    expect(calcAnnualGrant(d("2024-02-29"), 2027, 10, []).basis.completedYears).toBe(2)
  })

  it("override 取較大者，且只適用 year <= 發放年", () => {
    const ov = [{ year: 2026, totalQuota: 12 }, { year: 2028, totalQuota: 20 }]
    const r = calcAnnualGrant(d("2025-03-01"), 2027, 10, ov)
    expect(r.amount).toBe(12)
    expect(r.basis.text).toContain("個人額度 12 天，取較大者 → 12 天")
    expect(calcAnnualGrant(d("2023-08-14"), 2027, 10, [{ year: 2027, totalQuota: 12 }]).amount).toBe(14)
  })
})

describe("annualIneligibleReason", () => {
  it("沒有到職日", () => expect(annualIneligibleReason({ hireDate: null, terminatedDate: null }, 2027)).toBe("沒有到職日"))
  it("到職年 = 發放年（走首年）", () =>
    expect(annualIneligibleReason({ hireDate: d("2027-03-01"), terminatedDate: null }, 2027)).toBe("到職年即發放年，已由首年按比例發放"))
  it("離職日剛好 1/1 → 不發", () =>
    expect(annualIneligibleReason({ hireDate: d("2020-01-01"), terminatedDate: d("2027-01-01") }, 2027)).toBe("發放日前已離職"))
  it("離職日 1/2 → 發", () =>
    expect(annualIneligibleReason({ hireDate: d("2020-01-01"), terminatedDate: d("2027-01-02") }, 2027)).toBeNull())
})

describe("openYearFor / allowedGrantYears", () => {
  it("11/30 開放到今年；12/1 起開放到明年", () => {
    expect(openYearFor(d("2026-11-30"))).toBe(2026)
    expect(openYearFor(d("2026-12-01"))).toBe(2027)
  })
  it("HR 只能發今年或明年", () => expect(allowedGrantYears(d("2026-10-01"))).toEqual([2026, 2027]))
})

describe("periodKey", () => {
  it("格式", () => expect(periodKey("ANNUAL", 2027)).toBe("ANNUAL:2027"))
})

describe("sumGrantTotal", () => {
  const g = (kind: string, iso: string, amount: number) => ({ kind, effectiveAt: d(iso), amount })

  it("無期初：生效日 <= asOf 才計入", () => {
    const grants = [g("PRORATA", "2026-10-01", 2.5), g("ANNUAL", "2027-01-01", 10), g("ADJUSTMENT", "2026-11-01", -1)]
    expect(sumGrantTotal(grants, d("2026-09-30"))).toBe(0)
    expect(sumGrantTotal(grants, d("2026-12-31"))).toBe(1.5)
    expect(sumGrantTotal(grants, d("2027-01-01"))).toBe(11.5)
  })

  it("有期初：期初一律計入（與舊公式一致），其他只算期初日之後", () => {
    const grants = [g("OPENING", "2026-01-01", 12), g("ADJUSTMENT", "2026-01-01", 3), g("ADJUSTMENT", "2026-10-01", 4), g("ANNUAL", "2027-01-01", 14)]
    expect(sumGrantTotal(grants, d("2025-12-31"))).toBe(12)
    expect(sumGrantTotal(grants, d("2026-10-01"))).toBe(16)
    expect(sumGrantTotal(grants, d("2027-01-01"))).toBe(30)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/lib/annual-grant-calc.test.ts`
Expected: FAIL，`Cannot find module './annual-grant-calc'`

- [ ] **Step 3: 實作**

`src/lib/annual-grant-calc.ts`：

```ts
import { getStatutoryAnnualDays, monthsBetween } from "./leave-utils"

// 特休發放的純計算。公式只存在這裡，且只在「寫入發放紀錄當下」被呼叫。

export type GrantBasis = { rule: string; text: string; [k: string]: string | number }
export type GrantCalc = { amount: number; basis: GrantBasis }
export type Override = { year: number; totalQuota: number }
export type GrantLike = { kind: string; effectiveAt: Date; amount: number }

// 捨去到 0.5；加極小值避免 2.9999999 這類浮點誤差被捨成 2.5
export function floorToHalf(n: number): number {
  return Math.floor(n * 2 + 1e-9) / 2
}

// 剩餘完整月數：1 號到職算當月；其他日期從下個月起算
export function remainingFullMonths(hireDate: Date): number {
  const m = hireDate.getUTCMonth()
  return hireDate.getUTCDate() === 1 ? 12 - m : 11 - m
}

// 首年按比例（A 算法，HR 2026-10-01 確認）
export function calcProRataGrant(hireDate: Date, defaultDays: number): GrantCalc {
  const months = remainingFullMonths(hireDate)
  const amount = floorToHalf((months / 12) * defaultDays)
  return {
    amount,
    basis: {
      rule: "PRORATA_MONTHS_V1",
      months,
      defaultDays,
      text: `到職首年：剩 ${months} 個月 × ${defaultDays} ÷ 12 → ${amount} 天`,
    },
  }
}

// 年度發放：以 year-01-01 的完整年資；<2 年 = defaultDays，>=2 年 = 勞基法 §38；override 取大
export function calcAnnualGrant(hireDate: Date, year: number, defaultDays: number, overrides: Override[]): GrantCalc {
  const jan1 = new Date(Date.UTC(year, 0, 1))
  const completedYears = Math.floor(monthsBetween(hireDate, jan1) / 12)
  const base = completedYears < 2 ? defaultDays : getStatutoryAnnualDays(completedYears)

  let override: number | null = null
  for (const o of overrides) {
    if (o.year <= year) override = o.totalQuota
    else break
  }
  const amount = override !== null ? Math.max(base, override) : base

  let text = completedYears < 2
    ? `${year} 年度特休：年資 ${completedYears} 年（未滿 2 年依公司規定）→ ${base} 天`
    : `${year} 年度特休：滿 ${completedYears} 年，依勞基法 §38 → ${base} 天`
  if (override !== null) text += `；個人額度 ${override} 天，取較大者 → ${amount} 天`

  const basis: GrantBasis = { rule: "ANNUAL_V1", completedYears, base, text }
  if (override !== null) basis.override = override
  return { amount, basis }
}

// 不符年度發放資格的原因；符合回 null
export function annualIneligibleReason(
  u: { hireDate: Date | null; terminatedDate: Date | null },
  year: number,
): string | null {
  if (!u.hireDate) return "沒有到職日"
  if (u.hireDate.getUTCFullYear() >= year) return "到職年即發放年，已由首年按比例發放"
  const jan1 = new Date(Date.UTC(year, 0, 1))
  // terminatedDate = 離職日，自該日起視為離職
  if (u.terminatedDate && u.terminatedDate <= jan1) return "發放日前已離職"
  return null
}

// 目前開放到哪一年：12/1（台北）起開放明年
export function openYearFor(todayTaipei: Date): number {
  const y = todayTaipei.getUTCFullYear()
  return todayTaipei.getUTCMonth() === 11 ? y + 1 : y
}

// HR 按鈕可發的年度：今年、明年
export function allowedGrantYears(todayTaipei: Date): number[] {
  const y = todayTaipei.getUTCFullYear()
  return [y, y + 1]
}

export function periodKey(kind: "PRORATA" | "ANNUAL", year: number): string {
  return `${kind}:${year}`
}

// 特休總額（只傳入未作廢的紀錄）。
// 有期初：期初一律計入（與舊公式一致），其他紀錄只算「期初日之後、且生效日 <= asOf」。
// 無期初：生效日 <= asOf 的全部加總。
export function sumGrantTotal(activeGrants: GrantLike[], asOf: Date): number {
  const opening = activeGrants.find((g) => g.kind === "OPENING")
  let total = 0
  for (const g of activeGrants) {
    if (g.kind === "OPENING") continue
    if (g.effectiveAt > asOf) continue
    if (opening && g.effectiveAt <= opening.effectiveAt) continue
    total += g.amount
  }
  return opening ? opening.amount + total : total
}

export function isAnnualLeaveTypeName(name: string): boolean {
  return name.includes("特休") || name.toLowerCase().includes("annual")
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/lib/annual-grant-calc.test.ts`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/annual-grant-calc.ts src/lib/annual-grant-calc.test.ts
git commit -m "feat(annual-grant): 特休發放純計算（首年月份制、年度、資格、總額）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 舊公式搬家 + 回填產生器 + 等價性測試

**Files:**
- Create: `src/lib/legacy-annual-calc.ts`
- Create: `src/lib/backfill-plan.ts`
- Test: `src/lib/backfill-plan.test.ts`
- Modify: `src/lib/leave-utils.test.ts`（`calcCalendarYearCumulative` 的 describe 改從 `./legacy-annual-calc` import）

**Interfaces:**
- Consumes: Task 2 的 `calcAnnualGrant`、`periodKey`、`sumGrantTotal`、`GrantBasis`、`Override`
- Produces:
  - `legacyCalcCalendarYearCumulative(hireDate, asOf, defaultDays, overrides, adjustments, opening?)`（與現行 `calcCalendarYearCumulative` 完全相同）
  - `legacyProRata(hireDate: Date, defaultDays: number): { amount: number; remainingDays: number; yearTotal: number }`
  - `type BackfillRow = { kind: "PRORATA"|"ANNUAL"|"OPENING"|"ADJUSTMENT"; year: number|null; effectiveAt: Date; amount: number; basis: GrantBasis; reason: string|null; periodKey: string|null; createdById: string|null }`
  - `buildBackfillRows(input: { hireDate: Date|null; opening: { balance: number; at: Date } | null; overrides: Override[]; adjustments: { effectiveAt: Date; amount: number; reason: string; createdById: string }[]; defaultDays: number; now: Date }): BackfillRow[]`

- [ ] **Step 1: 建立 `legacy-annual-calc.ts`**

把 `src/lib/leave-utils.ts` 第 125-219 行（`ceilToHalf`、`isLeapYear`、`daysInYear`、`daysFromHireToYearEnd`、`calcCalendarYearCumulative`）**原封不動**複製到新檔，函式改名 `legacyCalcCalendarYearCumulative`，並加上 `legacyProRata`：

```ts
import { getStatutoryAnnualDays, monthsBetween } from "./leave-utils"

// ⚠️ 舊版特休即時公式（2026-05-20 ~ 遷移前）。
// 只給：遷移回填、零差異審核報表、等價性測試使用。遷移穩定後（過完 2027/1/1）刪除。

function ceilToHalf(n: number): number {
  return Math.ceil(n * 2) / 2
}
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}
function daysInYear(year: number): number {
  return isLeapYear(year) ? 366 : 365
}
function daysFromHireToYearEnd(hireDate: Date): number {
  const nextYearStart = Date.UTC(hireDate.getUTCFullYear() + 1, 0, 1)
  return Math.round((nextYearStart - hireDate.getTime()) / 86_400_000)
}

// 舊首年：剩餘天數 / 全年天數 × defaultDays，無條件進位到 0.5
export function legacyProRata(hireDate: Date, defaultDays: number) {
  const remainingDays = daysFromHireToYearEnd(hireDate)
  const yearTotal = daysInYear(hireDate.getUTCFullYear())
  return { amount: ceilToHalf((remainingDays / yearTotal) * defaultDays), remainingDays, yearTotal }
}

export function legacyCalcCalendarYearCumulative(
  hireDate: Date,
  asOf: Date,
  leaveTypeDefaultDays: number,
  overrides: { year: number; totalQuota: number }[],
  adjustments: { effectiveAt: Date; amount: number }[],
  opening?: { balance: number; at: Date }
): number {
  // 以下與 leave-utils.ts 遷移前的 calcCalendarYearCumulative 本體相同（第 156-218 行），不可修改
  function resolveOverride(calendarYear: number): number | null {
    let applicable: number | null = null
    for (const o of overrides) {
      if (o.year <= calendarYear) applicable = o.totalQuota
      else break
    }
    return applicable
  }

  function grantForJan1(year: number): number {
    const jan1 = new Date(Date.UTC(year, 0, 1))
    const completedYears = Math.floor(monthsBetween(hireDate, jan1) / 12)
    const base = completedYears < 2
      ? leaveTypeDefaultDays
      : getStatutoryAnnualDays(completedYears)
    const applicable = resolveOverride(year)
    return applicable !== null ? Math.max(base, applicable) : base
  }

  let total: number
  if (opening) {
    total = opening.balance
    let year = hireDate.getUTCFullYear() + 1
    const stopYear = asOf.getUTCFullYear() + 1
    while (year < stopYear) {
      const jan1 = new Date(Date.UTC(year, 0, 1))
      if (jan1 > asOf) break
      if (jan1 > opening.at) {
        total += grantForJan1(year)
      }
      year++
    }
  } else {
    if (asOf < hireDate) return 0
    const remainingDays = daysFromHireToYearEnd(hireDate)
    const yearTotal = daysInYear(hireDate.getUTCFullYear())
    total = ceilToHalf(remainingDays / yearTotal * leaveTypeDefaultDays)

    let year = hireDate.getUTCFullYear() + 1
    const stopYear = asOf.getUTCFullYear() + 1
    while (year < stopYear) {
      const jan1 = new Date(Date.UTC(year, 0, 1))
      if (jan1 > asOf) break
      total += grantForJan1(year)
      year++
    }
  }

  for (const adj of adjustments) {
    if (adj.effectiveAt > asOf) continue
    if (opening && adj.effectiveAt <= opening.at) continue
    total += adj.amount
  }

  return total
}
```

貼完後用 `diff <(sed -n 156,218p src/lib/leave-utils.ts) <(...)` 或肉眼逐行比對，確認與原本體邏輯一致（Step 2 的舊測試會再驗證一次）。

- [ ] **Step 2: 修改 `leave-utils.test.ts` import**

`src/lib/leave-utils.test.ts` 第 18 行的 `calcCalendarYearCumulative,` 從 `./leave-utils` 的 import 移除，並新增：

```ts
import { legacyCalcCalendarYearCumulative as calcCalendarYearCumulative } from "./legacy-annual-calc"
```

Run: `npx vitest run src/lib/leave-utils.test.ts`
Expected: 全部 PASS（同一組舊測試現在測的是 legacy 檔）

- [ ] **Step 3: 寫等價性失敗測試**

`src/lib/backfill-plan.test.ts`：

```ts
import { describe, it, expect, vi } from "vitest"

vi.mock("./db", () => ({ prisma: {} }))

import { buildBackfillRows } from "./backfill-plan"
import { legacyCalcCalendarYearCumulative } from "./legacy-annual-calc"
import { sumGrantTotal } from "./annual-grant-calc"

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const NOW = d("2026-10-01")

// 合成員工：涵蓋有/無期初、各種到職日、override、手動調整（含期初日當天與之前）
const cases = [
  { name: "Sophia 型：今年到職無期初", hireDate: d("2026-08-24"), opening: null, overrides: [], adjustments: [] },
  { name: "Aaron 型：1 號到職", hireDate: d("2026-10-01"), opening: null, overrides: [], adjustments: [] },
  { name: "Ringo 型：1/1 到職", hireDate: d("2026-01-01"), opening: null, overrides: [], adjustments: [] },
  { name: "去年到職無期初", hireDate: d("2025-03-15"), opening: null, overrides: [], adjustments: [] },
  { name: "多年無期初 + override", hireDate: d("2021-07-01"), opening: null, overrides: [{ year: 2024, totalQuota: 18 }], adjustments: [] },
  {
    name: "林仲軍型：有期初 + 期初後調整",
    hireDate: d("2023-08-14"),
    opening: { balance: 12, at: d("2026-01-01") },
    overrides: [],
    adjustments: [{ effectiveAt: d("2026-10-01"), amount: 4, reason: "年資滿3年補滿14天特休", createdById: "hr" }],
  },
  {
    name: "期初當天與之前的調整不重複計",
    hireDate: d("2019-02-01"),
    opening: { balance: 20, at: d("2026-01-01") },
    overrides: [],
    adjustments: [
      { effectiveAt: d("2025-12-01"), amount: 2, reason: "x", createdById: "hr" },
      { effectiveAt: d("2026-01-01"), amount: 1, reason: "y", createdById: "hr" },
      { effectiveAt: d("2026-03-01"), amount: -1.5, reason: "z", createdById: "hr" },
    ],
  },
  { name: "未來生效的調整", hireDate: d("2024-05-05"), opening: null, overrides: [], adjustments: [{ effectiveAt: d("2026-12-15"), amount: 2, reason: "w", createdById: "hr" }] },
]

// 時間點：每月 1 號與月底，2019 ~ 今天
const asOfs: Date[] = []
for (let y = 2019; y <= 2026; y++) {
  for (let m = 0; m < 12; m++) {
    const first = new Date(Date.UTC(y, m, 1))
    const last = new Date(Date.UTC(y, m + 1, 0))
    if (first <= NOW) asOfs.push(first)
    if (last <= NOW) asOfs.push(last)
  }
}

describe("buildBackfillRows 與舊公式等價（asOf <= 遷移日）", () => {
  for (const c of cases) {
    it(c.name, () => {
      const rows = buildBackfillRows({ ...c, defaultDays: 10, now: NOW })
      for (const asOf of asOfs) {
        const legacy = legacyCalcCalendarYearCumulative(
          c.hireDate, asOf, 10, c.overrides,
          c.adjustments.map((a) => ({ effectiveAt: a.effectiveAt, amount: a.amount })),
          c.opening ?? undefined,
        )
        expect(sumGrantTotal(rows, asOf), `${c.name} @ ${asOf.toISOString().slice(0, 10)}`).toBe(legacy)
      }
    })
  }

  it("有期初者不產生 PRORATA；無期初者 PRORATA 用舊天數算法原值", () => {
    const withOpening = buildBackfillRows({ ...cases[5], defaultDays: 10, now: NOW })
    expect(withOpening.some((r) => r.kind === "PRORATA")).toBe(false)
    const sophia = buildBackfillRows({ ...cases[0], defaultDays: 10, now: NOW })
    expect(sophia.find((r) => r.kind === "PRORATA")).toMatchObject({ amount: 4, periodKey: "PRORATA:2026", year: 2026 })
  })

  it("沒有到職日 → 空陣列", () => {
    expect(buildBackfillRows({ hireDate: null, opening: null, overrides: [], adjustments: [], defaultDays: 10, now: NOW })).toEqual([])
  })
})
```

- [ ] **Step 4: 跑測試確認失敗**

Run: `npx vitest run src/lib/backfill-plan.test.ts`
Expected: FAIL，`Cannot find module './backfill-plan'`

- [ ] **Step 5: 實作 `backfill-plan.ts`**

```ts
import { calcAnnualGrant, periodKey, type GrantBasis, type Override } from "./annual-grant-calc"
import { legacyProRata } from "./legacy-annual-calc"

// 遷移回填：把「舊公式截至 now 已發生的發放」照抄成紀錄，數字與舊公式完全一致。

export type BackfillRow = {
  kind: "PRORATA" | "ANNUAL" | "OPENING" | "ADJUSTMENT"
  year: number | null
  effectiveAt: Date
  amount: number
  basis: GrantBasis
  reason: string | null
  periodKey: string | null
  createdById: string | null
}

export function buildBackfillRows(input: {
  hireDate: Date | null
  opening: { balance: number; at: Date } | null
  overrides: Override[]
  adjustments: { effectiveAt: Date; amount: number; reason: string; createdById: string }[]
  defaultDays: number
  now: Date
}): BackfillRow[] {
  const { hireDate, opening, overrides, adjustments, defaultDays, now } = input
  if (!hireDate) return []
  const rows: BackfillRow[] = []
  const hireYear = hireDate.getUTCFullYear()

  if (opening) {
    rows.push({
      kind: "OPENING", year: null, effectiveAt: opening.at, amount: opening.balance,
      basis: { rule: "MIGRATED_OPENING", text: `期初餘額 ${opening.balance} 天（遷移自舊制）` },
      reason: "遷移自舊制期初餘額", periodKey: null, createdById: null,
    })
  } else {
    const p = legacyProRata(hireDate, defaultDays)
    rows.push({
      kind: "PRORATA", year: hireYear, effectiveAt: hireDate, amount: p.amount,
      basis: {
        rule: "MIGRATED_PRORATA_DAYS", remainingDays: p.remainingDays, yearTotal: p.yearTotal, defaultDays,
        text: `到職首年：${p.remainingDays}/${p.yearTotal} × ${defaultDays} → ${p.amount} 天（遷移自即時公式）`,
      },
      reason: null, periodKey: periodKey("PRORATA", hireYear), createdById: null,
    })
  }

  for (let year = hireYear + 1; year <= now.getUTCFullYear(); year++) {
    const jan1 = new Date(Date.UTC(year, 0, 1))
    if (jan1 > now) break
    if (opening && jan1 <= opening.at) continue // 已含在期初
    const g = calcAnnualGrant(hireDate, year, defaultDays, overrides)
    rows.push({
      kind: "ANNUAL", year, effectiveAt: jan1, amount: g.amount,
      basis: { ...g.basis, rule: "MIGRATED_ANNUAL", text: `${g.basis.text}（遷移自即時公式）` },
      reason: null, periodKey: periodKey("ANNUAL", year), createdById: null,
    })
  }

  for (const a of adjustments) {
    if (opening && a.effectiveAt <= opening.at) continue // 已含在期初
    rows.push({
      kind: "ADJUSTMENT", year: null, effectiveAt: a.effectiveAt, amount: a.amount,
      basis: { rule: "MIGRATED_ADJUSTMENT", text: `HR 調整 ${a.amount > 0 ? "+" : ""}${a.amount} 天（${a.reason}）` },
      reason: a.reason, periodKey: null, createdById: a.createdById,
    })
  }
  return rows
}
```

- [ ] **Step 6: 跑測試確認通過**

Run: `npx vitest run src/lib/backfill-plan.test.ts src/lib/leave-utils.test.ts`
Expected: 全部 PASS。若等價性有任何一個時間點失敗，**停止**，回報差異案例，不要調整測試去迎合。

- [ ] **Step 7: Commit**

```bash
git add src/lib/legacy-annual-calc.ts src/lib/backfill-plan.ts src/lib/backfill-plan.test.ts src/lib/leave-utils.test.ts
git commit -m "feat(annual-grant): 舊公式隔離 + 回填產生器與等價性測試

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: DB 服務 `annual-grant.ts`（mock 測試）

**Files:**
- Create: `src/lib/annual-grant.ts`
- Test: `src/lib/annual-grant.test.ts`

**Interfaces:**
- Consumes: Task 2 全部；`todayStartUTCFromTaipei()`（`src/lib/date-format.ts`）；Prisma `annualLeaveGrant`
- Produces（後續 Task 6/7/8/9/11 使用）：
  - `getAnnualLeaveType(): Promise<{ id: string; name: string; defaultDays: number }>`
  - `type AnnualPreview = { year: number; toGrant: { userId: string; name: string; amount: number; basis: GrantBasis }[]; skipped: { userId: string; name: string; at: Date; source: string; byName: string | null }[]; ineligible: { userId: string; name: string; reason: string }[] }`
  - `previewAnnualForYear(year: number, opts?: { userIds?: string[] }): Promise<AnnualPreview>`
  - `grantAnnualForYear(year: number, opts: { userIds?: string[]; source: "SYSTEM_CRON" | "HR_BUTTON" | "HIRE" | "RECALC"; actorId?: string | null }): Promise<{ year: number; granted: AnnualPreview["toGrant"]; skipped: AnnualPreview["skipped"]; ineligible: AnnualPreview["ineligible"] }>`
  - `grantOnHire(userId: string, opts: { actorId: string | null; today?: Date }): Promise<{ created: string[] }>`（回傳寫入的 periodKey 清單）
  - `voidGrantsAfterTermination(userId: string, terminatedDate: Date, actorId: string): Promise<{ id: string; kind: string; year: number | null; amount: number }[]>`
  - `type RecalcChange = { periodKey: string; label: string; oldId: string | null; oldAmount: number | null; newAmount: number | null; newEffectiveAt: Date | null; newBasis: GrantBasis | null }`
  - `previewHireDateRecalc(userId: string, today?: Date): Promise<RecalcChange[]>`
  - `applyHireDateRecalc(userId: string, actorId: string, reason: string, today?: Date): Promise<RecalcChange[]>`
  - `listActiveGrants(userId: string): Promise<{ kind: string; effectiveAt: Date; amount: number; year: number | null }[]>`
  - `addAdjustment(args: { userId: string; effectiveAt: Date; amount: number; reason: string; actorId: string }): Promise<{ id: string }>`
  - `setOpening(args: { userId: string; balance: number; at: Date; actorId: string }): Promise<{ id: string }>`
  - `voidGrant(id: string, reason: string, actorId: string): Promise<{ id: string; userId: string; kind: string; amount: number }>`

- [ ] **Step 1: 寫失敗測試**

`src/lib/annual-grant.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { Prisma } from "@prisma/client"

const mockPrisma = vi.hoisted(() => ({
  leaveType: { findFirst: vi.fn() },
  user: { findMany: vi.fn(), findUnique: vi.fn() },
  userLeaveBalance: { findMany: vi.fn() },
  annualLeaveGrant: {
    findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(),
    create: vi.fn(), update: vi.fn(), updateMany: vi.fn(),
  },
  $transaction: vi.fn(),
}))
vi.mock("./db", () => ({ prisma: mockPrisma }))

import {
  previewAnnualForYear, grantAnnualForYear, grantOnHire, voidGrantsAfterTermination,
  previewHireDateRecalc, voidGrant, setOpening,
} from "./annual-grant"

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const p2002 = () => new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "6" })

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.leaveType.findFirst.mockResolvedValue({ id: "lt-annual", name: "特休", defaultDays: 10 })
  mockPrisma.userLeaveBalance.findMany.mockResolvedValue([])
  mockPrisma.annualLeaveGrant.findMany.mockResolvedValue([])
  mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => unknown) => fn(mockPrisma))
})

describe("previewAnnualForYear", () => {
  it("分成 將發放 / 已發放略過 / 不符資格", async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      { id: "joy", name: "Joy", hireDate: d("2023-08-14"), terminatedDate: null },
      { id: "amy", name: "Amy", hireDate: d("2022-01-01"), terminatedDate: null },
      { id: "new", name: "New", hireDate: d("2027-03-01"), terminatedDate: null },
    ])
    mockPrisma.annualLeaveGrant.findMany.mockImplementation(async (args: { where: { kind?: string | { in: string[] } } }) => {
      if (args.where.kind === "OPENING") return []
      return [{ userId: "amy", createdAt: d("2026-12-01"), source: "SYSTEM_CRON", createdBy: null }]
    })
    const r = await previewAnnualForYear(2027)
    expect(r.toGrant).toEqual([expect.objectContaining({ userId: "joy", amount: 14 })])
    expect(r.skipped).toEqual([expect.objectContaining({ userId: "amy", source: "SYSTEM_CRON" })])
    expect(r.ineligible).toEqual([expect.objectContaining({ userId: "new" })])
  })

  it("期初已含該年 → ineligible（避免重複）", async () => {
    mockPrisma.user.findMany.mockResolvedValue([{ id: "joy", name: "Joy", hireDate: d("2023-08-14"), terminatedDate: null }])
    mockPrisma.annualLeaveGrant.findMany.mockImplementation(async (args: { where: { kind?: string } }) =>
      args.where.kind === "OPENING" ? [{ userId: "joy", effectiveAt: d("2026-01-01") }] : [])
    const r = await previewAnnualForYear(2026)
    expect(r.ineligible).toEqual([{ userId: "joy", name: "Joy", reason: "期初餘額已包含此年度" }])
  })
})

describe("grantAnnualForYear 防呆", () => {
  beforeEach(() => {
    mockPrisma.user.findMany.mockResolvedValue([
      { id: "a", name: "A", hireDate: d("2020-01-01"), terminatedDate: null },
      { id: "b", name: "B", hireDate: d("2020-01-01"), terminatedDate: null },
    ])
  })

  it("寫入時帶 periodKey；被唯一鍵擋下（P2002）視為略過，不丟錯", async () => {
    mockPrisma.annualLeaveGrant.create
      .mockResolvedValueOnce({ id: "g1" })
      .mockRejectedValueOnce(p2002())
    const r = await grantAnnualForYear(2027, { source: "SYSTEM_CRON" })
    expect(r.granted.map((g) => g.userId)).toEqual(["a"])
    expect(r.skipped.map((s) => s.userId)).toEqual(["b"])
    expect(mockPrisma.annualLeaveGrant.create.mock.calls[0][0].data).toMatchObject({
      userId: "a", kind: "ANNUAL", year: 2027, periodKey: "ANNUAL:2027", effectiveAt: d("2027-01-01"), source: "SYSTEM_CRON",
    })
  })

  it("非 P2002 錯誤要丟出", async () => {
    mockPrisma.annualLeaveGrant.create.mockRejectedValue(new Error("db down"))
    await expect(grantAnnualForYear(2027, { source: "SYSTEM_CRON" })).rejects.toThrow("db down")
  })
})

describe("grantOnHire", () => {
  it("12/1 前建檔：只寫首年（A 算法）", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "aaron", name: "Aaron", hireDate: d("2026-10-01"), terminatedDate: null })
    mockPrisma.user.findMany.mockResolvedValue([])
    mockPrisma.annualLeaveGrant.findFirst.mockResolvedValue(null) // 無期初
    mockPrisma.annualLeaveGrant.create.mockResolvedValue({ id: "g" })
    const r = await grantOnHire("aaron", { actorId: "hr", today: d("2026-10-01") })
    expect(r.created).toEqual(["PRORATA:2026"])
    expect(mockPrisma.annualLeaveGrant.create.mock.calls[0][0].data).toMatchObject({ kind: "PRORATA", amount: 2.5, source: "HIRE" })
  })

  it("grantOnHire 在 12/5 建檔會補明年 ANNUAL", async () => {
    const u = { id: "dec", name: "Dec", hireDate: d("2026-12-15"), terminatedDate: null }
    mockPrisma.user.findUnique.mockResolvedValue(u)
    mockPrisma.user.findMany.mockResolvedValue([u])
    mockPrisma.annualLeaveGrant.findFirst.mockResolvedValue(null)
    mockPrisma.annualLeaveGrant.create.mockResolvedValue({ id: "g" })
    const r = await grantOnHire("dec", { actorId: "hr", today: d("2026-12-05") })
    expect(r.created).toEqual(["PRORATA:2026", "ANNUAL:2027"])
  })

  it("補建 2025 年到職者 → 2025 首年 + 2026 年度", async () => {
    const u = { id: "old", name: "Old", hireDate: d("2025-05-01"), terminatedDate: null }
    mockPrisma.user.findUnique.mockResolvedValue(u)
    mockPrisma.user.findMany.mockResolvedValue([u])
    mockPrisma.annualLeaveGrant.findFirst.mockResolvedValue(null)
    mockPrisma.annualLeaveGrant.create.mockResolvedValue({ id: "g" })
    const r = await grantOnHire("old", { actorId: "hr", today: d("2026-10-01") })
    expect(r.created).toEqual(["PRORATA:2025", "ANNUAL:2026"])
  })

  it("有期初 → 不寫首年", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "x", name: "X", hireDate: d("2023-08-14"), terminatedDate: null })
    mockPrisma.annualLeaveGrant.findFirst.mockResolvedValue({ id: "op", effectiveAt: d("2026-01-01") })
    const r = await grantOnHire("x", { actorId: "hr", today: d("2026-10-01") })
    expect(r.created).toEqual([])
    expect(mockPrisma.annualLeaveGrant.create).not.toHaveBeenCalled()
  })
})

describe("voidGrantsAfterTermination", () => {
  it("作廢生效日 >= 離職日的 PRORATA/ANNUAL，並清空 periodKey", async () => {
    mockPrisma.annualLeaveGrant.findMany.mockResolvedValue([{ id: "g27", kind: "ANNUAL", year: 2027, amount: 10 }])
    mockPrisma.annualLeaveGrant.updateMany.mockResolvedValue({ count: 1 })
    const r = await voidGrantsAfterTermination("u", d("2027-01-01"), "hr")
    expect(mockPrisma.annualLeaveGrant.findMany.mock.calls[0][0].where).toMatchObject({
      userId: "u", voidedAt: null, kind: { in: ["PRORATA", "ANNUAL"] }, effectiveAt: { gte: d("2027-01-01") },
    })
    expect(mockPrisma.annualLeaveGrant.updateMany.mock.calls[0][0].data).toMatchObject({ periodKey: null, voidedById: "hr" })
    expect(r).toHaveLength(1)
  })
})

describe("previewHireDateRecalc", () => {
  it("previewRecalc 到職年改變：舊 PRORATA:2026 作廢、新增 PRORATA:2025 與 ANNUAL:2026", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "u", name: "U", hireDate: d("2025-11-01"), terminatedDate: null })
    mockPrisma.annualLeaveGrant.findFirst.mockResolvedValue(null)
    mockPrisma.annualLeaveGrant.findMany.mockResolvedValue([
      { id: "old", kind: "PRORATA", year: 2026, periodKey: "PRORATA:2026", amount: 2.5, effectiveAt: d("2026-10-01") },
    ])
    const changes = await previewHireDateRecalc("u", d("2026-10-01"))
    expect(changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ periodKey: "PRORATA:2026", oldAmount: 2.5, newAmount: null }),
      expect.objectContaining({ periodKey: "PRORATA:2025", oldAmount: null, newAmount: 1.5 }),
      expect.objectContaining({ periodKey: "ANNUAL:2026", oldAmount: null, newAmount: 10 }),
    ]))
  })

  it("天數與生效日都沒變 → 不列入", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "u", name: "U", hireDate: d("2026-10-01"), terminatedDate: null })
    mockPrisma.annualLeaveGrant.findFirst.mockResolvedValue(null)
    mockPrisma.annualLeaveGrant.findMany.mockResolvedValue([
      { id: "p", kind: "PRORATA", year: 2026, periodKey: "PRORATA:2026", amount: 2.5, effectiveAt: d("2026-10-01") },
    ])
    expect(await previewHireDateRecalc("u", d("2026-10-01"))).toEqual([])
  })
})

describe("voidGrant / setOpening", () => {
  it("已作廢的不能再作廢", async () => {
    mockPrisma.annualLeaveGrant.findUnique.mockResolvedValue({ id: "g", voidedAt: d("2026-10-01") })
    await expect(voidGrant("g", "x", "hr")).rejects.toThrow("此紀錄已作廢")
  })

  it("作廢原因必填", async () => {
    await expect(voidGrant("g", "  ", "hr")).rejects.toThrow("作廢原因必填")
  })

  it("setOpening 先作廢舊期初再寫新的", async () => {
    mockPrisma.annualLeaveGrant.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.annualLeaveGrant.create.mockResolvedValue({ id: "new" })
    await setOpening({ userId: "u", balance: 12, at: d("2026-01-01"), actorId: "hr" })
    expect(mockPrisma.annualLeaveGrant.updateMany.mock.calls[0][0]).toMatchObject({
      where: { userId: "u", kind: "OPENING", voidedAt: null },
      data: { voidReason: "期初餘額重設" },
    })
    expect(mockPrisma.annualLeaveGrant.create.mock.calls[0][0].data).toMatchObject({ kind: "OPENING", amount: 12, source: "HR_MANUAL" })
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/lib/annual-grant.test.ts`
Expected: FAIL，`Cannot find module './annual-grant'`

- [ ] **Step 3: 實作 `annual-grant.ts`**

```ts
import { Prisma } from "@prisma/client"
import { prisma } from "./db"
import { todayStartUTCFromTaipei } from "./date-format"
import {
  calcAnnualGrant, calcProRataGrant, annualIneligibleReason, openYearFor, periodKey,
  type GrantBasis, type Override,
} from "./annual-grant-calc"

// 特休發放紀錄的唯一寫入入口：排程、HR 按鈕、新人、離職、重算、調整、期初都經過這裡。

type GrantSource = "SYSTEM_CRON" | "HR_BUTTON" | "HIRE" | "RECALC"

const isUniqueViolation = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002"

const displayName = (u: { name: string | null }) => u.name ?? "(未命名)"

export async function getAnnualLeaveType() {
  const lt = await prisma.leaveType.findFirst({
    where: { isActive: true, name: { contains: "特休" } },
    select: { id: true, name: true, defaultDays: true },
  })
  if (!lt) throw new Error("找不到特休假別")
  return lt
}

async function loadOverrides(leaveTypeId: string, userIds: string[]): Promise<Map<string, Override[]>> {
  const rows = await prisma.userLeaveBalance.findMany({
    where: { leaveTypeId, userId: { in: userIds } },
    orderBy: { year: "asc" },
    select: { userId: true, year: true, totalQuota: true },
  })
  const map = new Map<string, Override[]>()
  for (const r of rows) {
    const list = map.get(r.userId) ?? []
    list.push({ year: r.year, totalQuota: r.totalQuota })
    map.set(r.userId, list)
  }
  return map
}

export type AnnualPreview = {
  year: number
  toGrant: { userId: string; name: string; amount: number; basis: GrantBasis }[]
  skipped: { userId: string; name: string; at: Date; source: string; byName: string | null }[]
  ineligible: { userId: string; name: string; reason: string }[]
}

export async function previewAnnualForYear(year: number, opts: { userIds?: string[] } = {}): Promise<AnnualPreview> {
  const lt = await getAnnualLeaveType()
  const users = await prisma.user.findMany({
    where: opts.userIds ? { id: { in: opts.userIds } } : {},
    select: { id: true, name: true, hireDate: true, terminatedDate: true },
    orderBy: { name: "asc" },
  })
  const ids = users.map((u) => u.id)
  const existing = await prisma.annualLeaveGrant.findMany({
    where: { userId: { in: ids }, periodKey: periodKey("ANNUAL", year), voidedAt: null },
    select: { userId: true, createdAt: true, source: true, createdBy: { select: { name: true } } },
  })
  const openings = await prisma.annualLeaveGrant.findMany({
    where: { userId: { in: ids }, kind: "OPENING", voidedAt: null },
    select: { userId: true, effectiveAt: true },
  })
  const existingBy = new Map(existing.map((e) => [e.userId, e]))
  const openingBy = new Map(openings.map((o) => [o.userId, o.effectiveAt]))
  const overrides = await loadOverrides(lt.id, ids)
  const jan1 = new Date(Date.UTC(year, 0, 1))

  const result: AnnualPreview = { year, toGrant: [], skipped: [], ineligible: [] }
  for (const u of users) {
    const name = displayName(u)
    const ex = existingBy.get(u.id)
    if (ex) {
      result.skipped.push({ userId: u.id, name, at: ex.createdAt, source: ex.source, byName: ex.createdBy?.name ?? null })
      continue
    }
    const reason = annualIneligibleReason(u, year)
    if (reason) { result.ineligible.push({ userId: u.id, name, reason }); continue }
    const openingAt = openingBy.get(u.id)
    if (openingAt && openingAt >= jan1) {
      result.ineligible.push({ userId: u.id, name, reason: "期初餘額已包含此年度" })
      continue
    }
    const g = calcAnnualGrant(u.hireDate!, year, lt.defaultDays, overrides.get(u.id) ?? [])
    result.toGrant.push({ userId: u.id, name, amount: g.amount, basis: g.basis })
  }
  return result
}

export async function grantAnnualForYear(
  year: number,
  opts: { userIds?: string[]; source: GrantSource; actorId?: string | null },
) {
  const preview = await previewAnnualForYear(year, { userIds: opts.userIds })
  const granted: AnnualPreview["toGrant"] = []
  const skipped = [...preview.skipped]
  for (const g of preview.toGrant) {
    try {
      await prisma.annualLeaveGrant.create({
        data: {
          userId: g.userId, kind: "ANNUAL", year, effectiveAt: new Date(Date.UTC(year, 0, 1)),
          amount: g.amount, basis: g.basis, reason: null, source: opts.source,
          createdById: opts.actorId ?? null, periodKey: periodKey("ANNUAL", year),
        },
      })
      granted.push(g)
    } catch (e) {
      // 另一邊（排程或 HR 按鈕）剛好先寫入：唯一鍵擋下 → 視為已發放
      if (!isUniqueViolation(e)) throw e
      skipped.push({ userId: g.userId, name: g.name, at: new Date(), source: "CONCURRENT", byName: null })
    }
  }
  return { year, granted, skipped, ineligible: preview.ineligible }
}

async function getActiveOpening(userId: string) {
  return prisma.annualLeaveGrant.findFirst({
    where: { userId, kind: "OPENING", voidedAt: null },
    select: { id: true, effectiveAt: true },
  })
}

// 新人（或補填到職日）：寫首年，並補齊到目前開放年度
export async function grantOnHire(userId: string, opts: { actorId: string | null; today?: Date }) {
  const today = opts.today ?? todayStartUTCFromTaipei()
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, hireDate: true, terminatedDate: true },
  })
  const created: string[] = []
  if (!user?.hireDate) return { created }
  if (await getActiveOpening(userId)) return { created }

  const lt = await getAnnualLeaveType()
  const hireYear = user.hireDate.getUTCFullYear()
  const p = calcProRataGrant(user.hireDate, lt.defaultDays)
  try {
    await prisma.annualLeaveGrant.create({
      data: {
        userId, kind: "PRORATA", year: hireYear, effectiveAt: user.hireDate, amount: p.amount,
        basis: p.basis, reason: null, source: "HIRE", createdById: opts.actorId,
        periodKey: periodKey("PRORATA", hireYear),
      },
    })
    created.push(periodKey("PRORATA", hireYear))
  } catch (e) {
    if (!isUniqueViolation(e)) throw e
  }

  for (let year = hireYear + 1; year <= openYearFor(today); year++) {
    const r = await grantAnnualForYear(year, { userIds: [userId], source: "HIRE", actorId: opts.actorId })
    if (r.granted.length > 0) created.push(periodKey("ANNUAL", year))
  }
  return { created }
}

// 離職：作廢生效日 >= 離職日的系統發放（離職日起視為離職）
export async function voidGrantsAfterTermination(userId: string, terminatedDate: Date, actorId: string) {
  const targets = await prisma.annualLeaveGrant.findMany({
    where: { userId, voidedAt: null, kind: { in: ["PRORATA", "ANNUAL"] }, effectiveAt: { gte: terminatedDate } },
    select: { id: true, kind: true, year: true, amount: true },
  })
  if (targets.length === 0) return []
  await prisma.annualLeaveGrant.updateMany({
    where: { id: { in: targets.map((t) => t.id) } },
    data: { voidedAt: new Date(), voidedById: actorId, voidReason: "生效日在離職日之後", periodKey: null },
  })
  return targets
}

export type RecalcChange = {
  periodKey: string
  label: string
  oldId: string | null
  oldAmount: number | null
  newAmount: number | null
  newEffectiveAt: Date | null
  newBasis: GrantBasis | null
}

const labelOf = (key: string) => {
  const [kind, year] = key.split(":")
  return kind === "PRORATA" ? `${year} 到職首年` : `${year} 年度特休`
}

// 依「目前的到職日」算出應有的 PRORATA/ANNUAL，與現有紀錄比對
export async function previewHireDateRecalc(userId: string, today: Date = todayStartUTCFromTaipei()): Promise<RecalcChange[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, hireDate: true, terminatedDate: true },
  })
  if (!user) throw new Error("找不到員工")
  const lt = await getAnnualLeaveType()
  const opening = await getActiveOpening(userId)
  const current = await prisma.annualLeaveGrant.findMany({
    where: { userId, voidedAt: null, kind: { in: ["PRORATA", "ANNUAL"] } },
    select: { id: true, kind: true, year: true, periodKey: true, amount: true, effectiveAt: true },
  })
  const overrides = (await loadOverrides(lt.id, [userId])).get(userId) ?? []

  const desired = new Map<string, { amount: number; effectiveAt: Date; basis: GrantBasis }>()
  if (user.hireDate) {
    const hireYear = user.hireDate.getUTCFullYear()
    if (!opening) {
      const p = calcProRataGrant(user.hireDate, lt.defaultDays)
      desired.set(periodKey("PRORATA", hireYear), { amount: p.amount, effectiveAt: user.hireDate, basis: p.basis })
    }
    const maxExisting = Math.max(0, ...current.filter((c) => c.kind === "ANNUAL").map((c) => c.year ?? 0))
    const maxYear = Math.max(openYearFor(today), maxExisting)
    for (let year = hireYear + 1; year <= maxYear; year++) {
      const jan1 = new Date(Date.UTC(year, 0, 1))
      if (annualIneligibleReason(user, year)) continue
      if (opening && opening.effectiveAt >= jan1) continue
      const g = calcAnnualGrant(user.hireDate, year, lt.defaultDays, overrides)
      desired.set(periodKey("ANNUAL", year), { amount: g.amount, effectiveAt: jan1, basis: g.basis })
    }
  }

  const changes: RecalcChange[] = []
  const currentBy = new Map(current.map((c) => [c.periodKey!, c]))
  for (const key of new Set([...currentBy.keys(), ...desired.keys()])) {
    const old = currentBy.get(key)
    const want = desired.get(key)
    if (old && want && old.amount === want.amount && old.effectiveAt.getTime() === want.effectiveAt.getTime()) continue
    changes.push({
      periodKey: key, label: labelOf(key),
      oldId: old?.id ?? null, oldAmount: old?.amount ?? null,
      newAmount: want?.amount ?? null, newEffectiveAt: want?.effectiveAt ?? null, newBasis: want?.basis ?? null,
    })
  }
  return changes.sort((a, b) => a.periodKey.localeCompare(b.periodKey))
}

export async function applyHireDateRecalc(userId: string, actorId: string, reason: string, today: Date = todayStartUTCFromTaipei()) {
  const changes = await previewHireDateRecalc(userId, today)
  await prisma.$transaction(async (tx) => {
    for (const c of changes) {
      if (c.oldId) {
        await tx.annualLeaveGrant.update({
          where: { id: c.oldId },
          data: { voidedAt: new Date(), voidedById: actorId, voidReason: reason, periodKey: null },
        })
      }
      if (c.newAmount !== null && c.newEffectiveAt && c.newBasis) {
        const [kind, year] = c.periodKey.split(":")
        await tx.annualLeaveGrant.create({
          data: {
            userId, kind: kind as "PRORATA" | "ANNUAL", year: Number(year), effectiveAt: c.newEffectiveAt,
            amount: c.newAmount, basis: c.newBasis, reason, source: "RECALC", createdById: actorId, periodKey: c.periodKey,
          },
        })
      }
    }
  })
  return changes
}

export async function listActiveGrants(userId: string) {
  return prisma.annualLeaveGrant.findMany({
    where: { userId, voidedAt: null },
    orderBy: { effectiveAt: "asc" },
    select: { kind: true, effectiveAt: true, amount: true, year: true },
  })
}

function assertHalfStep(amount: number) {
  if (Math.abs(amount * 2 - Math.round(amount * 2)) > 1e-9) throw new Error("天數必須是 0.5 的倍數")
}

export async function addAdjustment(args: { userId: string; effectiveAt: Date; amount: number; reason: string; actorId: string }) {
  const reason = args.reason.trim()
  if (!reason) throw new Error("原因必填")
  if (isNaN(args.amount) || args.amount === 0) throw new Error("數量必須為非 0 數值")
  assertHalfStep(args.amount)
  return prisma.annualLeaveGrant.create({
    data: {
      userId: args.userId, kind: "ADJUSTMENT", year: null, effectiveAt: args.effectiveAt, amount: args.amount,
      basis: { rule: "ADJUSTMENT", text: `HR 調整 ${args.amount > 0 ? "+" : ""}${args.amount} 天（${reason}）` },
      reason, source: "HR_MANUAL", createdById: args.actorId, periodKey: null,
    },
    select: { id: true },
  })
}

export async function setOpening(args: { userId: string; balance: number; at: Date; actorId: string }) {
  if (isNaN(args.balance) || args.balance < 0) throw new Error("期初天數需為非負數")
  assertHalfStep(args.balance)
  return prisma.$transaction(async (tx) => {
    await tx.annualLeaveGrant.updateMany({
      where: { userId: args.userId, kind: "OPENING", voidedAt: null },
      data: { voidedAt: new Date(), voidedById: args.actorId, voidReason: "期初餘額重設" },
    })
    return tx.annualLeaveGrant.create({
      data: {
        userId: args.userId, kind: "OPENING", year: null, effectiveAt: args.at, amount: args.balance,
        basis: { rule: "OPENING", text: `期初餘額 ${args.balance} 天` },
        reason: "HR 設定期初餘額", source: "HR_MANUAL", createdById: args.actorId, periodKey: null,
      },
      select: { id: true },
    })
  })
}

export async function voidGrant(id: string, reason: string, actorId: string) {
  if (!reason.trim()) throw new Error("作廢原因必填")
  const g = await prisma.annualLeaveGrant.findUnique({ where: { id } })
  if (!g) throw new Error("找不到此紀錄")
  if (g.voidedAt) throw new Error("此紀錄已作廢")
  await prisma.annualLeaveGrant.update({
    where: { id },
    data: { voidedAt: new Date(), voidedById: actorId, voidReason: reason.trim(), periodKey: null },
  })
  return { id: g.id, userId: g.userId, kind: g.kind, amount: g.amount }
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/lib/annual-grant.test.ts && npx tsc --noEmit`
Expected: 全部 PASS；tsc 無錯誤

- [ ] **Step 5: Commit**

```bash
git add src/lib/annual-grant.ts src/lib/annual-grant.test.ts
git commit -m "feat(annual-grant): 發放服務（預覽、防呆發放、新人、離職作廢、重算、調整、期初）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 真實 MySQL 測試（Docker，跑完關閉）

**Files:**
- Create: `vitest.db.config.ts`
- Modify: `vitest.config.ts`（`include` 不變，加 `exclude: ["src/**/*.db.test.ts", "node_modules/**"]`）
- Create: `src/lib/annual-grant.db.test.ts`

**Interfaces:**
- Consumes: Task 1 schema、Task 4 `grantAnnualForYear`、`voidGrant`

- [ ] **Step 1: 設定 vitest**

`vitest.config.ts` 的 `test` 內加：

```ts
    exclude: ["src/**/*.db.test.ts", "node_modules/**"],
```

`vitest.db.config.ts`：

```ts
import { defineConfig } from "vitest/config"
import path from "path"

// 只跑需要真實 MySQL 的測試；DATABASE_URL 必須指向本機 Docker（見測試檔開頭的保護）
export default defineConfig({
  test: { include: ["src/**/*.db.test.ts"], testTimeout: 30_000, fileParallelism: false },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
})
```

- [ ] **Step 2: 寫 DB 測試**

`src/lib/annual-grant.db.test.ts`：

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest"

// 保護：絕對不能打到 Cloud SQL
const url = process.env.DATABASE_URL ?? ""
if (!url.includes("127.0.0.1:3307")) throw new Error(`DB 測試只能連本機 Docker（127.0.0.1:3307），目前：${url}`)

import { prisma } from "./db"
import { grantAnnualForYear, voidGrant } from "./annual-grant"

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

beforeAll(async () => {
  await prisma.department.create({ data: { id: "dept", name: "測試部" } })
  await prisma.leaveType.create({ data: { id: "lt", name: "特休", defaultDays: 10, isActive: true } })
  await prisma.user.create({ data: { id: "u1", email: "u1@t", name: "U1", departmentId: "dept", hireDate: d("2020-01-01") } })
})

afterAll(async () => { await prisma.$disconnect() })

describe("AnnualLeaveGrant 唯一鍵（真實 MySQL）", () => {
  it("並行 5 次發同一年 → 只有 1 筆成功", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => grantAnnualForYear(2027, { userIds: ["u1"], source: "SYSTEM_CRON" })),
    )
    expect(results.reduce((n, r) => n + r.granted.length, 0)).toBe(1)
    expect(await prisma.annualLeaveGrant.count({ where: { userId: "u1", periodKey: "ANNUAL:2027" } })).toBe(1)
  })

  it("作廢後 periodKey 清空，可重新發放", async () => {
    const g = await prisma.annualLeaveGrant.findFirstOrThrow({ where: { userId: "u1", periodKey: "ANNUAL:2027" } })
    await voidGrant(g.id, "測試", "u1")
    const r = await grantAnnualForYear(2027, { userIds: ["u1"], source: "HR_BUTTON" })
    expect(r.granted).toHaveLength(1)
    expect(await prisma.annualLeaveGrant.count({ where: { userId: "u1", year: 2027 } })).toBe(2)
  })

  it("ADJUSTMENT（periodKey = null）同人可多筆", async () => {
    for (const amount of [1, 2]) {
      await prisma.annualLeaveGrant.create({
        data: { userId: "u1", kind: "ADJUSTMENT", effectiveAt: d("2026-10-01"), amount, source: "HR_MANUAL", periodKey: null },
      })
    }
    expect(await prisma.annualLeaveGrant.count({ where: { userId: "u1", kind: "ADJUSTMENT" } })).toBe(2)
  })
})
```

（若 `department`、`leaveType`、`user` 有其他必填欄位，依 `prisma/schema.prisma` 補上最少必填值。）

- [ ] **Step 3: 啟動 Docker MySQL 並套用 schema**

```bash
open -a Docker
until docker info >/dev/null 2>&1; do sleep 2; done
docker run -d --name timeoff-test-mysql -e MYSQL_ROOT_PASSWORD=test -e MYSQL_DATABASE=timeoff_test -p 3307:3306 mysql:8.0
until docker exec timeoff-test-mysql mysqladmin ping -ptest --silent; do sleep 2; done
DATABASE_URL="mysql://root:test@127.0.0.1:3307/timeoff_test" npx prisma db push --skip-generate
```

Expected: `Your database is now in sync with your Prisma schema.`（**只對本機 3307**）

- [ ] **Step 4: 跑 DB 測試**

Run: `DATABASE_URL="mysql://root:test@127.0.0.1:3307/timeoff_test" npx vitest run -c vitest.db.config.ts`
Expected: 3 passed

- [ ] **Step 5: 關閉並清除 Docker**

```bash
docker rm -f timeoff-test-mysql
osascript -e 'quit app "Docker"'
```

確認 `docker ps` 連不上（Docker 已關）。

- [ ] **Step 6: 確認預設測試不會跑 DB 測試，然後 Commit**

Run: `npx vitest run`
Expected: 全部 PASS，且輸出不含 `annual-grant.db.test.ts`

```bash
git add vitest.config.ts vitest.db.config.ts src/lib/annual-grant.db.test.ts
git commit -m "test(annual-grant): 真實 MySQL 驗證唯一鍵與並行發放

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 餘額讀取改用 grants + 跨年重複花額度修正

**Files:**
- Modify: `src/lib/leave-utils.ts`（`getUserLeaveBalance` 特休分支第 233-283 行；刪除第 125-219 行舊公式與輔助函式）
- Modify: `src/app/actions/leave.ts`（applyLeave 第 88-93 行、updateLeave 第 509-516 行）
- Test: `src/lib/leave-utils.test.ts`（新增 describe）

**Interfaces:**
- Consumes: Task 2 `sumGrantTotal`、`isAnnualLeaveTypeName`；Task 4 `listActiveGrants`
- Produces:
  - `getUserLeaveBalance(userId, leaveTypeId, asOf?)` 簽名與回傳不變
  - `findAnnualShortfall(userId: string, leaveTypeId: string, extra: { startDate: Date; days: number }, excludeRequestId?: string): Promise<{ year: number; remaining: number } | null>`

- [ ] **Step 1: 寫失敗測試**

`src/lib/leave-utils.test.ts`：把檔案頂端 `vi.mock("./db", ...)` 的 mock 物件擴充為：

```ts
vi.mock("./db", () => ({
  prisma: {
    holiday: { findMany: vi.fn() },
    leaveType: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    annualLeaveGrant: { findMany: vi.fn() },
    leaveRequest: { aggregate: vi.fn(), findMany: vi.fn() },
  },
}))
```

新增 describe（`getUserLeaveBalance`、`findAnnualShortfall` 加進 import）：

```ts
describe("getUserLeaveBalance 特休（讀 grants）", () => {
  beforeEach(() => {
    vi.mocked(prisma.leaveType.findUnique).mockResolvedValue({ id: "lt", name: "特休", defaultDays: 10 } as never)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "u", hireDate: utcDate("2023-08-14") } as never)
    vi.mocked(prisma.leaveRequest.aggregate).mockResolvedValue({ _sum: { durationDays: 0 } } as never)
  })

  it("total = 期初 + 期初後已生效的紀錄；未生效的明年發放不計", async () => {
    vi.mocked(prisma.annualLeaveGrant.findMany).mockResolvedValue([
      { kind: "OPENING", effectiveAt: utcDate("2026-01-01"), amount: 12, year: null },
      { kind: "ADJUSTMENT", effectiveAt: utcDate("2026-10-01"), amount: 4, year: null },
      { kind: "ANNUAL", effectiveAt: utcDate("2027-01-01"), amount: 14, year: 2027 },
    ] as never)
    const bal = await getUserLeaveBalance("u", "lt", utcDate("2026-10-01"))
    expect(bal.total).toBe(16)
    const next = await getUserLeaveBalance("u", "lt", utcDate("2027-02-01"))
    expect(next.total).toBe(30)
  })

  it("沒有到職日 → 全 0", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "u", hireDate: null } as never)
    expect((await getUserLeaveBalance("u", "lt")).total).toBe(0)
  })
})

describe("findAnnualShortfall（跨年重複花額度）", () => {
  it("今年剩 5、明年發 14：先請明年 19 天，再請今年 5 天 → 擋下（2027 年底會是 -5）", async () => {
    vi.mocked(prisma.leaveType.findUnique).mockResolvedValue({ id: "lt", name: "特休", defaultDays: 10 } as never)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "u", hireDate: utcDate("2023-08-14") } as never)
    vi.mocked(prisma.annualLeaveGrant.findMany).mockResolvedValue([
      { kind: "OPENING", effectiveAt: utcDate("2026-01-01"), amount: 5, year: null },
      { kind: "ANNUAL", effectiveAt: utcDate("2027-01-01"), amount: 14, year: 2027 },
    ] as never)
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([
      { id: "r27", startDate: utcDate("2027-02-01"), durationDays: 19 },
    ] as never)
    const r = await findAnnualShortfall("u", "lt", { startDate: utcDate("2026-12-01"), days: 5 })
    expect(r).toEqual({ year: 2027, remaining: -5 })
  })

  it("額度足夠 → null", async () => {
    vi.mocked(prisma.annualLeaveGrant.findMany).mockResolvedValue([
      { kind: "OPENING", effectiveAt: utcDate("2026-01-01"), amount: 5, year: null },
      { kind: "ANNUAL", effectiveAt: utcDate("2027-01-01"), amount: 14, year: 2027 },
    ] as never)
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([] as never)
    expect(await findAnnualShortfall("u", "lt", { startDate: utcDate("2026-12-01"), days: 5 })).toBeNull()
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/lib/leave-utils.test.ts`
Expected: FAIL（`findAnnualShortfall` 不存在；特休 total 仍走舊公式）

- [ ] **Step 3: 改寫 `getUserLeaveBalance` 特休分支並新增 `findAnnualShortfall`**

刪除 `leave-utils.ts` 第 125-219 行（`ceilToHalf` 到 `calcCalendarYearCumulative` 結尾）。`getStatutoryAnnualDays`、`monthsBetween`、`addYearsUTC` 保留。檔頭加：

```ts
import { sumGrantTotal, isAnnualLeaveTypeName } from "./annual-grant-calc"
```

把特休分支（`if (isAnnualLeave) { ... return {...} }`）整段替換為：

```ts
  if (isAnnualLeave) {
    if (!user.hireDate) {
      return { total: 0, used: 0, pending: 0, pendingFirst: 0, pendingSecond: 0, remaining: 0 };
    }
    const grants = await prisma.annualLeaveGrant.findMany({
      where: { userId, voidedAt: null },
      select: { kind: true, effectiveAt: true, amount: true, year: true },
    })
    const total = sumGrantTotal(grants, asOf)
    const opening = grants.find((g) => g.kind === "OPENING")

    // 已用 / 待審：截止日 = asOf 所屬年度 12/31；有期初時只算期初日之後（與遷移前相同）
    const endOfYear = new Date(Date.UTC(asOf.getUTCFullYear(), 11, 31, 23, 59, 59, 999))
    const startFilter = opening ? { gte: opening.effectiveAt, lte: endOfYear } : { lte: endOfYear }
    const [usedAgg, pendingAgg, pendingSecondAgg] = await Promise.all([
      prisma.leaveRequest.aggregate({ _sum: { durationDays: true }, where: { userId, leaveTypeId, status: "APPROVED", startDate: startFilter } }),
      prisma.leaveRequest.aggregate({ _sum: { durationDays: true }, where: { userId, leaveTypeId, status: "PENDING", startDate: startFilter } }),
      prisma.leaveRequest.aggregate({ _sum: { durationDays: true }, where: { userId, leaveTypeId, status: "PENDING", firstApprovedAt: { not: null }, startDate: startFilter } }),
    ])
    const used = usedAgg._sum.durationDays || 0
    const pending = pendingAgg._sum.durationDays || 0
    const pendingSecond = pendingSecondAgg._sum.durationDays || 0
    return { total, used, pending, pendingFirst: pending - pendingSecond, pendingSecond, remaining: total - used - pending }
  }
```

`const isAnnualLeave = ...` 那行改為 `const isAnnualLeave = isAnnualLeaveTypeName(leaveType.name);`。檔尾新增：

```ts
// 跨年重複花額度檢查：把「這張新單」加進去後，從請假年度到最遠一張已預約假單的年度，
// 每年 12/31 的累計剩餘都不可為負。回傳第一個不足的年度，足夠則 null。
export async function findAnnualShortfall(
  userId: string,
  leaveTypeId: string,
  extra: { startDate: Date; days: number },
  excludeRequestId?: string,
): Promise<{ year: number; remaining: number } | null> {
  const grants = await prisma.annualLeaveGrant.findMany({
    where: { userId, voidedAt: null },
    select: { kind: true, effectiveAt: true, amount: true, year: true },
  })
  const opening = grants.find((g) => g.kind === "OPENING")
  const requests = await prisma.leaveRequest.findMany({
    where: {
      userId, leaveTypeId, status: { in: ["APPROVED", "PENDING"] },
      ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}),
      ...(opening ? { startDate: { gte: opening.effectiveAt } } : {}),
    },
    select: { id: true, startDate: true, durationDays: true },
  })
  const all = [...requests.map((r) => ({ startDate: r.startDate, days: r.durationDays })), extra]
  const fromYear = extra.startDate.getUTCFullYear()
  const toYear = Math.max(fromYear, ...all.map((r) => r.startDate.getUTCFullYear()))
  for (let year = fromYear; year <= toYear; year++) {
    const yearEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999))
    const total = sumGrantTotal(grants, yearEnd)
    const spent = all.filter((r) => r.startDate <= yearEnd).reduce((n, r) => n + r.days, 0)
    if (total - spent < 0) return { year, remaining: total - spent }
  }
  return null
}
```

- [ ] **Step 4: applyLeave / updateLeave 加檢查**

`src/app/actions/leave.ts` import 加 `findAnnualShortfall`。applyLeave 第 92 行（`if (durationDays > balance.remaining) {...}` 區塊）之後加：

```ts
  if (isAnnual) {
    const shortfall = await findAnnualShortfall(userId, data.leaveTypeId, { startDate: start, days: durationDays })
    if (shortfall) {
      return { error: `${leaveTypeName}不足！加上這張單後，${shortfall.year} 年底特休會是 ${shortfall.remaining} 天（已預約的跨年假單也會用到額度）。` };
    }
  }
```

updateLeave 第 516 行（額度不足 return 的 `}`）之後加：

```ts
  const newTypeForCheck = leaveTypeChanged
    ? await prisma.leaveType.findUnique({ where: { id: data.leaveTypeId } })
    : request.leaveType
  if (newTypeForCheck && (newTypeForCheck.name.includes("特休") || newTypeForCheck.name.toLowerCase().includes("annual"))) {
    const shortfall = await findAnnualShortfall(userId, data.leaveTypeId, { startDate: start, days: newDuration }, requestId)
    if (shortfall) {
      return { error: `特休不足！修改後 ${shortfall.year} 年底特休會是 ${shortfall.remaining} 天。` };
    }
  }
```

- [ ] **Step 5: 跑全部測試**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 全部 PASS；tsc 無錯誤（若有地方還 import `calcCalendarYearCumulative`，改 import legacy 檔或移除）

- [ ] **Step 6: Commit**

```bash
git add src/lib/leave-utils.ts src/lib/leave-utils.test.ts src/app/actions/leave.ts
git commit -m "feat(annual-grant): 特休餘額改讀發放紀錄 + 跨年重複花額度檢查

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 歷史假單改讀 grants

**Files:**
- Modify: `src/lib/ledger-utils.ts`（特休分支第 77-197 行；刪除 `ceilToHalfLocal`、`isLeapYearLocal`、`daysInYearLocal`、`daysFromHireToYearEndLocal`、`resolveCalendarOverride`、`grantForJan1`）
- Test: `src/lib/ledger-utils.test.ts`（新建）

**Interfaces:**
- Consumes: Prisma `annualLeaveGrant`
- Produces: `getLeaveLedger(userId, leaveTypeId)` 簽名與 `LedgerEvent` 型別不變

- [ ] **Step 1: 寫失敗測試**

`src/lib/ledger-utils.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockPrisma = vi.hoisted(() => ({
  leaveType: { findUnique: vi.fn() },
  user: { findUnique: vi.fn() },
  annualLeaveGrant: { findMany: vi.fn() },
  leaveRequest: { findMany: vi.fn() },
}))
vi.mock("./db", () => ({ prisma: mockPrisma }))

import { getLeaveLedger } from "./ledger-utils"

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

describe("getLeaveLedger 特休（讀 grants）", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.leaveType.findUnique.mockResolvedValue({ id: "lt", name: "特休", defaultDays: 10 })
    mockPrisma.user.findUnique.mockResolvedValue({ id: "u", hireDate: d("2026-10-01") })
    mockPrisma.leaveRequest.findMany.mockResolvedValue([
      { id: "r1", startDate: d("2026-11-02"), endDate: d("2026-11-02"), durationDays: 1, status: "PENDING" },
    ])
  })

  it("發放說明用 basis.text；未生效的不顯示；running balance 正確", async () => {
    mockPrisma.annualLeaveGrant.findMany.mockResolvedValue([
      { id: "g1", kind: "PRORATA", effectiveAt: d("2026-10-01"), amount: 2.5, basis: { text: "到職首年：剩 3 個月 × 10 ÷ 12 → 2.5 天" } },
      { id: "g2", kind: "ANNUAL", effectiveAt: d("2099-01-01"), amount: 10, basis: { text: "未來" } },
    ])
    const events = await getLeaveLedger("u", "lt")
    expect(events.map((e) => e.description)).toEqual([
      "請假 (2026-11-02~2026-11-02) [待審核]",
      "到職首年：剩 3 個月 × 10 ÷ 12 → 2.5 天",
    ])
    expect(events[0].runningBalance).toBe(1.5)
  })

  it("負數調整列為 USAGE", async () => {
    mockPrisma.annualLeaveGrant.findMany.mockResolvedValue([
      { id: "g3", kind: "ADJUSTMENT", effectiveAt: d("2026-10-02"), amount: -1, basis: { text: "HR 調整 -1 天（扣除）" } },
    ])
    const events = await getLeaveLedger("u", "lt")
    expect(events.find((e) => e.id === "grant-g3")?.type).toBe("USAGE")
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/lib/ledger-utils.test.ts`
Expected: FAIL（目前讀 `leaveAdjustment`、`userLeaveBalance`，mock 沒有）

- [ ] **Step 3: 改寫特休分支**

`if (isAnnualLeave) { ... }` 整段替換為：

```ts
  if (isAnnualLeave) {
    if (!user.hireDate) return []

    const grants = await prisma.annualLeaveGrant.findMany({
      where: { userId, voidedAt: null },
      orderBy: { effectiveAt: "asc" },
      select: { id: true, kind: true, effectiveAt: true, amount: true, basis: true },
    })
    const opening = grants.find((g) => g.kind === "OPENING")
    for (const g of grants) {
      if (g.effectiveAt > now) continue // 未生效不顯示（明年發放在餘額卡片另行提示）
      const text = (g.basis as { text?: string } | null)?.text ?? `${g.kind} ${g.amount} 天`
      events.push({
        id: `grant-${g.id}`,
        date: g.effectiveAt,
        type: g.amount >= 0 ? "GRANT" : "USAGE",
        leaveTypeName: leaveType.name,
        description: text,
        amount: g.amount,
      })
    }

    // 已請假紀錄：期初之前的不顯示（已抵銷在期初內）
    const usages = await prisma.leaveRequest.findMany({
      where: {
        userId, leaveTypeId, status: { in: ["APPROVED", "PENDING"] },
        ...(opening ? { startDate: { gte: opening.effectiveAt } } : {}),
      },
    })
    for (const req of usages) {
      events.push({
        id: `usage-${req.id}`,
        date: req.startDate,
        type: "USAGE",
        leaveTypeName: leaveType.name,
        description: `請假 (${formatTaipeiDateISO(req.startDate)}~${formatTaipeiDateISO(req.endDate)}) ${req.status === "PENDING" ? "[待審核]" : ""}`.trim(),
        amount: -req.durationDays,
      })
    }
  } else {
```

刪掉檔頭不再使用的輔助函式與 import（`getStatutoryAnnualDays`、`monthsBetween`、`addYearsUTC`、`addMonthsUTC`）。

注意：原本的「滿 3 個月，特休開放申請」marker 一併移除（無金額、純提示）。若使用者要保留，另開需求。

- [ ] **Step 4: 跑測試**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/ledger-utils.ts src/lib/ledger-utils.test.ts
git commit -m "feat(annual-grant): 歷史假單特休改讀發放紀錄

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 12/1 排程端點 + 管理員 LINE 通知

**Files:**
- Modify: `src/lib/line.ts`（`sendLineDailyRoster` 之後新增函式）
- Create: `src/app/api/cron/annual-leave-grant/route.ts`
- Test: `src/app/api/cron/annual-leave-grant/route.test.ts`

**Interfaces:**
- Consumes: Task 4 `grantAnnualForYear`；Task 2 `openYearFor`；`todayStartUTCFromTaipei`
- Produces: `sendLineAdminNotice(text: string): Promise<number>`（回傳推播人數）；`GET /api/cron/annual-leave-grant`

- [ ] **Step 1: 寫失敗測試**

`src/app/api/cron/annual-leave-grant/route.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mockGrant = vi.hoisted(() => vi.fn())
const mockNotice = vi.hoisted(() => vi.fn(async () => 2))
vi.mock("@/lib/annual-grant", () => ({ grantAnnualForYear: mockGrant }))
vi.mock("@/lib/line", () => ({ sendLineAdminNotice: mockNotice }))
vi.mock("@/lib/date-format", () => ({ todayStartUTCFromTaipei: () => new Date("2026-12-01T00:00:00Z") }))
vi.mock("@/lib/db", () => ({ prisma: {} }))

import { GET } from "./route"

const req = (secret?: string) =>
  new NextRequest("http://x/api/cron/annual-leave-grant", { headers: secret ? { "x-cron-secret": secret } : {} })

describe("GET /api/cron/annual-leave-grant", () => {
  beforeEach(() => { vi.clearAllMocks(); process.env.CRON_SECRET = "s" })

  it("沒帶或帶錯 secret → 401，不發放", async () => {
    expect((await GET(req())).status).toBe(401)
    expect((await GET(req("bad"))).status).toBe(401)
    expect(mockGrant).not.toHaveBeenCalled()
  })

  it("12/1 發明年；成功通知管理員", async () => {
    mockGrant.mockResolvedValue({ year: 2027, granted: [{ userId: "a" }], skipped: [{ userId: "b" }], ineligible: [] })
    const res = await GET(req("s"))
    expect(res.status).toBe(200)
    expect(mockGrant).toHaveBeenCalledWith(2027, { source: "SYSTEM_CRON", actorId: null })
    expect(mockNotice.mock.calls[0][0]).toContain("2027 年度特休發放完成：發放 1 人、略過 1 人")
  })

  it("失敗 → 500 並通知管理員", async () => {
    mockGrant.mockRejectedValue(new Error("db down"))
    const res = await GET(req("s"))
    expect(res.status).toBe(500)
    expect(mockNotice.mock.calls[0][0]).toContain("2027 年度特休發放失敗：db down")
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/app/api/cron/annual-leave-grant/route.test.ts`
Expected: FAIL，找不到 `./route`

- [ ] **Step 3: 實作**

`src/lib/line.ts` 在 `sendLineDailyRoster` 之後加（檔頭補 `import { prisma } from "./db"`，若已存在則略過）：

```ts
/**
 * 系統訊息推給所有在職、已綁定 LINE 的 ADMIN（例如 12/1 特休年度發放結果）
 */
export async function sendLineAdminNotice(text: string): Promise<number> {
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", terminatedDate: null, lineUserId: { not: null } },
    select: { lineUserId: true },
  })
  await Promise.allSettled(admins.map((a) => linePush(a.lineUserId!, [{ type: "text", text }])))
  return admins.length
}
```

`src/app/api/cron/annual-leave-grant/route.ts`：

```ts
import { NextRequest, NextResponse } from "next/server"
import { grantAnnualForYear } from "@/lib/annual-grant"
import { openYearFor } from "@/lib/annual-grant-calc"
import { todayStartUTCFromTaipei } from "@/lib/date-format"
import { sendLineAdminNotice } from "@/lib/line"

// 每年 12/1 06:00（Asia/Taipei）由 Cloud Scheduler 觸發：發「明年」的年度特休（生效日 = 明年 1/1）。
// 重跑安全：已發放者由 DB 唯一鍵略過。失敗回 500 讓 Scheduler 重試。結果只通知 ADMIN。
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 })
  if (req.headers.get("x-cron-secret") !== cronSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const year = openYearFor(todayStartUTCFromTaipei())
  try {
    const r = await grantAnnualForYear(year, { source: "SYSTEM_CRON", actorId: null })
    const summary = `✅ ${year} 年度特休發放完成：發放 ${r.granted.length} 人、略過 ${r.skipped.length} 人、不符資格 ${r.ineligible.length} 人`
    console.log(`[annual-leave-grant] ${summary}`)
    await sendLineAdminNotice(summary)
    return NextResponse.json({ year, granted: r.granted.length, skipped: r.skipped.length, ineligible: r.ineligible.length })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[annual-leave-grant] ${year} failed:`, e)
    await sendLineAdminNotice(`❌ ${year} 年度特休發放失敗：${msg}\n請到「假別與額度設定」用「全部發放」補發。`)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
```

注意：若 12/1 前手動呼叫此端點，`openYearFor` 會回傳今年（已由回填寫入），結果是全部略過，不會誤發。

- [ ] **Step 4: 跑測試**

Run: `npx vitest run src/app/api/cron/annual-leave-grant/route.test.ts && npx tsc --noEmit`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add src/lib/line.ts src/app/api/cron/annual-leave-grant/
git commit -m "feat(annual-grant): 12/1 年度發放排程端點 + 管理員 LINE 通知

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: 後台 server actions（發放 / 作廢 / 調整 / 期初 / 重算）+ 員工管理串接

**Files:**
- Modify: `src/lib/audit.ts`（新增 action 與 target）
- Create: `src/app/admin/annual-grant-actions.ts`
- Test: `src/app/admin/annual-grant-actions.test.ts`
- Modify: `src/app/admin/users/actions.ts`（`createUser`、`updateUserHireDate`、`updateUserTerminatedDate`、`setAnnualLeaveOpening`、`clearAnnualLeaveOpening`）
- Modify: `src/app/admin/leave-settings/actions.ts`（刪除 `addLeaveAdjustment`、`deleteLeaveAdjustment`，改由新檔提供）

**Interfaces:**
- Consumes: Task 0 `requireAdmin`；Task 4 全部服務；Task 2 `allowedGrantYears`
- Produces（Task 10/11 UI 使用）：
  - `previewAnnualGrantAction(year: number, userIds?: string[]): Promise<AnnualPreview>`
  - `grantAnnualAction(year: number, userIds?: string[]): Promise<{ success: true; message: string; granted: number; skipped: number }>`
  - `addAnnualAdjustmentAction(input: { userId: string; effectiveAt: string; amount: number; reason: string }): Promise<{ success: true; message: string }>`
  - `voidAnnualGrantAction(id: string, reason: string): Promise<{ success: true; message: string }>`
  - `previewRecalcAction(userId: string): Promise<RecalcChange[]>`
  - `applyRecalcAction(userId: string, reason: string): Promise<{ success: true; message: string }>`
  - `listUserGrantsAction(userId: string)`：回傳該員工全部紀錄（含作廢）供後台展開
  - `updateUserHireDate` 回傳新增欄位 `recalc: RecalcChange[]`
  - `updateUserTerminatedDate` 回傳新增欄位 `voided: { kind: string; year: number | null; amount: number }[]`

- [ ] **Step 1: audit 類型**

`src/lib/audit.ts` 的 `AuditAction` 加入：

```ts
  | "ANNUAL_GRANT_ISSUE"
  | "ANNUAL_GRANT_VOID"
  | "ANNUAL_GRANT_ADJUST"
  | "ANNUAL_GRANT_OPENING"
  | "ANNUAL_GRANT_RECALC"
```

`AuditTargetType` 加入 `| "AnnualLeaveGrant"`。

- [ ] **Step 2: 寫失敗測試**

`src/app/admin/annual-grant-actions.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockRequireAdmin = vi.hoisted(() => vi.fn(async () => "hr"))
const svc = vi.hoisted(() => ({
  previewAnnualForYear: vi.fn(), grantAnnualForYear: vi.fn(), addAdjustment: vi.fn(),
  voidGrant: vi.fn(), previewHireDateRecalc: vi.fn(), applyHireDateRecalc: vi.fn(),
}))
vi.mock("@/lib/admin-guard", () => ({ requireAdmin: mockRequireAdmin }))
vi.mock("@/lib/annual-grant", () => svc)
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => {}) }))
vi.mock("@/lib/db", () => ({ prisma: { annualLeaveGrant: { findMany: vi.fn() } } }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/date-format", () => ({ todayStartUTCFromTaipei: () => new Date("2026-10-01T00:00:00Z") }))

import { grantAnnualAction, voidAnnualGrantAction, addAnnualAdjustmentAction } from "./annual-grant-actions"

describe("annual-grant-actions", () => {
  beforeEach(() => vi.clearAllMocks())

  it("非 ADMIN → 拒絕，不呼叫服務", async () => {
    mockRequireAdmin.mockRejectedValueOnce(new Error("Forbidden"))
    await expect(grantAnnualAction(2027)).rejects.toThrow("Forbidden")
    expect(svc.grantAnnualForYear).not.toHaveBeenCalled()
  })

  it("只能發今年或明年", async () => {
    await expect(grantAnnualAction(2028)).rejects.toThrow("只能發放 2026 或 2027 年")
  })

  it("發放結果訊息含發放與略過人數，source = HR_BUTTON", async () => {
    svc.grantAnnualForYear.mockResolvedValue({ year: 2027, granted: [{ userId: "a" }], skipped: [{ userId: "b" }], ineligible: [] })
    const r = await grantAnnualAction(2027, ["a", "b"])
    expect(svc.grantAnnualForYear).toHaveBeenCalledWith(2027, { userIds: ["a", "b"], source: "HR_BUTTON", actorId: "hr" })
    expect(r.message).toBe("2027 年度特休：發放 1 人、略過 1 人（已發放）")
  })

  it("作廢原因必填", async () => {
    await expect(voidAnnualGrantAction("g", " ")).rejects.toThrow("作廢原因必填")
  })

  it("調整：日期字串轉 UTC midnight", async () => {
    svc.addAdjustment.mockResolvedValue({ id: "x" })
    await addAnnualAdjustmentAction({ userId: "u", effectiveAt: "2026-10-01", amount: 4, reason: "r" })
    expect(svc.addAdjustment.mock.calls[0][0]).toMatchObject({ effectiveAt: new Date("2026-10-01T00:00:00Z"), amount: 4, actorId: "hr" })
  })
})
```

- [ ] **Step 3: 跑測試確認失敗**

Run: `npx vitest run src/app/admin/annual-grant-actions.test.ts`
Expected: FAIL，找不到模組

- [ ] **Step 4: 實作 `annual-grant-actions.ts`**

```ts
"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/db"
import { requireAdmin } from "@/lib/admin-guard"
import { logAudit } from "@/lib/audit"
import { todayStartUTCFromTaipei } from "@/lib/date-format"
import { allowedGrantYears } from "@/lib/annual-grant-calc"
import {
  previewAnnualForYear, grantAnnualForYear, addAdjustment, voidGrant,
  previewHireDateRecalc, applyHireDateRecalc,
} from "@/lib/annual-grant"

function revalidateAll() {
  revalidatePath("/admin/leave-settings")
  revalidatePath("/admin/users")
  revalidatePath("/")
}

function assertAllowedYear(year: number) {
  const allowed = allowedGrantYears(todayStartUTCFromTaipei())
  if (!allowed.includes(year)) throw new Error(`只能發放 ${allowed[0]} 或 ${allowed[1]} 年`)
}

const parseDate = (s: string) => {
  const [y, m, d] = s.split("-").map(Number)
  if (!y || !m || !d) throw new Error("日期格式錯誤")
  return new Date(Date.UTC(y, m - 1, d))
}

export async function previewAnnualGrantAction(year: number, userIds?: string[]) {
  await requireAdmin()
  assertAllowedYear(year)
  return previewAnnualForYear(year, { userIds })
}

export async function grantAnnualAction(year: number, userIds?: string[]) {
  const actorId = await requireAdmin()
  assertAllowedYear(year)
  const r = await grantAnnualForYear(year, { userIds, source: "HR_BUTTON", actorId })
  await logAudit({
    actorId, action: "ANNUAL_GRANT_ISSUE", targetType: "AnnualLeaveGrant", targetId: `ANNUAL:${year}`,
    payload: { year, userIds: userIds ?? "ALL", granted: r.granted.map((g) => ({ userId: g.userId, amount: g.amount })), skipped: r.skipped.length },
  })
  revalidateAll()
  return {
    success: true as const,
    message: `${year} 年度特休：發放 ${r.granted.length} 人、略過 ${r.skipped.length} 人（已發放）`,
    granted: r.granted.length,
    skipped: r.skipped.length,
  }
}

export async function addAnnualAdjustmentAction(input: { userId: string; effectiveAt: string; amount: number; reason: string }) {
  const actorId = await requireAdmin()
  const effectiveAt = parseDate(input.effectiveAt)
  const g = await addAdjustment({ userId: input.userId, effectiveAt, amount: input.amount, reason: input.reason, actorId })
  await logAudit({
    actorId, action: "ANNUAL_GRANT_ADJUST", targetType: "AnnualLeaveGrant", targetId: g.id,
    payload: { userId: input.userId, effectiveAt: input.effectiveAt, amount: input.amount, reason: input.reason },
  })
  revalidateAll()
  return { success: true as const, message: `已新增調整 ${input.amount > 0 ? "+" : ""}${input.amount} 天` }
}

export async function voidAnnualGrantAction(id: string, reason: string) {
  const actorId = await requireAdmin()
  if (!reason.trim()) throw new Error("作廢原因必填")
  const g = await voidGrant(id, reason, actorId)
  await logAudit({ actorId, action: "ANNUAL_GRANT_VOID", targetType: "AnnualLeaveGrant", targetId: id, payload: { ...g, reason } })
  revalidateAll()
  return { success: true as const, message: "已作廢" }
}

export async function previewRecalcAction(userId: string) {
  await requireAdmin()
  return previewHireDateRecalc(userId)
}

export async function applyRecalcAction(userId: string, reason: string) {
  const actorId = await requireAdmin()
  const changes = await applyHireDateRecalc(userId, actorId, reason)
  await logAudit({ actorId, action: "ANNUAL_GRANT_RECALC", targetType: "User", targetId: userId, payload: { reason, changes } })
  revalidateAll()
  return { success: true as const, message: `已重算 ${changes.length} 筆` }
}

export async function listUserGrantsAction(userId: string) {
  await requireAdmin()
  return prisma.annualLeaveGrant.findMany({
    where: { userId },
    orderBy: [{ effectiveAt: "asc" }, { createdAt: "asc" }],
    select: {
      id: true, kind: true, year: true, effectiveAt: true, amount: true, basis: true, reason: true, source: true,
      createdAt: true, voidedAt: true, voidReason: true,
      createdBy: { select: { name: true } }, voidedBy: { select: { name: true } },
    },
  })
}
```

- [ ] **Step 5: 串接 `users/actions.ts`**

檔頭加：

```ts
import { grantOnHire, previewHireDateRecalc, voidGrantsAfterTermination, setOpening } from "@/lib/annual-grant"
```

`createUser`：在 `logAudit` 之後、`revalidatePath` 之前加：

```ts
  if (hireDateStr) await grantOnHire(newUser.id, { actorId })
```

（`newUser` 為 `prisma.user.create` 的回傳變數名；若原程式未接回傳值，改成 `const newUser = await prisma.user.create(...)`。）

`updateUserHireDate`：`logAudit` 之後改為：

```ts
  // 原本沒有到職日 → 視為新人建檔，直接發放；原本有 → 回傳重算預覽讓 HR 決定
  let recalc: Awaited<ReturnType<typeof previewHireDateRecalc>> = []
  if (hireDate && !before?.hireDate) {
    await grantOnHire(userId, { actorId })
  } else if (hireDate) {
    recalc = await previewHireDateRecalc(userId)
  }
  revalidatePath("/admin/users")
  return { success: true, message: "已更新到職日", recalc }
```

`updateUserTerminatedDate`：標記離職的 `prisma.user.update` 之後加：

```ts
  const voided = await voidGrantsAfterTermination(userId, new Date(terminatedDate), actorId)
```

最後的 return 改為：

```ts
  const voidedMsg = voided.length ? `；已作廢 ${voided.map((v) => `${v.year ?? ""} ${v.kind === "ANNUAL" ? "年度" : "首年"}特休 ${v.amount} 天`).join("、")}` : ""
  return { success: true, message: `已標記離職${voidedMsg}`, voided }
```

`setAnnualLeaveOpening`：在 `prisma.user.update` 之後加 `await setOpening({ userId, balance, at: new Date(\`${atISO}T00:00:00.000Z\`), actorId })`。`clearAnnualLeaveOpening`：在 `prisma.user.update` 之後加：

```ts
  await prisma.annualLeaveGrant.updateMany({
    where: { userId, kind: "OPENING", voidedAt: null },
    data: { voidedAt: new Date(), voidedById: actorId, voidReason: "HR 清除期初餘額" },
  })
```

（舊欄位照寫，保留到遷移穩定後移除，方便退回舊版。）

`src/app/admin/leave-settings/actions.ts`：刪除 `addLeaveAdjustment`、`deleteLeaveAdjustment` 兩個函式。

- [ ] **Step 6: 擴充 Task 0 的 users actions 測試**

`src/app/admin/users/actions.test.ts` 的 mock 補上：

```ts
const svc = vi.hoisted(() => ({
  grantOnHire: vi.fn(async () => ({ created: [] })),
  previewHireDateRecalc: vi.fn(async () => []),
  voidGrantsAfterTermination: vi.fn(async () => []),
  setOpening: vi.fn(),
}))
vi.mock("@/lib/annual-grant", () => svc)
```

新增：

```ts
describe("到職日 / 離職串接 grant", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "hr", email: "hr@example.com" } })
    mockPrisma.user.update.mockResolvedValue({})
  })

  it("原本沒有到職日 → grantOnHire", async () => {
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ id: "hr", role: "ADMIN" })
      .mockResolvedValueOnce({ hireDate: null })
    await updateUserHireDate("u", "2026-10-01")
    expect(svc.grantOnHire).toHaveBeenCalledWith("u", { actorId: "hr" })
    expect(svc.previewHireDateRecalc).not.toHaveBeenCalled()
  })

  it("原本有到職日 → 回傳重算預覽，不自動寫入", async () => {
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ id: "hr", role: "ADMIN" })
      .mockResolvedValueOnce({ hireDate: new Date("2026-08-24T00:00:00Z") })
    svc.previewHireDateRecalc.mockResolvedValueOnce([{ periodKey: "PRORATA:2026", oldAmount: 3, newAmount: 4 }] as never)
    const r = await updateUserHireDate("u", "2026-08-01")
    expect(r.recalc).toHaveLength(1)
    expect(svc.grantOnHire).not.toHaveBeenCalled()
  })
})
```

（`updateUserTerminatedDate` 需要 `prisma.user.findMany` 回傳空陣列給下屬檢查；若要加離職測試，在 mockPrisma.user 補 `findMany: vi.fn(async () => [])`。）

- [ ] **Step 7: 跑測試**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 全部 PASS。tsc 若報 `Forms.tsx` 找不到 `addLeaveAdjustment` / `deleteLeaveAdjustment`，屬預期，Task 10 處理；此步驟先暫時在 `Forms.tsx` 把兩個 import 改為從 `@/app/admin/annual-grant-actions` 匯入的新函式名稱以通過型別檢查（UI 細節於 Task 10 完成）。

- [ ] **Step 8: Commit**

```bash
git add src/lib/audit.ts src/app/admin/annual-grant-actions.ts src/app/admin/annual-grant-actions.test.ts src/app/admin/users/actions.ts src/app/admin/users/actions.test.ts src/app/admin/leave-settings/actions.ts src/app/admin/leave-settings/Forms.tsx
git commit -m "feat(annual-grant): 後台發放/作廢/調整/重算 actions，員工建檔與離職串接

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: 「假別與額度設定」頁：年度發放區塊、調整改作廢

**Files:**
- Create: `src/app/admin/leave-settings/AnnualGrantPanel.tsx`
- Modify: `src/app/admin/leave-settings/page.tsx`（第 50-110 行資料載入、第 166-232 行區塊 2/3）
- Modify: `src/app/admin/leave-settings/Forms.tsx`（`CreateAdjustmentForm` 第 338-477 行、`DeleteAdjustmentButton` 第 479-506 行）

**Interfaces:**
- Consumes: Task 9 `previewAnnualGrantAction`、`grantAnnualAction`、`addAnnualAdjustmentAction`、`voidAnnualGrantAction`；Task 4 `AnnualPreview` 型別

先讀 `node_modules/next/dist/docs/01-app/` 中 Server Actions 與 Forms 相關章節，確認 client component 呼叫 server action 的寫法未變。

- [ ] **Step 1: 建立 `AnnualGrantPanel.tsx`**

```tsx
"use client"

import { useState, useTransition } from "react"
import toast from "react-hot-toast"
import { previewAnnualGrantAction, grantAnnualAction } from "@/app/admin/annual-grant-actions"
import type { AnnualPreview } from "@/lib/annual-grant"

const SOURCE_LABEL: Record<string, string> = {
  SYSTEM_CRON: "12/1 排程", HR_BUTTON: "HR 按鈕", HIRE: "新人建檔", RECALC: "重算", MIGRATION: "遷移", CONCURRENT: "同時發放",
}
const fmt = (d: Date | string) => new Date(d).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false })

export function AnnualGrantPanel({ years, status }: {
  years: number[]
  status: { year: number; count: number; lastAt: Date | null; lastSource: string | null }[]
}) {
  const [year, setYear] = useState(years[1] ?? years[0])
  const [preview, setPreview] = useState<AnnualPreview | null>(null)
  const [isPending, startTransition] = useTransition()

  const loadPreview = () => startTransition(async () => {
    try { setPreview(await previewAnnualGrantAction(year)) } catch (e) { toast.error((e as Error).message) }
  })
  const confirm = () => startTransition(async () => {
    try {
      const r = await grantAnnualAction(year)
      toast.success(r.message)
      setPreview(null)
    } catch (e) { toast.error((e as Error).message) }
  })

  return (
    <div className="space-y-4">
      <ul className="text-sm text-gray-600 space-y-1">
        {status.map((s) => (
          <li key={s.year}>
            <span className="font-medium text-gray-900">{s.year} 年度發放：</span>
            {s.count === 0 ? "尚未發放" : `已發放 ${s.count} 人（最近 ${fmt(s.lastAt!)}，${SOURCE_LABEL[s.lastSource ?? ""] ?? s.lastSource}）`}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="select select-bordered select-sm">
          {years.map((y) => <option key={y} value={y}>{y} 年</option>)}
        </select>
        <button onClick={loadPreview} disabled={isPending} className="btn btn-sm btn-outline">預覽全部發放</button>
      </div>

      {preview && (
        <div className="border border-gray-200 rounded-lg p-4 space-y-4 bg-gray-50">
          <Section title={`將發放 ${preview.toGrant.length} 人`}>
            {preview.toGrant.map((g) => <li key={g.userId}><b>{g.name}</b>　{g.amount} 天　<span className="text-gray-500">{g.basis.text}</span></li>)}
          </Section>
          <Section title={`已發放、略過 ${preview.skipped.length} 人`}>
            {preview.skipped.map((s) => <li key={s.userId}>{s.name}　<span className="text-gray-500">{fmt(s.at)}　{SOURCE_LABEL[s.source] ?? s.source}{s.byName ? `（${s.byName}）` : ""}</span></li>)}
          </Section>
          <Section title={`不符資格 ${preview.ineligible.length} 人`}>
            {preview.ineligible.map((i) => <li key={i.userId}>{i.name}　<span className="text-gray-500">{i.reason}</span></li>)}
          </Section>
          <div className="flex gap-2">
            <button onClick={confirm} disabled={isPending || preview.toGrant.length === 0} className="btn btn-sm btn-primary">
              確認發放 {preview.toGrant.length} 人
            </button>
            <button onClick={() => setPreview(null)} disabled={isPending} className="btn btn-sm btn-ghost">取消</button>
          </div>
        </div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-800 mb-1">{title}</h3>
      <ul className="text-sm space-y-0.5 max-h-48 overflow-y-auto">{children}</ul>
    </div>
  )
}
```

- [ ] **Step 2: 改 `page.tsx`**

資料載入：把 `const adjustments = await prisma.leaveAdjustment.findMany({...})` 改為：

```ts
  const adjustments = await prisma.annualLeaveGrant.findMany({
    where: { kind: "ADJUSTMENT" },
    orderBy: { createdAt: "desc" },
    include: { user: { select: { name: true, email: true } }, createdBy: { select: { name: true, email: true } } },
  })
  const today = todayStartUTCFromTaipei()
  const grantYears = allowedGrantYears(today)
  const grantStatus = await Promise.all(grantYears.map(async (year) => {
    const rows = await prisma.annualLeaveGrant.findMany({
      where: { periodKey: `ANNUAL:${year}`, voidedAt: null },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, source: true },
    })
    return { year, count: rows.length, lastAt: rows[0]?.createdAt ?? null, lastSource: rows[0]?.source ?? null }
  }))
```

import 補 `todayStartUTCFromTaipei`（`@/lib/date-format`）、`allowedGrantYears`（`@/lib/annual-grant-calc`）、`AnnualGrantPanel`。目錄 `<ul>` 加 `<li><a href="#section-annual-grant">特休年度發放</a></li>`。在「3. HR 手動調整」區塊之前插入：

```tsx
      <div id="section-annual-grant" className="bg-white rounded-lg shadow border border-gray-200 p-6 scroll-mt-32">
        <h2 className="text-lg font-medium mb-2">特休年度發放</h2>
        <p className="text-sm text-gray-500 mb-4">
          每年 12/1 系統會自動發放明年的年度特休（1/1 生效）。員工若在 12/1 前要預約明年的假，可在此提前發放全部，或到「員工管理」單人發放。已發放的人會自動略過，不會重複。
        </p>
        <AnnualGrantPanel years={grantYears} status={grantStatus} />
      </div>
```

「3. HR 手動調整」區塊：說明改為「僅限特休。新人到職的首年特休、每年年度特休由系統自動發放，不需手動補。員工從生效日起可動用。」；`<CreateAdjustmentForm users={activeUsers} />`（移除 leaveTypes）；表格移除「假別」欄，新增「狀態」欄；每列：

```tsx
                  <tr key={adj.id} className={adj.voidedAt ? "opacity-50" : ""}>
                    <td className="px-4 py-3 font-medium">{adj.user.name || adj.user.email}</td>
                    <td className="px-4 py-3">{formatTaipeiDateISO(adj.effectiveAt)}</td>
                    <td className={`px-4 py-3 text-right font-bold ${adj.amount >= 0 ? "text-green-600" : "text-red-600"}`}>{adj.amount > 0 ? "+" : ""}{adj.amount}</td>
                    <td className="px-4 py-3 text-gray-600 max-w-xs whitespace-pre-wrap">{adj.reason}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{adj.createdBy?.name || adj.createdBy?.email || "系統"}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{formatTaipeiDateISO(adj.createdAt)}</td>
                    <td className="px-4 py-3 text-xs">{adj.voidedAt ? `已作廢：${adj.voidReason}` : "有效"}</td>
                    <td className="px-4 py-3">{!adj.voidedAt && <VoidGrantButton id={adj.id} />}</td>
                  </tr>
```

「2. 員工 Override 列表」說明改為：「個人年度額度：只影響之後的年度發放，不會改到已發放的年度。」

- [ ] **Step 3: 改 `Forms.tsx`**

`CreateAdjustmentForm`：props 改為 `{ users }`；移除 `leaveTypeId` state、假別下拉與驗證；送出改為：

```ts
        const result = await addAnnualAdjustmentAction({ userId, effectiveAt, amount: num, reason: reason.trim() })
```

數量欄 `placeholder="+2 / -1"` 改為 `placeholder="2 / -1"`；驗證訊息改為「請填寫所有欄位（員工、生效日、數量、原因）」。

`DeleteAdjustmentButton` 整個替換為：

```tsx
export function VoidGrantButton({ id }: { id: string }) {
  const [isPending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")

  if (!open) {
    return <button onClick={() => setOpen(true)} className="text-red-500 hover:text-red-700 text-xs font-medium">作廢</button>
  }
  return (
    <div className="flex items-center gap-1">
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="作廢原因（必填）" className="input input-bordered input-xs w-36" />
      <button
        disabled={isPending || !reason.trim()}
        onClick={() => startTransition(async () => {
          try { toast.success((await voidAnnualGrantAction(id, reason)).message); setOpen(false) }
          catch (e) { toast.error((e as Error).message) }
        })}
        className="btn btn-xs btn-error"
      >確認</button>
      <button onClick={() => setOpen(false)} className="btn btn-xs btn-ghost">取消</button>
    </div>
  )
}
```

import 改為 `import { addAnnualAdjustmentAction, voidAnnualGrantAction } from "@/app/admin/annual-grant-actions"`，移除舊的 `addLeaveAdjustment`、`deleteLeaveAdjustment`。`page.tsx` 的 `DeleteAdjustmentButton` import 改為 `VoidGrantButton`。

- [ ] **Step 4: 型別與測試**

Run: `npx tsc --noEmit && npx vitest run && npx eslint src/app/admin/leave-settings`
Expected: 無型別錯誤；測試全過；此資料夾無新增 lint error

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/leave-settings/
git commit -m "feat(annual-grant): 假別設定頁新增年度發放區塊，手動調整改寫發放紀錄並改為作廢

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: 「員工管理」頁：特休欄、單人發放、重算預覽、離職作廢訊息

**Files:**
- Create: `src/app/admin/users/AnnualLeaveCell.tsx`
- Modify: `src/app/admin/users/UserTable.tsx`（`OpeningCell` 使用處第 251-258 行、到職日 / 離職日 onChange 第 243-268 行、表頭第 101 行；刪除 `OpeningCell` 元件第 328 行起）
- Modify: `src/app/admin/users/page.tsx`（每人載入特休剩餘）

**Interfaces:**
- Consumes: Task 9 `listUserGrantsAction`、`grantAnnualAction`、`previewAnnualGrantAction`、`previewRecalcAction`、`applyRecalcAction`；`setAnnualLeaveOpening`、`clearAnnualLeaveOpening`（既有）
- Produces: `<AnnualLeaveCell userId remaining nextYear disabled />`

- [ ] **Step 1: page.tsx 載入剩餘天數**

在 `users` 查詢之後加：

```ts
  const annualType = await prisma.leaveType.findFirst({ where: { isActive: true, name: { contains: "特休" } }, select: { id: true } })
  const remainingByUser = new Map<string, number>()
  if (annualType) {
    for (const u of users) {
      if (u.terminatedDate) continue
      const bal = await getUserLeaveBalance(u.id, annualType.id)
      remainingByUser.set(u.id, bal.remaining)
    }
  }
  const nextYear = todayStartUTCFromTaipei().getUTCFullYear() + 1
```

傳給 `UserTable`：`remainingByUser={Object.fromEntries(remainingByUser)} nextYear={nextYear}`；`UserTable` props 型別加 `remainingByUser: Record<string, number>; nextYear: number`。

- [ ] **Step 2: 建立 `AnnualLeaveCell.tsx`**

```tsx
"use client"

import { useState, useTransition } from "react"
import toast from "react-hot-toast"
import {
  listUserGrantsAction, previewAnnualGrantAction, grantAnnualAction, previewRecalcAction, applyRecalcAction,
} from "@/app/admin/annual-grant-actions"
import type { RecalcChange } from "@/lib/annual-grant"
import { setAnnualLeaveOpening } from "./actions"
import { VoidGrantButton } from "@/app/admin/leave-settings/Forms"

type GrantRow = Awaited<ReturnType<typeof listUserGrantsAction>>[number]
const KIND_LABEL: Record<string, string> = { PRORATA: "首年", ANNUAL: "年度", OPENING: "期初", ADJUSTMENT: "調整" }
const iso = (d: Date | string) => new Date(d).toISOString().slice(0, 10)

export function AnnualLeaveCell({ userId, remaining, nextYear, disabled }: {
  userId: string; remaining: number | undefined; nextYear: number; disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<GrantRow[] | null>(null)
  const [nextPreview, setNextPreview] = useState<{ amount: number; text: string } | null>(null)
  const [recalc, setRecalc] = useState<RecalcChange[] | null>(null)
  const [isPending, startTransition] = useTransition()

  const refresh = () => startTransition(async () => {
    try {
      setRows(await listUserGrantsAction(userId))
      const p = await previewAnnualGrantAction(nextYear, [userId])
      setNextPreview(p.toGrant[0] ? { amount: p.toGrant[0].amount, text: p.toGrant[0].basis.text } : null)
    } catch (e) { toast.error((e as Error).message) }
  })

  const issued = rows?.find((r) => !r.voidedAt && r.kind === "ANNUAL" && r.year === nextYear)

  return (
    <div className="text-xs space-y-1 min-w-[180px]">
      <button onClick={() => { setOpen(!open); if (!open) refresh() }} className="font-medium text-gray-900 hover:underline">
        剩 {remaining ?? "-"} 天 {open ? "▲" : "▼"}
      </button>

      {open && rows && (
        <div className="space-y-2 pt-1">
          <ul className="space-y-0.5">
            {rows.map((r) => (
              <li key={r.id} className={r.voidedAt ? "line-through text-gray-400" : "text-gray-700"}
                  title={r.voidedAt ? `作廢：${r.voidReason}` : (r.basis as { text?: string } | null)?.text}>
                {iso(r.effectiveAt)}　{KIND_LABEL[r.kind]}{r.year ? ` ${r.year}` : ""}　{r.amount > 0 ? "+" : ""}{r.amount}
                {!r.voidedAt && (r.kind === "OPENING" || r.kind === "ADJUSTMENT") && <span className="ml-1"><VoidGrantButton id={r.id} /></span>}
              </li>
            ))}
          </ul>

          {issued ? (
            <p className="text-gray-500">已發放 {nextYear}（{issued.source === "SYSTEM_CRON" ? "12/1 排程" : issued.createdBy?.name ?? issued.source}）</p>
          ) : nextPreview ? (
            <button
              disabled={disabled || isPending}
              onClick={() => {
                if (!confirm(`發放 ${nextYear} 年度特休 ${nextPreview.amount} 天？\n${nextPreview.text}`)) return
                startTransition(async () => {
                  try { toast.success((await grantAnnualAction(nextYear, [userId])).message); refresh() }
                  catch (e) { toast.error((e as Error).message) }
                })
              }}
              className="btn btn-xs btn-outline"
            >發放 {nextYear}（{nextPreview.amount} 天）</button>
          ) : null}

          <button
            disabled={disabled || isPending}
            onClick={() => startTransition(async () => {
              try { setRecalc(await previewRecalcAction(userId)) } catch (e) { toast.error((e as Error).message) }
            })}
            className="btn btn-xs btn-ghost"
          >檢查是否需重算</button>

          <OpeningForm userId={userId} disabled={disabled || isPending} onDone={refresh} />
        </div>
      )}

      {recalc && (
        <RecalcBox changes={recalc} onClose={() => setRecalc(null)} onApply={(reason) => startTransition(async () => {
          try { toast.success((await applyRecalcAction(userId, reason)).message); setRecalc(null); refresh() }
          catch (e) { toast.error((e as Error).message) }
        })} />
      )}
    </div>
  )
}

// 期初餘額（舊員工用）：寫入 OPENING 紀錄（setAnnualLeaveOpening 已於 Task 9 串接 setOpening）
function OpeningForm({ userId, disabled, onDone }: { userId: string; disabled: boolean; onDone: () => void }) {
  const [show, setShow] = useState(false)
  const [balance, setBalance] = useState("")
  const [at, setAt] = useState("")
  if (!show) return <button onClick={() => setShow(true)} className="btn btn-xs btn-ghost">設定期初餘額</button>
  return (
    <div className="flex flex-wrap items-center gap-1">
      <input type="number" step="0.5" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="天數" className="input input-bordered input-xs w-16" />
      <input type="date" value={at} onChange={(e) => setAt(e.target.value)} className="input input-bordered input-xs" />
      <button
        disabled={disabled || !balance || !at}
        onClick={async () => {
          try {
            const r = await setAnnualLeaveOpening(userId, Number(balance), at, null, null)
            toast.success(r.message); setShow(false); onDone()
          } catch (e) { toast.error((e as Error).message) }
        }}
        className="btn btn-xs btn-primary"
      >儲存</button>
      <button onClick={() => setShow(false)} className="btn btn-xs btn-ghost">取消</button>
    </div>
  )
}

export function RecalcBox({ changes, onApply, onClose }: {
  changes: RecalcChange[]; onApply: (reason: string) => void; onClose: () => void
}) {
  const [reason, setReason] = useState("")
  if (changes.length === 0) {
    return <p className="text-gray-500">發放紀錄與目前到職日一致，不需重算。<button onClick={onClose} className="underline ml-1">關閉</button></p>
  }
  return (
    <div className="border border-amber-300 bg-amber-50 rounded p-2 space-y-1">
      <p className="font-semibold text-amber-900">到職日變更，以下發放需重算：</p>
      <ul>
        {changes.map((c) => (
          <li key={c.periodKey}>{c.label}　{c.oldAmount ?? "（無）"} → {c.newAmount ?? "（作廢）"} 天{c.newBasis ? `　${c.newBasis.text}` : ""}</li>
        ))}
      </ul>
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="重算原因（例：到職日由 X 改為 Y）" className="input input-bordered input-xs w-full" />
      <div className="flex gap-1">
        <button disabled={!reason.trim()} onClick={() => onApply(reason.trim())} className="btn btn-xs btn-warning">確認重算</button>
        <button onClick={onClose} className="btn btn-xs btn-ghost">先不要</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 改 `UserTable.tsx`**

表頭第 101 行 `特休 Opening` 改為 `特休`。`OpeningCell` 那格改為：

```tsx
                <td className="px-6 py-4 align-top">
                  <AnnualLeaveCell userId={user.id} remaining={remainingByUser[user.id]} nextYear={nextYear} disabled={isPending} />
                </td>
```

到職日 `onChange` 改為接回傳的 `recalc`：

```tsx
                    onChange={(e) => {
                      const v = e.target.value
                      startTransition(async () => {
                        try {
                          const r = await updateUserHireDate(user.id, v)
                          toast.success(r.message)
                          if (r.recalc.length > 0) setRecalcFor({ userId: user.id, changes: r.recalc, from: user.hireDate, to: v })
                        } catch (err) { toast.error((err as Error).message) }
                      })
                    }}
```

元件頂端加 `const [recalcFor, setRecalcFor] = useState<{ userId: string; changes: RecalcChange[]; from: Date | null; to: string } | null>(null)`；表格下方加：

```tsx
      {recalcFor && (
        <div className="fixed bottom-4 right-4 z-40 w-96 bg-white shadow-xl rounded-lg p-4 text-xs">
          <RecalcBox
            changes={recalcFor.changes}
            onClose={() => { setRecalcFor(null); toast("到職日已儲存；發放紀錄未變更，可之後在特休欄重算") }}
            onApply={(reason) => startTransition(async () => {
              try { toast.success((await applyRecalcAction(recalcFor.userId, reason)).message); setRecalcFor(null) }
              catch (err) { toast.error((err as Error).message) }
            })}
          />
        </div>
      )}
```

（`startTransition` 使用元件內既有的 `useTransition`；若既有程式用 `wrap()` 包裝，可沿用 `wrap` 但需讓它回傳 action 結果。）離職日 `onChange` 的成功訊息直接用回傳的 `message`（已含作廢明細）。刪除 `OpeningCell` 元件（期初設定已移到 `AnnualLeaveCell` 的 `OpeningForm`；清除期初改為在發放紀錄清單上作廢 OPENING 那筆）。import 補 `AnnualLeaveCell`、`RecalcBox`、`applyRecalcAction`、`RecalcChange` 型別。

- [ ] **Step 4: 型別、測試、lint**

Run: `npx tsc --noEmit && npx vitest run && npx eslint src/app/admin/users`
Expected: 無型別錯誤；測試全過；無新增 lint error

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/users/
git commit -m "feat(annual-grant): 員工管理特休欄（發放紀錄、單人發放、重算預覽）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: 員工端「明年特休將於 1/1 生效」提示

**Files:**
- Modify: `src/app/components/BalanceSummary.tsx`（`Balance` 型別第 3-9 行、顯示處）
- Modify: `src/app/page.tsx:51-58`、`src/app/apply/page.tsx:52-60`

**Interfaces:**
- Consumes: Prisma `annualLeaveGrant`
- Produces: `Balance` 型別新增可選欄位 `upcoming?: { year: number; amount: number } | null`

- [ ] **Step 1: 修改兩個頁面的 balances**

`src/app/page.tsx` 在 `balances` 計算之後加：

```ts
  const upcoming = await prisma.annualLeaveGrant.findFirst({
    where: { userId: user.id, kind: "ANNUAL", voidedAt: null, effectiveAt: { gt: new Date() } },
    orderBy: { effectiveAt: "asc" },
    select: { year: true, amount: true },
  })
  const balancesWithUpcoming = balances.map((b) =>
    b.type.includes("特休") && upcoming ? { ...b, upcoming: { year: upcoming.year!, amount: upcoming.amount } } : b)
```

並把傳給 `BalanceSummary` 的 `balances` 換成 `balancesWithUpcoming`。`src/app/apply/page.tsx` 若有渲染 `BalanceSummary` 或特休餘額，做同樣處理；若沒有，此檔不改。

- [ ] **Step 2: BalanceSummary 顯示**

`Balance` 型別加 `upcoming?: { year: number; amount: number } | null`。在顯示 `/ {b.total} 天` 的兩處下方各加：

```tsx
{b.upcoming && (
  <div className="text-[10px] text-emerald-600 mt-0.5">{b.upcoming.year} 年度特休 {b.upcoming.amount} 天將於 1/1 生效</div>
)}
```

- [ ] **Step 3: 型別與測試**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 通過

- [ ] **Step 4: Commit**

```bash
git add src/app/components/BalanceSummary.tsx src/app/page.tsx src/app/apply/page.tsx
git commit -m "feat(annual-grant): 餘額卡片顯示明年特休將於 1/1 生效

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: 回填、審核、修正腳本

**Files:**
- Create: `scripts/annual-grant-backfill.ts`
- Create: `scripts/annual-grant-audit.ts`
- Create: `scripts/annual-grant-fix-prorata.ts`
- Modify: `src/lib/legacy-annual-calc.ts`（新增 `legacyAnnualBalance`）

**Interfaces:**
- Consumes: Task 3 `buildBackfillRows`、`legacyCalcCalendarYearCumulative`；Task 6 新 `getUserLeaveBalance`；Task 2 `calcProRataGrant`、`periodKey`
- Produces: `legacyAnnualBalance(userId: string, leaveTypeId: string, asOf: Date): Promise<{ total: number; used: number; pending: number; remaining: number }>`

- [ ] **Step 1: `legacyAnnualBalance`**

在 `src/lib/legacy-annual-calc.ts` 加（檔頭補 `import { prisma } from "./db"`）。這是舊 `getUserLeaveBalance` 特休分支的複製，讀舊欄位與舊 `LeaveAdjustment`：

```ts
export async function legacyAnnualBalance(userId: string, leaveTypeId: string, asOf: Date) {
  const leaveType = await prisma.leaveType.findUniqueOrThrow({ where: { id: leaveTypeId } })
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
  if (!user.hireDate) return { total: 0, used: 0, pending: 0, remaining: 0 }
  const overrides = await prisma.userLeaveBalance.findMany({
    where: { userId, leaveTypeId }, orderBy: { year: "asc" }, select: { year: true, totalQuota: true },
  })
  const adjustments = await prisma.leaveAdjustment.findMany({
    where: { userId, leaveTypeId }, orderBy: { effectiveAt: "asc" }, select: { effectiveAt: true, amount: true },
  })
  const opening = user.annualLeaveOpeningBalance !== null && user.annualLeaveOpeningAt !== null
    ? { balance: user.annualLeaveOpeningBalance, at: user.annualLeaveOpeningAt } : undefined
  const total = legacyCalcCalendarYearCumulative(user.hireDate, asOf, leaveType.defaultDays, overrides, adjustments, opening)
  const endOfYear = new Date(Date.UTC(asOf.getUTCFullYear(), 11, 31, 23, 59, 59, 999))
  const startFilter = opening ? { gte: opening.at, lte: endOfYear } : { lte: endOfYear }
  const [u, p] = await Promise.all([
    prisma.leaveRequest.aggregate({ _sum: { durationDays: true }, where: { userId, leaveTypeId, status: "APPROVED", startDate: startFilter } }),
    prisma.leaveRequest.aggregate({ _sum: { durationDays: true }, where: { userId, leaveTypeId, status: "PENDING", startDate: startFilter } }),
  ])
  const used = u._sum.durationDays || 0
  const pending = p._sum.durationDays || 0
  return { total, used, pending, remaining: total - used - pending }
}
```

- [ ] **Step 2: 回填腳本**

`scripts/annual-grant-backfill.ts`：

```ts
// 用法：
//   npx tsx --env-file=.env scripts/annual-grant-backfill.ts            → dry-run，只印出將寫入的列
//   npx tsx --env-file=.env scripts/annual-grant-backfill.ts --apply    → 寫入（需使用者同意；共用線上 DB）
import { prisma } from "../src/lib/db"
import { buildBackfillRows } from "../src/lib/backfill-plan"
import { getAnnualLeaveType } from "../src/lib/annual-grant"

async function main() {
  const apply = process.argv.includes("--apply")
  const now = new Date()
  const lt = await getAnnualLeaveType()

  const already = await prisma.annualLeaveGrant.count()
  if (already > 0) throw new Error(`AnnualLeaveGrant 已有 ${already} 筆，回填只能在空表執行`)

  const users = await prisma.user.findMany({ orderBy: { name: "asc" } })
  let total = 0
  for (const u of users) {
    const overrides = await prisma.userLeaveBalance.findMany({
      where: { userId: u.id, leaveTypeId: lt.id }, orderBy: { year: "asc" }, select: { year: true, totalQuota: true },
    })
    const adjustments = await prisma.leaveAdjustment.findMany({
      where: { userId: u.id, leaveTypeId: lt.id }, orderBy: { effectiveAt: "asc" },
      select: { effectiveAt: true, amount: true, reason: true, createdById: true },
    })
    const opening = u.annualLeaveOpeningBalance !== null && u.annualLeaveOpeningAt !== null
      ? { balance: u.annualLeaveOpeningBalance, at: u.annualLeaveOpeningAt } : null
    const rows = buildBackfillRows({ hireDate: u.hireDate, opening, overrides, adjustments, defaultDays: lt.defaultDays, now })
    for (const r of rows) {
      console.log(`${u.name}\t${r.kind}\t${r.year ?? ""}\t${r.effectiveAt.toISOString().slice(0, 10)}\t${r.amount}\t${r.basis.text}`)
    }
    total += rows.length
    if (apply && rows.length) {
      await prisma.annualLeaveGrant.createMany({
        data: rows.map((r) => ({ ...r, userId: u.id, source: "MIGRATION" as const })),
      })
    }
  }
  console.log(`\n${apply ? "已寫入" : "dry-run，將寫入"} ${total} 筆（${users.length} 位員工）`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
```

- [ ] **Step 3: 審核報表腳本**

`scripts/annual-grant-audit.ts`：

```ts
// 用法：npx tsx --env-file=.env scripts/annual-grant-audit.ts --out <path.csv>
// 每位員工 × 多個時間點比對：舊公式（legacyAnnualBalance）vs 新表（getUserLeaveBalance）。
// 時間點 >= 2027-01-01 標記為「預期差異」（新表要等 12/1 或 HR 按鈕才有明年發放）。
import { writeFileSync } from "fs"
import { prisma } from "../src/lib/db"
import { legacyAnnualBalance } from "../src/lib/legacy-annual-calc"
import { getUserLeaveBalance } from "../src/lib/leave-utils"
import { getAnnualLeaveType } from "../src/lib/annual-grant"

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

async function main() {
  const outIdx = process.argv.indexOf("--out")
  if (outIdx < 0) throw new Error("需要 --out <path.csv>")
  const out = process.argv[outIdx + 1]
  const lt = await getAnnualLeaveType()
  const users = await prisma.user.findMany({ orderBy: { name: "asc" } })
  const expectedFrom = d("2027-01-01")

  const lines = ["姓名,狀態,時間點,舊總額,新總額,差異,已用,待審,舊剩餘,新剩餘,剩餘差異,類別"]
  let unexpected = 0, expected = 0
  for (const u of users) {
    const grants = await prisma.annualLeaveGrant.findMany({ where: { userId: u.id, voidedAt: null }, select: { effectiveAt: true } })
    const points = new Set<string>([new Date().toISOString().slice(0, 10), "2025-12-31", "2026-12-31", "2027-01-01"])
    for (const g of grants) {
      points.add(g.effectiveAt.toISOString().slice(0, 10))
      points.add(new Date(g.effectiveAt.getTime() - 86_400_000).toISOString().slice(0, 10))
    }
    for (const p of [...points].sort()) {
      const asOf = d(p)
      const oldB = await legacyAnnualBalance(u.id, lt.id, asOf)
      const newB = await getUserLeaveBalance(u.id, lt.id, asOf)
      const diff = newB.total - oldB.total
      const remDiff = newB.remaining - oldB.remaining
      const isExpected = asOf >= expectedFrom
      const kind = diff === 0 && remDiff === 0 ? "一致" : isExpected ? "預期差異" : "❌ 非預期差異"
      if (kind === "❌ 非預期差異") unexpected++
      if (kind === "預期差異") expected++
      lines.push([u.name, u.terminatedDate ? "離職" : "在職", p, oldB.total, newB.total, diff, newB.used, newB.pending, oldB.remaining, newB.remaining, remDiff, kind].join(","))
    }
  }
  const future = await prisma.leaveRequest.findMany({
    where: { leaveTypeId: lt.id, status: { in: ["APPROVED", "PENDING"] }, startDate: { gte: expectedFrom } },
    select: { id: true, userId: true, startDate: true, durationDays: true },
  })
  writeFileSync(out, "﻿" + lines.join("\n"))
  console.log(`報表：${out}`)
  console.log(`非預期差異：${unexpected} 筆；預期差異（2027 以後）：${expected} 筆；已預約 2027 以後特休：${future.length} 張`)
  if (future.length) console.log(future)
  if (unexpected > 0) process.exit(2)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
```

- [ ] **Step 4: Aaron / Sophia 修正腳本**

`scripts/annual-grant-fix-prorata.ts`：

```ts
// 用法：npx tsx --env-file=.env scripts/annual-grant-fix-prorata.ts --names Aaron,Sophia --actor <ADMIN email> [--apply]
// 作廢指定員工的首年 PRORATA，改寫為 A 算法（月份制）。預設 dry-run。
import { prisma } from "../src/lib/db"
import { calcProRataGrant, periodKey } from "../src/lib/annual-grant-calc"
import { getAnnualLeaveType } from "../src/lib/annual-grant"

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined }

async function main() {
  const apply = process.argv.includes("--apply")
  const names = (arg("--names") ?? "").split(",").filter(Boolean)
  const actor = await prisma.user.findUniqueOrThrow({ where: { email: arg("--actor") ?? "" } })
  if (actor.role !== "ADMIN") throw new Error("--actor 必須是 ADMIN")
  const lt = await getAnnualLeaveType()
  const reason = "首年改依月份計算（HR 2026-10-01 確認）"

  for (const name of names) {
    const u = await prisma.user.findFirstOrThrow({ where: { name } })
    const year = u.hireDate!.getUTCFullYear()
    const old = await prisma.annualLeaveGrant.findFirstOrThrow({ where: { userId: u.id, periodKey: periodKey("PRORATA", year), voidedAt: null } })
    const next = calcProRataGrant(u.hireDate!, lt.defaultDays)
    console.log(`${name}：${old.amount} → ${next.amount}（${next.basis.text}）`)
    if (!apply) continue
    await prisma.$transaction([
      prisma.annualLeaveGrant.update({ where: { id: old.id }, data: { voidedAt: new Date(), voidedById: actor.id, voidReason: reason, periodKey: null } }),
      prisma.annualLeaveGrant.create({
        data: {
          userId: u.id, kind: "PRORATA", year, effectiveAt: u.hireDate!, amount: next.amount, basis: next.basis,
          reason, source: "RECALC", createdById: actor.id, periodKey: periodKey("PRORATA", year),
        },
      }),
    ])
    await prisma.auditLog.create({
      data: { actorId: actor.id, action: "ANNUAL_GRANT_RECALC", targetType: "User", targetId: u.id, payload: { from: old.amount, to: next.amount, reason } },
    })
  }
  console.log(apply ? "已寫入" : "dry-run，未寫入")
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
```

- [ ] **Step 5: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無錯誤（腳本在 tsconfig 範圍外時改用 `npx tsc --noEmit -p .` 並確認 `scripts/` 被包含，或用 `npx tsx --check` 不可用時至少 `npx tsx scripts/annual-grant-backfill.ts --help` 能載入到 DB 連線前一步）

- [ ] **Step 6: Commit**

```bash
git add scripts/annual-grant-backfill.ts scripts/annual-grant-audit.ts scripts/annual-grant-fix-prorata.ts src/lib/legacy-annual-calc.ts
git commit -m "feat(annual-grant): 回填、零差異審核報表、首年修正腳本

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: 畫面驗證（只看、只預覽，不按確認）

**Files:** 無（驗證）

前提：Task 15 Step 1–3 已完成（新表已建、已回填），否則 dev server 讀不到資料。若尚未回填，此 Task 移到 Task 15 Step 3 之後執行。

- [ ] **Step 1: 啟動 dev server（背景）**

Run: `npm run dev`（`run_in_background`），等到出現 `Ready`。

- [ ] **Step 2: 瀏覽器檢查（新開分頁）**

以 ADMIN 帳號登入，依序檢查並截圖：
1. `/admin/leave-settings`：「特休年度發放」狀態列顯示「2026 年度發放：已發放 N 人（遷移）」「2027：尚未發放」；按「預覽全部發放」選 2027，三個清單合理（林仲軍 14 天、Aaron 不符資格「到職年即發放年」不會出現，因為 2026 到職者 2027 應在「將發放」10 天）。**不要按「確認發放」。**
2. 手動調整列表：林仲軍 +4 一筆「有效」；作廢按鈕可展開輸入框（不送出）。
3. `/admin/users`：「特休」欄可展開，紀錄與 basis 正確；單人「發放 2027（N 天）」按鈕存在（不按）；「檢查是否需重算」顯示「不需重算」。
4. 員工端首頁歷史假單：發放說明為 basis 文字。
5. 用手機寬度（375px）再看一次 1–3。

- [ ] **Step 3: 收拾**

關閉自己開的分頁、停止 dev server。回報收掉了什麼。

---

### Task 15: 上線 Runbook（每一步都要使用者同意）

**Files:**
- Modify: `DEPLOYMENT.md`（第 6 節排程表新增一列、新增「特休發放」小節）
- Modify: `/Users/benson/.claude/projects/-Users-benson-Documents-project-internal-timeoff-system/memory/annual_leave_calendar_year.md`

- [ ] **Step 1: 預覽 schema SQL（唯讀）**

```bash
npx prisma migrate diff --from-url "$(grep ^DATABASE_URL .env | cut -d= -f2- | tr -d '"')" --to-schema-datamodel prisma/schema.prisma --script
```

Expected: 只有 `CREATE TABLE \`AnnualLeaveGrant\``、索引、外鍵。把 SQL 給使用者看。出現任何 `ALTER TABLE` 既有表的欄位變更或 `DROP` → 停止。

- [ ] **Step 2: 【需同意】建立新表**

Run: `npx prisma db push --skip-generate`
Expected: 不出現 data loss 警告；`Your database is now in sync`。若出現警告 → 中止並回報。

- [ ] **Step 3: 回填 dry-run → 【需同意】寫入**

```bash
npx tsx --env-file=.env scripts/annual-grant-backfill.ts > <scratchpad>/backfill-dryrun.tsv
```

把摘要給使用者（每人幾筆、Sophia PRORATA 4、Aaron PRORATA 3、Leo (小)/Nelly/Pierce 5.5、林仲軍 OPENING 12 + ADJUSTMENT 4）。同意後：

```bash
npx tsx --env-file=.env scripts/annual-grant-backfill.ts --apply
```

- [ ] **Step 4: 零差異審核**

```bash
npx tsx --env-file=.env scripts/annual-grant-audit.ts --out <scratchpad>/annual-grant-audit-before-switch.csv
```

Expected: `非預期差異：0 筆`；exit code 0。非 0 → 停止，回報差異列，不進下一步。已預約 2027 特休若 > 0，列出與使用者討論。

- [ ] **Step 5: 畫面驗證**：執行 Task 14。

- [ ] **Step 6: 【需同意】通知 HR 暫停手動調整；merge 部署**

```bash
git checkout main && git merge --no-ff feat/annual-grant-ledger && git push origin main
```

等 Cloud Build 完成後確認：

```bash
gcloud run services describe timeoff-system --project=popinpoc1 --region=asia-east1 --format="value(status.latestReadyRevisionName,spec.template.metadata.annotations)"
```

確認 revision 的 commit-sha 等於 `git rev-parse HEAD`。

- [ ] **Step 7: 切換後再審核一次**

```bash
npx tsx --env-file=.env scripts/annual-grant-audit.ts --out <scratchpad>/annual-grant-audit-after-switch.csv
```

Expected: `非預期差異：0 筆`。

- [ ] **Step 8: 【需同意】Aaron / Sophia 首年修正**

```bash
npx tsx --env-file=.env scripts/annual-grant-fix-prorata.ts --names Aaron,Sophia --actor <使用者指定的 ADMIN email>
```

Expected: `Aaron：3 → 2.5`、`Sophia：4 → 3`。同意後加 `--apply`。再跑一次審核報表，非預期差異應**只有** Aaron、Sophia。

- [ ] **Step 9: 【需同意】建立 12/1 Cloud Scheduler（約 US$0.10/月）**

```bash
gcloud scheduler jobs create http timeoff-annual-leave-grant \
  --project=popinpoc1 --location=asia-east1 \
  --schedule="0 6 1 12 *" --time-zone="Asia/Taipei" \
  --uri="https://timeoff.pacnexus.net/api/cron/annual-leave-grant" --http-method=GET \
  --headers="x-cron-secret=$(grep ^CRON_SECRET .env | cut -d= -f2- | tr -d '"')" \
  --attempt-deadline=300s --max-retry-attempts=3 --min-backoff=5m
gcloud scheduler jobs describe timeoff-annual-leave-grant --project=popinpoc1 --location=asia-east1
```

（現在觸發會發「今年」→ 全部略過；可用 `gcloud scheduler jobs run` 驗證端點 200 與管理員收到 LINE，經同意後再執行。）

- [ ] **Step 10: 文件與記憶**

`DEPLOYMENT.md` 第 6 節表格加：`| timeoff-annual-leave-grant | 0 6 1 12 * Asia/Taipei | /api/cron/annual-leave-grant |`，並新增小節說明：重跑安全、失敗補發用後台「全部發放」、舊欄位與 `LeaveAdjustment` 於 2027/1/1 後移除。

更新 memory `annual_leave_calendar_year.md`：特休改為發放紀錄表 `AnnualLeaveGrant`、首年 A 算法（月份制捨去）、12/1 排程、舊公式只在 `legacy-annual-calc.ts`。

```bash
git add DEPLOYMENT.md && git commit -m "docs: 特休年度發放排程與 runbook

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" && git push origin main
```

- [ ] **Step 11: 通知 HR 恢復手動調整。**

---

## 後續（不在本計畫）

- 過完 2027/1/1、確認 12/1 排程正常後：移除 `User.annualLeaveOpening*` 四欄、`LeaveAdjustment` 表、`legacy-annual-calc.ts`、`backfill-plan.ts`、回填與審核腳本。
- 健檢其他項目（國定假日 9/1 排程、甘特圖、中低優先）另開計畫。
