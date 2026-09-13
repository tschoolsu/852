'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type Member={recipient:string;role:'viewer'|'editor';name?:string};
export type UploadAccess={level:'private'|'selected'|'members';members:Member[];linkRole?:''};
export const privateAccess=():UploadAccess=>({level:'private',members:[]});
type Owner={name:string;email:string};
type Props={initial:UploadAccess;batch?:boolean;pending:boolean;onSave:(value:UploadAccess)=>Promise<void>;onClose?:()=>void;owner?:Owner;urls?:string[]};

function MemberSearch({onAdd,exclude}:{onAdd:(member:Member)=>void;exclude:string[]}){
  const [query,setQuery]=useState(''),[users,setUsers]=useState<Array<{id:string;email:string;display_name:string}>>([]),[loading,setLoading]=useState(false),[error,setError]=useState('');
  useEffect(()=>{if(query.trim().length<2)return;const controller=new AbortController();const timer=setTimeout(async()=>{setLoading(true);setError('');try{const response=await fetch('/api/users?q='+encodeURIComponent(query),{signal:controller.signal,cache:'no-store'});const data=await response.json() as {error?:string;users:Array<{id:string;email:string;display_name:string}>};if(!response.ok)throw new Error(data.error||'搜尋失敗');setUsers(data.users);}catch(e){if(!controller.signal.aborted)setError((e as Error).message);}finally{if(!controller.signal.aborted)setLoading(false);}},250);return()=>{clearTimeout(timer);controller.abort();};},[query]);
  return <div className="member-search"><Input aria-label="搜尋學校信箱或顯示名稱" placeholder="新增成員：輸入學校信箱或顯示名稱" value={query} onChange={e=>{setQuery(e.target.value);setUsers([]);}}/>{query.trim().length>=2&&<div className="member-results" aria-label="成員搜尋結果">{loading?<p>搜尋中…</p>:error?<p role="alert">{error}</p>:users.filter(u=>!exclude.includes(u.email)).map(u=><button type="button" key={u.id} onClick={()=>{onAdd({recipient:u.email,name:u.display_name,role:'viewer'});setQuery('');setUsers([]);}}><strong>{u.display_name}</strong><small>{u.email}</small></button>)}{!loading&&!error&&!users.length&&<p>找不到符合的已註冊成員。</p>}</div>}</div>;
}

export function AccessEditor({initial,batch,pending,onSave,onClose,owner,urls=[]}:Props){
  const [draft,setDraft]=useState<UploadAccess>(structuredClone(initial)),[copyStatus,setCopyStatus]=useState('');
  const copy=async()=>{try{await navigator.clipboard.writeText(urls.join('\n'));setCopyStatus('已複製連結');}catch{setCopyStatus('無法自動複製，請選取下方網址複製。');}};
  return <form onSubmit={event=>{event.preventDefault();void onSave(draft);}}><fieldset className="form-stack detail-fields" disabled={pending}>
    <h3>具有存取權的使用者</h3>
    <div className="member-row"><span><strong>{owner?.name||'各項目的擁有者'}</strong>{owner?.email&&<small>{owner.email}</small>}</span><span>擁有者</span></div>
    <MemberSearch exclude={[...draft.members.map(m=>m.recipient),owner?.email||'']} onAdd={member=>setDraft({...draft,members:[...draft.members,member]})}/>
    {draft.members.map((member,index)=><div className="member-row" key={member.recipient}><span><strong>{member.name||member.recipient}</strong>{member.name&&<small>{member.recipient}</small>}</span><select aria-label={member.recipient+' 權限'} value={member.role} onChange={event=>setDraft({...draft,members:draft.members.map((m,i)=>i===index?{...m,role:event.target.value as 'viewer'|'editor'}:m)})}><option value="viewer">可檢視</option><option value="editor">可編輯</option></select><Button type="button" variant="ghost" aria-label={'移除 '+member.recipient} onClick={()=>setDraft({...draft,members:draft.members.filter((_,i)=>i!==index)})}>移除</Button></div>)}
    <hr/><label htmlFor="general-access">一般存取權</label><select id="general-access" value={draft.level==='members'?'members':'private'} onChange={event=>setDraft({...draft,level:event.target.value as UploadAccess['level']})}><option value="private">限制</option><option value="members">所有已登入成員</option></select>
    <p>{draft.level==='members'?'所有已登入的學校成員可檢視；指定成員仍保有設定的權限。':'只有擁有者與指定成員可以開啟；所在資料夾授予的權限仍會繼承。'}所有已登入成員仍可在清單看到基本資料。</p>
    <p>可編輯的成員可修改、移動、刪除及管理存取權。分享網址本身不授予權限。</p>
    {copyStatus&&<output>{copyStatus}</output>}{copyStatus.startsWith('無法')&&urls.map(url=><Input key={url} aria-label="固定分享網址" value={url} readOnly onFocus={e=>e.currentTarget.select()}/>)}
    <DialogFooter className="access-footer"><Button type="button" variant="outline" disabled={!urls.length} onClick={()=>void copy()}>複製連結</Button>{!urls.length&&<small>上傳完成後可複製</small>}{onClose&&<Button type="button" variant="ghost" onClick={onClose}>取消</Button>}<Button type="submit" disabled={draft.members.length>50}>{pending?'正在儲存…':batch?'套用至所有選取項目':'儲存'}</Button></DialogFooter>
  </fieldset></form>;
}
export function UploadAccessDialog({initial,batch,title,pending,error,onClose,onSave,owner,urls}:{initial:UploadAccess;batch:boolean;title:string;pending:boolean;error:string;onClose:()=>void;onSave:(value:UploadAccess)=>Promise<void>;owner?:Owner;urls?:string[]}){
  return <Dialog open onOpenChange={open=>{if(!open&&!pending)onClose();}}><DialogContent className="detail-dialog" showCloseButton={!pending}><DialogHeader><DialogTitle>{batch?'管理清單中所有檔案的存取權':`管理存取權：${title}`}</DialogTitle><DialogDescription>{batch?'儲存會取代清單中各項目的直接存取權。':'管理誰可以開啟此項目。'}擁有者固定保有完整權限。</DialogDescription></DialogHeader>{error&&<div className="notice bulk-result" role="alert">{error}</div>}<AccessEditor initial={initial} batch={batch} pending={pending} onSave={onSave} onClose={onClose} owner={owner} urls={urls}/></DialogContent></Dialog>;
}
