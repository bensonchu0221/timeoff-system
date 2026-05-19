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
          以下流程適用於所有員工的請假申請。任何環節都會自動觸發對應的通知（Email + LINE）。
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
            description="餘額是否足夠、日期是否與既有假單重疊、自動跳過週末與國定假日；不通過會即時提示。"
          />
          <FlowStep
            title="通知主管"
            description="同步送出 Email + LINE 推播；LINE 訊息含「快速核准」「駁回」兩顆按鈕。"
          />
          <FlowStep
            title="主管審核"
            description="可在「審核」頁面操作，也可直接在 LINE 一鍵核准；駁回可從預設理由清單選或自填理由（理由非必填）。"
          />
          <FlowStep
            title="結果通知"
            description="申請人收到 Email + LINE 結果；若核准，同部門同事收提醒；有代理人時，代理人收到正式通知。"
          />
          <FlowStep
            title="進入行事曆"
            description="核准的假單會出現在團隊甘特圖，也會同步到個人 iCal 訂閱（行事曆 App）。"
            isLast
          />
        </ul>
      </section>

      {/* ===== 特殊情境 ===== */}
      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-4">特殊情境</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ScenarioCard
            title="員工修改待審假單"
            trigger="員工在主管審核前到「修改假單」頁更動內容"
            behavior="主管收到含 before / after 對照的修改通知（Email + LINE），改以最新版本審核"
          />
          <ScenarioCard
            title="員工撤銷假單"
            trigger="員工在開始日前按「撤銷」"
            behavior="原為「待審」→ 通知主管；原為「已核准」→ 主管 + 同部門 + 代理人都收到撤銷通知。員工該期間如常出勤"
          />
          <ScenarioCard
            title="24 小時未審核自動升級"
            trigger="假單 PENDING 超過 24 小時"
            behavior="cron 每小時檢查，自動將該單升級給所有 admin（每張單只升一次，不會重複騷擾）"
          />
          <ScenarioCard
            title="每日 11:00 待審清單"
            trigger="主管當下還有 PENDING 假單"
            behavior="LINE 推播「您目前有 N 筆假單待審核」+ 審核連結"
          />
          <ScenarioCard
            title="每日 10:00 全公司請假名單"
            trigger="今天有人請假（APPROVED）"
            behavior="LINE 推播「今日請假：A 特休、B 事假上午」給全公司在職且已綁定 LINE 的同仁（自己今天請假則不會看到自己）"
          />
        </div>
      </section>

      {/* ===== 通知速查表 ===== */}
      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-4">通知速查表</h2>
        <p className="text-sm text-gray-500 mb-3">
          每位收件人需在「個人設定」綁定 LINE 才會收到推播；Email 一律會送。
        </p>

        <div className="overflow-x-auto bg-white rounded-lg border border-gray-200 shadow-sm">
          <table className="table">
            <thead className="bg-gray-50">
              <tr>
                <th>事件</th>
                <th className="text-center">申請人</th>
                <th className="text-center">主管</th>
                <th className="text-center">同部門</th>
                <th className="text-center">代理人</th>
                <th className="text-center">Admin</th>
              </tr>
            </thead>
            <tbody>
              <NotifyRow event="新申請" rcpts={["-", "✓", "-", "✓", "-"]} />
              <NotifyRow event="核准" rcpts={["✓", "-", "✓", "✓", "-"]} />
              <NotifyRow event="駁回" rcpts={["✓", "-", "-", "✓ 解除", "-"]} />
              <NotifyRow event="修改（PENDING）" rcpts={["-", "✓", "-", "✓ *", "-"]} />
              <NotifyRow event="撤銷（PENDING）" rcpts={["-", "✓", "-", "✓ 解除", "-"]} />
              <NotifyRow event="撤銷（已核准）" rcpts={["-", "✓", "✓", "✓ 解除", "-"]} />
              <NotifyRow event="24h 未審核升級" rcpts={["-", "-", "-", "-", "✓"]} />
              <NotifyRow event="每日 11:00 待審清單" rcpts={["-", "✓", "-", "-", "-"]} />
              <NotifyRow event="每日 10:00 全公司請假名單 **" rcpts={["✓", "✓", "✓", "✓", "✓"]} />
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          * 修改時，代理人若有變動才會通知（舊代理人收解除、新代理人收指派）。
        </p>
        <p className="text-xs text-gray-500 mt-1">
          ** 全公司請假名單：所有在職且已綁定 LINE 的同仁皆會收到（自己今天請假則只看到其他人的名單）。
        </p>
      </section>

      {/* ===== 員工自助提示 ===== */}
      <section className="bg-[#7A9A8A]/10 border border-[#7A9A8A]/30 rounded-lg p-5">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">員工自助小提示</h2>
        <ul className="space-y-2 text-sm text-gray-700 list-disc list-inside">
          <li>想關閉特定 LINE 通知？到「個人設定」逐項調整（9 種通知可獨立開關）</li>
          <li>想查餘額？跟 LINE Bot 輸入「查假」即可，免登入網頁</li>
          <li>駁回後想知道為什麼？看通知內容裡的「主管留言」段落（主管未填則沒有）</li>
          <li>已核准但需要撤銷？只要在開始日前都可以撤；過了開始日請聯絡 admin</li>
          <li>修改 / 撤銷 / 駁回 都會即時通知對應的同事，不會出現「資訊脫鉤」</li>
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
