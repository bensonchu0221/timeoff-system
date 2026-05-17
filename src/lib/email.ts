type BrevoPerson = {
  name?: string
  email: string
}

type BrevoEmailRequest = {
  sender?: BrevoPerson
  to: BrevoPerson[]
  subject: string
  htmlContent: string
}

const sendBrevoEmail = async (toEmail: string, subject: string, htmlContent: string) => {
  const apiKey = process.env.MAIL_API_KEY
  const senderEmail = process.env.FROM_EMAIL
  const senderName = process.env.SENDER_NAME

  if (!apiKey) {
    console.log(`[Email Mock] To: ${toEmail} | Subject: ${subject}`)
    return
  }

  const reqBody: BrevoEmailRequest = {
    to: [{ email: toEmail }],
    subject,
    htmlContent
  }

  if (senderEmail) {
    reqBody.sender = { 
      email: senderEmail, 
      name: senderName || "Timeoff System" 
    }
  }

  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "api-key": apiKey
      },
      body: JSON.stringify(reqBody)
    })

    if (!res.ok) {
      const errText = await res.text()
      console.error(`Brevo API Error (${res.status}): ${errText}`)
    } else {
      console.log(`Email successfully sent to ${toEmail}`)
    }
  } catch (error) {
    console.error("Failed to send Brevo email:", error)
  }
}

export async function sendLeaveApplicationEmail(toEmail: string, applicantName: string, leaveType: string, duration: number, link: string) {
  const subject = `[待審核] ${applicantName} 送出了請假申請`
  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
      <h2 style="color: #333;">新的請假申請待審核</h2>
      <p style="color: #555; line-height: 1.5;"><strong>申請人：</strong> ${applicantName}</p>
      <p style="color: #555; line-height: 1.5;"><strong>假別：</strong> ${leaveType}</p>
      <p style="color: #555; line-height: 1.5;"><strong>天數：</strong> ${duration} 天</p>
      <div style="margin-top: 30px;">
        <a href="${link}" style="background-color: #7A9A8A; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">前往系統審核</a>
      </div>
    </div>
  `
  await sendBrevoEmail(toEmail, subject, html)
}

export async function sendLeaveResultEmail(toEmail: string, leaveType: string, status: "APPROVED" | "REJECTED", message?: string) {
  const isApproved = status === "APPROVED"
  const statusText = isApproved ? "✅ 已核准" : "❌ 已駁回"
  const color = isApproved ? "#7A9A8A" : "#C48F8B"

  const subject = `[假單結果] 您的請假申請 ${statusText}`
  const siteUrl = process.env.NEXTAUTH_URL || "http://localhost:8080"

  // 主管留言區塊：駁回時通常一定有，核准選填
  const messageBlock = message?.trim()
    ? `<div style="margin-top: 20px; padding: 12px 16px; background-color: #f9f9f9; border-left: 4px solid ${color}; border-radius: 4px;">
         <p style="margin: 0 0 4px 0; color: #888; font-size: 12px;">主管留言</p>
         <p style="margin: 0; color: #333; line-height: 1.5; white-space: pre-wrap;">${escapeHtml(message.trim())}</p>
       </div>`
    : ""

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
      <h2 style="color: ${color};">請假審核結果通知</h2>
      <p style="color: #555; line-height: 1.5;">您申請的 <strong>${leaveType}</strong>，主管審核結果為：<strong style="color: ${color};">${statusText}</strong>。</p>
      ${messageBlock}
      <p style="color: #555; line-height: 1.5; margin-top: 20px;">您可以登入系統查看詳細資訊。</p>
      <div style="margin-top: 30px;">
        <a href="${siteUrl}" style="background-color: #A9ADA9; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">前往系統</a>
      </div>
    </div>
  `
  await sendBrevoEmail(toEmail, subject, html)
}

export async function sendDepartmentLeaveEmail(
  toEmail: string,
  applicantName: string,
  leaveType: string,
  startDate: Date,
  endDate: Date
) {
  const range = formatDateRange(startDate, endDate)
  const subject = `[團隊通知] ${applicantName} 將於 ${range} 請${leaveType}`
  const siteUrl = process.env.NEXTAUTH_URL || "http://localhost:8080"

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
      <h2 style="color: #333;">團隊請假通知</h2>
      <p style="color: #555; line-height: 1.5;"><strong>${escapeHtml(applicantName)}</strong> 將於 <strong>${range}</strong> 請<strong>${escapeHtml(leaveType)}</strong>。</p>
      <p style="color: #888; line-height: 1.5; font-size: 13px;">此為自動通知，您可以登入系統查看部門完整請假狀況。</p>
      <div style="margin-top: 24px;">
        <a href="${siteUrl}/admin/gantt" style="background-color: #7A9A8A; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; font-size: 14px;">查看團隊行事曆</a>
      </div>
    </div>
  `
  await sendBrevoEmail(toEmail, subject, html)
}

function formatDateRange(start: Date, end: Date): string {
  const s = formatTaipeiDate(start)
  const e = formatTaipeiDate(end)
  return s === e ? s : `${s}–${e}`
}

function formatTaipeiDate(d: Date): string {
  const tw = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Taipei" }))
  return `${tw.getMonth() + 1}/${tw.getDate()}`
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}
