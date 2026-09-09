import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import multer from "multer";
import { rateLimit } from "express-rate-limit";
import { config } from "./config.js";
import {
  approveUser,
  audit,
  createSession,
  createOAuthRegistrationState,
  consumeOAuthRegistrationState,
  deleteSession,
  getSession,
  listPendingUsers,
  signInWithGoogle,
} from "./db.js";
import {
  createOpaqueToken,
  hashPassword,
  hashToken,
  isAllowedSchoolEmail,
  safeEqualText,
  signSessionToken,
} from "./lib/security.js";
import { removeTempFile } from "./storage.js";
import { resourceRouter } from "./resources-router.js";
import { createGoogleRegistrationRequest,googleRegistrationReady,verifyGoogleRegistration } from "./google-registration.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const googleOnlyPasswordHash = await hashPassword(createOpaqueToken(48));
if (config.trustProxy) app.set("trust proxy", 1);
app.disable("x-powered-by");
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        styleSrc: ["'self'"],
        scriptSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: config.isProduction ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: "no-referrer" },
  }),
);
app.use(express.urlencoded({ extended: false, limit: "32kb" }));
app.use(cookieParser());
app.use("/static", express.static(path.join(__dirname, "public"), { maxAge: config.isProduction ? "7d" : 0 }));
app.use((_req,res,next) => {
  res.setHeader("Cache-Control","no-store");
  next();
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: "嘗試次數過多，請稍後再試。",
});

function cookieOptions(maxAge) {
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "lax",
    path: "/",
    maxAge,
  };
}

function oauthStates(req) {
  return String(req.cookies.tfiles_oauth_states || "").split(".")
    .filter(value => /^[A-Za-z0-9_-]{43}$/.test(value)).slice(-5);
}

function setOAuthStates(res,states) {
  if (states.length) res.cookie("tfiles_oauth_states",states.slice(-5).join("."),cookieOptions(10*60*1000));
  else res.clearCookie("tfiles_oauth_states",{ path:"/" });
}

function startSession(res,user) {
  const rawToken = createOpaqueToken();
  createSession({
    tokenHash: signSessionToken(rawToken, config.sessionSecret),
    userId: user.id,
    csrfToken: createOpaqueToken(24),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });
  res.cookie("tfiles_session", rawToken, cookieOptions(7 * 24 * 60 * 60 * 1000));
  res.clearCookie("tfiles_csrf", { path: "/" });
}

app.use((req, res, next) => {
  const rawSessionToken = req.cookies.tfiles_session;
  if (rawSessionToken) {
    const tokenHash = signSessionToken(rawSessionToken, config.sessionSecret);
    const session = getSession(tokenHash);
    if (session && session.status === "active" && isAllowedSchoolEmail(session.email,config.allowedEmailDomain)) {
      req.sessionRecord = session;
      req.user = {
        id: session.user_id,
        email: session.email,
        displayName: session.display_name,
        role: session.role,
      };
      res.locals.csrfToken = session.csrf_token;
    }
  }

  if (!res.locals.csrfToken) {
    let csrfToken = req.cookies.tfiles_csrf;
    if (!csrfToken || csrfToken.length < 32) {
      csrfToken = createOpaqueToken(24);
      res.cookie("tfiles_csrf", csrfToken, cookieOptions(2 * 60 * 60 * 1000));
    }
    res.locals.csrfToken = csrfToken;
  }

  res.locals.user = req.user || null;
  res.locals.registrationMode = config.registrationMode;
  res.locals.allowedEmailDomain = config.allowedEmailDomain;
  res.locals.notice = noticeFromQuery(req.query.notice);
  res.locals.nextPath = safeNext(req.body?.next || req.query.next);
  res.locals.formatBytes = formatBytes;
  res.locals.formatDate = (value) => new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium" }).format(new Date(value));
  next();
});

