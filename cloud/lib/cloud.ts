import { env } from 'cloudflare:workers';

export type User = { id:string; email:string; display_name:string; role:string; status:string };
export type Resource = {
  id:string; kind:'file'|'link'|'folder'; title:string; description:string; url:string|null; storage_key:string|null;
  original_name:string|null; mime_type:string|null; size_bytes:number|null; owner_id:string; parent_id:string|null;
  access_level:string; revision:number; trashed_at:string|null; created_at:string; updated_at:string;
};

export const now = () => new Date().toISOString();
export const allowedDomain = () => (env.ALLOWED_EMAIL_DOMAIN || 'tschool.tp.edu.tw').toLowerCase();
export const appOrigin = (request:Request) => (env.APP_URL || new URL(request.url).origin).replace(/\/$/, '');
export const isAdminEmail = (email:string) => (env.ADMIN_EMAILS || '11430106@tschool.tp.edu.tw').toLowerCase().split(',').map(v=>v.trim()).includes(email.toLowerCase());

export function validSchoolEmail(value:string) {
  const email = String(value || '').trim().toLowerCase();
  const parts = email.split('@');
  return parts.length === 2 && Boolean(parts[0]) && parts[1] === allowedDomain();
}

export function cookies(request:Request) {
  return Object.fromEntries((request.headers.get('cookie') || '').split(';').map(v=>v.trim()).filter(Boolean).map(v=>{
    const i=v.indexOf('='); return [decodeURIComponent(i<0?v:v.slice(0,i)),decodeURIComponent(i<0?'':v.slice(i+1))];
  }));
}

