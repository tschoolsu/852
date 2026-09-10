'use client';

import { useRef,useState,type SyntheticEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription } from '@/components/ui/dialog';

async function post(action:string,body:Record<string,unknown>) {
  try {
    const response=await fetch(`/api/auth/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
    const data=await response.json() as {message?:string;error?:string;displayName?:string};
    if(!response.ok)throw new Error(data.error || '操作失敗，請稍後再試。');
    return data;
  }catch(error){
    if(error instanceof TypeError||(error as Error).name==='TimeoutError')throw new Error('連線中斷或回應逾時，請檢查信箱或嘗試登入，確認剛才的操作是否已完成。');
    throw error;
  }
}

type Mode='login'|'register'|'forgot'|'complete';
export default function AuthPanel({onSignedIn}:{onSignedIn:()=>Promise<void>}) {
  const [mode,setMode]=useState<Mode>(()=>typeof window!=='undefined'&&new URLSearchParams(window.location.search).get('auth')==='complete'?'complete':'login');
  const [email,setEmail]=useState(''),[message,setMessage]=useState(''),[error,setError]=useState(''),[pending,setPending]=useState(false);
  const lock=useRef(false);
  const switchMode=(next:Mode)=>{if(lock.current)return;setMode(next);setMessage('');setError('');const url=new URL(location.href);url.searchParams.delete('auth');url.searchParams.delete('error');url.hash='';history.replaceState(null,'',url);};
  const submit=async(event:SyntheticEvent<HTMLFormElement>)=>{
    event.preventDefault();if(lock.current)return;
    const body=Object.fromEntries(new FormData(event.currentTarget));
    if(mode==='complete')body.token=new URLSearchParams(location.hash.slice(1)).get('token') || '';
    lock.current=true;setPending(true);setError('');setMessage('');
    try{
      const result=await post(mode,body);
      if(mode==='login')await onSignedIn();
      else if(mode==='complete'){
        const url=new URL(location.href);url.hash='';url.searchParams.delete('auth');history.replaceState(null,'',url);
        setMode('login');setMessage(result.message || '設定完成，請登入。');
      }else setMessage(result.message || '請查看學校信箱。');
    }catch(e){setError((e as Error).message)}finally{lock.current=false;setPending(false)}
  };
  const title={login:'登入',register:'註冊帳號',forgot:'忘記／首次設定密碼',complete:'設定密碼'}[mode];
  return <main className="login-page"><section className="login-intro"><div className="brand light"><span className="brand-mark">T</span><strong>學生會內部服務</strong></div><div><h1>學生會檔案<br/>管理系統</h1><p>使用你的學校信箱與獨立密碼登入</p></div><small>T Files © 2026 TSchool 學生會數位部</small></section><section className="login-panel"><div className="login-card"><p className="eyebrow">學生會檔案庫</p><h2>{title}</h2>
    <p>{mode==='login'?'此系統使用獨立密碼，與學校及 Google 密碼分開。':mode==='register'?'先驗證學校信箱，再自行設定顯示名稱與密碼。':mode==='forgot'?'輸入學校信箱，我們會寄送密碼設定連結。原 Google 使用者也可從這裡設定密碼，檔案與權限會保留。':'請設定獨立密碼。新帳號需填寫顯示名稱；既有帳號留白則保留原名稱。'}</p>
    {error&&<div className="notice" role="alert">{error}</div>}{message&&<output className="operation-status">{message}</output>}
    <form onSubmit={submit}><fieldset disabled={pending} className="form-stack">
      {mode!=='complete'&&<><label htmlFor="auth-email">學校信箱</label><Input id="auth-email" type="email" name="email" autoComplete="username" placeholder="學號@tschool.tp.edu.tw" value={email} onChange={e=>setEmail(e.target.value)} maxLength={254} required/></>}
      {mode==='complete'&&<><label htmlFor="auth-name">顯示名稱</label><Input id="auth-name" name="displayName" autoComplete="nickname" maxLength={80} placeholder="你希望顯示的名稱"/></>}
      {(mode==='login'||mode==='complete')&&<><label htmlFor="auth-password">{mode==='complete'?'新密碼':'密碼'}</label><Input id="auth-password" type="password" name="password" minLength={8} maxLength={128} autoComplete={mode==='login'?'current-password':'new-password'} required/>{mode==='complete'&&<><small>8～128 個字元，可使用長密碼或密碼片語。</small><label htmlFor="auth-confirm">再次輸入密碼</label><Input id="auth-confirm" name="confirmPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} required/></>}</>}
      <Button type="submit" disabled={pending}>{pending?'處理中…':mode==='login'?'登入':mode==='complete'?'儲存新密碼':'寄送驗證／密碼設定信'}</Button>
    </fieldset></form>
    <div className="auth-links">{mode==='login'?<><button disabled={pending} onClick={()=>switchMode('register')}>註冊帳號</button><button disabled={pending} onClick={()=>switchMode('forgot')}>忘記／首次設定密碼</button></>:<button disabled={pending} onClick={()=>switchMode('login')}>返回登入</button>}</div>
    <small>僅接受 @tschool.tp.edu.tw 學校信箱</small>
  </div></section></main>;
}

export function ProfileDialog({name,csrf,onClose,onSaved}:{name:string;csrf:string;onClose:()=>void;onSaved:(name:string)=>void}) {
  const [pending,setPending]=useState(false),[error,setError]=useState('');const lock=useRef(false);
  const submit=async(event:SyntheticEvent<HTMLFormElement>)=>{event.preventDefault();if(lock.current)return;const value=new FormData(event.currentTarget).get('displayName');const displayName=typeof value==='string'?value:'';lock.current=true;setPending(true);setError('');try{const data=await post('profile',{displayName,csrf});onSaved(data.displayName!);onClose();}catch(e){setError((e as Error).message)}finally{lock.current=false;setPending(false)}};
  return <Dialog open onOpenChange={open=>!open&&!lock.current&&onClose()}><DialogContent showCloseButton={!pending}><DialogHeader><DialogTitle>修改顯示名稱</DialogTitle><DialogDescription>檔案擁有者與共享搜尋會使用這個名稱。</DialogDescription></DialogHeader>{error&&<div className="notice" role="alert">{error}</div>}<form onSubmit={submit}><fieldset className="form-stack" disabled={pending}><label htmlFor="profile-name">顯示名稱</label><Input id="profile-name" name="displayName" defaultValue={name} maxLength={80} required/><Button type="submit">{pending?'儲存中…':'儲存'}</Button></fieldset></form></DialogContent></Dialog>;
}
