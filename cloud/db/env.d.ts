declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    FILES: R2Bucket;
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    SESSION_SECRET: string;
    ADMIN_EMAILS?: string;
    REGISTRATION_MODE?: string;
    ALLOWED_EMAIL_DOMAIN?: string;
    APP_URL?: string;
    RESEND_API_KEY?: string;
    SHARE_EMAIL_FROM?: string;
  }
}
