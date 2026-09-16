'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

type Member = { id:string;email:string;display_name:string;role:string;status:string;created_at:string;last_login:string|null;last_login_audit:string|null;files:number;links:number;folders:number;bytes:number };
type Event = { id:number;action:string;actor_id:string|null;target_id:string|null;details:string;created_at:string;actor_name:string;actor_email:string|null;resource_title:string|null;resource_kind:string|null };
type FileRow = { id:string;title:string;size_bytes:number|null;created_at:string;trashed_at:string|null;owner_name:string;owner_email:string };
type Health = { currentBytes:number;fileCount:number;versionCount:number;databaseBytes:number;disk:{total:number;free:number}|null;backup:{configured:boolean;latest:string|null;ageHours:number|null;count:number};smtpConfigured:boolean;security:Event[] };
const date = (value:string|null) => value ? new Intl.DateTimeFormat('zh-TW',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)) : '尚無紀錄';
const bytes = (value:number|null) => value==null ? '未知' : value<1024 ? `${value} B` : value<1048576 ? `${(value/1024).toFixed(1)} KB` : value<1073741824 ? `${(value/1048576).toFixed(1)} MB` : `${(value/1073741824).toFixed(2)} GB`;
const labels:Record<string,string> = {
  'auth.password_login':'登入','auth.login_failed':'登入失敗','auth.rate_limited':'觸發登入／寄信頻率限制',
  'auth.mail_sent':'驗證信已交給 SMTP','auth.mail_failed':'驗證信寄送失敗','auth.password_set':'設定密碼',
  'admin.account_reset':'要求重新註冊','admin.mail_resent':'管理員重寄設定信','admin.resource_opened':'管理員開啟項目',
  'resource.file_created':'上傳檔案','resource.link_created':'建立連結','resource.folder_created':'建立資料夾',
  'resource.updated':'修改內容','resource.moved':'移動項目','resource.trashed':'移到垃圾桶',
  'resource.restored':'從垃圾桶還原','resource.deleted_permanently':'永久刪除','resource.downloaded':'下載檔案',
  'resource.selection_downloaded':'批次下載','resource.version_restored':'還原版本',
  'share.access_configured':'修改存取權','share.member_updated':'指定共享成員',
};

