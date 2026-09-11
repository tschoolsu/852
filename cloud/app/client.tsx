'use client';
import AuthPanel,{ProfileDialog} from './auth-panel';

import { useCallback, useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';
import { ArchiveRestore, ChevronRight, Download, File, FileImage, FileText, Folder, FolderInput, History, Link as LinkIcon, LogOut, Menu, MoreHorizontal, Pencil, Plus, Search, Share2, Trash2, Upload, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

type User={id:string;email:string;displayName:string;role:string};
type Item={id:string;kind:'file'|'link'|'folder';title:string;description:string;url:string|null;original_name:string|null;mime_type:string|null;size_bytes:number|null;owner_id:string;owner_name:string;owner_email:string;parent_id:string|null;access_level:string;permission:string;revision:number;trashed_at:string|null;created_at:string;updated_at:string};
type Detail={resource:Item;versions:Array<{revision:number;event:string;actor_id:string;original_name:string|null;size_bytes:number|null;created_at:string}>;members:Array<{id:string;email:string;display_name:string;role:string}>;link:{role:string}|null};

async function requestJson<T=Record<string,unknown>>(url:string,options:RequestInit={}):Promise<T> {
  const headers=new Headers(options.headers); headers.set('Accept','application/json');
  const readOnly=!options.method||options.method==='GET';
  const timeout=readOnly?30000:options.body instanceof FormData?600000:60000;
  const signal=AbortSignal.any([AbortSignal.timeout(timeout),...(options.signal?[options.signal]:[])]);
  try {
    const response=await fetch(url,{...options,headers,signal,cache:'no-store'});
    const data=await response.json() as T & {error?:string};
    if(!response.ok) throw new Error(data.error || '操作失敗，請稍後再試。'); return data;
  } catch(error) {
    if(options.signal?.aborted) throw error;
    if((error as Error).name==='TimeoutError') throw new Error(readOnly?'讀取逾時，請重新載入清單。':'等待回應逾時，尚無法確認操作結果。請關閉視窗並重新載入清單確認，避免重複送出。');
    if(error instanceof TypeError||error instanceof SyntaxError) throw new Error(readOnly?'無法讀取資料，請檢查連線後再試。':'連線中斷，尚無法確認操作結果。請關閉視窗並重新載入清單確認，避免重複送出。');
    throw error;
  }
}
const formatDate=(value:string)=>new Intl.DateTimeFormat('zh-TW',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
const formatSize=(bytes:number|null)=>bytes==null?'':bytes<1024?`${bytes} B`:bytes<1048576?`${(bytes/1024).toFixed(1)} KB`:`${(bytes/1048576).toFixed(1)} MB`;
const formatKind=(item:Item)=>item.kind==='folder'?'資料夾':item.kind==='link'?'LINK':(item.original_name?.split('.').pop()||'FILE').toUpperCase();
const eventLabel=(event:string)=>({created:'建立',updated:'修改',moved:'移動',version_restored:'還原舊版本'}[event]||event);

export default function ClientApp(){
  const [profileOpen,setProfileOpen]=useState(false);
  const [checkedIds,setCheckedIds]=useState<Set<string>>(new Set());
  const [user,setUser]=useState<User|null>(null),[csrf,setCsrf]=useState(''),[checking,setChecking]=useState(true);
  const [items,setItems]=useState<Item[]>([]),[folder,setFolder]=useState<Item|null>(null),[scope,setScope]=useState<'accessible'|'mine'|'trash'>('accessible');
  const [parent,setParent]=useState(''),[query,setQuery]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[mobile,setMobile]=useState(false);
  const [createKind,setCreateKind]=useState<''|'file'|'link'|'folder'>(''),[selected,setSelected]=useState<Item|null>(null),[detail,setDetail]=useState<Detail|null>(null);
  const [mode,setMode]=useState<''|'edit'|'move'|'share'|'versions'>(''),[folders,setFolders]=useState<Item[]>([]),[confirmDelete,setConfirmDelete]=useState(false),[generatedLink,setGeneratedLink]=useState('');
  const [loading,setLoading]=useState(false),[listError,setListError]=useState(''),[operationError,setOperationError]=useState(''),[operationLabel,setOperationLabel]=useState('');
  const mutationLock=useRef(false),listRequest=useRef(0),detailRequest=useRef(0);
  const share=typeof window==='undefined'?'':new URLSearchParams(window.location.search).get('share')||'';

  const load=useCallback(async(signal?:AbortSignal)=>{
    if(!user)return;const id=++listRequest.current;setLoading(true);setListError('');setCheckedIds(new Set());
    try{const params=new URLSearchParams({scope,parent,q:query,share});const data=await requestJson<{items:Item[];folder:Item|null}>(`/api/resources?${params}`,{signal});if(id===listRequest.current){setItems(data.items);setFolder(data.folder);}}
    catch(e){if(id===listRequest.current&&!signal?.aborted)setListError((e as Error).message);}
    finally{if(id===listRequest.current)setLoading(false);}
  },[user,scope,parent,query,share]);
  useEffect(()=>{requestJson<{user:User;csrf:string}>('/api/me').then(data=>{setUser(data.user);setCsrf(data.csrf)}).catch(()=>setUser(null)).finally(()=>setChecking(false));},[]);
  // oxlint-disable-next-line react/react-compiler -- Refresh server state whenever the selected folder or scope changes.
  useEffect(()=>{const controller=new AbortController();void load(controller.signal);return()=>controller.abort();},[load]);
  const closeDetail=()=>{++detailRequest.current;setConfirmDelete(false);setSelected(null);setDetail(null);setMode('');setGeneratedLink('');setOperationError('');};
  const openDetail=async(item:Item)=>{if(mutationLock.current)return;if(item.kind==='folder'&&!item.trashed_at){setParent(item.id);return;}const id=++detailRequest.current;setSelected(item);setDetail(null);setMode('');setOperationError('');setMessage('');try{const data=await requestJson<Detail>(`/api/resources/${item.id}?share=${encodeURIComponent(share)}&trash=${item.trashed_at?'1':'0'}`);if(id===detailRequest.current)setDetail(data);}catch(e){if(id===detailRequest.current){closeDetail();setMessage((e as Error).message)}}};
  const refresh=async()=>{closeDetail();setMessage('操作已完成。');await load();};
  const mutate=async(operation:string,data:Record<string,unknown>|FormData={})=>{
    if(!selected||mutationLock.current)return;mutationLock.current=true;setBusy(true);setOperationError('');setMessage('');
    setOperationLabel(operation==='delete'?'正在永久刪除…':operation==='edit'?'正在儲存…':operation==='trash'?'正在移到垃圾桶…':'正在處理…');
    try{
      let options:RequestInit;
      if(data instanceof FormData){data.set('operation',operation);data.set('csrf',csrf);data.set('share',share);options={method:'POST',body:data};}
      else options={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation,csrf,share,...data})};
      const result=await requestJson<{warning?:string;url?:string}>(`/api/resources/${selected.id}`,options);
      if(operation==='link-generate'&&result.url){setGeneratedLink(result.url);return;}
      await refresh();if(result.warning)setMessage(result.warning);
    }catch(e){setOperationError((e as Error).message)}finally{mutationLock.current=false;setBusy(false)}
  };

  if(checking)return <div className="loading-screen"><div className="loading-mark">T</div><p>正在開啟檔案庫…</p></div>;
  if(!user)return <AuthPanel onSignedIn={async()=>{const data=await requestJson<{user:User;csrf:string}>('/api/me');setUser(data.user);setCsrf(data.csrf)}}/>;

  return <div className="app-shell">
    <header className="topbar"><button className="mobile-menu" onClick={()=>setMobile(v=>!v)} aria-label="開啟選單"><Menu/></button><div className="brand"><span className="brand-mark">T</span><div><strong>學生會檔案管理系統</strong><small>TSchool 學生會數位部</small></div></div>
      <label className="search-box"><Search/><input disabled={busy} value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜尋檔案、連結或資料夾"/></label>
      <div className="account"><span><strong>{user.displayName}</strong><small>{user.email}{user.role==='admin'?' · 管理員':''}</small></span><Button variant="ghost" size="icon" aria-label="修改顯示名稱" onClick={()=>setProfileOpen(true)}><Pencil/></Button><Button variant="ghost" size="icon" aria-label="登出" onClick={async()=>{await requestJson('/api/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({csrf})});location.href='/';}}><LogOut/></Button></div>
    </header>
    <aside className={`sidebar ${mobile?'sidebar-open':''}`}><button className="sidebar-close" onClick={()=>setMobile(false)}><X/></button><p className="nav-label">檔案庫</p>
      <Nav active={scope==='accessible'} icon={<Folder/>} label="可存取的內容" onClick={()=>{if(mutationLock.current)return;setScope('accessible');setParent('');setMobile(false)}}/>
      <Nav active={scope==='mine'} icon={<Upload/>} label="我的上傳紀錄" onClick={()=>{if(mutationLock.current)return;setScope('mine');setParent('');setMobile(false)}}/>
      <Nav active={scope==='trash'} icon={<Trash2/>} label="垃圾桶" onClick={()=>{if(mutationLock.current)return;setScope('trash');setParent('');setMobile(false)}}/>
      <div className="sidebar-note"><strong>學校帳號限定</strong><p>只有登入過本系統的 @tschool.tp.edu.tw 成員可被指定共享。</p></div>
    </aside>
    <main className="content"><div className="page-head"><div><p className="eyebrow">{scope==='mine'?'MY UPLOADS':scope==='trash'?'TRASH':'LIBRARY'}</p><h1>{folder?.title || (scope==='mine'?'我的上傳紀錄':scope==='trash'?'垃圾桶':'可存取的內容')}</h1><p>{scope==='trash'?'只有擁有者可以還原或永久刪除。':'集中管理學生會的檔案、網址與資料夾。'}</p></div>{parent&&<Button variant="outline" disabled={busy} onClick={()=>setParent(folder?.parent_id||'')}>回上一層</Button>}</div>
      {message&&<div className="notice" role="alert">{message}</div>}
      {listError&&<div className="notice" role="alert">{listError}<Button variant="outline" onClick={()=>void load()}>重新載入清單</Button></div>}
      {loading&&<OperationStatus active label="正在載入清單…"/>}
      <div className="selection-toolbar"><label><input type="checkbox" aria-label="全選目前清單" disabled={busy||loading||Boolean(listError)||!items.length} checked={items.length>0&&checkedIds.size===items.length} ref={node=>{if(node)node.indeterminate=checkedIds.size>0&&checkedIds.size<items.length}} onChange={e=>setCheckedIds(e.target.checked?new Set(items.map(item=>item.id)):new Set())}/>全選目前清單</label><output>已選取 {checkedIds.size} 項</output>{checkedIds.size>0&&<Button variant="ghost" size="sm" disabled={busy} onClick={()=>setCheckedIds(new Set())}>取消選取</Button>}</div>
      <div className="file-table" aria-busy={loading}><div className="file-row file-header selection-header"><span>類型</span><span>名稱</span><span>擁有者</span><span>更新時間</span><span></span></div>
        {items.map(item=><div className={`selectable-row ${checkedIds.has(item.id)?'row-selected':''}`} key={item.id}><label className="row-check"><input type="checkbox" aria-label={`選取 ${item.title}`} checked={checkedIds.has(item.id)} disabled={busy||loading||Boolean(listError)} onChange={e=>{const checked=e.target.checked;setCheckedIds(current=>{const next=new Set(current);if(checked)next.add(item.id);else next.delete(item.id);return next;});}}/></label><button className="file-row" disabled={busy||loading} onClick={()=>openDetail(item)}><KindIcon item={item}/><span className="file-name"><strong>{item.title}</strong><small>{item.description || formatKind(item)}{item.size_bytes?` · ${formatSize(item.size_bytes)}`:''}</small></span><span>{item.owner_name||'—'}</span><span>{formatDate(item.updated_at)}</span><MoreHorizontal/></button></div>)}
        {!loading&&!listError&&!items.length&&<div className="empty"><span>{scope==='trash'?'00':'+'}</span><h2>{query?'找不到符合的內容':scope==='trash'?'垃圾桶是空的':'這裡還沒有內容'}</h2><p>{scope==='trash'?'刪除的檔案、連結與資料夾會出現在這裡。':'使用右下角的加號新增第一個項目。'}</p></div>}
      </div>
      <BulkActions items={items.filter(item=>checkedIds.has(item.id))} trash={scope==='trash'} csrf={csrf} share={share} disabled={busy||loading||Boolean(listError)} setBusy={value=>{mutationLock.current=value;setBusy(value)}} onDone={async failed=>{await load();setCheckedIds(new Set(failed));}}/>
    </main>
    {scope!=='trash'&&<DropdownMenu><DropdownMenuTrigger render={<button className="fab" aria-label="新增內容"><Plus/></button>}/><DropdownMenuContent side="top" align="end" className="w-48 p-2"><DropdownMenuItem onClick={()=>setCreateKind('file')}><Upload/>上傳檔案</DropdownMenuItem><DropdownMenuItem onClick={()=>setCreateKind('link')}><LinkIcon/>發表連結</DropdownMenuItem><DropdownMenuItem onClick={()=>setCreateKind('folder')}><Folder/>建立資料夾</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}
    {profileOpen&&<ProfileDialog name={user.displayName} csrf={csrf} onClose={()=>setProfileOpen(false)} onSaved={displayName=>{setUser({...user,displayName});void load()}}/>}
    <CreateDialog key={createKind} kind={createKind} setKind={setCreateKind} csrf={csrf} parent={parent} onDone={refresh}/>
    <DetailDialog close={closeDetail} error={operationError} status={operationLabel} detail={detail} selected={selected} mode={mode} setMode={setMode} busy={busy} mutate={mutate} folders={folders} setFolders={setFolders} generatedLink={generatedLink} setMessage={setOperationError} openDelete={()=>{setOperationError('');setConfirmDelete(true)}}/>
    <AlertDialog open={confirmDelete} onOpenChange={open=>{if(!mutationLock.current){setConfirmDelete(open);setOperationError('')}}}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>永久刪除這個項目？</AlertDialogTitle><AlertDialogDescription>所有版本與檔案內容都會永久刪除，無法還原。</AlertDialogDescription></AlertDialogHeader>{operationError&&<div className="notice" role="alert">{operationError}</div>}<OperationStatus active={busy} label={operationLabel}/><AlertDialogFooter><AlertDialogCancel disabled={busy}>取消</AlertDialogCancel><AlertDialogAction disabled={busy} className="danger-solid" onClick={()=>mutate('delete')}>{busy?'正在刪除…':'永久刪除'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}


function Nav({active,icon,label,onClick}:{active:boolean;icon:ReactNode;label:string;onClick:()=>void}){return <button className={`nav-item ${active?'active':''}`} onClick={onClick}>{icon}<span>{label}</span></button>}
function KindIcon({item}:{item:Item}){const Icon=item.kind==='folder'?Folder:item.kind==='link'?LinkIcon:item.mime_type?.startsWith('image/')?FileImage:item.mime_type==='application/pdf'?FileText:File;return <span className={`kind-icon ${item.kind}`}><Icon/><small>{formatKind(item)}</small></span>}

function OperationStatus({active,label}:{active:boolean;label:string}){
  const [slow,setSlow]=useState(false);
  useEffect(()=>{if(!active)return;const timer=setTimeout(()=>setSlow(true),10000);return()=>{clearTimeout(timer);setSlow(false)};},[active]);
  if(!active)return null;
  return <output className="operation-status"><span className="operation-spinner" aria-hidden="true"/>{label}{slow&&' 處理時間較長，請保持視窗開啟，勿重複送出。'}</output>;
}

function CreateDialog({kind,setKind,csrf,parent,onDone}:{kind:string;setKind:(v:''|'file'|'link'|'folder')=>void;csrf:string;parent:string;onDone:()=>Promise<void>}){
  const [pending,setPending]=useState(false),[error,setError]=useState('');const lock=useRef(false);
  const submit=async(e:SyntheticEvent<HTMLFormElement>)=>{e.preventDefault();if(lock.current)return;const form=new FormData(e.currentTarget);form.set('kind',kind);form.set('csrf',csrf);form.set('parentId',parent);lock.current=true;setPending(true);setError('');try{await requestJson('/api/resources',{method:'POST',body:form});setKind('');await onDone();}catch(err){setError((err as Error).message)}finally{lock.current=false;setPending(false)}};
  return <Dialog open={Boolean(kind)} onOpenChange={open=>!open&&!lock.current&&setKind('')}><DialogContent className="sm:max-w-lg" showCloseButton={!pending}><DialogHeader><DialogTitle>{kind==='file'?'上傳檔案':kind==='link'?'發表連結':'建立資料夾'}</DialogTitle><DialogDescription>內容會建立在目前所在的位置。</DialogDescription></DialogHeader>{error&&<div className="notice" role="alert">{error}</div>}<form id="create-form" onSubmit={submit} aria-busy={pending}><fieldset className="form-stack" disabled={pending}><label htmlFor="create-title">{kind==='file'?'名稱（選填）':'名稱'}</label><Input id="create-title" name="title" required={kind!=='file'} placeholder={kind==='file'?'不填則使用原始檔名':kind==='folder'?'例如：活動企劃':''}/><label htmlFor="create-description">說明</label><Textarea id="create-description" name="description" placeholder="可留白"/>{kind==='file'&&<><label htmlFor="create-file">選擇檔案</label><Input id="create-file" name="file" type="file" required/></>}{kind==='link'&&<><label htmlFor="create-url">網址</label><Input id="create-url" name="url" type="url" required placeholder="https://"/></>}</fieldset></form><OperationStatus active={pending} label={kind==='file'?'正在上傳檔案…':'正在建立…'}/><DialogFooter><Button disabled={pending} type="submit" form="create-form">{pending?(kind==='file'?'上傳中…':'建立中…'):'建立'}</Button></DialogFooter></DialogContent></Dialog>
}

function DetailDialog({detail,selected,close,error,status,mode,setMode,busy,mutate,folders,setFolders,generatedLink,setMessage,openDelete}:{detail:Detail|null;selected:Item|null;close:()=>void;error:string;status:string;mode:string;setMode:(v:''|'edit'|'move'|'share'|'versions')=>void;busy:boolean;mutate:(op:string,data?:Record<string,unknown>|FormData)=>Promise<void>;folders:Item[];setFolders:(v:Item[])=>void;generatedLink:string;setMessage:(v:string)=>void;openDelete:()=>void}){
  if(!selected)return null;
  if(!detail)return <Dialog open onOpenChange={open=>!open&&close()}><DialogContent><DialogHeader><DialogTitle>{selected.title}</DialogTitle><DialogDescription>正在讀取項目內容。</DialogDescription></DialogHeader><OperationStatus active label="正在開啟…"/></DialogContent></Dialog>;
  const r=detail.resource,owner=r.permission==='owner';
  const loadFolders=async()=>{setMode('move');setFolders([]);try{const data=await requestJson<{items:Item[]}>('/api/resources?scope=folders');setFolders(data.items);}catch(error){setMessage((error as Error).message)}};
  const edit=async(e:SyntheticEvent<HTMLFormElement>)=>{e.preventDefault();await mutate('edit',new FormData(e.currentTarget));};
  const addMember=async(e:SyntheticEvent<HTMLFormElement>)=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.currentTarget));await mutate('member-add',data)};
  return <Dialog open onOpenChange={open=>!open&&!busy&&close()}><DialogContent className="detail-dialog" showCloseButton={!busy}><DialogHeader><DialogTitle>{mode==='edit'?'編輯內容':mode==='move'?'移動項目':mode==='share'?'共享設定':mode==='versions'?'版本紀錄':r.title}</DialogTitle><DialogDescription>{r.kind==='folder'?'資料夾':formatKind(r)} · {r.owner_name} · {r.permission==='owner'?'擁有者':r.permission==='editor'?'可編輯':'可檢視'}</DialogDescription></DialogHeader>{error&&<div className="notice" role="alert">{error}</div>}<OperationStatus active={busy} label={status}/><fieldset disabled={busy} className="detail-fields" aria-busy={busy}>
    {!mode&&<div className="detail-body"><p>{r.description||'沒有說明'}</p><dl><div><dt>建立時間</dt><dd>{formatDate(r.created_at)}</dd></div><div><dt>最近更新</dt><dd>{formatDate(r.updated_at)}</dd></div><div><dt>版本</dt><dd>第 {r.revision} 版</dd></div></dl><div className="action-grid">{r.kind==='file'&&<a className="action-button" href={`/api/resources/${r.id}/download`}><Download/>下載</a>}{r.kind==='link'&&<a className="action-button" href={r.url||'#'} target="_blank" rel="noreferrer"><LinkIcon/>開啟連結</a>}{['owner','editor'].includes(r.permission)&&<><button disabled={busy} onClick={()=>setMode('edit')}><Pencil/>編輯</button><button disabled={busy} onClick={()=>setMode('versions')}><History/>版本紀錄</button></>}{owner&&<><button disabled={busy} onClick={()=>void loadFolders()}><FolderInput/>移動</button><button disabled={busy} onClick={()=>setMode('share')}><Share2/>共享</button></>}{r.trashed_at?<><button disabled={busy} onClick={()=>void mutate('restore')}><ArchiveRestore/>還原</button><button disabled={busy} className="danger" onClick={openDelete}><Trash2/>永久刪除</button></>:owner&&<button disabled={busy} className="danger" onClick={()=>void mutate('trash')}><Trash2/>移到垃圾桶</button>}</div></div>}
    {mode==='edit'&&<form className="form-stack" onSubmit={edit}><label htmlFor="edit-title">名稱</label><Input id="edit-title" name="title" defaultValue={r.title} required/><label htmlFor="edit-description">說明</label><Textarea id="edit-description" name="description" defaultValue={r.description}/>{r.kind==='link'&&<><label htmlFor="edit-url">網址</label><Input id="edit-url" type="url" name="url" defaultValue={r.url||''} required/></>}{r.kind==='file'&&<><label htmlFor="edit-file">替換檔案</label><Input id="edit-file" type="file" name="file"/></>}<DialogFooter><Button type="button" variant="outline" onClick={()=>setMode('')}>返回</Button><Button type="submit" disabled={busy}>{busy?'儲存中…':'儲存'}</Button></DialogFooter></form>}
    {mode==='move'&&<div className="form-stack"><button className="folder-choice" onClick={()=>mutate('move',{parentId:''})}><Folder/>檔案庫最上層</button>{folders.filter(f=>f.id!==r.id).map(f=><button className="folder-choice" key={f.id} onClick={()=>mutate('move',{parentId:f.id})}><Folder/>{f.title}<ChevronRight/></button>)}</div>}
    {mode==='versions'&&<div className="version-list">{detail.versions.map(v=><div className="version-row" key={v.revision}><div><strong>第 {v.revision} 版 {v.revision===r.revision?'· 目前版本':''}</strong><small>{eventLabel(v.event)} · {formatDate(v.created_at)} {v.size_bytes?`· ${formatSize(v.size_bytes)}`:''}</small></div><div>{r.kind==='file'&&<a href={`/api/resources/${r.id}/download?revision=${v.revision}`}><Download/></a>}{v.revision!==r.revision&&<Button size="sm" variant="outline" onClick={()=>mutate('version-restore',{revision:v.revision})}>還原</Button>}</div></div>)}</div>}
    {mode==='share'&&<div className="share-panel"><label htmlFor="access-level">一般存取</label><select id="access-level" defaultValue={r.access_level} onChange={e=>void mutate('access-level',{level:e.target.value})}><option value="private">僅自己</option><option value="selected">指定成員</option><option value="members">所有已登入成員</option></select><hr/><form onSubmit={addMember} className="share-form"><Input name="recipient" aria-label="學校信箱或完整本名" placeholder="輸入學校信箱或完整本名" required/><select name="role" aria-label="成員權限"><option value="viewer">可檢視</option><option value="editor">可編輯</option></select><Button type="submit"><Users/>共享</Button></form>{detail.members.map(m=><div className="member-row" key={m.id}><span><strong>{m.display_name}</strong><small>{m.email} · {m.role==='editor'?'可編輯':'可檢視'}</small></span><Button variant="ghost" size="icon" onClick={()=>void mutate('member-remove',{userId:m.id})}><X/></Button></div>)}<hr/><div className="link-share"><strong>連結共享</strong><p>取得連結的人仍需用學校帳號登入。</p><div><select id="link-role"><option value="viewer">可檢視</option><option value="editor">可編輯</option></select><Button variant="outline" onClick={()=>{const el=document.getElementById('link-role') as HTMLSelectElement|null;void mutate('link-generate',{role:el?.value})}}>建立新連結</Button>{detail.link&&<Button variant="destructive" onClick={()=>void mutate('link-revoke')}>關閉連結</Button>}</div>{generatedLink&&<Input value={generatedLink} readOnly onFocus={e=>e.currentTarget.select()}/>}</div></div>}
    {mode&&<button className="back-text" onClick={()=>setMode('')}>← 返回項目</button>}</fieldset>
  </DialogContent></Dialog>
}

function BulkActions({items,trash,csrf,share,disabled,setBusy,onDone}:{items:Item[];trash:boolean;csrf:string;share:string;disabled:boolean;setBusy:(v:boolean)=>void;onDone:(failed:string[])=>Promise<void>}) {
  const [mode,setMode]=useState(''),[pending,setPending]=useState(false),[error,setError]=useState(''),[summary,setSummary]=useState('');
  const [folders,setFolders]=useState<Item[]>([]),[folderLoading,setFolderLoading]=useState(false),[destination,setDestination]=useState('');
  const [links,setLinks]=useState<Array<{title:string;url:string}>>([]);const lock=useRef(false);
  const owner=items.length>0&&items.every(item=>item.permission==='owner');
  const open=async(next:string)=>{setError('');setSummary('');setLinks([]);setMode(next);if(next==='move'){setDestination('');setFolderLoading(true);try{const data=await requestJson<{items:Item[]}>('/api/resources?scope=folders');const selected=new Set(items.map(i=>i.id)),map=new Map(data.items.map(i=>[i.id,i]));setFolders(data.items.filter(f=>{let r:Item|undefined=f;const seen=new Set<string>();while(r&&!seen.has(r.id)){if(selected.has(r.id))return false;seen.add(r.id);r=r.parent_id?map.get(r.parent_id):undefined;}return true;}));}catch(e){setError((e as Error).message);}finally{setFolderLoading(false);}}};
  const run=async(operation:string,data:Record<string,unknown>={})=>{
    if(lock.current)return;lock.current=true;setPending(true);setBusy(true);setError('');setSummary('');const selected=[...items];
    try{
      if(operation==='download'){
        const response=await fetch('/api/selection',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation,ids:selected.map(i=>i.id),csrf,share}),signal:AbortSignal.timeout(600000)});
        if(!response.ok){const data=await response.json() as {error?:string};throw new Error(data.error||'下載失敗');}
        const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='student-files.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);setSummary('已準備好 ZIP 下載。');return;
      }
      const result=await requestJson<{results:Array<{id:string;ok:boolean;error?:string;warning?:string;url?:string}>}>('/api/selection',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation,ids:selected.map(i=>i.id),csrf,share,...data})});
      const failed=result.results.filter(r=>!r.ok),done=result.results.filter(r=>r.ok),names=new Map(selected.map(i=>[i.id,i.title]));
      setSummary('完成 '+done.length+' 項'+(failed.length?'；失敗 '+failed.length+' 項':'')+'。');
      setError([...failed.map(r=>(names.get(r.id)||r.id)+'：'+r.error),...new Set(done.flatMap(r=>r.warning?[r.warning]:[]))].join('\n'));
      const generated=done.filter(r=>r.url).map(r=>({title:names.get(r.id)||r.id,url:r.url!}));setLinks(generated);
      if(!failed.length&&!generated.length)setMode('');
      await onDone(failed.map(r=>r.id));
    }catch(e){setError((e as Error).message);}finally{lock.current=false;setPending(false);setBusy(false);}
  };
  return <>
    {items.length>0&&<div className="bulk-actions" aria-label="選取項目操作">{!trash&&<Button disabled={disabled} onClick={()=>void run('download')}><Download/>下載 ZIP</Button>}{trash?<><Button disabled={disabled||!owner} onClick={()=>void run('restore')}><ArchiveRestore/>還原</Button><Button variant="destructive" disabled={disabled||!owner} onClick={()=>void open('delete')}><Trash2/>永久刪除</Button></>:<><Button variant="outline" disabled={disabled||!owner} onClick={()=>void open('trash')}><Trash2/>刪除</Button><Button variant="outline" disabled={disabled||!owner} onClick={()=>void open('move')}><FolderInput/>移動</Button><Button variant="outline" disabled={disabled||!owner} onClick={()=>void open('share')}><Share2/>共享</Button></>}{!owner&&<small>刪除、移動與共享僅限自己擁有的項目。</small>}</div>}
    {!mode&&<>{summary&&<output>{summary}</output>}{error&&<div className="notice bulk-result" role="alert">{error}</div>}<OperationStatus active={pending} label="正在處理選取項目，請勿重複送出…"/></>}
    <Dialog open={Boolean(mode)} onOpenChange={open=>{if(!open&&!lock.current)setMode('')}}><DialogContent showCloseButton={!pending}><DialogHeader><DialogTitle>{mode==='share'?'共享選取項目':mode==='move'?'移動選取項目':mode==='delete'?'永久刪除選取項目？':'將選取項目移到垃圾桶？'}</DialogTitle><DialogDescription>{items.length>0?'已選取 '+items.length+' 個項目。':''}{mode==='delete'?'所有版本與資料夾內容都會永久刪除，無法還原。':mode==='move'?'移入資料夾後會繼承目的地的共享權限。':mode==='share'?'共享給已登入過系統的學校成員；資料夾的權限也適用於子項目。':'之後可從垃圾桶還原。'}</DialogDescription></DialogHeader>
    {summary&&<output>{summary}</output>}{error&&<div className="notice bulk-result" role="alert">{error}</div>}<OperationStatus active={pending} label="正在處理選取項目…"/>
    <fieldset disabled={pending||!items.length} className="detail-fields">
    {mode==='move'&&<form className="form-stack" onSubmit={e=>{e.preventDefault();void run('move',{parentId:destination})}}><label htmlFor="bulk-destination">目的地</label>{folderLoading?<p>正在載入資料夾…</p>:<select id="bulk-destination" value={destination} onChange={e=>setDestination(e.target.value)}><option value="">檔案庫最上層</option>{folders.map(f=><option value={f.id} key={f.id}>{f.title} · {f.owner_name}</option>)}</select>}<Button disabled={pending||folderLoading||Boolean(error)} type="submit">移動到這裡</Button></form>}
    {mode==='share'&&<div className="form-stack"><form className="form-stack" onSubmit={e=>{e.preventDefault();void run('member-add',Object.fromEntries(new FormData(e.currentTarget)))}}><Input name="recipient" aria-label="學校信箱或完整本名" placeholder="學校信箱或完整本名" required/><select name="role" aria-label="共享權限"><option value="viewer">可檢視</option><option value="editor">可編輯</option></select><Button type="submit">共享給成員</Button></form><hr/><form className="form-stack" onSubmit={e=>{e.preventDefault();void run('link-generate',Object.fromEntries(new FormData(e.currentTarget)))}}><p>每個項目會產生各自的共享連結，取得連結者仍須登入學校帳號。重新產生會取代舊連結。</p><select name="role" aria-label="連結權限"><option value="viewer">可檢視</option><option value="editor">可編輯</option></select><Button variant="outline" type="submit">建立共享連結</Button></form></div>}
    {(mode==='trash'||mode==='delete')&&<DialogFooter><Button type="button" variant="outline" onClick={()=>setMode('')}>取消</Button><Button variant="destructive" onClick={()=>void run(mode)}>{mode==='delete'?'確認永久刪除':'移到垃圾桶'}</Button></DialogFooter>}
    </fieldset>{links.map(link=><label key={link.url}>{link.title}<Input value={link.url} readOnly aria-label={link.title+' 共享連結'} onFocus={e=>e.currentTarget.select()}/></label>)}
    </DialogContent></Dialog>
  </>;
}
