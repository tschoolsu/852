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
  consumePasswordReset,
  createPasswordReset,
  createSession,
  createOAuthRegistrationState,
  consumeOAuthRegistrationState,
  createVerifiedRegistration,
  getVerifiedRegistration,
  createUserFromVerifiedRegistration,
  deleteSession,
  getSession,
  getUserByEmail,
  getValidPasswordReset,
  listPendingUsers,
} from "./db.js";
import {
  createOpaqueToken,
  hashPassword,
  hashToken,
  isAllowedSchoolEmail,
  normalizeEmail,
  safeEqualText,
  signSessionToken,
  validatePassword,
  verifyPassword,
} from "./lib/security.js";
import { removeTempFile } from "./storage.js";
import { resourceRouter } from "./resources-router.js";
import { sendPasswordResetEmail } from "./mail.js";
import { createGoogleRegistrationRequest,googleRegistrationReady,verifyGoogleRegistration } from "./google-registration.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const dummyPasswordHash = await hashPassword(createOpaqueToken());

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
    registered: "註冊完成，現在可以登入。",
    pending: "註冊完成，帳號正在等待管理員審核。",
    created: "已新增到檔案庫。",
    access: "存取權限已更新。",
    updated: "修改已儲存。",
    approved: "帳號已核准。",
    reset_sent: "若帳號存在，我們已寄出重設密碼說明。",
    reset_done: "密碼已更新，請重新登入。",
    already_registered: "這個學校帳號已經註冊，請直接登入。",
    registration_expired: "Google 驗證已逾時，請重新開始註冊。",
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

app.get("/login", (req, res) => {
  if (req.user) return res.redirect(res.locals.nextPath);
  renderAuth(res, "login");
});

app.post("/login", authLimiter, requireCsrf, async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const user = getUserByEmail(email);
  const passwordOk = await verifyPassword(String(req.body.password || ""), user?.password_hash || dummyPasswordHash);

  if (!user || !passwordOk) {
    audit(user?.id, "auth.login_failed", "user", user?.id, {});
    return renderAuth(res.status(401), "login", { error: "電子郵件或密碼不正確。", values: { email } });
  }
  if (user.status === "pending") {
    return renderAuth(res.status(403), "login", { error: "帳號仍在等待管理員審核。", values: { email } });
  }
  if (user.status !== "active") {
    return renderAuth(res.status(403), "login", { error: "這個帳號目前無法使用。", values: { email } });
  }

  const rawToken = createOpaqueToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  createSession({
    tokenHash: signSessionToken(rawToken, config.sessionSecret),
    userId: user.id,
    csrfToken: createOpaqueToken(24),
    expiresAt,
  });
  res.cookie("tfiles_session", rawToken, cookieOptions(7 * 24 * 60 * 60 * 1000));
  res.clearCookie("tfiles_csrf", { path: "/" });
  audit(user.id, "auth.login_succeeded", "user", user.id, {});
  res.redirect(res.locals.nextPath);
});

app.post("/logout", requireAuth, requireCsrf, (req, res) => {
  const rawToken = req.cookies.tfiles_session;
  if (rawToken) deleteSession(signSessionToken(rawToken, config.sessionSecret));
  audit(req.user.id, "auth.logout", "user", req.user.id, {});
  res.clearCookie("tfiles_session", { path: "/" });
  res.redirect("/login");
});

app.get("/register", (req, res) => {
  if (req.user) return res.redirect("/app");
  renderAuth(res, "register", { googleReady:googleRegistrationReady() });
});

app.get("/auth/google/register",authLimiter,async (req,res) => {
  if (req.user) return res.redirect("/app");
  if (!googleRegistrationReady()) return renderAuth(res.status(503),"register",{
    googleReady:false,error:"Google 學校帳號驗證尚未完成設定，請聯絡管理員。",
  });
  const state = createOpaqueToken();
  const nonce = createOpaqueToken();
  const request = await createGoogleRegistrationRequest({ state,nonce });
  createOAuthRegistrationState({ stateHash:hashToken(state),codeVerifier:request.codeVerifier,nonce,
    expiresAt:new Date(Date.now()+10*60*1000).toISOString() });
  res.cookie("tfiles_oauth_state",state,cookieOptions(10*60*1000));
  res.redirect(request.url);
});

