# T-Files 資安政策

本專案以 OWASP ASVS 5.0 與 OWASP Cheat Sheet Series 作為基準。這份文件描述目前已實作的控制、營運要求與仍需在正式上線前完成的工作；它不是第三方資安認證。

## 帳號與密碼

- 僅接受完整網域為 `tschool.tp.edu.tw` 的電子郵件，不接受相似或子網域字串混淆。
- 註冊透過 Google OpenID Connect 驗證帳號簽章、audience、nonce、已驗證信箱及 Google Workspace `hd` 網域；顯示名稱直接取自 Google `name` 宣告。
- OAuth 授權碼流程使用 PKCE、一次性隨機 `state` 與 HttpOnly SameSite Cookie 防止授權碼攔截及登入 CSRF。驗證完成後不保存 Google access token 或 refresh token。
- 密碼長度依專案要求為 8–128 個字元，註冊與重設密碼使用相同規則，允許 Unicode、空格及所有符號，不要求固定組合。此長度設定是專案例外，並未符合 OWASP 對未啟用 MFA 時至少 15 字元的建議。
- 密碼使用 Node.js `scrypt` 搭配每筆獨立隨機鹽值儲存，不保存明文。
- 登入與忘記密碼端點有速率限制；登入不存在的帳號時仍執行密碼雜湊驗證，以降低帳號枚舉風險。
- 忘記密碼頁對存在與不存在的帳號顯示相同訊息。重設權杖以密碼學安全亂數產生、資料庫只保存雜湊值、30 分鐘到期且只能使用一次。
- 密碼重設完成後，所有既有登入工作階段都會失效，使用者必須重新登入。

參考：[OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)、[OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)。

## 工作階段與請求保護

- 工作階段 ID 使用 256 位元安全亂數產生，資料庫只保存經伺服器密鑰 HMAC 處理的值。
- Cookie 使用 `HttpOnly`、`SameSite=Lax`；正式環境強制 `Secure`。
- 登入後建立全新的工作階段，登出會從伺服器端刪除；工作階段預設 7 天到期。
- 所有會改變資料的表單都驗證 CSRF 權杖。
- 使用 Helmet 設定 Content Security Policy、禁止 iframe 嵌入、MIME sniffing 及 Referrer 洩漏。
- 正式環境必須使用 HTTPS。

參考：[OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)。

## 檔案與存取控制

- 所有權限在伺服器端逐次驗證；隱藏按鈕不被視為安全控制。
- 未知或錯誤的權限值會安全地降級為「僅自己」。
- 使用者提供的檔名只作為下載名稱；實際儲存鍵為隨機 UUID。
- 本機檔案放在網站公開目錄之外。正式環境可存於不公開的 S3/R2 Bucket。
- 檔案只透過已驗證權限的下載處理器傳送，並強制使用附件下載及 `X-Content-Type-Options: nosniff`，不在網站內執行或預覽。
- 系統業務需求允許任意檔案格式，因此沒有採用副檔名白名單。這是與 OWASP 一般上傳建議不同的明確風險決策；隔離儲存與強制下載用來降低風險。
- 檔案庫沒有總容量配額。單檔預設限制 1 GiB，避免磁碟耗盡型阻斷服務，可由環境設定調整。

參考：[OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)、[OWASP ASVS 5.0 File Upload and Content](https://cornucopia.owasp.org/taxonomy/asvs-5.0/05-file-handling/02-file-upload-and-content)。

## 資料處理與紀錄

- SQL 查詢一律使用參數化敘述。
- EJS 預設 HTML 編碼用於所有使用者輸入；連結只接受 `http` 與 `https`。
- 稽核紀錄包含登入成功／失敗、登出、註冊、密碼重設、上傳、下載、建立連結、權限修改及帳號核准。
- 稽核紀錄不保存密碼、工作階段權杖、重設權杖或 SMTP 憑證。
- `.env`、資料庫與上傳檔案不得提交到 Git。

## 正式上線前必做

1. 設定 HTTPS、長度足夠且唯一的 `SESSION_SECRET`，並確認反向代理設定正確。
2. 設定 SMTP 專用帳號與應用程式密碼，測試寄送及退信處理。
3. 使用私有 S3/R2 Bucket，將金鑰限制在單一 Bucket 所需的最小權限，並設定金鑰輪替程序。
4. 對 SQLite 資料庫、稽核紀錄及檔案中繼資料建立加密備份與還原演練。
5. 接入防毒或沙箱掃描服務；掃描完成前將新上傳檔案標記為不可下載。任意格式上傳在沒有惡意程式掃描時仍有剩餘風險。
6. 在 Google Cloud 完成 OAuth 品牌、用戶端與正式 HTTPS 重新導向 URI 設定；用戶端密鑰只放在部署環境的秘密設定。
7. 為管理員帳號加入 MFA。高權限帳號只靠密碼仍有憑證遭竊風險。
8. 設定監控、磁碟及雲端費用告警，定期檢查稽核紀錄和相依套件漏洞。
9. 進行獨立滲透測試，特別驗證 IDOR、權限變更、上傳繞過、CSRF、工作階段固定與密碼重設流程。

## 漏洞回報與應變

發現疑似漏洞時，不要在公開 Issue 張貼個資、權杖、密碼或可直接利用的細節。先停用受影響功能或憑證、保存必要稽核紀錄，通知學生會數位部負責人，再以私密管道提供重現步驟。

確認事件後應立即撤銷外洩工作階段或金鑰、修補根因、檢查是否有未授權存取、通知受影響使用者，並留下不含敏感資料的事件紀錄與改善項目。