export default function AdminPanel({ csrf, onOpenResource }: { csrf:string;onOpenResource:(id:string)=>Promise<void> }) {
  const [view,setView] = useState<'members'|'events'|'files'|'health'>('members');
  const [q,setQ] = useState(''),[member,setMember] = useState(''),[memberName,setMemberName] = useState('');
  const [from,setFrom] = useState(''),[to,setTo] = useState(''),[order,setOrder] = useState('newest');
  const [page,setPage] = useState(1),[hasMore,setHasMore] = useState(false);
  const [members,setMembers] = useState<Member[]>([]),[events,setEvents] = useState<Event[]>([]),[files,setFiles] = useState<FileRow[]>([]),[health,setHealth] = useState<Health|null>(null);
  const [loading,setLoading] = useState(false),[error,setError] = useState(''),[message,setMessage] = useState('');
  const [confirm,setConfirm] = useState<{user:Member;operation:'reset-registration'|'resend-mail'|'activate'}|null>(null),[pending,setPending] = useState(false);
  const load = useCallback(async(signal?:AbortSignal) => {
    setLoading(true);setError('');
    try {
      const params = new URLSearchParams({view,q,member,from,to,order,page:String(page)});
      const response = await fetch(`/api/admin?${params}`,{cache:'no-store',signal});
      const data = await response.json() as {error?:string;members:Member[];events:Event[];files:FileRow[];health:Health;hasMore?:boolean};
      if(!response.ok) throw new Error(data.error||'無法讀取管理資料。');
      setHasMore(Boolean(data.hasMore));
      if(view==='members')setMembers(data.members);
      if(view==='events')setEvents(data.events);
      if(view==='files')setFiles(data.files);
      if(view==='health')setHealth(data.health);
    } catch(e) { if(!signal?.aborted)setError((e as Error).message); }
    finally { if(!signal?.aborted)setLoading(false); }
  },[view,q,member,from,to,order,page]);
  // oxlint-disable-next-line react/react-compiler -- Fetch remote administrator data when filters change.
  useEffect(()=>{const controller=new AbortController();void load(controller.signal);return()=>controller.abort();},[load]);
  const selectView = (next:typeof view) => {setView(next);setPage(1);setQ('');setMember('');setMemberName('');setError('');setMessage('');};
  const pagination = view!=='health'&&<div className="admin-pagination"><button disabled={page===1} onClick={()=>setPage(p=>p-1)}>上一頁</button><span>第 {page} 頁</span><button disabled={!hasMore} onClick={()=>setPage(p=>p+1)}>下一頁</button></div>;
  const openResource = async(id:string) => {try{await onOpenResource(id)}catch(e){setError((e as Error).message)}};
  const act = async() => {
    if(!confirm||pending)return;
    setPending(true);setError('');setMessage('');
    try {
      const response=await fetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({csrf,userId:confirm.user.id,operation:confirm.operation})});
      const data=await response.json() as {error?:string;message:string};if(!response.ok)throw new Error(data.error||'操作失敗。');
      setMessage(data.message);setConfirm(null);await load();
    }catch(e){setError((e as Error).message)}finally{setPending(false)}
  };
  return <section className="admin-panel">
    <div className="page-head"><div><p className="eyebrow">ADMINISTRATION</p><h1>管理員</h1><p>成員、操作紀錄、檔案與系統狀態</p></div></div>
    <nav className="admin-tabs" aria-label="管理項目">
      {([['members','成員'],['events','時間'],['files','檔案大小'],['health','系統狀態']] as const).map(([key,label])=><button key={key} className={view===key?'active':''} onClick={()=>selectView(key)} aria-current={view===key?'page':undefined}>{label}</button>)}
    </nav>
    {view!=='health'&&<div className="admin-filters">
      <label>搜尋{view==='members'?'成員':'檔案或成員'}<input value={q} onChange={e=>{setPage(1);setQ(e.target.value)}} placeholder={view==='members'?'顯示名稱或學校信箱':'名稱或學校信箱'}/></label>
      {view==='events'&&<><label>從<input type="date" value={from} onChange={e=>{setPage(1);setFrom(e.target.value)}}/></label><label>到<input type="date" value={to} onChange={e=>{setPage(1);setTo(e.target.value)}}/></label></>}
      {view!=='members'&&<label>排序<select value={order} onChange={e=>{setPage(1);setOrder(e.target.value)}}>{view==='events'?<><option value="newest">最新操作</option><option value="oldest">最舊操作</option></>:<><option value="newest">檔案最大</option><option value="smallest">檔案最小</option></>}</select></label>}
    </div>}
    {member&&view==='events'&&<button className="admin-back" onClick={()=>{setPage(1);setMember('');setMemberName('');setView('members')}}>← 返回成員　目前：{memberName}</button>}
    {message&&<output className="admin-message">{message}</output>}
    {error&&<p className="notice" role="alert">{error}</p>}
    {loading&&<output>正在讀取管理資料…</output>}
    {!loading&&view==='members'&&<div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>成員</th><th>註冊時間</th><th>最近登入</th><th>檔案</th><th>連結</th><th>資料夾</th><th>檔案空間</th><th>處理</th></tr></thead><tbody>{members.map(u=><tr key={u.id}><td><button className="admin-link" aria-label={`查看 ${u.display_name} 的操作紀錄`} onClick={()=>{setPage(1);setMember(u.id);setMemberName(u.display_name);setView('events');setQ('')}}>{u.display_name}</button><small>{u.email}</small>{u.status!=='active'&&<small className="admin-status">{u.status==='reset_required'?'待重新註冊':u.status==='pending'?'待審核':'已停用'}</small>}</td><td>{date(u.created_at)}</td><td>{date(u.last_login_audit||u.last_login)}</td><td>{u.files}</td><td>{u.links}</td><td>{u.folders}</td><td>{bytes(u.bytes)}</td><td><div className="admin-row-actions">{u.status==='pending'&&<button aria-label={`啟用 ${u.display_name}`} onClick={()=>setConfirm({user:u,operation:'activate'})}>啟用帳號</button>}<button aria-label={`要求 ${u.display_name} 重新註冊`} disabled={u.role==='admin'||u.status==='reset_required'} onClick={()=>setConfirm({user:u,operation:'reset-registration'})}>要求重新註冊</button><button aria-label={`重寄設定信給 ${u.display_name}`} disabled={u.status==='disabled'} onClick={()=>setConfirm({user:u,operation:'resend-mail'})}>重寄設定信</button></div></td></tr>)}</tbody></table>{!members.length&&<p className="admin-empty">找不到成員。</p>}<p className="admin-footnote">統計為目前未在垃圾桶的項目；重新註冊保留原帳號 ID 與檔案擁有者。</p>{pagination}</div>}
    {!loading&&view==='events'&&<div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>操作時間</th><th>成員</th><th>操作</th><th>項目</th><th>補充資訊</th></tr></thead><tbody>{events.map(e=><tr key={e.id}><td>{date(e.created_at)}</td><td>{e.actor_name}<small>{e.actor_email}</small></td><td>{labels[e.action]||e.action}</td><td>{e.resource_title?<button className="admin-link" onClick={()=>e.target_id&&void openResource(e.target_id)}>{e.resource_title}</button>:'—'}</td><td><small>{eventDetails(e.details)}</small></td></tr>)}</tbody></table>{!events.length&&<p className="admin-empty">此條件沒有操作紀錄。</p>}<p className="admin-footnote">永久刪除項目的名稱可能已無法從資料庫取得。</p>{pagination}</div>}
    {!loading&&view==='files'&&<div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>檔案</th><th>擁有者</th><th>建立時間</th><th>大小</th><th>狀態</th></tr></thead><tbody>{files.map(f=><tr key={f.id}><td><button className="admin-link" onClick={()=>void openResource(f.id)}>{f.title}</button></td><td>{f.owner_name}<small>{f.owner_email}</small></td><td>{date(f.created_at)}</td><td>{bytes(f.size_bytes)}</td><td>{f.trashed_at?'垃圾桶':'使用中'}</td></tr>)}</tbody></table>{!files.length&&<p className="admin-empty">沒有符合條件的檔案。</p>}<p className="admin-footnote">包含垃圾桶中的檔案。</p>{pagination}</div>}
    {!loading&&view==='health'&&health&&<><div className="admin-health-grid">
      <article><h2>目前檔案</h2><strong>{health.fileCount} 個 · {bytes(health.currentBytes)}</strong><p>資料庫記錄的現有檔案大小；歷史版本另有 {health.versionCount} 筆。</p></article>
      <article><h2>資料庫</h2><strong>{bytes(health.databaseBytes)}</strong><p>目前 PostgreSQL 資料庫大小。</p></article>
      <article><h2>主機磁碟</h2><strong>{health.disk?`可用 ${bytes(health.disk.free)} / ${bytes(health.disk.total)}`:'無法讀取'}</strong><p>檔案所在磁碟的可用空間，包含其他服務使用量。</p></article>
      <article><h2>備份</h2><strong>{!health.backup.configured?'未設定備份目錄':health.backup.latest?`最近：${date(health.backup.latest)}`:'沒有可驗證的備份'}</strong><p>{health.backup.latest?`${health.backup.count} 份備份檔，最近一份約 ${health.backup.ageHours} 小時前。僅檢查時間，尚未驗證可還原。`:'正式使用前應排程資料庫與檔案備份，並定期測試還原。'}</p></article>
      <article><h2>郵件</h2><strong>{health.smtpConfigured?'SMTP 已設定':'SMTP 未設定'}</strong><p>已設定不代表郵件確實送達。可查看下方寄信失敗紀錄。</p></article>
      <article><h2>系統更新</h2><strong>由伺服器部署</strong><p>需在伺服器執行 Git 更新、建置與 PM2 重啟；後台不直接執行系統命令。</p></article>
    </div><h2 className="admin-section-title">近期登入與寄信異常</h2><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>時間</th><th>事件</th><th>來源／信箱</th></tr></thead><tbody>{health.security.map((e,i)=><tr key={i}><td>{date(e.created_at)}</td><td>{labels[e.action]||e.action}</td><td>{eventDetails(e.details)}</td></tr>)}</tbody></table>{!health.security.length&&<p className="admin-empty">沒有近期紀錄。</p>}</div><p className="admin-footnote">登入失敗與頻率限制可以幫助調查異常；來源 IP 為代理伺服器轉送的資訊，不能單獨當作攻擊者身分證據。</p></>}
    {confirm&&<div className="admin-confirm-backdrop" role="presentation"><dialog className="admin-confirm" open aria-label="確認帳號操作"><h2>{confirm.operation==='reset-registration'?'要求重新註冊':confirm.operation==='activate'?'啟用帳號':'重寄設定信'}</h2><p>{confirm.user.display_name}（{confirm.user.email}）</p><p>{confirm.operation==='reset-registration'?'將立即撤銷舊密碼與所有登入，成員須以相同學校信箱驗證後重新設定密碼。原檔案與擁有者保留。':confirm.operation==='activate'?'啟用後，成員可使用已驗證的學校信箱登入。':'系統將寄出有效 30 分鐘的設定連結；不會替成員設定密碼。'}</p><div><Button variant="outline" disabled={pending} onClick={()=>setConfirm(null)}>取消</Button><Button disabled={pending} onClick={()=>void act()}>{pending?'處理中…':'確認'}</Button></div></dialog></div>}
  </section>;
}

function eventDetails(raw:string) {
  try { const value=JSON.parse(raw) as Record<string,unknown>; return Object.entries(value).filter(([key])=>['email','ip','recipient','reason','revision','count','parentId','purpose'].includes(key)).map(([key,v])=>`${key}: ${String(v)}`).join(' · ') || '—'; }
  catch { return '—'; }
}
