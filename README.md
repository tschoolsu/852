# T-Files 學生會檔案管理系統

正式網站：[file.tschoolsu.org](https://file.tschoolsu.org/)

T-Files 供 TSchool 學生會成員整理檔案、連結與資料夾。只有 `@tschool.tp.edu.tw` 學校信箱可註冊；本服務使用獨立密碼與工作階段，不使用 T-Pass 或 Google 登入。

系統支援多檔上傳、資料夾、連結、搜尋、檔案與連結專區、共享權限、垃圾桶、版本紀錄和管理員檢視。登入成員可看項目的基本資料；開啟或修改內容時，伺服器會檢查擁有者與共享權限。

## 專案結構

| 路徑 | 用途 |
| --- | --- |
| `src/app/` | Next.js 頁面與 API |
| `src/lib/` | 獨立登入、存取權、郵件與 PostgreSQL／檔案儲存 |
| `src/config/file.ts` | 部署前必填的環境變數清單 |
| `prisma/migrations/` | PostgreSQL 結構的版本遷移 |
| `postgres/` | 原始 PostgreSQL 結構參考 |
| `ops/` | 備份、Nginx 和系統服務設定 |
| `scripts/` | 驗收與回歸測試 |

部署服務名稱為 `file`，Repo 與主機目錄為 `tpass-file`，由 Nginx 轉送至本機 `127.0.0.1:3005`，PM2 執行 `ecosystem.config.js`。PostgreSQL 保存帳號與中繼資料；上傳檔案放在由 `FILE_STORAGE_PATH` 指向的私有目錄。真實設定寫在不進 Git 的 `.env.local`。

## 開發與檢查

使用 Node.js 24 與 pnpm 10.27.0。複製 `.env.example` 為 `.env.local`，填入開發環境的資料庫、檔案目錄與 SMTP 設定，再執行：

```bash
pnpm install --frozen-lockfile
pnpm exec prisma migrate deploy
pnpm dev
```

提交前執行 `pnpm lint`、`pnpm typecheck`、`pnpm build`。`pnpm test:admin` 與 `pnpm test:security` 只可使用各自指定的拋棄式 PostgreSQL 資料庫，不可指向正式資料庫。

正式部署由 TSchool 的服務註冊表與維運部署工具管理。遷移既有主機時，先備份資料庫和私有檔案，確認 `.env.local`、資料庫遷移、PM2、Nginx 與備份服務，再切換程序；不要重設或清空既有資料。

安全設計與漏洞回報見 [SECURITY.md](./SECURITY.md)。[初版 README](./docs/archive/初版README.md) 與 [舊版部署文件](./docs/archive/舊版部署與維護手冊.md) 保留作歷史參考，內容不適用於現行部署。
