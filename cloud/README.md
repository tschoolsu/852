# T-Files 雲端程式說明

## 介紹

`cloud/` 是 T-Files 正式網站目前使用的雲端版程式

正式網站：[https://tschool-student-files.yuchenglin1029.chatgpt.site](https://tschool-student-files.yuchenglin1029.chatgpt.site)

此版本執行於 OpenAI Sites／Cloudflare Workers，使用 Cloudflare D1 儲存帳號、權限及檔案資料，並使用 Cloudflare R2 儲存實際上傳的檔案。

網站、資料庫及檔案都在雲端執行，因此網站不需要依賴開發者的電腦持續開機。

## 目前部署狀態

- 正式網站目前使用學校 Google 帳號登入
- 只接受 `@tschool.tp.edu.tw` 學校帳號
- 正式網站的帳號、檔案資料及權限保存在 Cloudflare D1
- 上傳的檔案及歷史檔案版本保存在 Cloudflare R2
- R2 儲存空間不對外公開
- 使用者下載檔案前，程式會先檢查登入狀態及存取權
- 正式網站目前尚未切換至獨立密碼登入
- `cloud/` 的開發版本已包含獨立密碼及 Brevo SMTP 程式
- 獨立密碼版本必須先完成 SMTP 設定、資料庫遷移及測試，才能部署到正式網站

## 使用技術

- TypeScript
- React
- Next.js 相容架構
- Vinext
- Cloudflare Workers
- Cloudflare D1
- Cloudflare R2
- Drizzle ORM
- Wrangler
- Node.js
- npm

## Node.js 版本

本專案需要：

```text
Node.js 22.13.0 或更新版本
```

建議所有開發者使用相同的 Node.js 主要版本，避免套件安裝、建置或測試結果不同。

可以使用以下指令確認版本：

```powershell
node --version
npm --version
```

## 目錄說明

| 路徑 | 用途 |
| --- | --- |
| `app/` | 網頁頁面、登入頁面、檔案管理介面及 API |
| `app/api/` | 帳號、檔案、資料夾、共享及批次操作 API |
| `app/auth/` | 目前 Google 登入及登入回呼的相容路由 |
| `components/` | 網頁共用介面元件 |
| `db/` | Drizzle 資料庫結構 |
| `drizzle/` | Drizzle 產生的資料庫遷移檔案 |
| `migrations/` | Wrangler 套用至 D1 的資料庫遷移檔案 |
| `lib/` | 權限、登入、密碼、寄信、檔案及 ZIP 等共用程式 |
| `public/` | 網站圖示及不需要權限的靜態檔案 |
| `scripts/` | 權限、帳號及介面測試工具 |
| `.openai/hosting.json` | OpenAI Sites 的 D1 與 R2 綁定設定 |
| `package.json` | 套件、Node.js 版本及指令設定 |
| `env.d.ts` | Cloudflare 環境變數及資源綁定的型別 |
| `drizzle.config.ts` | Drizzle 資料庫產生設定 |
| `vite.config.ts` | Vinext、Vite 及 Cloudflare 建置設定 |

以下目錄由開發或測試指令產生，不應提交到 Git：

- `node_modules/`
- `.next/`
- `.vinext/`
- `.wrangler/`
- `dist/`
- `work/`
- `.dev.vars`

## Cloudflare 資源

### D1 資料庫

Cloudflare D1 用來儲存系統資料。

程式使用的 D1 綁定名稱為：

```text
DB
```

D1 儲存：

- 使用者帳號
- 使用者角色及帳號狀態
- 登入工作階段
- OAuth 登入狀態
- 檔案、連結及資料夾的基本資料
- 項目擁有者
- 資料夾位置
- 指定成員及權限
- 一般存取權
- 舊版分享權杖對應資料（僅供相容）
- 版本紀錄
- 垃圾桶狀態
- 操作紀錄
- 獨立登入密碼雜湊
- 信箱驗證及密碼重設權杖
- 登入及寄信頻率限制

D1 不儲存實際上傳的檔案內容。

### R2 檔案儲存

Cloudflare R2 用來保存實際檔案。

程式使用的 R2 綁定名稱為：

```text
FILES
```

R2 儲存：

- 目前版本的檔案
- 被替換的歷史檔案版本
- 還原版本需要使用的檔案內容

檔案使用隨機儲存鍵保存，不直接使用使用者提供的檔名作為儲存位置。

R2 Bucket 必須保持非公開。使用者必須透過網站的下載 API，並通過存取權檢查後才能下載檔案。

### Sites 資源綁定

`.openai/hosting.json` 會指定正式網站使用的資源：

```json
{
  "project_id": "網站專案 ID",
  "d1": "DB",
  "r2": "FILES"
}
```

其中：

- `project_id` 是 OpenAI Sites 專案
- `d1` 是 D1 綁定名稱
- `r2` 是 R2 綁定名稱

除非重新建立部署專案或更換資源，否則不要任意修改綁定名稱。

## 資料庫資料表

### `users`

儲存使用者基本資料：

- 使用者 ID
- 學校信箱
- 顯示名稱
- Google 帳號識別資料
- 一般成員或管理員角色
- 帳號狀態
- 建立及更新時間

### `sessions`

儲存登入工作階段：

- 工作階段權杖雜湊
- 使用者 ID
- CSRF 權杖
- 到期時間
- 建立時間

資料庫不會直接保存原始工作階段權杖。

### `oauth_states`

儲存 Google OAuth 登入期間使用的資料：

- OAuth `state`
- PKCE 驗證資料
- `nonce`
- 登入完成後的返回位置
- 到期時間

### `resources`

儲存檔案、連結及資料夾的基本資料：

- 項目類型
- 名稱
- 說明
- 連結網址
- R2 儲存鍵
- 原始檔名
- MIME 類型
- 檔案容量
- 擁有者
- 所在資料夾
- 一般存取權
- 目前版本
- 垃圾桶狀態
- 建立及更新時間

### `resource_members`

儲存指定成員的存取權：

- 項目 ID
- 使用者 ID
- 可檢視或可編輯

### `share_links`

保留舊版分享權杖與項目的對應資料，供既有網址相容使用。舊版權杖只保存雜湊，不直接保存原始權杖。

目前建立的固定分享網址直接使用項目 ID，不會新增分享權杖，也不會自行授予存取權。使用者仍須登入，系統會依一般存取權與指定成員設定判斷是否可開啟。

### `resource_versions`

儲存檔案、連結及資料夾的版本紀錄：

- 版本編號
- 名稱及說明
- 連結網址
- 檔案儲存鍵
- 原始檔名及檔案容量
- 所在資料夾
- 操作類型
- 操作者
- 建立時間

### `audit_log`

儲存系統操作紀錄：

- 操作者
- 操作類型
- 操作目標
- 操作資料
- 操作時間

操作紀錄不得保存密碼、SMTP 密鑰、工作階段權杖或其他秘密資料。

### `password_credentials`

供獨立登入版本保存：

- 使用者 ID
- 密碼雜湊
- 信箱驗證時間
- 密碼變更時間

系統不會保存原始密碼。

### `auth_tokens`

供獨立登入版本保存：

- 權杖雜湊
- 學校信箱
- 註冊或忘記密碼用途
- 到期時間
- 建立時間

### `auth_rate_limits`

儲存登入、註冊及寄信的頻率限制資料。

## 管理員系統

目前系統可以區分一般成員與管理員，但管理員後台尚未建立。

預計提供：

- 查看及搜尋使用者
- 審核新帳號
- 啟用或停用帳號
- 管理使用者角色
- 查看系統操作紀錄
- 處理違規或異常內容

管理員可以執行的檔案操作及限制，需在功能設計完成後補充。

## 資料庫遷移

資料庫結構變更必須透過遷移檔案處理，不可直接修改正式 D1 資料表。

目前遷移內容包含：

- 基本帳號、資源、共享、版本及操作紀錄資料表
- 獨立密碼、驗證權杖及頻率限制資料表

修改 `db/schema.ts` 後，可以產生新的 Drizzle 遷移：

```powershell
npm run db:generate
```

本機套用 D1 遷移：

```powershell
npx wrangler d1 migrations apply site-creator-d1 --local --config dist/server/wrangler.json
```

正式環境套用遷移前必須：

- 備份正式資料
- 檢查遷移內容
- 先在本機資料庫測試
- 確認舊帳號、檔案及權限不會遺失
- 確認新舊程式可以正確讀取資料

## 環境變數

本機開發環境使用：

```text
cloud/.dev.vars
```

`.dev.vars` 不得提交到 GitHub。

正式環境的變數由 OpenAI Sites／Cloudflare 的秘密設定管理，不應寫入程式碼、README、GitHub Issue 或公開文件。

### 共用環境變數

#### `SESSION_SECRET`

用途：

- 保護登入工作階段
- 計算工作階段權杖雜湊

要求：

- 必須使用安全亂數
- 不同環境應使用不同值
- 不得提交到 Git
- 正式環境至少使用 32 位元組的安全亂數

#### `APP_URL`

用途：

- 指定網站的完整網址
- 產生登入回呼、分享網址及郵件連結

正式網站目前使用：

```text
https://tschool-student-files.yuchenglin1029.chatgpt.site
```

更換為 `https://file.tschoolsu.org` 後，需要同步修改此變數。

網址最後不需要 `/`。

#### `ALLOWED_EMAIL_DOMAIN`

用途：

- 限制可以使用系統的學校信箱網域

目前設定：

```text
tschool.tp.edu.tw
```

程式會檢查完整網域，不接受相似網域或子網域。

#### `ADMIN_EMAILS`

用途：

- 指定管理員信箱

格式：

- 可以填寫一個或多個信箱
- 多個信箱使用逗號分隔
- 信箱必須使用完整學校網域

範例：

```dotenv
ADMIN_EMAILS=admin1@tschool.tp.edu.tw,admin2@tschool.tp.edu.tw
```

#### `REGISTRATION_MODE`

用途：

- 設定新帳號建立後是否立即啟用

可使用：

```text
instant
approval
```

`instant`：

- 完成登入或註冊後立即啟用帳號

`approval`：

- 新帳號先設為等待審核
- 需要管理員核准後才能使用

目前正式網站採用立即啟用。

### Google 登入環境變數

正式網站目前仍使用 Google 登入，因此需要以下變數。

#### `GOOGLE_CLIENT_ID`

用途：

- Google OAuth 網頁應用程式用戶端 ID

#### `GOOGLE_CLIENT_SECRET`

用途：

- Google OAuth 網頁應用程式用戶端密鑰

Google OAuth 用戶端必須設定正確的重新導向網址：

```text
https://正式網站/auth/google/callback
```

使用 `file.tschoolsu.org` 後應設定為：

```text
https://file.tschoolsu.org/auth/google/callback
```

Google 用戶端密鑰不得放入 GitHub。

### Brevo SMTP 環境變數

以下變數供獨立登入版本使用。

正式網站切換至獨立登入前，必須先完成 Brevo 寄件者驗證及 SMTP 投遞測試。

#### `SMTP_HOST`

SMTP 伺服器位置。

Brevo 使用：

```text
smtp-relay.brevo.com
```

#### `SMTP_PORT`

SMTP 連接埠。

目前程式預設：

```text
465
```

#### `SMTP_USER`

Brevo SMTP 頁面提供的登入帳號。

此值不一定與寄件者信箱相同。

#### `SMTP_PASSWORD`

Brevo SMTP key。

此值不是 Brevo API key，也不是個人信箱密碼。

#### `SMTP_FROM_EMAIL`

寄件者信箱。

此信箱必須先在 Brevo 完成驗證。

#### `SMTP_FROM_NAME`

收件者看到的寄件者名稱。

建議使用：

```text
學生會檔案管理系統
```

Brevo SMTP 用於：

- 寄送註冊驗證信
- 寄送首次設定密碼信
- 寄送忘記密碼信
- 寄送共享通知信

### 舊版寄信環境變數

`env.d.ts` 仍保留以下舊版寄信變數：

```text
RESEND_API_KEY
SHARE_EMAIL_FROM
```

這兩個變數是先前使用 Resend 寄送共享通知時使用。

獨立帳號版本改用 Brevo SMTP 後，不需要同時設定 Resend。確認正式環境已完全改用 Brevo 後，可以再移除舊版變數及相關相容程式。

## 本機開發

### 進入雲端版目錄

```powershell
cd cloud
```

### 安裝套件

```powershell
npm ci
```

### 設定本機環境變數

向專案維護者取得開發環境使用的 `.dev.vars`，放到 `cloud/` 目錄。

不得直接使用正式環境的 SMTP 密鑰或其他正式憑證進行一般開發。

### 啟動開發伺服器

```powershell
npm run dev
```

### 建立完整的本機 Workers 環境

先建置程式：

```powershell
npm run build
```

套用本機 D1 遷移：

```powershell
npx wrangler d1 migrations apply site-creator-d1 --local --config dist/server/wrangler.json
```

啟動本機 Workers：

```powershell
npm start
```

本機資料會保存在 Wrangler 的本機資料目錄，不會修改正式 D1 或 R2。

## 專案指令

### `npm run dev`

啟動 Vinext 開發伺服器。

用於：

- 修改網頁介面
- 修改 React 元件
- 一般開發測試

### `npm run build`

建立正式版本。

此指令會：

- 檢查程式能否完成建置
- 產生 `dist/`
- 產生 Wrangler 使用的執行設定

### `npm start`

使用建置完成的設定啟動本機 Cloudflare Workers。

執行前必須先完成：

```powershell
npm run build
```

### `npm run lint`

檢查以下目錄的程式格式及常見問題：

- `app/`
- `lib/`
- `db/`

### `npm run format`

使用專案設定格式化程式碼。

執行前應先確認目前 Git 變更，避免一次修改不相關的檔案。

### `npm run db:generate`

依照 `db/schema.ts` 產生 Drizzle 資料庫遷移。

產生後必須人工檢查 SQL 內容。

### `npm run test:access`

執行檔案及權限測試。

測試內容包含：

- 不同使用者身分
- 檔案上傳及下載
- 檔案替換
- 連結及資料夾
- 指定成員共享
- 可檢視及可編輯權限
- 資料夾權限繼承
- 沒有權限時的阻擋
- 檔案及連結專區
- 搜尋
- 版本紀錄
- 移動
- 垃圾桶
- 還原
- 永久刪除
- 批次操作
- ZIP 下載
- CSRF 驗證

測試使用本機 D1 及 R2，不會修改正式網站資料。

### `npm run test:auth`

執行獨立帳號及 SMTP 測試。

測試內容包含：

- 學校信箱網域限制
- 註冊驗證信
- 設定顯示名稱
- 設定獨立密碼
- 密碼長度限制
- 密碼登入
- 忘記密碼
- 密碼重設
- 舊密碼失效
- 舊登入工作階段撤銷
- 舊 Google 帳號資料保留
- SMTP 寄送失敗處理
- 登入頻率限制
- 權杖過期及重複使用阻擋

此測試會啟動本機 SMTP 測試伺服器，不會寄送真正的電子郵件。

### `npm audit --omit=dev`

檢查正式環境套件是否有已知安全漏洞。

## 建議檢查順序

修改雲端程式後，依序執行：

```powershell
npm run lint
npm run build
npm run test:access
npm run test:auth
npm audit --omit=dev
```

如果只修改文件，不需要執行完整程式測試。

如果修改資料庫結構、權限、登入、寄信或檔案處理，必須執行相關測試。

## 儲存及下載限制

### 單一檔案

- 單一檔案大小上限為 100 MB
- 此限制來自目前雲端平台的單次 HTTP 請求上限
- 程式沒有設定每位使用者的總容量上限

### 批次操作

- 每次最多選取 500 個項目

### ZIP 下載

單次 ZIP 下載上限為：

- 總容量 512 MB
- 最多 10,000 個檔案及資料夾項目

超過限制時，需要分批下載。

### 總儲存容量

程式本身沒有設定：

- 每位使用者的容量上限
- 每個資料夾的容量上限
- 整個檔案庫的容量上限

實際容量及費用由 Cloudflare D1、R2 及網站方案決定。

## 正式環境需求

正式環境需要：

- OpenAI Sites／Cloudflare Workers 執行環境
- Cloudflare D1 資料庫
- 非公開的 Cloudflare R2 Bucket
- 正確的 `DB` 及 `FILES` 綁定
- HTTPS 網址
- 安全且獨立的 `SESSION_SECRET`
- 正確的學校信箱網域
- 正確的管理員信箱
- 與正式網址一致的 `APP_URL`
- 完成資料庫遷移
- 完成登入及權限測試
- 定期備份 D1 資料
- 定期確認 R2 檔案及版本資料
- 定期檢查套件安全性

如果啟用 Google 登入，還需要：

- Google OAuth 網頁應用程式
- 正確的 Google OAuth 重新導向網址
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

如果啟用獨立登入，還需要：

- 完成驗證的 Brevo 帳號
- 完成驗證的寄件者信箱
- Brevo SMTP 登入帳號
- Brevo SMTP key
- 實際測試註冊及忘記密碼郵件

## 與 Debian 部署的差異

`cloud/` 是 Cloudflare Workers 版本，不使用：

- Nginx
- PM2
- PostgreSQL
- 主機本機檔案系統

Debian 12、Nginx、PM2 及 PostgreSQL 的部署方式屬於另一套正式主機架構，應記錄於獨立的部署與維護手冊，不應直接套用本文件中的 Cloudflare 指令。
