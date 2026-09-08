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
  createResource,
  createSession,
  createUser,
  deleteSession,
  getResourceById,
  getResourceMemberIds,
  getSession,
  getUserByEmail,
  getValidPasswordReset,
  listAccessibleResources,
  listActiveUsers,
  listPendingUsers,
  updateResourceAccess,
  userCanAccessResource,
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
import { normalizeAccessLevel } from "./lib/access.js";
import { getObjectStream, removeTempFile, storeUploadedFile, tempDir } from "./storage.js";
import { sendPasswordResetEmail } from "./mail.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({ dest: tempDir, preservePath: false, limits: { fileSize: config.maxUploadBytes, files: 1 } });
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
    if (session && session.status === "active") {
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
    approved: "帳號已核准。",
    reset_sent: "若帳號存在，我們已寄出重設密碼說明。",
    reset_done: "密碼已更新，請重新登入。",
  };
  return messages[String(key || "")] || "";
}

function requireCsrf(req, res, next) {
  const expected = req.sessionRecord?.csrf_token || req.cookies.tfiles_csrf;
  if (!safeEqualText(expected, req.body?._csrf)) {
    return res.status(403).render("error", { title: "要求已失效", message: "請回到上一頁重新操作。" });
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.redirect("/login");
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.redirect("/login");
  if (req.user.role !== "admin") {
    return res.status(403).render("error", { title: "無法存取", message: "這個頁面僅限管理員使用。" });
  }
  next();
}

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function selectedMemberIds(req, ownerId) {
  const requested = Array.isArray(req.body.memberIds)
    ? req.body.memberIds
    : req.body.memberIds
      ? [req.body.memberIds]
      : [];
  const allowed = new Set(listActiveUsers(ownerId).map((user) => user.id));
  return [...new Set(requested.filter((id) => allowed.has(id)))];
}

function renderAuth(res, view, values = {}) {
  return res.render(view, { error: "", values: {}, ...values });
}

app.get("/", (req, res) => res.redirect(req.user ? "/app" : "/login"));

app.get("/login", (req, res) => {
  if (req.user) return res.redirect("/app");
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
  res.redirect("/app");
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
  renderAuth(res, "register");
});

app.post("/register", authLimiter, requireCsrf, async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const displayName = cleanText(req.body.displayName, 80);
  const password = String(req.body.password || "");
  const values = { email, displayName };

  if (!isAllowedSchoolEmail(email, config.allowedEmailDomain)) {
    return renderAuth(res.status(400), "register", {
      error: `只能使用 @${config.allowedEmailDomain} 學校帳號註冊。`,
      values,
    });
  }
  if (displayName.length < 2) {
    return renderAuth(res.status(400), "register", { error: "請輸入至少 2 個字的顯示名稱。", values });
  }
  const passwordError = validatePassword(password);
  if (passwordError) return renderAuth(res.status(400), "register", { error: passwordError, values });
  if (password !== String(req.body.passwordConfirm || "")) {
    return renderAuth(res.status(400), "register", { error: "兩次輸入的密碼不同。", values });
  }
  if (getUserByEmail(email)) {
    return renderAuth(res.status(409), "register", { error: "這個電子郵件已經註冊。", values });
  }

  const status = config.registrationMode === "approval" ? "pending" : "active";
  const role = config.adminEmails.has(email) ? "admin" : "member";
  const user = createUser({
    id: randomUUID(),
    email,
    displayName,
    passwordHash: await hashPassword(password),
    role,
    status,
  });
  audit(user.id, "auth.registered", "user", user.id, { status });
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

app.get("/app", requireAuth, (req, res) => {
  const search = cleanText(req.query.q, 100);
  const resources = listAccessibleResources(req.user.id, search);
  res.render("dashboard", {
    resources,
    members: listActiveUsers(req.user.id),
    search,
    uploadError: "",
    activePanel: String(req.query.panel || "") === "link" ? "link" : "file",
  });
});

app.post("/resources/files", requireAuth, upload.single("file"), requireCsrf, async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).render("error", { title: "沒有收到檔案", message: "請選擇一個檔案後再上傳。" });
    }
    const accessLevel = normalizeAccessLevel(req.body.accessLevel);
    const title = cleanText(req.body.title, 160) || cleanText(req.file.originalname, 160) || "未命名檔案";
    const resourceId = randomUUID();
    const storageKey = randomUUID();
    const members = accessLevel === "selected" ? selectedMemberIds(req, req.user.id) : [];
    await storeUploadedFile(req.file.path, storageKey, req.file.mimetype || "application/octet-stream", req.file.size);
    createResource(
      {
        id: resourceId,
        kind: "file",
        title,
        description: cleanText(req.body.description, 500),
        storageKey,
        originalName: cleanText(req.file.originalname, 255) || "download",
        mimeType: cleanText(req.file.mimetype, 150) || "application/octet-stream",
        sizeBytes: req.file.size,
        ownerId: req.user.id,
        accessLevel,
      },
      members,
    );
    audit(req.user.id, "resource.file_created", "resource", resourceId, { accessLevel });
    res.redirect("/app?notice=created");
  } catch (error) {
    await removeTempFile(req.file?.path);
    next(error);
  }
});

