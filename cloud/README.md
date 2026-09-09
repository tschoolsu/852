# 學生會檔案管理系統（雲端版）

這個目錄是部署於 OpenAI Sites／Cloudflare Workers 的版本。網站不依賴個人電腦持續開機：D1 保存帳號、權限與版本資料，R2 私有儲存檔案內容。

## 功能

- 直接用 `@tschool.tp.edu.tw` Google 帳號登入，第一次登入自動建立帳號並同步 Google 本名。
- 上傳任意格式檔案、發表連結、建立及移動資料夾。
- 擁有者可設僅自己、指定已登入成員或所有已登入成員；指定成員與登入後共享連結均可分成可檢視或可編輯。
- 我的上傳紀錄、垃圾桶、還原、永久刪除、完整版本紀錄與舊版本還原。
- 指定成員共享後可透過 Resend 寄出通知信；未設定寄信服務時，介面會明確提示通知未寄出。

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
GOOGLE_CLIENT_ID=Google OAuth 網頁用戶端 ID
GOOGLE_CLIENT_SECRET=Google OAuth 網頁用戶端密鑰
SESSION_SECRET=至少 32 位元組的安全亂數
APP_URL=https://tschool-student-files.yuchenglin1029.chatgpt.site
ALLOWED_EMAIL_DOMAIN=tschool.tp.edu.tw
ADMIN_EMAILS=11430106@tschool.tp.edu.tw
REGISTRATION_MODE=instant
RESEND_API_KEY=選填，Resend API Key
SHARE_EMAIL_FROM=選填，例如 T-Files <files@你的已驗證網域>
```

Google OAuth 用戶端需加入以下重新導向 URI：

```text
https://tschool-student-files.yuchenglin1029.chatgpt.site/auth/google/callback
```

## 驗證

```powershell
npm run lint
npm run build
npm run test:access
npm audit --omit=dev
```

權限測試會使用本機 D1/R2，驗證四種使用者身分、共享、資料夾繼承、上傳下載、版本、垃圾桶及 CSRF，不會碰正式資料。

## 平台限制

程式不限制每位使用者或檔案庫的總容量。Cloudflare 免費方案仍有平台用量上限，單次 HTTP 請求最多 100 MB，因此雲端版單一檔案限制為 100 MB。超過免費額度時需等待額度重置或升級方案。
