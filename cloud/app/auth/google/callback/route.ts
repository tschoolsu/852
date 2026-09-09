import { env } from 'cloudflare:workers';
import { appOrigin, audit, clearCookie, cookie, cookies, first, now, run, sessionHash, sha256, token, validSchoolEmail } from '@/lib/cloud';

type GoogleProfile={sub:string;email:string;email_verified:string|boolean;name:string;hd:string;aud:string;iss:string;exp:string;nonce:string};

function loginError(request:Request,message:string,status=400){
  const url=new URL('/',appOrigin(request)); url.searchParams.set('error',message); return new Response(null,{status,headers:{Location:url.toString(), 'Set-Cookie':clearCookie('tfiles_oauth_states')}});
}

export async function GET(request:Request) {
  const url=new URL(request.url),state=url.searchParams.get('state') || '',code=url.searchParams.get('code') || '';
  const known=(cookies(request).tfiles_oauth_states || '').split('.').filter(Boolean);
  if(!state || !known.includes(state) || !code) return loginError(request,'Google 登入要求已失效，請重新開始。');
  const pending=await first<{code_verifier:string;nonce:string;next_path:string}>('SELECT code_verifier,nonce,next_path FROM oauth_states WHERE state_hash=? AND expires_at>?',await sha256(state),now());
  await run('DELETE FROM oauth_states WHERE state_hash=?',await sha256(state));
  if(!pending) return loginError(request,'Google 登入要求已失效，請重新開始。');
  try {
    const body=new URLSearchParams({code,client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,
      redirect_uri:`${appOrigin(request)}/auth/google/callback`,grant_type:'authorization_code',code_verifier:pending.code_verifier});
    const exchanged=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
    const tokens=await exchanged.json() as {id_token?:string}; if(!exchanged.ok || !tokens.id_token) throw new Error('token exchange failed');
    const checked=await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokens.id_token)}`);
    const profile=await checked.json() as GoogleProfile;
    const domain=(env.ALLOWED_EMAIL_DOMAIN || 'tschool.tp.edu.tw').toLowerCase();
    if(!checked.ok || profile.aud!==env.GOOGLE_CLIENT_ID || !['accounts.google.com','https://accounts.google.com'].includes(profile.iss) ||
      profile.nonce!==pending.nonce || String(profile.email_verified)!=='true' || profile.hd?.toLowerCase()!==domain || !validSchoolEmail(profile.email) || Number(profile.exp)*1000<=Date.now()) throw new Error('invalid profile');
    const email=profile.email.toLowerCase(),adminEmails=(env.ADMIN_EMAILS || '11430106@tschool.tp.edu.tw').toLowerCase().split(',').map(v=>v.trim());
    const bySub=await first<{id:string;google_subject:string|null}>('SELECT id,google_subject FROM users WHERE google_subject=?',profile.sub);
    const byEmail=await first<{id:string;google_subject:string|null}>('SELECT id,google_subject FROM users WHERE email=? COLLATE NOCASE',email);
    if(bySub && byEmail && bySub.id!==byEmail.id) return loginError(request,'帳號資料發生衝突，請聯絡管理員。',409);
    const existing=bySub || byEmail; if(existing?.google_subject && existing.google_subject!==profile.sub) return loginError(request,'帳號資料發生衝突，請聯絡管理員。',409);
    const userId=existing?.id || crypto.randomUUID(),role=adminEmails.includes(email)?'admin':'member';
    const status=existing ? (await first<{status:string}>('SELECT status FROM users WHERE id=?',userId))?.status || 'active' : env.REGISTRATION_MODE==='approval'?'pending':'active';
    if(existing) await run('UPDATE users SET email=?,display_name=?,google_subject=?,role=?,updated_at=? WHERE id=?',email,profile.name || email,profile.sub,role,now(),userId);
    else await run('INSERT INTO users(id,email,display_name,google_subject,role,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',userId,email,profile.name || email,profile.sub,role,status,now(),now());
    if(status!=='active') return loginError(request,'帳號正在等待管理員審核。',403);
    const raw=token(),csrf=token(24); await run('DELETE FROM sessions WHERE expires_at<=?',now());
    await run('INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at,created_at) VALUES(?,?,?,?,?)',await sessionHash(raw),userId,csrf,new Date(Date.now()+604800000).toISOString(),now());
    await audit(userId,existing?'auth.google_login_succeeded':'auth.google_account_created',userId,{domain});
    const remaining=known.filter(v=>v!==state).slice(-5); const headers=new Headers({Location:new URL(pending.next_path || '/',appOrigin(request)).toString()});
    headers.append('Set-Cookie',cookie('tfiles_session',raw,604800));
    headers.append('Set-Cookie',remaining.length?cookie('tfiles_oauth_states',remaining.join('.'),600):clearCookie('tfiles_oauth_states'));
    return new Response(null,{status:302,headers});
  } catch(error) { console.warn('Google OAuth failed',error); return loginError(request,'無法驗證學校 Google 帳號，請重新嘗試。'); }
}
