# T-Files 學生會檔案管理器

T-Files 是獨立於既有內部系統的學生會檔案與連結管理網站。使用者直接以學校 Google Workspace 帳號登入；第一次登入會自動建立帳號，之後每次登入都會同步學校信箱與 Google 本名。

## 已完成功能

- 任意格式檔案上傳；檔案以隨機名稱存放在網站公開目錄之外，下載前會再次檢查權限。
- 網址發表、資料夾與搜尋；資料夾的共享權限會套用到其中內容。
- 擁有者可依本名或學校信箱搜尋已登入過本系統的成員，授予「可檢視」或「可編輯」。
- 可編輯者能改名稱、說明、替換檔案、修改連結，也能在共享資料夾中新增內容。
- 分享連結仍要求對方使用學校 Google 帳號登入，可設為可檢視或可編輯並隨時撤銷。
- 「我的上傳紀錄」只列出目前帳號建立的檔案、連結與資料夾。
- 不需要另外註冊或設定本機密碼；姓名與信箱取自已驗證的學校 Google 帳號。
- Google 用於每次登入；系統不會取得 Google 密碼，也不儲存 Google access token 或 refresh token。
- 同時檢查 Google Workspace `hd` 宣告與完整 `@tschool.tp.edu.tw` 信箱。
- 新帳號啟用模式可在「立即啟用」與「管理員審核」之間切換。
- 指定成員共享時可透過 SMTP 寄送通知信；未設定 SMTP 的開發環境會在執行視窗顯示通知內容。
- 支援垃圾桶、還原、永久刪除、移動項目及檔案／連結／資料夾的完整版本紀錄與還原。
- 本機檔案儲存與 S3 相容雲端儲存可切換，支援 Cloudflare R2、AWS S3 等服務。
- 重要登入、上傳、下載、權限及管理行為會寫入稽核紀錄。

## 第一次在本機啟動

需要 Node.js 24 或更新版本。

```powershell
Copy-Item .env.example .env
npm install
npm run dev
```

開啟 <http://localhost:3000>，使用學校 Google 帳號登入即可。

Windows 也可以直接按兩下 `start-local.cmd`。啟動後請保持該視窗開啟；關閉視窗或按 `Ctrl+C` 會停止本機網站，之後再次按兩下即可重新啟動。

請在 `.env` 把 `SESSION_SECRET` 改成至少 32 字元的隨機字串。PowerShell 可用以下指令產生：

```powershell
[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

## 設定學校 Google 帳號驗證

1. 在 Google Cloud 建立 OAuth 2.0 用戶端，應用程式類型選「網頁應用程式」。
2. 本機測試的已授權重新導向 URI 填入：`http://localhost:3000/auth/google/callback`。
3. 將取得的值填入本機 `.env`，不要提交到 Git：

```dotenv
GOOGLE_CLIENT_ID=你的用戶端ID
GOOGLE_CLIENT_SECRET=你的用戶端密鑰
```

4. 重新啟動網站。正式上線時需另加 `https://正式網域/auth/google/callback`，且必須與 `APP_URL` 完全一致。

流程只要求 `openid email profile`，用來登入並取得 Google 簽章驗證過的學校信箱與本名。登入完成後不保存 Google access token 或 refresh token。

## 分享通知信與 SMTP

SMTP 可以想成網站寄出電子郵件時使用的「郵局櫃台」。擁有者把項目分享給指定成員後，網站會把通知信交給 SMTP 伺服器，再寄到對方的學校信箱。

向學校資訊管理人員或郵件服務商取得以下資料後，填入 `.env`：

```dotenv
SMTP_HOST=smtp.example.org
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=寄信帳號
SMTP_PASS=應用程式密碼
SMTP_FROM_NAME=T-Files 學生會檔案管理
SMTP_FROM_EMAIL=寄件者信箱
```

