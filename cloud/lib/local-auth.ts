import { env } from 'cloudflare:workers';
import { appOrigin,audit,cookie,first,httpError,isAdminEmail,json,now,requireCsrf,requireUser,run,sessionHash,sha256,token,validSchoolEmail } from './cloud';
import { hashPassword,validPassword,verifyPassword } from './password';
import { mailConfigured,sendMail } from './mail';

const genericMailMessage='若此信箱符合條件，將收到驗證或密碼設定信，請檢查收件匣與垃圾郵件。';
function nameValue(value:unknown) {return typeof value==='string'?value.trim().slice(0,80):'';}
function requireOrigin(request:Request) {
  if(request.headers.get('origin')!==appOrigin(request))throw httpError(403,'請從本網站送出要求。');
  if(!request.headers.get('content-type')?.includes('application/json'))throw httpError(415,'不支援的要求格式。');
}
async function rateLimit(action:string,identity:string,limit:number,seconds:number) {
  const timestamp=Date.now(),expires=timestamp+seconds*1000;
  const key=await sha256(`${action}:${identity}`);
  await run(`INSERT INTO auth_rate_limits(key,hits,expires_at) VALUES(?,1,?)
    ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN expires_at<=? THEN 1 ELSE hits+1 END,
    expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END`,key,expires,timestamp,timestamp);
  const row=await first<{hits:number}>('SELECT hits FROM auth_rate_limits WHERE key=?',key);
  if(!row||row.hits>limit)throw httpError(429,'操作太頻繁，請稍後再試。');
}

export async function authPost(request:Request,action:string) {
  const raw=await request.text();requireOrigin(request);if(raw.length>4096)throw httpError(413,'要求內容過長。');
  let body:Record<string,unknown>;try{body=JSON.parse(raw);}catch{throw httpError(400,'要求格式錯誤。');}
  if(!body||typeof body!=='object'||Array.isArray(body))throw httpError(400,'要求格式錯誤。');
  const ip=request.headers.get('cf-connecting-ip') || 'local';
  await rateLimit('auth-ip',ip,60,900);
  await run('DELETE FROM auth_rate_limits WHERE expires_at<?',Date.now()-86400000);
  if(action==='profile') {
    const auth=await requireUser(request);requireCsrf(request,auth.csrf,typeof body.csrf==='string'?body.csrf:'');
    const displayName=nameValue(body.displayName);if(!displayName)throw httpError(400,'請輸入顯示名稱。');
    await run('UPDATE users SET display_name=?,updated_at=? WHERE id=?',displayName,now(),auth.user.id);
    return json({ok:true,displayName});
  }
  if(action==='complete')return complete(body);
  const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
  if(!validSchoolEmail(email)||email.length>254||/[\s<>\r\n]/.test(email))throw httpError(400,'請使用 @tschool.tp.edu.tw 的學校信箱。');
  if(action==='login') {
    await rateLimit('login',email,10,900);
    if(!validPassword(body.password))throw httpError(401,'信箱或密碼不正確。');
    const user=await first<{id:string;status:string;password_hash:string|null}>(`SELECT u.id,u.status,p.password_hash FROM users u LEFT JOIN password_credentials p ON p.user_id=u.id WHERE u.email=?`,email);
    if(!await verifyPassword(body.password,user?.password_hash || null)||!user)throw httpError(401,'信箱或密碼不正確。原 Google 使用者請先使用「忘記／首次設定密碼」。');
    if(user.status!=='active')throw httpError(403,'帳號尚未啟用，請聯絡管理員。');
    const rawSession=token(),csrf=token(24);
    await run('INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at,created_at) VALUES(?,?,?,?,?)',await sessionHash(rawSession),user.id,csrf,new Date(Date.now()+604800000).toISOString(),now());
    await audit(user.id,'auth.password_login',user.id);
    return json({ok:true},200,{'Set-Cookie':cookie('tfiles_session',rawSession,604800)});
  }
  if(action!=='register'&&action!=='forgot')throw httpError(404,'找不到頁面。');
  if(!mailConfigured())throw httpError(503,'寄信服務尚未設定，請聯絡管理員。');
  await rateLimit('mail-email',email,3,900);
  await rateLimit('mail-ip',ip,12,900);
  const existing=await first<{id:string;status:string}>('SELECT id,status FROM users WHERE email=?',email);
  if((action==='forgot'&&!existing)||existing?.status==='disabled')return json({message:genericMailMessage});
  const rawToken=token(),hash=await sha256(rawToken),created=now();
  await run('DELETE FROM auth_tokens WHERE expires_at<=?',created);
  await run('INSERT INTO auth_tokens(token_hash,email,purpose,expires_at,created_at) VALUES(?,?,?,?,?)',hash,email,action,new Date(Date.now()+1800000).toISOString(),created);
  const url=new URL('/',appOrigin(request));url.searchParams.set('auth','complete');url.hash=new URLSearchParams({token:rawToken,purpose:action}).toString();
  try {
    await sendMail(email,'學生會檔案管理系統：驗證信箱與設定密碼',`請開啟以下連結，驗證學校信箱並設定你自己的密碼：\n\n${url}\n\n連結有效期限為 30 分鐘，僅可使用一次。系統密碼與學校／Google 密碼分開。\n若你未提出要求，請忽略此信，原密碼不會因此改變。`);
  }catch{
    await run('DELETE FROM auth_tokens WHERE token_hash=?',hash);
    throw httpError(503,'目前無法寄出郵件，請稍後重試或聯絡管理員。');
  }
  return json({message:genericMailMessage});
}

