import { env } from './node-env';
import { all, appOrigin, audit, first, httpError, isAdminEmail, json, now, requireCsrf, requireUser, run, sha256, token, validSchoolEmail } from './cloud';
import { mailConfigured, sendMail } from './mail';

async function requireAdmin(request: Request) {
  const auth = await requireUser(request);
  if (auth.user.role !== 'admin' || !isAdminEmail(auth.user.email)) throw httpError(403, '只有管理員可以使用此功能。');
  return auth;
}

const dateInput = (value: string | null) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? value : '';
const searchInput = (value: string | null) => (value || '').trim().slice(0, 100);
const likeInput = (value: string) => `%${value.replace(/[\\%_]/g, '\\$&')}%`;

export async function adminGet(request: Request, url: URL) {
  await requireAdmin(request);
  const view = url.searchParams.get('view') || 'members';
  const query = searchInput(url.searchParams.get('q'));
  const from = dateInput(url.searchParams.get('from'));
  const to = dateInput(url.searchParams.get('to'));
  if (view === 'members') {
    const rows = await all(`SELECT u.id,u.email,u.display_name,u.role,u.status,u.created_at,
      (SELECT MAX(s.created_at) FROM sessions s WHERE s.user_id=u.id) AS last_login,
      (SELECT MAX(a.created_at) FROM audit_log a WHERE a.actor_id=u.id AND a.action IN ('auth.password_login','auth.google_login')) AS last_login_audit,
      COUNT(r.id) FILTER (WHERE r.kind='file' AND r.trashed_at IS NULL) AS files,
      COUNT(r.id) FILTER (WHERE r.kind='link' AND r.trashed_at IS NULL) AS links,
      COUNT(r.id) FILTER (WHERE r.kind='folder' AND r.trashed_at IS NULL) AS folders,
      COALESCE(SUM(r.size_bytes) FILTER (WHERE r.kind='file' AND r.trashed_at IS NULL),0) AS bytes
      FROM users u LEFT JOIN resources r ON r.owner_id=u.id
      WHERE LOWER(u.email) LIKE LOWER(?) ESCAPE '\\' OR LOWER(u.display_name) LIKE LOWER(?) ESCAPE '\\'
      GROUP BY u.id,u.email,u.display_name,u.role,u.status,u.created_at ORDER BY u.created_at DESC LIMIT 200`,likeInput(query),likeInput(query));
    return json({ members: rows });
  }
  if (view === 'events') {
    const member = searchInput(url.searchParams.get('member'));
    const order = url.searchParams.get('order') === 'oldest' ? 'ASC' : 'DESC';
    const until = to ? new Date(Date.parse(`${to}T00:00:00Z`)+86400000).toISOString() : '';
    const rows = await all(`SELECT a.id,a.action,a.actor_id,a.target_id,a.details,a.created_at,
      COALESCE(u.display_name,'未知或已移除的帳號') AS actor_name,u.email AS actor_email,
      r.title AS resource_title,r.kind AS resource_kind
      FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id LEFT JOIN resources r ON r.id=a.target_id
      WHERE (?='' OR a.actor_id=? OR a.target_id=?)
        AND (?='' OR a.created_at>=?) AND (?='' OR a.created_at<?)
        AND (?='' OR LOWER(COALESCE(r.title,'')) LIKE LOWER(?) ESCAPE '\\' OR LOWER(COALESCE(u.email,'')) LIKE LOWER(?) ESCAPE '\\' OR LOWER(a.action) LIKE LOWER(?) ESCAPE '\\')
      ORDER BY a.created_at ${order},a.id ${order} LIMIT 200`,member,member,member,from,from,to,until,query,likeInput(query),likeInput(query),likeInput(query));
    return json({ events: rows });
  }
  if (view === 'files') {
    const order = url.searchParams.get('order') === 'smallest' ? 'ASC' : 'DESC';
    const rows = await all(`SELECT r.id,r.title,r.size_bytes,r.created_at,r.trashed_at,u.display_name AS owner_name,u.email AS owner_email
      FROM resources r JOIN users u ON u.id=r.owner_id WHERE r.kind='file'
      AND (?='' OR LOWER(r.title) LIKE LOWER(?) ESCAPE '\\' OR LOWER(u.email) LIKE LOWER(?) ESCAPE '\\')
      ORDER BY r.size_bytes ${order},r.created_at DESC LIMIT 200`,query,likeInput(query),likeInput(query));
    return json({ files: rows });
  }
  if (view === 'health') {
    const [usage, database] = await Promise.all([
      first<{bytes:number;files:number;versions:number}>(`SELECT COALESCE(SUM(size_bytes),0) AS bytes,COUNT(*) AS files,
        (SELECT COUNT(*) FROM resource_versions) AS versions FROM resources WHERE kind='file' AND trashed_at IS NULL`),
      first<{bytes:number}>('SELECT pg_database_size(current_database()) AS bytes'),
    ]);
    let disk: { total:number; free:number } | null = null;
    let backup: { configured:boolean; latest:string|null; ageHours:number|null; count:number } = { configured:false,latest:null,ageHours:null,count:0 };
    if (process.env.FILE_STORAGE_PATH) {
      try { const { statfs } = await import('node:fs/promises'); const s = await statfs(process.env.FILE_STORAGE_PATH); disk = { total:s.blocks*s.bsize, free:s.bavail*s.bsize }; } catch { /* Show unavailable rather than a guessed value. */ }
    }
    if (process.env.BACKUP_PATH) {
      backup.configured = true;
      try {
        const { readdir, stat } = await import('node:fs/promises');
        const path = await import('node:path');
        const entries = await readdir(process.env.BACKUP_PATH, { withFileTypes:true });
        const files = await Promise.all(entries.filter(e=>e.isFile() && /\.(dump|sql|tar|tgz|gz)$/i.test(e.name)).map(async e=>stat(path.join(process.env.BACKUP_PATH!,e.name))));
        const latest = files.sort((a,b)=>b.mtimeMs-a.mtimeMs)[0];
        backup = { configured:true,latest:latest?.mtime.toISOString()||null,ageHours:latest?Math.round((Date.now()-latest.mtimeMs)/3600000):null,count:files.length };
      } catch { /* Missing or unreadable backup directory is reported as no verified backup. */ }
    }
    const security = await all(`SELECT action,details,created_at FROM audit_log WHERE action IN
      ('auth.login_failed','auth.rate_limited','auth.mail_failed','auth.mail_sent','admin.account_reset','admin.mail_resent','admin.resource_opened')
      ORDER BY created_at DESC,id DESC LIMIT 100`);
    return json({ health:{ currentBytes:usage?.bytes||0,fileCount:usage?.files||0,versionCount:usage?.versions||0,databaseBytes:database?.bytes||0,disk,backup,smtpConfigured:mailConfigured(),security } });
  }
  throw httpError(404, '找不到管理頁面。');
}

