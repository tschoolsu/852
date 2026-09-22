// tpass-ops reads this array before building. Authentication remains local to T-Files.
export const REQUIRED = [
  "APP_URL",
  "DATABASE_URL",
  "FILE_STORAGE_PATH",
  "SESSION_SECRET",
  "ALLOWED_EMAIL_DOMAIN",
  "ADMIN_EMAILS",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "SMTP_FROM_EMAIL",
] as const;

export function assertRuntimeConfig() {
  const missing = REQUIRED.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}
