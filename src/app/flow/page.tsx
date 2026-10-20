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
          從送出假單到核准，大致會經過下面幾步。每一步系統都會自動通知相關的人（Email + LINE），你不用另外傳訊息提醒；
          不想收的通知可以到「個人設定」逐項關掉。
        </p>
      </div>

      {/* ===== 主要流程 ===== */}
      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-6">主要流程</h2>

        <ul className="steps steps-vertical">
          <FlowStep
            title="員工提交申請"
            description="到「請假」頁填日期、假別，事由和代理人可填可不填。"
          />
          <FlowStep
            title="系統自動驗證"
            description="送出當下系統會幫你檢查：餘額夠不夠（特休也會算跨年預約後的年底餘額）、有沒有和其他假單撞期；週末和國定假日會自動跳過不扣天數。特休需到職滿 3 個月、生理假限女性。有問題會馬上提示，不會送出。"
          />
          <FlowStep
            title="通知主管"
            description="主管會同時收到 Email 和 LINE。LINE 訊息上可以直接按「快速核准」或「駁回」，駁回時能選常用理由，也可以開網頁看完整資訊。"
          />
          <FlowStep
            title="主管一審"
            description="第一關由直屬主管審核（主管不在時 admin 可以代審）。通過就送到 Boss 做最後確認；駁回就直接結束。"
          />
          <FlowStep
            title="通知 Boss 終審"
            description="一審通過後，系統會通知 Boss，也會告訴你「主管已同意，等 Boss 最後確認」。"
          />
          <FlowStep
            title="Boss 終審"
            description="Boss 做最後核准或駁回（Boss 不在時 admin 可代為終審）。一審通過時天數會先幫你保留，Boss 核准後才正式扣除。"
          />
          <FlowStep
            title="結果通知"
            description="你會收到最終結果（Email + LINE）。核准的話，同部門同事會收到「誰哪天請假」的提醒，代理人也會收到正式通知。"
          />
          <FlowStep
            title="進入行事曆"
            description="甘特圖上看得到已核准（綠）和待審（灰）的假單。也可以把個人、團隊或全公司的請假行事曆訂閱到手機或 Google 行事曆，只會同步已核准的假單。"
            isLast
          />
        </ul>

        <div className="mt-4 text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-1">
          <p className="font-medium text-gray-800">什麼時候只審一關？</p>
          <p>• 你的直屬主管就是 Boss，或你還沒有設定直屬主管：Boss 審一次就算定案。</p>
          <p>• Boss 自己請假：自動核准（沒有更上層可以審）。</p>
          <p>• 系統還沒設定 Boss：只由直屬主管審一關。</p>
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
          要先在「個人設定」綁定 LINE 才收得到 LINE 推播；Email 預設都會寄。兩種都可以在「個人設定」逐項關掉。已離職（最後上班日已過）的同仁不會收到任何通知。
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
          ** 全公司請假名單：所有在職、已綁定 LINE 的同仁都會收到（自己今天請假的話，名單上不會出現自己）。
        </p>
        <p className="text-xs text-gray-500 mt-1">
          *** 撤銷待審單時，一審主管一律會收到；若已進入二審，Boss 也會收到。
        </p>
        <p className="text-xs text-gray-500 mt-1">
          最終核准時，若代理人剛好也是同部門同仁，只會收到一則「代理人通知」（不再另發部門提醒，避免重複）。
        </p>
      </section>

      {/* ===== 同仁離職時 ===== */}
      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">同仁離職時</h2>
        <p className="text-sm text-gray-600 mb-4">
          HR 一收到離職通知，就可以到「使用者管理」先填好這位同仁的<strong>最後上班日</strong>，不必等到人離開那天才處理。
          最後上班日當天照常使用系統，<strong>隔天 00:00 起自動生效</strong>。
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ScenarioCard
            title="最後上班日以前（含當天）"
            trigger="已經填好最後上班日，但日期還沒過"
            behavior="一切照常：可以登入、請假、審核，也會照常收到通知。使用者管理列表上會標示「MM/DD 最後上班」提醒大家"
          />
          <ScenarioCard
            title="最後上班日的隔天起"
            trigger="系統每天 00:10 自動檢查，不需要 HR 再做任何事"
            behavior="無法再登入網頁或使用 LINE 功能、不再收到任何 Email／LINE 通知；系統會自動解除 LINE 綁定並登出所有裝置，也會從請假名單、甘特圖、代理人選單和報表中移除"
          />
          <ScenarioCard
            title="特休怎麼處理？"
            trigger="填最後上班日的時候"
            behavior="最後上班日之後才生效的特休發放會自動作廢（例如最後上班日是 12/31，就不會拿到明年 1/1 發的特休）；已經發的、最後上班日以前的照舊"
          />
          <ScenarioCard
            title="他是主管或審核者怎麼辦？"
            trigger="離職的人底下還有下屬，或還有假單等他審"
            behavior="填未來日期時，系統會提醒 HR 在生效前把下屬改派給其他主管；如果生效後還沒改派，每天會用 LINE 提醒 admin，直到處理完為止"
          />
        </div>

        <div className="mt-4 text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-1">
          <p className="font-medium text-gray-800">HR 小提醒：</p>
          <p>• 填日期時會跳出確認視窗，列出會發生的事，確認後才會儲存。</p>
          <p>• 日期填錯或同仁決定留下來？把最後上班日清空，就會恢復為在職。若之前已經生效，本人需要到「個人設定」重新綁定 LINE；被作廢的特休請到特休欄按「檢查是否需重算」補回。</p>
          <p>• 補登已經過去的日期，會立刻生效。</p>
        </div>
      </section>

      {/* ===== 小提示 ===== */}
      <section className="bg-[#7A9A8A]/10 border border-[#7A9A8A]/30 rounded-lg p-5">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">小提示</h2>
        <ul className="space-y-2 text-sm text-gray-700 list-disc list-inside">
          <li>想知道審到哪一關？首頁的假單會顯示進度條（申請 → 主管審核 → Boss 終審 → 完成）</li>
          <li>通知太多？到「個人設定」逐項關掉，Email 和 LINE 可以分開設定</li>
          <li>想查還剩幾天假？傳「查假」給 LINE Bot 就好，不用開網頁</li>
          <li>被駁回想知道原因？打開假單看「主管留言」（一審）或「終審留言」（Boss）；如果主管沒填就不會有</li>
          <li>想改假單？主管審核前都能直接改；主管通過後就不能改了，請先撤銷再重新申請</li>
          <li>已核准但要取消？開始日當天（含）以前都可以自己撤銷；超過開始日請聯絡 admin 協助</li>
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