export async function adminPost(request: Request) {
  const { user, csrf } = await requireAdmin(request);
  if (request.headers.get('origin') !== appOrigin(request)) throw httpError(403, '請從本網站送出要求。');
  const body = await request.json() as { csrf?:string; operation?:string; userId?:string };
  requireCsrf(request,csrf,body.csrf);
  const target = await first<{id:string;email:string;status:string;role:string}>('SELECT id,email,status,role FROM users WHERE id=?',body.userId||'');
  if (!target || !validSchoolEmail(target.email)) throw httpError(404, '找不到學校成員。');
  if (body.operation === 'activate') {
    if (target.status !== 'pending') throw httpError(409, '只有待審核帳號可以啟用。');
    await run("UPDATE users SET status='active',updated_at=? WHERE id=? AND status='pending'",now(),target.id);
    await audit(user.id,'admin.account_activated',target.id,{email:target.email});
    return json({ ok:true,message:'帳號已啟用，成員可以登入。' });
  }
  if (body.operation === 'reset-registration') {
    if (target.id === user.id || target.role === 'admin') throw httpError(403, '不能重設管理員帳號。');
    if (!['active','pending'].includes(target.status)) throw httpError(409, '此帳號目前不能重設。');
    const statement = (sql:string,...values:unknown[]) => env.DB.prepare(sql).bind(...values);
    await env.DB.batch([
      statement("UPDATE users SET status='reset_required',updated_at=? WHERE id=?",now(),target.id),
      statement('DELETE FROM sessions WHERE user_id=?',target.id),
      statement('DELETE FROM password_credentials WHERE user_id=?',target.id),
      statement('DELETE FROM auth_tokens WHERE email=?',target.email),
    ]);
    await audit(user.id,'admin.account_reset',target.id,{email:target.email});
    return json({ ok:true,message:'舊登入已撤銷。請成員以同一學校信箱重新註冊，原檔案與擁有者會保留。' });
  }
  if (body.operation === 'resend-mail') {
    if (!mailConfigured()) throw httpError(503, 'SMTP 尚未設定。');
    if (!['active','pending','reset_required'].includes(target.status)) throw httpError(409, '此帳號無法寄送設定信。');
    const recent = await first<{count:number}>(`SELECT COUNT(*) AS count FROM audit_log WHERE action='admin.mail_resent' AND target_id=? AND created_at>?`,target.id,new Date(Date.now()-3600000).toISOString());
    if ((recent?.count||0)>=3) throw httpError(429, '一小時內最多重寄三次。');
    const purpose = target.status==='active' ? 'forgot' : 'register';
    const raw = token(),hash = await sha256(raw);
    await run('INSERT INTO auth_tokens(token_hash,email,purpose,expires_at,created_at) VALUES(?,?,?,?,?)',hash,target.email,purpose,new Date(Date.now()+1800000).toISOString(),now());
    const link = new URL('/',appOrigin(request)); link.searchParams.set('auth','complete'); link.hash=new URLSearchParams({token:raw,purpose}).toString();
    try { await sendMail(target.email,'學生會檔案管理系統：設定密碼',`請開啟以下連結驗證學校信箱並設定密碼：\n\n${link}\n\n連結有效 30 分鐘，僅能使用一次。若非你提出要求，請聯絡管理員。`); }
    catch { await run('DELETE FROM auth_tokens WHERE token_hash=?',hash); await audit(user.id,'auth.mail_failed',target.id,{email:target.email,purpose}); throw httpError(503,'SMTP 寄送失敗，請檢查寄件設定與服務紀錄。'); }
    await audit(user.id,'admin.mail_resent',target.id,{email:target.email,purpose});
    return json({ ok:true,message:'已交給 SMTP 寄送；實際送達仍需由成員確認收件匣與垃圾郵件。' });
  }
  throw httpError(400, '不支援此管理操作。');
}