async function complete(body:Record<string,unknown>) {
  if(typeof body.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(body.token))throw httpError(400,'連結無效或已失效，請重新寄送。');
  if(!validPassword(body.password))throw httpError(400,'密碼請使用 8～128 個字元。');
  if(body.password!==body.confirmPassword)throw httpError(400,'兩次輸入的密碼不一致。');
  const hash=await sha256(body.token),timestamp=now();
  const pending=await first<{email:string;purpose:string}>('SELECT email,purpose FROM auth_tokens WHERE token_hash=? AND expires_at>?',hash,timestamp);
  if(!pending)throw httpError(400,'連結無效或已失效，請重新寄送。');
  const existing=await first<{id:string;status:string;display_name:string}>('SELECT id,status,display_name FROM users WHERE email=?',pending.email);
  if(existing&&existing.status!=='active'&&existing.status!=='pending')throw httpError(403,'帳號已停用，請聯絡管理員。');
  if(!existing&&pending.purpose!=='register')throw httpError(400,'請先註冊帳號。');
  const displayName=nameValue(body.displayName)||existing?.display_name;
  if(!displayName)throw httpError(400,'請輸入顯示名稱。');
  const passwordHash=await hashPassword(body.password);
  // Atomically consume the token; concurrent submissions cannot both reset a password.
  const consumed=await first('DELETE FROM auth_tokens WHERE token_hash=? AND expires_at>? RETURNING token_hash',hash,now());
  if(!consumed)throw httpError(400,'連結已使用，請重新寄送。');
  const userId=existing?.id || crypto.randomUUID();
  const status=existing?.status || (env.REGISTRATION_MODE==='approval'?'pending':'active');
  const statement=(sql:string,...bindings:unknown[])=>env.DB.prepare(sql).bind(...bindings);
  await env.DB.batch([
    // Keep legacy Google identifiers intact. New accounts use a unique local marker.
    statement('INSERT INTO users(id,email,display_name,google_subject,role,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(email) DO NOTHING',userId,pending.email,displayName,`local:${userId}`,isAdminEmail(pending.email)?'admin':'member',status,timestamp,timestamp),
    statement('INSERT INTO password_credentials(user_id,password_hash,verified_at,changed_at) SELECT id,?,?,? FROM users WHERE email=? ON CONFLICT(user_id) DO UPDATE SET password_hash=excluded.password_hash,changed_at=excluded.changed_at',passwordHash,timestamp,timestamp,pending.email),
    statement('UPDATE users SET display_name=?,updated_at=? WHERE email=?',displayName,timestamp,pending.email),
    statement('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email=?)',pending.email),
    statement('DELETE FROM auth_tokens WHERE email=?',pending.email),
  ]);
  await audit(existing?.id||userId,'auth.password_set',existing?.id||userId);
  return json({ok:true,message:status==='active'?'密碼已設定，請使用學校信箱與新密碼登入。':'註冊完成，請等待管理員審核。'});
}
