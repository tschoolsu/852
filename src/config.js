import "dotenv/config";
import path from "node:path";
import { randomBytes } from "node:crypto";

const isProduction = process.env.NODE_ENV === "production";
const configuredSecret = process.env.SESSION_SECRET?.trim();

if (isProduction && (!configuredSecret || configuredSecret.length < 32)) {
  throw new Error("正式環境必須設定至少 32 字元的 SESSION_SECRET");
}

export const config = {
  env: process.env.NODE_ENV || "development",
  isProduction,
  host: process.env.HOST || "127.0.0.1",
  port: Number(process.env.PORT || 3000),
  appUrl: (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || "http://localhost:3000").replace(/\/$/, ""),
  sessionSecret: configuredSecret || randomBytes(32).toString("hex"),
  trustProxy: process.env.TRUST_PROXY === "1",
  registrationMode: process.env.REGISTRATION_MODE === "approval" ? "approval" : "instant",
  allowedEmailDomain: (process.env.ALLOWED_EMAIL_DOMAIN || "tschool.tp.edu.tw").toLowerCase(),
  googleOAuth: {
    clientId: process.env.GOOGLE_CLIENT_ID?.trim() || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() || "",
  },
  adminEmails: new Set(
    (process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  ),
  dataDir: path.resolve(process.env.DATA_DIR || "./data"),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 1024 * 1024 * 1024),
  storageDriver: process.env.STORAGE_DRIVER === "s3" ? "s3" : "local",
  s3: {
    region: process.env.S3_REGION || "auto",
    endpoint: process.env.S3_ENDPOINT || undefined,
    bucket: process.env.S3_BUCKET || "",
    accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  },
  smtp: {
    host: process.env.SMTP_HOST || "",
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    fromName: process.env.SMTP_FROM_NAME || "T-Files 學生會檔案管理",
    fromEmail: process.env.SMTP_FROM_EMAIL || "",
  },
};
