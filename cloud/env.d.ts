declare namespace Cloudflare {
  interface Env {
    FILES: R2Bucket;
    DB: D1Database;
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    SESSION_SECRET: string;
    ADMIN_EMAILS?: string;
    REGISTRATION_MODE?: string;
    ALLOWED_EMAIL_DOMAIN?: string;
    APP_URL?: string;
    RESEND_API_KEY?: string;
    SHARE_EMAIL_FROM?: string;
    SMTP_HOST?: string;
    SMTP_PORT?: string;
    SMTP_USER?: string;
    SMTP_PASSWORD?: string;
    SMTP_FROM_EMAIL?: string;
    SMTP_FROM_NAME?: string;
  }
}