export function cookie(name:string,value:string,maxAge:number) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearCookie(name:string) { return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`; }

export function token(bytes=32) {
  const data=crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...data)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

export async function sha256(value:string) {
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');
}

export async function sessionHash(value:string) {
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const digest=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');
}

export async function all<T=Record<string,unknown>>(sql:string,...bindings:unknown[]):Promise<T[]> {
  const result=await env.DB.prepare(sql).bind(...bindings).all<T>(); return result.results || [];
}
export async function first<T=Record<string,unknown>>(sql:string,...bindings:unknown[]):Promise<T|null> {
  return await env.DB.prepare(sql).bind(...bindings).first<T>();
}
export async function run(sql:string,...bindings:unknown[]) { return env.DB.prepare(sql).bind(...bindings).run(); }

export async function currentUser(request:Request):Promise<{user:User;csrf:string}|null> {
  const raw=cookies(request).tfiles_session; if(!raw) return null;
  const row=await first<User & {csrf_token:string}>(`SELECT u.id,u.email,u.display_name,u.role,u.status,s.csrf_token
    FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`,await sessionHash(raw),now());
  if(!row || row.status!=='active' || !validSchoolEmail(row.email)) return null;
  return {user:row,csrf:row.csrf_token};
}

export async function requireUser(request:Request) {
  const auth=await currentUser(request); if(!auth) throw httpError(401,'請先使用學校 Google 帳號登入。'); return auth;
}

export function requireCsrf(request:Request,expected:string,provided?:string) {
  const actual=provided || request.headers.get('x-csrf-token') || '';
  if(!actual || actual!==expected) throw httpError(403,'操作要求已失效，請重新整理後再試。');
}

export function httpError(status:number,message:string) { return Object.assign(new Error(message),{status,publicMessage:message}); }
export function json(data:unknown,status=200,headers:HeadersInit={}) {
  const responseHeaders=new Headers(headers);
  responseHeaders.set('Cache-Control','no-store');
  responseHeaders.set('X-Content-Type-Options','nosniff');
  return Response.json(data,{status,headers:responseHeaders});
}

export function safeUrl(value:string) {
  let url:URL; try { url=new URL(value); } catch { throw httpError(400,'請輸入有效的網址。'); }
  if(!['http:','https:'].includes(url.protocol) || url.username || url.password) throw httpError(400,'只接受安全的 http 或 https 網址。');
  return url.toString();
}

export async function loadAccess(user:User,shareToken='') {
  const [resourceRows,memberRows,shareRows]=await Promise.all([
    all<Resource>('SELECT * FROM resources'),
    all<{resource_id:string;user_id:string;role:string}>('SELECT resource_id,user_id,role FROM resource_members WHERE user_id=?',user.id),
    shareToken ? all<{resource_id:string;role:string}>('SELECT resource_id,role FROM share_links WHERE token_hash=?',await sha256(shareToken)) : Promise.resolve([]),
  ]);
  const map=new Map(resourceRows.map(r=>[r.id,r]));
  const memberships=new Map(memberRows.map(m=>[m.resource_id,m.role]));
  const links=new Map(shareRows.map(m=>[m.resource_id,m.role]));
  const rank=(role:string)=>role==='owner'?3:role==='editor'?2:role==='viewer'?1:0;
  function permission(resource:Resource) {
    let best=resource.owner_id===user.id?'owner':''; let current:Resource|undefined=resource; const seen=new Set<string>();
    while(current && !seen.has(current.id)) {
      seen.add(current.id);
      const member=memberships.get(current.id); const link=links.get(current.id);
      if(member && rank(member)>rank(best)) best=member;
      if(link && rank(link)>rank(best)) best=link;
      if(current.access_level==='members' && rank('viewer')>rank(best)) best='viewer';
      current=current.parent_id?map.get(current.parent_id):undefined;
    }
    return best;
  }
  function hiddenByTrash(resource:Resource) {
    let current:Resource|undefined=resource; const seen=new Set<string>();
    while(current && !seen.has(current.id)) { if(current.trashed_at) return true; seen.add(current.id); current=current.parent_id?map.get(current.parent_id):undefined; }
    return false;
  }
  return {resources:resourceRows,map,permission,hiddenByTrash,rank};
}

export function publicResource(resource:Resource,permission:string,owner?:{display_name:string;email:string}) {
  return {...resource,permission,owner_name:owner?.display_name || '',owner_email:owner?.email || '',storage_key:undefined};
}

export async function audit(actorId:string|null,action:string,targetId:string|null,details:unknown={}) {
  await run('INSERT INTO audit_log(actor_id,action,target_id,details,created_at) VALUES(?,?,?,?,?)',actorId,action,targetId,JSON.stringify(details),now());
}

export async function snapshot(resource:Resource,event:string,actorId:string,revision=resource.revision) {
  await run(`INSERT INTO resource_versions(resource_id,revision,kind,title,description,url,storage_key,original_name,mime_type,size_bytes,parent_id,event,actor_id,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,resource.id,revision,resource.kind,resource.title,resource.description,resource.url,resource.storage_key,
    resource.original_name,resource.mime_type,resource.size_bytes,resource.parent_id,event,actorId,now());
}

const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char] || char));

export async function sendShareNotification(request:Request,input:{recipient:string;recipientName:string;senderName:string;resourceTitle:string;permission:string}) {
  if(!env.RESEND_API_KEY || !env.SHARE_EMAIL_FROM) return {sent:false,reason:'尚未設定寄信服務'};
  const permission=input.permission==='editor'?'可編輯':'可檢視',site=appOrigin(request);
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({
    from:env.SHARE_EMAIL_FROM,to:[input.recipient],subject:`${input.senderName} 與你共享「${input.resourceTitle}」`,
    text:`${input.recipientName}，${input.senderName} 已在學生會檔案管理系統與你共享「${input.resourceTitle}」（${permission}）。登入查看：${site}`,
    html:`<p>${escapeHtml(input.recipientName)}，</p><p>${escapeHtml(input.senderName)} 已在學生會檔案管理系統與你共享「<strong>${escapeHtml(input.resourceTitle)}</strong>」（${permission}）。</p><p><a href="${escapeHtml(site)}">登入查看</a></p>`,
  })});
  if(!response.ok) return {sent:false,reason:`寄信服務回傳 ${response.status}`};
  return {sent:true,reason:''};
}
