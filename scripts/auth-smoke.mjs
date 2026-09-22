// Integration test against a disposable PostgreSQL database named tfiles_auth_smoke.
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Pool } from 'pg';
import { SMTPServer } from 'smtp-server';

if (process.env.AUTH_SMOKE_ENV_FILE) process.loadEnvFile(process.env.AUTH_SMOKE_ENV_FILE);
const testUrl = process.env.AUTH_SMOKE_DATABASE_URL ? new URL(process.env.AUTH_SMOKE_DATABASE_URL) : process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
if (testUrl && !process.env.AUTH_SMOKE_DATABASE_URL) testUrl.pathname = '/tfiles_auth_smoke';
if (!testUrl || testUrl.pathname !== '/tfiles_auth_smoke') throw Error('AUTH_SMOKE_DATABASE_URL must point to tfiles_auth_smoke.');

const databaseUrl = testUrl.toString();
const origin = 'http://127.0.0.1:3213';
const email = 'auth-smoke@tschool.tp.edu.tw';
const db = new Pool({ connectionString: databaseUrl });
const storage = await mkdtemp(path.join(tmpdir(), 'tfiles-auth-smoke-'));
const mail = [];
const smtp = new SMTPServer({ secure: false, disabledCommands: ['STARTTLS'], allowInsecureAuth: true, logger: false,
  onAuth(auth, _session, done) { done(auth.username === 'fixture' && auth.password === 'fixture' ? null : Error('Invalid SMTP login'), { user: 'fixture' }); },
  onData(stream, session, done) { let raw = ''; stream.on('data', chunk => { raw += chunk; }); stream.on('end', () => { mail.push({ to: session.envelope.rcptTo[0].address, raw }); done(); }); },
});
let server;
let logs = '';
let checks = 0;
function check(ok, message) { if (!ok) throw Error(message); checks++; }
async function post(action, body, cookie = '') {
  const response = await fetch(`${origin}/api/auth/${action}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  return { status: response.status, data: await response.json().catch(() => ({})), cookie: response.headers.get('set-cookie') };
}
function latestToken() {
  const normalized = mail.at(-1)?.raw.replace(/=\r?\n/g, '').replace(/=3D/gi, '=') || '';
  const token = /token=([A-Za-z0-9_-]{43})/.exec(normalized)?.[1];
  if (!token) throw Error('Verification token missing from test mail');
  return token;
}

try {
  await db.query(await readFile(new URL('../postgres/001_initial.sql', import.meta.url), 'utf8'));
  await db.query('TRUNCATE audit_log,auth_rate_limits,auth_tokens,password_credentials,sessions,resource_versions,resource_members,share_links,resources,oauth_states,users RESTART IDENTITY');
  await new Promise(resolve => smtp.listen(2526, '127.0.0.1', resolve));
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '3213'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, DATABASE_URL: databaseUrl, APP_URL: origin, FILE_STORAGE_PATH: storage,
      SESSION_SECRET: 'auth-smoke-session-secret', ALLOWED_EMAIL_DOMAIN: 'tschool.tp.edu.tw', ADMIN_EMAILS: 'nobody@tschool.tp.edu.tw',
      SMTP_HOST: '127.0.0.1', SMTP_PORT: '2526', SMTP_USER: 'fixture', SMTP_PASSWORD: 'fixture', SMTP_FROM_EMAIL: 'fixture@example.com', REGISTRATION_MODE: 'instant' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', chunk => { logs += chunk; });
  server.stderr.on('data', chunk => { logs += chunk; });
  let ready = false;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(origin)).status < 500) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 200)); }
  check(ready, `Next server did not start: ${logs.slice(-1000)}`);

  check((await fetch(`${origin}/auth/google`, { redirect: 'manual' })).status === 404, 'Legacy Google login route remains active');
  check((await post('register', { email: 'bad@example.com' })).status === 400, 'Non-school address accepted');
  check((await post('register', { email })).status === 200, 'Registration mail request failed');
  check(mail.length === 1 && mail[0].to === email, 'Registration mail not delivered to school address');
  const registrationToken = latestToken();
  check((await post('complete', { token: registrationToken, password: 'passw0rd', confirmPassword: 'passw0rd', displayName: '測試成員' })).status === 200, 'Registration could not be completed');
  const member = (await db.query('SELECT id,display_name,status FROM users WHERE email=$1', [email])).rows[0];
  check(member?.display_name === '測試成員' && member.status === 'active', 'New account missing or inactive');
  check((await post('login', { email, password: 'wrongpass' })).status === 401, 'Wrong password accepted');
  const login = await post('login', { email, password: 'passw0rd' });
  check(login.status === 200 && login.cookie?.includes('tfiles_session='), 'Independent password login failed');
  const cookie = login.cookie.split(';')[0];
  const me = await fetch(`${origin}/api/me`, { headers: { Cookie: cookie } });
  check(me.status === 200 && (await me.json()).user.email === email, 'Session did not identify member');
  check((await post('forgot', { email })).status === 200 && mail.length === 2, 'Password reset mail failed');
  const resetToken = latestToken();
  check((await post('complete', { token: resetToken, password: 'newpass8', confirmPassword: 'newpass8' })).status === 200, 'Password reset failed');
  check((await fetch(`${origin}/api/me`, { headers: { Cookie: cookie } })).status === 401, 'Old session survived password reset');
  check((await post('login', { email, password: 'passw0rd' })).status === 401, 'Old password survived reset');
  check((await post('login', { email, password: 'newpass8' })).status === 200, 'New password rejected');
  check((await post('complete', { token: resetToken, password: 'another8', confirmPassword: 'another8' })).status === 400, 'Reset token was reusable');
  const credential = (await db.query('SELECT password_hash FROM password_credentials WHERE user_id=$1', [member.id])).rows[0];
  check(credential?.password_hash?.startsWith('pbkdf2-sha256$') && !credential.password_hash.includes('newpass8'), 'Password not hashed');
  console.log(`Independent auth smoke test passed (${checks} checks)`);
} finally {
  server?.kill();
  await new Promise(resolve => smtp.close(resolve));
  await db.end();
  await rm(storage, { recursive: true, force: true });
}
