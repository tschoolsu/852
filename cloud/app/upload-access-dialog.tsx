'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export type UploadAccess={level:'private'|'selected'|'members';members:Array<{recipient:string;role:'viewer'|'editor'}>;linkRole:''|'viewer'|'editor'};
export const privateAccess=():UploadAccess=>({level:'private',members:[],linkRole:''});
export function UploadAccessDialog({initial,batch,title,pending,error,onClose,onSave}:{initial:UploadAccess;batch:boolean;title:string;pending:boolean;error:string;onClose:()=>void;onSave:(value:UploadAccess)=>Promise<void>}){
  const [draft,setDraft]=useState<UploadAccess>(structuredClone(initial));
  return <Dialog open onOpenChange={open=>{if(!open&&!pending)onClose();}}><DialogContent showCloseButton={!pending}><DialogHeader><DialogTitle>{batch?'管理清單中所有檔案的存取權':`管理存取權：${title}`}</DialogTitle><DialogDescription>{batch?'套用會取代目前清單中待上傳及已完成檔案的直接權限。':'待上傳檔案會在上傳時套用；已上傳檔案會立即更新。'}資料夾的繼承權限仍會生效。</DialogDescription></DialogHeader>
    {error&&<div className="notice bulk-result" role="alert">{error}</div>}
    <form onSubmit={event=>{event.preventDefault();void onSave(draft);}}><fieldset className="form-stack detail-fields" disabled={pending}>
      <label htmlFor="upload-access-level">一般存取</label><select id="upload-access-level" value={draft.level} onChange={event=>setDraft({...draft,level:event.target.value as UploadAccess['level']})}><option value="private">僅自己（不額外共享）</option><option value="selected">指定成員</option><option value="members">所有已登入成員（可檢視）</option></select>
      {draft.level==='selected'&&<><p>輸入已登入過本系統的學校信箱或完整顯示名稱。</p>{draft.members.map((member,index)=><div className="upload-access-member" key={index}><Input aria-label={`成員 ${index+1} 信箱或名稱`} required value={member.recipient} onChange={event=>setDraft({...draft,members:draft.members.map((m,i)=>i===index?{...m,recipient:event.target.value}:m)})}/><select aria-label={`成員 ${index+1} 權限`} value={member.role} onChange={event=>setDraft({...draft,members:draft.members.map((m,i)=>i===index?{...m,role:event.target.value as 'viewer'|'editor'}:m)})}><option value="viewer">可檢視</option><option value="editor">可編輯</option></select><Button type="button" variant="ghost" aria-label={`移除成員 ${index+1}`} onClick={()=>setDraft({...draft,members:draft.members.filter((_,i)=>i!==index)})}>移除</Button></div>)}<Button type="button" variant="outline" disabled={draft.members.length>=50} onClick={()=>setDraft({...draft,members:[...draft.members,{recipient:'',role:'viewer'}]})}>加入成員</Button></>}
      <label htmlFor="upload-link-role">連結共享</label><select id="upload-link-role" value={draft.linkRole} onChange={event=>setDraft({...draft,linkRole:event.target.value as UploadAccess['linkRole']})}><option value="">關閉</option><option value="viewer">取得連結的學校成員可檢視</option><option value="editor">取得連結的學校成員可編輯</option></select>
      <p>共享連結仍需學校帳號登入。啟用後會產生新連結，取代舊連結；可在檔案展開區複製。通知信尚未啟用。</p>
      <DialogFooter><Button type="button" variant="outline" onClick={onClose}>取消</Button><Button type="submit" disabled={draft.level==='selected'&&!draft.members.length}>{pending?'正在儲存…':batch?'套用至清單中所有檔案':'儲存存取權'}</Button></DialogFooter>
    </fieldset></form>
  </DialogContent></Dialog>;
}
