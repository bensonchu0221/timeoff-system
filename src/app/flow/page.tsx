import { auth } from "@/auth"
import { redirect } from "next/navigation"

export const metadata = {
  title: "請假審核流程圖 | Timeoff",
}

export default async function FlowPage() {
  const session = await auth()
  if (!session?.user) redirect("/")

  return (
    <div className="max-w-4xl mx-auto space-y-10">
      {/* Hero */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">請假審核流程圖</h1>
        <p className="mt-2 text-gray-600">
          以下流程適用於所有員工的請假申請。任何環節都會自動觸發對應的通知（Email + LINE，可在「個人設定」逐項開關）。
        </p>
      </div>

      {/* ===== 主要流程 ===== */}
      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-6">主要流程</h2>

        <ul className="steps steps-vertical">
          <FlowStep
            title="員工提交申請"
            description="在「請假」頁面填寫日期區間、假別、事由（選填）、代理人（選填）。"
          />
          <FlowStep
            title="系統自動驗證"
            description="餘額是否足夠（特休另會檢查跨年預約後的年底餘額）、日期與時段是否與既有假單重疊、自動跳過週末與國定假日；特休需到職滿 3 個月、生理假限女性。不通過會即時提示。"
          />
          <FlowStep
            title="通知主管"
            description="同步送出 Email + LINE 推播；LINE 訊息含「快速核准」「駁回」「前往網頁查看完整資訊」三顆按鈕，按駁回可再選常用理由或開網頁填寫。"
          />
          <FlowStep
            title="主管一審"
            description="第一關由直屬主管審核（admin 也可代審）。通過 → 送交 Boss 終審；駁回 → 直接結束，不進第二關。"
          />
          <FlowStep
            title="通知 Boss 終審"
            description="一審通過後，系統通知終審者（Boss）；同時通知申請人「一審已通過、等待終審」。"
          />
          <FlowStep
            title="Boss 終審"
            description="第二關由 Boss 做最後核准或駁回；Boss 不在時 admin 可代為終審。額度在此關最終核准時才正式扣除（一審通過時會先預留）。"
          />
          <FlowStep
            title="結果通知"
            description="申請人收到 Email + LINE 最終結果；若核准，同部門同事收提醒、代理人收到正式通知。"
          />
          <FlowStep
            title="進入行事曆"
            description="甘特圖會顯示已核准（綠）與待審（灰）的假單；iCal 訂閱（個人 / 團隊 / 全公司三種，可加到行事曆 App）只同步已核准的假單。"
            isLast
          />
        </ul>

        <div className="mt-4 text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-1">
          <p className="font-medium text-gray-800">兩階段的例外情況：</p>
          <p>• 若你的直屬主管本身就是 Boss，或你沒有設定直屬主管，由 Boss 單獨審核一關即為最終核准。</p>
          <p>• Boss 本人送出的假單會自動核准（無上層可審）。</p>
          <p>• 系統尚未設定 Boss 時，只由直屬主管審核一關。</p>
        </div>
      </section>

      {/* ===== 什麼時候系統會通知？ ===== */}
      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-4">什麼時候系統會通知？</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ScenarioCard
            title="一審通過、送交終審"
            trigger="主管完成第一關核准"
            behavior="通知 Boss「有一審通過的假單待終審」（Email + LINE，LINE 可一鍵核准 / 駁回）；同時通知申請人「一審已通過、等待終審」"
          />
          <ScenarioCard
            title="員工修改待審假單"
            trigger="員工在一審通過前、且開始日當天（含）以前，到「修改假單」頁更動內容"
            behavior="主管審核時直接看到最新版本，不另發修改通知；代理人有變動時，舊代理人收解除、新代理人收指派。一審通過後就不能修改，需先撤銷再重新申請"
          />
          <ScenarioCard
            title="員工撤銷假單"
            trigger="員工在開始日當天（含）以前按「撤銷」"
            behavior="待審 → 通知一審主管（已進二審則 Boss 也會收到）與代理人；已核准 → 主管 + Boss + 同部門 + 代理人都收到撤銷通知。員工該期間如常出勤"
          />
          <ScenarioCard
            title="48 小時未審假單提醒"
            trigger="假單在某一審核階段（等一審 / 等二審）超過 48 小時未處理"
            behavior="cron 平日 09–18 每小時檢查，提醒「目前該審的人」（一審→主管、二審→Boss）；每階段各算 48 小時、每階段只提醒一次"
          />
          <ScenarioCard
            title="每日 11:00 待審清單"
            trigger="工作日、審核者當下還有待審假單（六日 / 國定假日不推）"
            behavior="LINE 推播「您目前有 N 筆假單待審核」+ 審核連結；已進二審的單會算到 Boss 頭上，不再算主管"
          />
          <ScenarioCard
            title="每日 10:00 全公司請假名單"
            trigger="工作日、今天有人請假（APPROVED）；六日 / 國定假日沒人上班故不推"
            behavior="LINE 推播「今日請假：A 特休、B 事假上午」給全公司在職且已綁定 LINE 的同仁（自己今天請假則不會看到自己）"
          />
        </div>
      </section>

      {/* ===== 通知誰會收到？ ===== */}
      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-4">通知誰會收到？</h2>
        <p className="text-sm text-gray-500 mb-3">
          每位收件人需在「個人設定」綁定 LINE 才會收到推播；Email 預設會送。兩者都可在「個人設定」逐項關閉。
        </p>

        <div className="overflow-x-auto bg-white rounded-lg border border-gray-200 shadow-sm">
          <table className="table">
            <thead className="bg-gray-50">
              <tr>
                <th>事件</th>
                <th className="text-center">申請人</th>
                <th className="text-center">主管</th>
                <th className="text-center">Boss</th>
                <th className="text-center">同部門</th>
                <th className="text-center">代理人</th>
                <th className="text-center">Admin</th>
              </tr>
            </thead>
            <tbody>
              <NotifyRow event="新申請" rcpts={["-", "✓", "-", "-", "✓", "-"]} />
              <NotifyRow event="一審通過（送二審）" rcpts={["✓", "-", "✓", "-", "-", "-"]} />
              <NotifyRow event="最終核准" rcpts={["✓", "-", "-", "✓", "✓", "-"]} />
              <NotifyRow event="駁回（一審或二審）" rcpts={["✓", "-", "-", "-", "✓ 解除", "-"]} />
              <NotifyRow event="修改（限一審前）" rcpts={["-", "-", "-", "-", "✓ *", "-"]} />
              <NotifyRow event="撤銷（待審）" rcpts={["-", "✓", "✓ ***", "-", "✓ 解除", "-"]} />
              <NotifyRow event="撤銷（已核准）" rcpts={["-", "✓", "✓", "✓", "✓ 解除", "-"]} />
              <NotifyRow event="48 小時未審假單提醒（每階段）" rcpts={["-", "✓", "✓", "-", "-", "-"]} />
              <NotifyRow event="每日 11:00 待審清單" rcpts={["-", "✓", "✓", "-", "-", "-"]} />
              <NotifyRow event="每日 10:00 全公司請假名單 **" rcpts={["✓", "✓", "✓", "✓", "✓", "✓"]} />
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          * 修改時，代理人若有變動才會通知（舊代理人收解除、新代理人收指派）。
        </p>
        <p className="text-xs text-gray-500 mt-1">
          ** 全公司請假名單：所有在職且已綁定 LINE 的同仁皆會收到（自己今天請假則只看到其他人的名單）。
        </p>
        <p className="text-xs text-gray-500 mt-1">
          *** 撤銷待審單時，一審主管一律會收到；若已進入二審，Boss 也會收到。
        </p>
        <p className="text-xs text-gray-500 mt-1">
          最終核准時，若代理人剛好也是同部門同仁，只會收到一則「代理人通知」（不再另發部門提醒，避免重複）。
        </p>
      </section>

      {/* ===== 小提示 ===== */}
      <section className="bg-[#7A9A8A]/10 border border-[#7A9A8A]/30 rounded-lg p-5">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">小提示</h2>
        <ul className="space-y-2 text-sm text-gray-700 list-disc list-inside">
          <li>假單送出後，首頁列表會顯示橫式進度圖（申請 → 主管審核 → Boss 終審 → 完成），一眼看出審到哪一關</li>
          <li>想關閉特定通知？到「個人設定」逐項調整（Email 與 LINE 可分別獨立開關）</li>
          <li>想查餘額？跟 LINE Bot 輸入「查假」即可，免登入網頁</li>
          <li>被駁回想知道為什麼？看「主管留言」（一審）或「終審留言」（Boss 二審）段落（未填則沒有）</li>
          <li>想改假單內容？一審通過前可直接修改；一審通過後就鎖定了，請先撤銷再重新申請</li>
          <li>已核准但需要撤銷？開始日當天（含）以前都可以自己撤；過了開始日請聯絡 admin</li>
        </ul>
      </section>
    </div>
  )
}

// ---------- 子元件 ----------

function FlowStep({
  title,
  description,
  isLast,
}: {
  title: string
  description: string
  isLast?: boolean
}) {
  return (
    <li className={`step ${isLast ? "step-success" : "step-primary"}`}>
      <div className="text-start pl-2 py-3">
        <div className="font-bold text-gray-900">{title}</div>
        <div className="text-sm text-gray-600 mt-1 max-w-xl">{description}</div>
      </div>
    </li>
  )
}

function ScenarioCard({
  title,
  trigger,
  behavior,
}: {
  title: string
  trigger: string
  behavior: string
}) {
  return (
    <div className="card bg-white shadow-sm border border-gray-200">
      <div className="card-body p-5">
        <h3 className="font-semibold text-gray-900">{title}</h3>
        <div className="text-sm space-y-2 mt-1">
          <div>
            <span className="inline-block text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600 mr-1">
              觸發
            </span>
            <span className="text-gray-700">{trigger}</span>
          </div>
          <div>
            <span className="inline-block text-xs px-2 py-0.5 rounded bg-[#7A9A8A]/15 text-[#5a7868] mr-1">
              行為
            </span>
            <span className="text-gray-700">{behavior}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function NotifyRow({ event, rcpts }: { event: string; rcpts: string[] }) {
  return (
    <tr>
      <td className="font-medium text-gray-900">{event}</td>
      {rcpts.map((r, i) => (
        <td key={i} className="text-center">
          <span className={r === "-" ? "text-gray-300" : "text-[#5a7868] font-medium"}>{r}</span>
        </td>
      ))}
    </tr>
  )
}
