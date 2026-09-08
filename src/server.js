import { app } from "./app.js";
import { config } from "./config.js";

app.listen(config.port, config.host, () => {
  console.log(`T-Files 已啟動：${config.appUrl}`);
  if (!process.env.SESSION_SECRET) console.warn("開發模式目前使用暫時的 SESSION_SECRET；重新啟動後需重新登入。");
  if (!config.smtp.host) console.warn("SMTP 尚未設定；忘記密碼連結會顯示在此執行視窗。仍會對網頁使用者顯示相同回應。 ");
});
