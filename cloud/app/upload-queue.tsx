'use client';

import { useRef, useState } from 'react';
import { Upload, X, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

type Entry={id:string;file:File;title:string;description:string;parent:string;destination:string;status:'ready'|'uploading'|'done'|'failed'|'unknown';error:string};
const labels={ready:'待確認',uploading:'上傳中…',done:'上傳完成',failed:'上傳失敗',unknown:'結果待確認'};

export function UploadQueue({csrf,parent,destination,disabled,setBusy,onDone}:{csrf:string;parent:string;destination:string;disabled:boolean;setBusy:(value:boolean)=>void;onDone:()=>Promise<void>}){
  const [entries,setEntries]=useState<Entry[]>([]),[editing,setEditing]=useState(''),[collapsed,setCollapsed]=useState(false),[pending,setPending]=useState(false);
  const lock=useRef(false),picker=useRef<HTMLInputElement>(null);
  const update=(id:string,patch:Partial<Entry>)=>setEntries(current=>current.map(entry=>entry.id===id?{...entry,...patch}:entry));
  const active=entries.find(entry=>entry.id===editing),editable=active&&['ready','failed'].includes(active.status);
  const ready=entries.filter(entry=>['ready','failed'].includes(entry.status));
  const upload=async()=>{
    if(lock.current||disabled||!ready.length)return;
    lock.current=true;setPending(true);setBusy(true);setEditing('');let changed=false;
    try{
      for(const entry of ready){
        if(!entry.file.size||entry.file.size>100*1024*1024){update(entry.id,{status:'failed',error:!entry.file.size?'檔案是空的，請移除後重新選擇。':'單一檔案最多 100 MB，請移除後重新選擇。'});continue;}
        update(entry.id,{status:'uploading',error:''});
        const body=new FormData();body.set('kind','file');body.set('csrf',csrf);body.set('parentId',entry.parent);body.set('title',entry.title.trim()||entry.file.name);body.set('description',entry.description);body.set('file',entry.file);
        try{
          const response=await fetch('/api/resources',{method:'POST',body,signal:AbortSignal.timeout(600000)});
          const data=await response.json() as {error?:string;id?:string};
          if(!response.ok){update(entry.id,{status:response.status>=500?'unknown':'failed',error:(data.error||'上傳失敗')+(response.status>=500?' 請重新整理確認是否已上傳，避免重複上傳。':'')});continue;}
          if(!data.id)throw new Error('缺少上傳結果');
          update(entry.id,{status:'done'});changed=true;
        }catch{update(entry.id,{status:'unknown',error:'連線中斷或等待逾時，請重新整理確認是否已上傳，避免重複上傳。'});}
      }
      if(changed)await onDone();
    }finally{lock.current=false;setPending(false);setBusy(false);}
  };
  return <>
    <input ref={picker} id="multi-upload-picker" aria-label="選擇多個上傳檔案" type="file" multiple hidden disabled={disabled} onChange={event=>{
      const files=Array.from(event.currentTarget.files||[]);event.currentTarget.value='';if(!files.length)return;
      setEntries(current=>[...current,...files.map(file=>({id:crypto.randomUUID(),file,title:file.name,description:'',parent,destination,status:'ready' as const,error:''}))]);setCollapsed(false);
    }}/>
    {entries.length>0&&<section className="upload-queue" aria-label="上傳確認清單">
      <header><strong><Upload size={18}/>上傳確認（{entries.length} 個檔案）</strong><Button size="icon" variant="ghost" aria-label={collapsed?'展開上傳清單':'收合上傳清單'} onClick={()=>setCollapsed(value=>!value)}>{collapsed?<ChevronUp/>:<ChevronDown/>}</Button></header>
      <output className="upload-summary">已完成 {entries.filter(entry=>entry.status==='done').length} / {entries.length} 個檔案{pending?' · 正在上傳，請保持頁面開啟':''}</output>
      {!collapsed&&<>
        <p className="upload-hint">點選檔案可更改名稱、填寫說明或從待上傳清單移除。</p>
        <div className="upload-entries">{entries.map(entry=><button type="button" className={editing===entry.id?'upload-entry active':'upload-entry'} key={entry.id} disabled={pending} onClick={()=>setEditing(editing===entry.id?'':entry.id)}><span><strong>{entry.title.trim()||entry.file.name}</strong><small>目的地：{entry.destination}</small></span><small>{labels[entry.status]}</small></button>)}</div>
        {active&&<div className="upload-editor"><p>原始檔名：{active.file.name}</p>{active.error&&<div className="notice" role="alert">{active.error}</div>}{editable?<>
          <label htmlFor="queued-title">檔案名稱（留白使用原始檔名）</label><Input id="queued-title" maxLength={180} value={active.title} disabled={pending} onChange={event=>update(active.id,{title:event.target.value})}/>
          <label htmlFor="queued-description">說明</label><Textarea id="queued-description" maxLength={4000} value={active.description} disabled={pending} onChange={event=>update(active.id,{description:event.target.value})}/>
          <Button variant="ghost" className="danger" disabled={pending} onClick={()=>{setEntries(current=>current.filter(entry=>entry.id!==active.id));setEditing('');}}><Trash2/>移除待上傳檔案</Button>
        </>:<p>{active.status==='done'?'檔案已上傳，可從檔案清單編輯。':labels[active.status]}</p>}</div>}
        {entries.some(entry=>entry.status==='failed'||entry.status==='unknown')&&<p className="upload-hint" role="alert">部分檔案未完成，請點選該檔案查看原因。</p>}
        <footer><Button variant="outline" disabled={disabled} onClick={()=>picker.current?.click()}>加入檔案</Button><Button disabled={disabled||!ready.length} onClick={()=>void upload()}>{pending?'上傳中…':`確認上傳（${ready.length}）`}</Button><Button variant="ghost" size="icon" disabled={disabled} aria-label="清空上傳清單" title="只清空清單，不會刪除已上傳的檔案" onClick={()=>{setEntries([]);setEditing('');}}><X/></Button></footer>
      </>}
    </section>}
  </>;
}