app.get("/auth/google/callback",authLimiter,async (req,res) => {
  const state = String(req.query.state || "");
  const expectedState = req.cookies.tfiles_oauth_state;
  res.clearCookie("tfiles_oauth_state",{ path:"/" });
  if (req.query.error || !state || !expectedState || !safeEqualText(state,expectedState)) {
    return renderAuth(res.status(400),"register",{ googleReady:googleRegistrationReady(),
      error:req.query.error === "access_denied" ? "你已取消 Google 帳號驗證。" : "Google 驗證要求已失效，請重新開始。" });
  }
  const pending = consumeOAuthRegistrationState(hashToken(state));
  if (!pending || !req.query.code) return renderAuth(res.status(400),"register",{
    googleReady:googleRegistrationReady(),error:"Google 驗證要求已失效，請重新開始。",
  });
  try {
    const profile = await verifyGoogleRegistration({ code:String(req.query.code),codeVerifier:pending.code_verifier,nonce:pending.nonce });
    if (getUserByEmail(profile.email)) return renderAuth(res.status(409),"register",{
      googleReady:googleRegistrationReady(),error:"這個學校帳號已經註冊，請直接登入。",
    });
    const registrationToken = createOpaqueToken();
    createVerifiedRegistration({ tokenHash:hashToken(registrationToken),...profile,
      expiresAt:new Date(Date.now()+15*60*1000).toISOString() });
    res.cookie("tfiles_registration",registrationToken,cookieOptions(15*60*1000));
    audit(null,"auth.google_registration_verified",null,null,{ domain:config.allowedEmailDomain });
    res.redirect("/register/complete");
  } catch (error) {
    console.warn("Google registration verification failed:",error.message);
    return renderAuth(res.status(400),"register",{ googleReady:googleRegistrationReady(),
      error:"無法驗證這個 Google 學校帳號，請確認帳號屬於學校網域後重試。" });
  }
});

app.get("/register/complete",(req,res) => {
  if (req.user) return res.redirect("/app");
  const verified = getVerifiedRegistration(hashToken(req.cookies.tfiles_registration || ""));
  if (!verified) return res.redirect("/register?notice=registration_expired");
  renderAuth(res,"register-complete",{ verified });
});

app.post("/register/complete",authLimiter,requireCsrf,async (req,res) => {
  const registrationToken = req.cookies.tfiles_registration || "";
  const tokenHash = hashToken(registrationToken);
  const verified = getVerifiedRegistration(tokenHash);
  if (!verified) return renderAuth(res.status(400),"register",{ googleReady:googleRegistrationReady(),
    error:"Google 驗證已逾時，請重新開始註冊。" });
  const password = String(req.body.password || "");
  const passwordError = validatePassword(password);
  if (passwordError) return renderAuth(res.status(400),"register-complete",{ error:passwordError,verified });
  if (password !== String(req.body.passwordConfirm || "")) {
    return renderAuth(res.status(400),"register-complete",{ error:"兩次輸入的密碼不同。",verified });
  }
  const status = config.registrationMode === "approval" ? "pending" : "active";
  const result = createUserFromVerifiedRegistration({ tokenHash,id:randomUUID(),passwordHash:await hashPassword(password),
    role:config.adminEmails.has(verified.email) ? "admin" : "member",status });
  res.clearCookie("tfiles_registration",{ path:"/" });
  if (result.outcome === "exists") return res.redirect("/login?notice=already_registered");
  if (result.outcome !== "created") return res.redirect("/register?notice=registration_expired");
  audit(result.user.id,"auth.registered","user",result.user.id,{ status,identityProvider:"google" });
  res.redirect(`/login?notice=${status === "active" ? "registered" : "pending"}`);
});

app.get("/forgot-password", (_req, res) => renderAuth(res, "forgot-password"));

app.post("/forgot-password", authLimiter, requireCsrf, async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const user = getUserByEmail(email);
  if (user && user.status === "active") {
    const rawToken = createOpaqueToken();
    createPasswordReset({
      tokenHash: hashToken(rawToken),
      userId: user.id,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    });
    setImmediate(async () => {
      try {
        await sendPasswordResetEmail({
        to: user.email,
        displayName: user.display_name,
        resetUrl: `${config.appUrl}/reset-password/${rawToken}`,
        });
        audit(user.id, "auth.password_reset_requested", "user", user.id, {});
      } catch (error) {
        console.error("Password reset email failed:", error.message);
      }
    });
  }
  res.redirect("/forgot-password?notice=reset_sent");
});

app.get("/reset-password/:token", (req, res) => {
  const reset = getValidPasswordReset(hashToken(req.params.token));
  if (!reset) {
    return res.status(400).render("error", { title: "連結無效", message: "重設連結已失效，請重新申請。" });
  }
  renderAuth(res, "reset-password", { token: req.params.token });
});

app.post("/reset-password/:token", authLimiter, requireCsrf, async (req, res) => {
  const tokenHash = hashToken(req.params.token);
  const reset = getValidPasswordReset(tokenHash);
  if (!reset) {
    return res.status(400).render("error", { title: "連結無效", message: "重設連結已失效，請重新申請。" });
  }
  const password = String(req.body.password || "");
  const passwordError = validatePassword(password);
  if (passwordError) return renderAuth(res.status(400), "reset-password", { error: passwordError, token: req.params.token });
  if (password !== String(req.body.passwordConfirm || "")) {
    return renderAuth(res.status(400), "reset-password", { error: "兩次輸入的密碼不同。", token: req.params.token });
  }
  await consumePasswordReset(tokenHash, await hashPassword(password));
  audit(reset.user_id, "auth.password_reset_completed", "user", reset.user_id, {});
  res.redirect("/login?notice=reset_done");
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