連接埠 `587` 通常搭配 `SMTP_SECURE=false`（連線後升級 TLS），`465` 通常搭配 `SMTP_SECURE=true`。實際值以服務商提供的資料為準。請使用專用的應用程式密碼，不要把個人信箱密碼放進專案；`.env` 已被 Git 排除。

本機測試時可以先全部留白。共享仍會生效，但通知內容只會出現在執行 `npm run dev` 的視窗中。

## 切換新帳號審核

目前預設立即啟用：

```dotenv
REGISTRATION_MODE=instant
```

日後改為管理員審核：

```dotenv
REGISTRATION_MODE=approval
ADMIN_EMAILS=admin@tschool.tp.edu.tw
```

重新啟動網站後，指定信箱登入時會看到「帳號審核」。既有帳號資料不需重建。

## 換電腦或正式上線

程式不需要永久留在目前這台電腦。另一台電腦安裝 Node.js 24、複製專案與 `.env`，執行 `npm ci`、`npm start` 即可。

本機模式的資料在 `data/`。搬移本機資料時，先停止網站，再完整複製該資料夾。正式上線建議把檔案改存 S3 相容雲端；網站仍會先驗證使用者權限，再從雲端串流下載：

```dotenv
STORAGE_DRIVER=s3
S3_REGION=auto
S3_ENDPOINT=https://你的帳號.r2.cloudflarestorage.com
S3_BUCKET=tfiles
S3_ACCESS_KEY_ID=存取金鑰
S3_SECRET_ACCESS_KEY=秘密金鑰
```

Cloudflare R2 設定時通常不需開啟公開 Bucket。程式透過伺服器端金鑰存取，使用者無法繞過網站的權限檢查直接取得檔案。

資料庫目前採用 SQLite，位於 `data/tfiles.sqlite`。部署主機必須提供持久磁碟並定期備份 `data/`；若未來需要多台網站主機同時服務，再將資料庫層遷移到集中式資料庫。

正式環境至少需設定：

```dotenv
NODE_ENV=production
HOST=0.0.0.0
APP_URL=https://你的正式網域
SESSION_SECRET=至少32字元的隨機字串
TRUST_PROXY=1
GOOGLE_CLIENT_ID=正式環境的用戶端ID
GOOGLE_CLIENT_SECRET=正式環境的用戶端密鑰
```

請由反向代理或雲端平台提供 HTTPS。正式環境的登入 Cookie 只會透過 HTTPS 傳送。

### 使用 Render 持續執行

專案根目錄的 `render.yaml` 已準備好 Render Web Service 與 1 GB 持久磁碟。Render 會在雲端執行網站，因此你的電腦關機後網站仍會運作。持久磁碟存放 SQLite、上傳檔案與版本檔案；日後可以在 Render 後台增加容量。

1. 登入 Render，選擇 **New > Blueprint**，連接此 GitHub repository。
2. 建立時填入 `GOOGLE_CLIENT_ID` 與 `GOOGLE_CLIENT_SECRET`；`SESSION_SECRET` 會由 Render 自動產生。
3. 第一次部署取得 `https://...onrender.com` 網址後，到 Google Cloud OAuth 用戶端增加 `https://...onrender.com/auth/google/callback`。

持久磁碟需要 Render 的付費 Web Service；實際價格以 Render 後台顯示為準。此架構使用單一執行個體，適合目前學生會規模。若日後需要多台執行個體，再將 SQLite 與本機檔案分別移到集中式資料庫及私有物件儲存。

## 容量說明

系統沒有設定使用者或檔案庫的總容量上限。為避免單一請求耗盡主機資源，依 OWASP 建議保留單檔安全上限，預設為 1 GiB，可由 `MAX_UPLOAD_BYTES` 調整。雲端儲存的實際總容量與費用仍由服務商方案決定。

## 檢查

```powershell
npm test
npm audit
```

詳細資安設計、已知限制與上線檢查項目請見 [SECURITY.md](./SECURITY.md)。