app.post("/resources/links", requireAuth, requireCsrf, (req, res) => {
  const title = cleanText(req.body.title, 160);
  let parsedUrl;
  try {
    parsedUrl = new URL(String(req.body.url || ""));
    if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error("INVALID_PROTOCOL");
  } catch {
    return res.status(400).render("error", { title: "連結格式不正確", message: "請輸入以 http:// 或 https:// 開頭的網址。" });
  }
  if (!title) {
    return res.status(400).render("error", { title: "缺少標題", message: "請輸入這個連結的名稱。" });
  }
  const accessLevel = normalizeAccessLevel(req.body.accessLevel);
  const members = accessLevel === "selected" ? selectedMemberIds(req, req.user.id) : [];
  const resourceId = randomUUID();
  createResource(
    {
      id: resourceId,
      kind: "link",
      title,
      description: cleanText(req.body.description, 500),
      url: parsedUrl.toString(),
      ownerId: req.user.id,
      accessLevel,
    },
    members,
  );
  audit(req.user.id, "resource.link_created", "resource", resourceId, { accessLevel });
  res.redirect("/app?notice=created");
});

app.get("/resources/:id/download", requireAuth, async (req, res, next) => {
  const resource = getResourceById(req.params.id);
  if (!resource || resource.kind !== "file" || !userCanAccessResource(resource.id, req.user.id)) {
    return res.status(404).render("error", { title: "找不到檔案", message: "檔案不存在，或你沒有存取權限。" });
  }
  try {
    res.type(resource.mime_type || "application/octet-stream");
    res.attachment(resource.original_name || "download");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const stream = await getObjectStream(resource.storage_key);
    stream.on("error", next);
    stream.pipe(res);
    audit(req.user.id, "resource.downloaded", "resource", resource.id, {});
  } catch (error) {
    next(error);
  }
});

app.get("/resources/:id/access", requireAuth, (req, res) => {
  const resource = getResourceById(req.params.id);
  if (!resource || resource.owner_id !== req.user.id) {
    return res.status(404).render("error", { title: "找不到項目", message: "只有檔案擁有者可以調整權限。" });
  }
  res.render("access", {
    resource,
    members: listActiveUsers(req.user.id),
    selectedIds: new Set(getResourceMemberIds(resource.id)),
    error: "",
  });
});

app.post("/resources/:id/access", requireAuth, requireCsrf, (req, res) => {
  const resource = getResourceById(req.params.id);
  if (!resource || resource.owner_id !== req.user.id) {
    return res.status(404).render("error", { title: "找不到項目", message: "只有檔案擁有者可以調整權限。" });
  }
  const accessLevel = normalizeAccessLevel(req.body.accessLevel);
  const members = accessLevel === "selected" ? selectedMemberIds(req, req.user.id) : [];
  updateResourceAccess(resource.id, req.user.id, accessLevel, members);
  audit(req.user.id, "resource.access_updated", "resource", resource.id, { accessLevel, memberCount: members.length });
  res.redirect("/app?notice=access");
});

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
  console.error(error);
  if (req.file?.path) removeTempFile(req.file.path).catch(() => {});
  if (res.headersSent) return;
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    return res.status(413).render("error", {
      title: "檔案過大",
      message: `單一檔案目前最多 ${formatBytes(config.maxUploadBytes)}。這不影響檔案庫的總容量。`,
    });
  }
  res.status(500).render("error", { title: "發生錯誤", message: "系統暫時無法完成操作，請稍後再試。" });
});

export { app };
