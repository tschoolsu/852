import nodemailer from "nodemailer";
import { config } from "./config.js";

let transporter;
if (config.smtp.host) {
  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
}

export async function sendPasswordResetEmail({ to, displayName, resetUrl }) {
  if (!transporter) {
    if (!config.isProduction) {
      console.info(`\n[開發用重設密碼信] ${to}\n${resetUrl}\n`);
      return;
    }
    throw new Error("SMTP 尚未設定");
  }

  await transporter.sendMail({
    from: { name: config.smtp.fromName, address: config.smtp.fromEmail || config.smtp.user },
    to,
    subject: "重設你的 T-Files 密碼",
    text: `${displayName} 您好：\n\n請在 30 分鐘內使用以下連結重設密碼：\n${resetUrl}\n\n若不是你提出申請，請忽略此信。`,
    html: `<p>${escapeHtml(displayName)} 您好：</p><p>請在 30 分鐘內使用下方連結重設密碼：</p><p><a href="${escapeHtml(resetUrl)}">重設密碼</a></p><p>若不是你提出申請，請忽略此信。</p>`,
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]);
}
