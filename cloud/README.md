# 學生會檔案管理系統（雲端版）

這個目錄是部署於 OpenAI Sites／Cloudflare Workers 的版本。網站不依賴個人電腦持續開機：D1 保存帳號、權限與版本資料，R2 私有儲存檔案內容。

## 功能

- 僅接受 `@tschool.tp.edu.tw` 信箱註冊；先驗證信箱，再自行設定顯示名稱及獨立密碼（8～128 字元）。
- 忘記密碼透過 Brevo SMTP 寄送一次性連結；舊 Google 帳號由此設定密碼，沿用原使用者 ID、檔案與管理員權限。Google OAuth 入口只會導回獨立登入頁。
- 上傳任意格式檔案、發表連結、建立及移動資料夾。
- 擁有者可設僅自己、指定已登入成員或所有已登入成員；指定成員與登入後共享連結均可分成可檢視或可編輯。
- 我的上傳紀錄、垃圾桶、還原、永久刪除、完整版本紀錄與舊版本還原。
- 驗證、密碼重設與共享通知均透過 Brevo SMTP 寄信。

## 本機開發

需要 Node.js 22.13 以上版本。

```powershell
npm ci
npm run build
npx wrangler d1 migrations apply site-creator-d1 --local --config dist/server/wrangler.json
npm start
```

本機環境值放在不會提交的 `.dev.vars`。正式環境值由 Sites 管理：

```dotenv
SESSION_SECRET=至少 32 位元組的安全亂數
APP_URL=https://tschool-student-files.yuchenglin1029.chatgpt.site
ALLOWED_EMAIL_DOMAIN=tschool.tp.edu.tw
ADMIN_EMAILS=11430106@tschool.tp.edu.tw
REGISTRATION_MODE=instant
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=465
SMTP_USER=Brevo SMTP 頁面的登入帳號
SMTP_PASSWORD=Brevo SMTP key（不是 API key）
SMTP_FROM_EMAIL=Brevo 已驗證的寄件者信箱
SMTP_FROM_NAME=學生會檔案管理系統
```

密碼以 PBKDF2-HMAC-SHA256（600,000 次、每筆隨機 salt）保存。密碼設定連結 30 分鐘到期，資料庫僅存 token 的 SHA-256，使用後立即失效；完成重設會撤銷舊登入。登入與寄信有 IP／信箱限流。重設 token 放在 URL fragment，避免送進 HTTP 路徑及 Referer。

上線前需驗證寄件者並設定 SMTP 密鑰，實測投遞後再切換正式登入。保留舊 Google 欄位僅為資料相容，新帳號使用唯一 local 標記，不會交換 Google token。

## 驗證

```powershell
npm run lint
npm run build
npm run test:access
node scripts/auth-smoke.mjs
npm audit --omit=dev
```

權限測試會使用本機 D1/R2，驗證四種使用者身分、共享、資料夾繼承、上傳下載、版本、垃圾桶及 CSRF，不會碰正式資料。

## 平台限制

程式不限制每位使用者或檔案庫的總容量。Cloudflare 免費方案仍有平台用量上限，單次 HTTP 請求最多 100 MB，因此雲端版單一檔案限制為 100 MB。超過免費額度時需等待額度重置或升級方案。
