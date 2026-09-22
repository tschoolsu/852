# T-Files 開發約定

- 這是單一 Next.js 服務。正式程式在 Repo 根目錄的 `src/`；不要另建一套 `cloud/` 或 Express 入口。
- 保留學校信箱加獨立密碼的登入方式。不要接入 T-Pass SSO 或 Google OAuth。變更登入、工作階段與權限前，先確認既有帳號 ID、檔案擁有者和共享資料能保留。
- 使用 pnpm 10.27.0 與提交的 `pnpm-lock.yaml`。不要提交 npm 或 yarn 鎖檔。
- 共用按鈕、輸入欄位與色彩取自 `tpass-ui`；保留現有操作流程與按鈕位置，畫面採淺色與 OKLCH 色值。
- PostgreSQL 結構變動需增加 Prisma migration；不可清空正式資料庫。上傳檔案始終存放於 `FILE_STORAGE_PATH` 指向的私有目錄。
- 新環境變數同時更新 `src/config/file.ts` 的 `REQUIRED`（如果必填）與 `.env.example`；真值只放 `.env.local`，不要提交密鑰或備份。
- 修改後執行 `pnpm lint`、`pnpm typecheck`、`pnpm build`，並對相關功能使用拋棄式資料庫驗收。部署前確認備份與回復方式。
