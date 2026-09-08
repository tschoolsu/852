# T-Files 學生會檔案管理器

T-Files 是獨立於既有內部系統的學生會檔案與連結管理網站。使用者以 `@tschool.tp.edu.tw` 電子郵件自行註冊、登入，並可將每個檔案或連結設為「僅自己」、「指定成員」或「所有已登入成員」。

## 已完成功能

- 任意格式檔案上傳；檔案以隨機名稱存放在網站公開目錄之外，下載前會再次檢查權限。
- 網址發表與搜尋。
- 擁有者可隨時修改存取範圍。
- 獨立註冊、登入、登出與忘記密碼流程。
- 僅允許 `@tschool.tp.edu.tw` 網域註冊。
- 註冊模式可在「立即啟用」與「管理員審核」之間切換。
- SMTP 寄送重設密碼信；未設定 SMTP 的開發環境會在執行視窗顯示測試連結。
- 本機檔案儲存與 S3 相容雲端儲存可切換，支援 Cloudflare R2、AWS S3 等服務。
- 重要登入、上傳、下載、權限及管理行為會寫入稽核紀錄。

## 第一次在本機啟動

需要 Node.js 24 或更新版本。

```powershell
Copy-Item .env.example .env
npm install
npm run dev
```

開啟 <http://localhost:3000>。第一次使用時直接以學校信箱註冊即可。

請在 `.env` 把 `SESSION_SECRET` 改成至少 32 字元的隨機字串。PowerShell 可用以下指令產生：

```powershell
[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

## SMTP 是什麼？

SMTP 可以想成網站寄出電子郵件時使用的「郵局櫃台」。使用者按下忘記密碼後，網站會把收件者、主旨與重設連結交給 SMTP 伺服器，再由它寄到學校信箱。

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

本機測試時可以先全部留白。忘記密碼頁仍可操作，重設連結會出現在執行 `npm run dev` 的視窗中。

## 切換註冊審核

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
```

請由反向代理或雲端平台提供 HTTPS。正式環境的登入 Cookie 只會透過 HTTPS 傳送。

## 容量說明

系統沒有設定使用者或檔案庫的總容量上限。為避免單一請求耗盡主機資源，依 OWASP 建議保留單檔安全上限，預設為 1 GiB，可由 `MAX_UPLOAD_BYTES` 調整。雲端儲存的實際總容量與費用仍由服務商方案決定。

## 檢查

```powershell
npm test
npm audit
```

詳細資安設計、已知限制與上線檢查項目請見 [SECURITY.md](./SECURITY.md)。
