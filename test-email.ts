import { config } from "dotenv"
config()

const toEmail = "benson@popin.cc"
const subject = "[Test] 測試寄信功能 (Brevo API)"
const htmlContent = "<h1>這是一封測試信件</h1><p>如果您收到這封信，代表 Brevo API 設定正確，且您的 Timeoff 系統已經可以正常寄信了！</p>"

const apiKey = process.env.MAIL_API_KEY
const senderEmail = process.env.FROM_EMAIL
const senderName = process.env.SENDER_NAME

async function test() {
  console.log("Sending email with API Key:", apiKey ? "Set" : "Not Set")
  
  const reqBody = {
    sender: { email: senderEmail, name: senderName || "Timeoff System" },
    to: [{ email: toEmail }],
    subject,
    htmlContent
  }

  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "api-key": apiKey || ""
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

test()
