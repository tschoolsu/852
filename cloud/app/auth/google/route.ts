import { env } from 'cloudflare:workers';
import { appOrigin, cookie, cookies, now, run, sha256, token } from '@/lib/cloud';

export async function GET(request:Request) {
  if(!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return new Response('Google 登入尚未設定。',{status:503});
  const state=token(),nonce=token(),verifier=token(48);
  const challengeBytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));
  const challenge=btoa(String.fromCharCode(...new Uint8Array(challengeBytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const url=new URL(request.url); const next=url.searchParams.get('next') || '/';
  await run('DELETE FROM oauth_states WHERE expires_at<=?',now());
  await run('INSERT INTO oauth_states(state_hash,code_verifier,nonce,next_path,expires_at,created_at) VALUES(?,?,?,?,?,?)',
    await sha256(state),verifier,nonce,next.startsWith('/')?next:'/',new Date(Date.now()+600000).toISOString(),now());
  const known=(cookies(request).tfiles_oauth_states || '').split('.').filter(v=>/^[A-Za-z0-9_-]{43}$/.test(v)).slice(-4);
  const params=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:`${appOrigin(request)}/auth/google/callback`,response_type:'code',
    scope:'openid email profile',state,nonce,code_challenge:challenge,code_challenge_method:'S256',prompt:'select_account',hd:env.ALLOWED_EMAIL_DOMAIN || 'tschool.tp.edu.tw'});
  return new Response(null,{status:302,headers:{Location:`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 'Set-Cookie':cookie('tfiles_oauth_states',[...known,state].join('.'),600)}});
}