function formatBytes(bytes) {
  if (!Number.isFinite(Number(bytes))) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Number(bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function noticeFromQuery(key) {
  const messages = {
    created: "已新增到檔案庫。",
    access: "存取權限已更新。",
    updated: "修改已儲存。",
    approved: "帳號已核准。",
    signed_out: "你已安全登出。",
  };
  return messages[String(key || "")] || "";
}

async function requireCsrf(req, res, next) {
  const expected = req.sessionRecord?.csrf_token || req.cookies.tfiles_csrf;
  if (!expected || !req.body?._csrf || !safeEqualText(expected, req.body._csrf)) {
    await removeTempFile(req.file?.path);
    return res.status(403).render("error", { title: "要求已失效", message: "請回到上一頁重新操作。" });
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(safeNext(req.originalUrl))}`);
  next();
}

function safeNext(value) {
  return typeof value === "string" && /^\/(?:s\/[A-Za-z0-9_-]{43}|resources\/[0-9a-f-]{36}(?:\/edit|\/download)?|app|uploads)$/.test(value) ? value : "/app";
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.redirect("/login");
  if (req.user.role !== "admin") {
    return res.status(403).render("error", { title: "無法存取", message: "這個頁面僅限管理員使用。" });
  }
  next();
}

function renderAuth(res, view, values = {}) {
  return res.render(view, { error: "", values: {}, ...values });
}

app.get("/", (req, res) => res.redirect(req.user ? "/app" : "/login"));
app.get("/healthz", (_req, res) => res.status(200).type("text/plain").send("ok"));

app.get("/login", (req, res) => {
  if (req.user) return res.redirect(res.locals.nextPath);
  renderAuth(res, "login",{ googleReady:googleRegistrationReady() });
});

app.post("/login", (_req,res) => res.status(410).redirect("/login"));

app.post("/logout", requireAuth, requireCsrf, (req, res) => {
  const rawToken = req.cookies.tfiles_session;
  if (rawToken) deleteSession(signSessionToken(rawToken, config.sessionSecret));
  audit(req.user.id, "auth.logout", "user", req.user.id, {});
  res.clearCookie("tfiles_session", { path: "/" });
  res.redirect("/login?notice=signed_out");
});

app.get("/register", (_req,res) => res.redirect("/login"));
app.get("/register/complete", (_req,res) => res.redirect("/login"));
app.post("/register/complete", (_req,res) => res.status(410).redirect("/login"));
app.get("/forgot-password", (_req,res) => res.redirect("/login"));
app.post("/forgot-password", (_req,res) => res.status(410).redirect("/login"));
app.get("/reset-password/:token", (_req,res) => res.redirect("/login"));
app.post("/reset-password/:token", (_req,res) => res.status(410).redirect("/login"));

app.get("/auth/google/register",(req,res) => res.redirect(`/auth/google?next=${encodeURIComponent(res.locals.nextPath)}`));
app.get("/auth/google",authLimiter,async (req,res) => {
  if (req.user) return res.redirect("/app");
  if (!googleRegistrationReady()) return renderAuth(res.status(503),"login",{
    googleReady:false,error:"Google 學校帳號登入尚未完成設定，請聯絡管理員。",
  });
  const state = createOpaqueToken();
  const nonce = createOpaqueToken();
  const request = await createGoogleRegistrationRequest({ state,nonce });
  createOAuthRegistrationState({ stateHash:hashToken(state),codeVerifier:request.codeVerifier,nonce,
    expiresAt:new Date(Date.now()+10*60*1000).toISOString(),nextPath:res.locals.nextPath });
  setOAuthStates(res,[...oauthStates(req),state]);
  res.redirect(request.url);
});

app.get("/auth/google/callback",authLimiter,async (req,res) => {
  const state = String(req.query.state || "");
  const knownStates = oauthStates(req);
  const expectedState = knownStates.find(value => safeEqualText(value,state));
  setOAuthStates(res,knownStates.filter(value => value !== expectedState));
  if (!state || !expectedState) {
    return renderAuth(res.status(400),"login",{ googleReady:googleRegistrationReady(),
      error:"Google 登入要求已失效，請重新開始。" });
  }
  const pending = consumeOAuthRegistrationState(hashToken(state));
  if (req.query.error) return renderAuth(res.status(400),"login",{ googleReady:googleRegistrationReady(),
    error:req.query.error === "access_denied" ? "你已取消 Google 登入。" : "Google 登入沒有完成，請重新嘗試。" });
  if (!pending || !req.query.code) return renderAuth(res.status(400),"login",{
    googleReady:googleRegistrationReady(),error:"Google 登入要求已失效，請重新開始。",
  });
  try {
    const profile = await verifyGoogleRegistration({ code:String(req.query.code),codeVerifier:pending.code_verifier,nonce:pending.nonce });
    const status = config.registrationMode === "approval" ? "pending" : "active";
    const result = signInWithGoogle({ id:randomUUID(),...profile,status,
      passwordHash:googleOnlyPasswordHash });
    if (result.outcome === "conflict") return renderAuth(res.status(409),"login",{
      googleReady:googleRegistrationReady(),error:"這個學校帳號的身分資料與既有帳號不一致，請聯絡管理員。",
    });
    if (result.user.status === "pending") return renderAuth(res.status(403),"login",{
      googleReady:googleRegistrationReady(),error:"帳號正在等待管理員審核。",
    });
    if (result.user.status !== "active") return renderAuth(res.status(403),"login",{
      googleReady:googleRegistrationReady(),error:"這個帳號目前無法使用。",
    });
    startSession(res,result.user);
    audit(result.user.id,result.outcome === "created" ? "auth.google_account_created" : "auth.google_login_succeeded",
      "user",result.user.id,{ domain:config.allowedEmailDomain });
    res.redirect(safeNext(pending.next_path));
  } catch (error) {
    console.warn("Google sign-in verification failed:",error.message);
    return renderAuth(res.status(400),"login",{ googleReady:googleRegistrationReady(),
      error:"無法驗證這個 Google 學校帳號，請確認帳號屬於學校網域後重試。" });
  }
});

app.use(resourceRouter({ requireAuth, requireCsrf }));

app.get("/admin/users", requireAdmin, (req, res) => {
  res.render("admin-users", { pendingUsers: listPendingUsers() });
});

app.post("/admin/users/:id/approve", requireAdmin, requireCsrf, (req, res) => {
  approveUser(req.params.id);
  audit(req.user.id, "admin.user_approved", "user", req.params.id, {});
  res.redirect("/admin/users?notice=approved");
});

app.use((_req, res) => res.status(404).render("error", { title: "找不到頁面", message: "這個網址不存在。" }));

app.use((error, req, res, _next) => {
  if (!error.publicMessage) console.error(error);
  if (req.file?.path) removeTempFile(req.file.path).catch(() => {});
  if (res.headersSent) return res.destroy();
  if (error.publicMessage) return res.status(error.status || 400).render("error", { title: error.status === 409 ? "項目已更新" : "無法完成操作",message: error.publicMessage });
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    return res.status(413).render("error", {
      title: "檔案過大",
      message: `單一檔案目前最多 ${formatBytes(config.maxUploadBytes)}。這不影響檔案庫的總容量。`,
    });
  }
  res.status(500).render("error", { title: "發生錯誤", message: "系統暫時無法完成操作，請稍後再試。" });
});

export { app };
