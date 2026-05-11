import nodemailer from "nodemailer"

// Create a transporter using SMTP
// User must provide SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS in .env
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: Number(process.env.SMTP_PORT) || 465,
  secure: true, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

// Helper to gracefully fallback if SMTP is not configured yet
const isSmtpConfigured = !!(process.env.SMTP_USER && process.env.SMTP_PASS)

export async function sendLeaveApplicationEmail(toEmail: string, applicantName: string, leaveType: string, duration: number, link: string) {
  if (!isSmtpConfigured) {
    console.log(`[Email Mock] To: ${toEmail} | Subject: 待審核通知 | ${applicantName} 申請了 ${leaveType} (${duration}天)`)
    return
  }

  await transporter.sendMail({
    from: `"Timeoff System" <${process.env.SMTP_USER}>`,
    to: toEmail,
    subject: `[待審核] ${applicantName} 送出了請假申請`,
    html: `
      <h2>新的請假申請待審核</h2>
      <p><strong>申請人：</strong> ${applicantName}</p>
      <p><strong>假別：</strong> ${leaveType}</p>
      <p><strong>天數：</strong> ${duration} 天</p>
      <br/>
      <a href="${link}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">前往審核</a>
    `
  })
}

export async function sendLeaveResultEmail(toEmail: string, leaveType: string, status: "APPROVED" | "REJECTED") {
  if (!isSmtpConfigured) {
    console.log(`[Email Mock] To: ${toEmail} | Subject: 審核結果 | ${leaveType} 狀態：${status}`)
    return
  }

  const statusText = status === "APPROVED" ? "✅ 已核准" : "❌ 已駁回"
  
  await transporter.sendMail({
    from: `"Timeoff System" <${process.env.SMTP_USER}>`,
    to: toEmail,
    subject: `[假單結果] 您的請假申請 ${statusText}`,
    html: `
      <h2>請假審核結果通知</h2>
      <p>您申請的 <strong>${leaveType}</strong>，主管審核結果為：<strong>${statusText}</strong>。</p>
      <p>您可以登入系統查看詳細資訊。</p>
      <br/>
      <a href="${process.env.NEXTAUTH_URL || 'http://localhost:8080'}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">前往系統</a>
    `
  })
}
