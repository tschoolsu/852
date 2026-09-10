import { env } from 'cloudflare:workers';
import { authPost } from '@/lib/local-auth';
import { all, appOrigin, audit, clearCookie, currentUser, first, httpError, json, loadAccess, now, publicResource, requireCsrf, requireUser, run, safeUrl, sendShareNotification, sessionHash, sha256, snapshot, token, type Resource } from '@/lib/cloud';

type Context={params:Promise<{path?:string[]}>};
const textValue=(value:unknown)=>typeof value==='string'?value:'';
const title=(value:unknown)=>{const v=textValue(value).trim().slice(0,180); if(!v) throw httpError(400,'請輸入名稱。'); return v;};
const description=(value:unknown)=>textValue(value).trim().slice(0,4000);
const role=(value:unknown)=>value==='editor'?'editor':'viewer';

async function resourceAccess(request:Request,id:string,share='',allowTrashed=false,auth?:Awaited<ReturnType<typeof requireUser>>) {
  const {user}=auth || await requireUser(request),access=await loadAccess(user,share);
  const resource=access.map.get(id); if(!resource || (!allowTrashed && access.hiddenByTrash(resource))) throw httpError(404,'找不到這個項目。');
  const permission=access.permission(resource); if(!permission) throw httpError(404,'找不到這個項目。');
  return {user,resource,permission,access};
}

function assertOwner(resource:Resource,userId:string){if(resource.owner_id!==userId) throw httpError(403,'只有擁有者可以執行這項操作。');}
function assertEditor(permission:string){if(!['owner','editor'].includes(permission)) throw httpError(403,'你沒有編輯權限。');}

async function parseBody(request:Request) {
  const type=request.headers.get('content-type') || '';
  if(type.includes('application/json')) return await request.json() as Record<string,unknown>;
  const form=await request.formData(); return Object.fromEntries(form.entries()) as Record<string,unknown>;
}

export async function GET(request:Request,context:Context) {
  try {
    const path=(await context.params).path || [],url=new URL(request.url);
    if(path[0]==='me') {
      const auth=await currentUser(request); if(!auth) return json({authenticated:false},401);
      return json({authenticated:true,user:{id:auth.user.id,email:auth.user.email,displayName:auth.user.display_name,role:auth.user.role},csrf:auth.csrf});
    }
    if(path[0]==='users') {
      const {user}=await requireUser(request),q=(url.searchParams.get('q') || '').trim().slice(0,100);
      if(q.length<2) return json({users:[]}); const like=`%${q.replace(/[\\%_]/g,'\\$&')}%`;
      const users=await all<{id:string;email:string;display_name:string}>(`SELECT id,email,display_name FROM users WHERE status='active' AND id<>?
        AND (email LIKE ? ESCAPE '\\' COLLATE NOCASE OR display_name LIKE ? ESCAPE '\\' COLLATE NOCASE) ORDER BY display_name LIMIT 10`,user.id,like,like);
      return json({users});
    }
    if(path[0]==='resources' && path.length===1) {
      const {user}=await requireUser(request),scope=url.searchParams.get('scope') || 'accessible',parent=url.searchParams.get('parent') || '',share=url.searchParams.get('share') || '';
      const q=(url.searchParams.get('q') || '').trim().toLowerCase(),access=await loadAccess(user,share);
      const owners=new Map((await all<{id:string;display_name:string;email:string}>('SELECT id,display_name,email FROM users')).map(u=>[u.id,u]));
      const items=access.resources.filter(r=>{
        if(scope==='trash') return r.owner_id===user.id && Boolean(r.trashed_at);
        if(access.hiddenByTrash(r) || !access.permission(r)) return false;
        if(scope==='mine' && r.owner_id!==user.id) return false;
        if(scope==='folders') return r.kind==='folder' && ['owner','editor'].includes(access.permission(r));
        const visibleParent=r.parent_id && access.map.get(r.parent_id) && access.permission(access.map.get(r.parent_id)!) && !access.hiddenByTrash(access.map.get(r.parent_id)!) ? r.parent_id : '';
        if(!q && visibleParent!==parent) return false;
        return !q || r.title.toLowerCase().includes(q) || r.description.toLowerCase().includes(q);
      }).sort((a,b)=>a.kind===b.kind?b.updated_at.localeCompare(a.updated_at):a.kind==='folder'?-1:b.kind==='folder'?1:0)
        .map(r=>publicResource(r,access.permission(r),owners.get(r.owner_id)));
      const folder=parent?access.map.get(parent):null;
      return json({items,folder:folder?publicResource(folder,access.permission(folder),owners.get(folder.owner_id)):null});
    }
    if(path[0]==='resources' && path[1]) {
      const id=path[1],share=url.searchParams.get('share') || '';
      if(path[2]==='download') return await download(request,id,share,url.searchParams.get('revision'));
      const {user,resource,permission}=await resourceAccess(request,id,share,url.searchParams.get('trash')==='1');
      const [owner,versions,members,link]=await Promise.all([
        first<{display_name:string;email:string}>('SELECT display_name,email FROM users WHERE id=?',resource.owner_id),
        ['owner','editor'].includes(permission)?all('SELECT revision,event,actor_id,original_name,size_bytes,created_at FROM resource_versions WHERE resource_id=? ORDER BY revision DESC',id):[],
        resource.owner_id===user.id?all(`SELECT u.id,u.email,u.display_name,m.role FROM resource_members m JOIN users u ON u.id=m.user_id WHERE m.resource_id=? ORDER BY u.display_name`,id):[],
        resource.owner_id===user.id?first<{role:string}>('SELECT role FROM share_links WHERE resource_id=?',id):null,
      ]);
      return json({resource:publicResource(resource,permission,owner||undefined),versions,members,link});
    }
    throw httpError(404,'找不到頁面。');
  } catch(error) { return handle(error); }
}

export async function POST(request:Request,context:Context) {
  try {
    const path=(await context.params).path || [];
    if(path[0]==='auth'&&path.length===2)return await authPost(request,path[1]);
    if(path[0]==='logout') {
      const auth=await requireUser(request),body=await parseBody(request); requireCsrf(request,auth.csrf,textValue(body.csrf));
      const raw=(request.headers.get('cookie')||'').match(/(?:^|;\s*)tfiles_session=([^;]+)/)?.[1]; if(raw) await run('DELETE FROM sessions WHERE token_hash=?',await sessionHash(decodeURIComponent(raw)));
      return json({ok:true},200,{'Set-Cookie':clearCookie('tfiles_session')});
    }
    if(path[0]==='resources' && path.length===1) return await createResource(request);
    if(path[0]==='resources' && path[1]) return await mutateResource(request,path[1]);
    throw httpError(404,'找不到頁面。');
  } catch(error) { return handle(error); }
}

async function createResource(request:Request) {
  const auth=await requireUser(request),form=await request.formData(); requireCsrf(request,auth.csrf,textValue(form.get('csrf')));
  const kind=textValue(form.get('kind')),parentId=textValue(form.get('parentId')) || null;
  if(!['file','link','folder'].includes(kind)) throw httpError(400,'未知的項目類型。');
  if(parentId) { const parentAccess=await resourceAccess(request,parentId,'',false,auth); if(parentAccess.resource.kind!=='folder') throw httpError(400,'目的地不是資料夾。'); assertEditor(parentAccess.permission); }
  const id=crypto.randomUUID(),created=now(); let storageKey:string|null=null,originalName:string|null=null,mimeType:string|null=null,sizeBytes:number|null=null,url:string|null=null;
  if(kind==='link') url=safeUrl(textValue(form.get('url')));
  if(kind==='file') {
    const file=form.get('file'); if(!(file instanceof File) || file.size===0) throw httpError(400,'請選擇檔案。');
    if(file.size>100*1024*1024) throw httpError(413,'免費雲端版本單一檔案最多 100 MB。');
    storageKey=`files/${id}/${crypto.randomUUID()}`; originalName=file.name.slice(0,240); mimeType=file.type || 'application/octet-stream'; sizeBytes=file.size;
    await env.FILES.put(storageKey,file.stream(),{httpMetadata:{contentType:mimeType},customMetadata:{originalName}});
  }
  const resource:Resource={id,kind:kind as Resource['kind'],title:title(form.get('title') || (kind==='file'?originalName:'')),description:description(form.get('description')),
    url,storage_key:storageKey,original_name:originalName,mime_type:mimeType,size_bytes:sizeBytes,owner_id:auth.user.id,parent_id:parentId,access_level:'private',revision:1,trashed_at:null,created_at:created,updated_at:created};
  await run(`INSERT INTO resources(id,kind,title,description,url,storage_key,original_name,mime_type,size_bytes,owner_id,parent_id,access_level,revision,trashed_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,resource.id,resource.kind,resource.title,resource.description,resource.url,resource.storage_key,resource.original_name,resource.mime_type,resource.size_bytes,
    resource.owner_id,resource.parent_id,resource.access_level,1,null,created,created);
  await snapshot(resource,'created',auth.user.id); await audit(auth.user.id,`resource.${kind}_created`,id,{parentId}); return json({ok:true,id},201);
}

async function mutateResource(request:Request,id:string) {
  const auth=await requireUser(request),contentType=request.headers.get('content-type')||'';
  let body:Record<string,unknown>,file:File|null=null;
  if(contentType.includes('multipart/form-data')) { const f=await request.formData(); body=Object.fromEntries(f.entries()); const value=f.get('file'); file=value instanceof File?value:null; }
  else body=await request.json() as Record<string,unknown>;
  requireCsrf(request,auth.csrf,textValue(body.csrf)); const operation=textValue(body.operation) || 'edit';
  const share=textValue(body.share),state=await resourceAccess(request,id,share,['restore','delete'].includes(operation),auth),resource=state.resource;
  if(operation==='edit') {
    assertEditor(state.permission); const nextRevision=resource.revision+1; let storageKey=resource.storage_key,originalName=resource.original_name,mimeType=resource.mime_type,sizeBytes=resource.size_bytes;
    if(resource.kind==='file' && file?.size) { if(file.size>100*1024*1024) throw httpError(413,'免費雲端版本單一檔案最多 100 MB。'); storageKey=`files/${id}/${crypto.randomUUID()}`; originalName=file.name.slice(0,240); mimeType=file.type||'application/octet-stream'; sizeBytes=file.size; await env.FILES.put(storageKey,file.stream(),{httpMetadata:{contentType:mimeType},customMetadata:{originalName}}); }
    const next={...resource,title:title(body.title),description:description(body.description),url:resource.kind==='link'?safeUrl(textValue(body.url)):resource.url,
      storage_key:storageKey,original_name:originalName,mime_type:mimeType,size_bytes:sizeBytes,revision:nextRevision,updated_at:now()};
    await run('UPDATE resources SET title=?,description=?,url=?,storage_key=?,original_name=?,mime_type=?,size_bytes=?,revision=?,updated_at=? WHERE id=?',next.title,next.description,next.url,next.storage_key,next.original_name,next.mime_type,next.size_bytes,nextRevision,next.updated_at,id);
    await snapshot(next,'updated',auth.user.id,nextRevision); await audit(auth.user.id,'resource.updated',id,{revision:nextRevision}); return json({ok:true});
  }
  if(operation==='move') {
    assertOwner(resource,auth.user.id); const parentId=textValue(body.parentId)||null; if(parentId===id) throw httpError(400,'資料夾不能移到自己裡面。');
    if(parentId) { const dest=await resourceAccess(request,parentId,'',false,auth); if(dest.resource.kind!=='folder') throw httpError(400,'目的地不是資料夾。'); assertEditor(dest.permission);
      let cursor:Resource|undefined=dest.resource; while(cursor){if(cursor.id===id) throw httpError(400,'資料夾不能移到自己的子資料夾。'); cursor=cursor.parent_id?dest.access.map.get(cursor.parent_id):undefined;} }
    const next={...resource,parent_id:parentId,revision:resource.revision+1,updated_at:now()}; await run('UPDATE resources SET parent_id=?,revision=?,updated_at=? WHERE id=?',parentId,next.revision,next.updated_at,id);
    await snapshot(next,'moved',auth.user.id,next.revision); await audit(auth.user.id,'resource.moved',id,{parentId}); return json({ok:true});
  }
  if(operation==='trash') {
    assertOwner(resource,auth.user.id); const access=state.access; const subtree=new Set<string>([id]); let changed=true;
    while(changed){changed=false; for(const row of access.resources) if(row.parent_id&&subtree.has(row.parent_id)&&!subtree.has(row.id)){subtree.add(row.id);changed=true;}}
    for(const row of access.resources) if(row.parent_id&&subtree.has(row.parent_id)&&row.owner_id!==auth.user.id) await run('UPDATE resources SET parent_id=NULL,updated_at=? WHERE id=?',now(),row.id);
    await run('UPDATE resources SET trashed_at=?,updated_at=? WHERE id=?',now(),now(),id); await audit(auth.user.id,'resource.trashed',id); return json({ok:true});
  }
  if(operation==='restore') { assertOwner(resource,auth.user.id); if(!resource.trashed_at) throw httpError(409,'項目不在垃圾桶。'); await run('UPDATE resources SET trashed_at=NULL,updated_at=? WHERE id=?',now(),id); await audit(auth.user.id,'resource.restored',id); return json({ok:true}); }
  if(operation==='delete') {
    assertOwner(resource,auth.user.id); if(!resource.trashed_at) throw httpError(409,'請先將項目移到垃圾桶。'); const rows=state.access.resources,subtree=new Set<string>([id]); let changed=true;
    while(changed){changed=false; for(const row of rows) if(row.parent_id&&subtree.has(row.parent_id)&&!subtree.has(row.id)){if(row.owner_id!==auth.user.id) throw httpError(409,'資料夾中仍有其他成員擁有的內容。');subtree.add(row.id);changed=true;}}
    const ids=[...subtree],keys=new Set<string>(); for(const rid of ids){for(const v of await all<{storage_key:string|null}>('SELECT storage_key FROM resource_versions WHERE resource_id=?',rid))if(v.storage_key)keys.add(v.storage_key); const current=rows.find(r=>r.id===rid);if(current?.storage_key)keys.add(current.storage_key);}
    for(const rid of ids){await run('DELETE FROM resource_members WHERE resource_id=?',rid);await run('DELETE FROM share_links WHERE resource_id=?',rid);await run('DELETE FROM resource_versions WHERE resource_id=?',rid);await run('DELETE FROM resources WHERE id=?',rid);} if(keys.size)await env.FILES.delete([...keys]);
    await audit(auth.user.id,'resource.deleted_permanently',id,{count:ids.length}); return json({ok:true});
  }
  if(operation==='member-add') {
    assertOwner(resource,auth.user.id); const query=textValue(body.recipient).trim(); let users=await all<{id:string;email:string;display_name:string}>("SELECT id,email,display_name FROM users WHERE status='active' AND email=? COLLATE NOCASE",query);
    if(!users.length)users=await all<{id:string;email:string;display_name:string}>("SELECT id,email,display_name FROM users WHERE status='active' AND display_name=? COLLATE NOCASE LIMIT 2",query); if(users.length!==1||users[0].id===auth.user.id)throw httpError(400,'找不到唯一且已登入過本系統的學校成員。');
    await run('INSERT INTO resource_members(resource_id,user_id,role) VALUES(?,?,?) ON CONFLICT(resource_id,user_id) DO UPDATE SET role=excluded.role',id,users[0].id,role(body.role));
    await run("UPDATE resources SET access_level='selected',updated_at=? WHERE id=?",now(),id); await audit(auth.user.id,'share.member_updated',id,{recipient:users[0].email,role:role(body.role)});
    const notification=await sendShareNotification(request,{recipient:users[0].email,recipientName:users[0].display_name,senderName:auth.user.display_name,resourceTitle:resource.title,permission:role(body.role)});
    await audit(auth.user.id,notification.sent?'share.notification_sent':'share.notification_skipped',id,{recipient:users[0].email,reason:notification.reason});
    return json({ok:true,notificationSent:notification.sent,warning:notification.sent?undefined:`共享已完成；通知信未寄出（${notification.reason}）。`});
  }
  if(operation==='member-remove') { assertOwner(resource,auth.user.id); await run('DELETE FROM resource_members WHERE resource_id=? AND user_id=?',id,textValue(body.userId)); return json({ok:true}); }
  if(operation==='access-level') { assertOwner(resource,auth.user.id); const level=body.level==='members'?'members':body.level==='selected'?'selected':'private'; await run('UPDATE resources SET access_level=?,updated_at=? WHERE id=?',level,now(),id); if(level==='private'){await run('DELETE FROM resource_members WHERE resource_id=?',id);await run('DELETE FROM share_links WHERE resource_id=?',id);} return json({ok:true}); }
  if(operation==='link-generate') { assertOwner(resource,auth.user.id); const raw=token(); await run('INSERT INTO share_links(resource_id,token_hash,role,created_at) VALUES(?,?,?,?) ON CONFLICT(resource_id) DO UPDATE SET token_hash=excluded.token_hash,role=excluded.role,created_at=excluded.created_at',id,await sha256(raw),role(body.role),now()); return json({ok:true,url:`${appOrigin(request)}/s/${raw}`}); }
  if(operation==='link-revoke') { assertOwner(resource,auth.user.id); await run('DELETE FROM share_links WHERE resource_id=?',id); return json({ok:true}); }
  if(operation==='version-restore') {
    assertEditor(state.permission); const revision=Number(body.revision),v=await first<Resource & {revision:number}>('SELECT * FROM resource_versions WHERE resource_id=? AND revision=?',id,revision); if(!v)throw httpError(404,'找不到版本。');
    const next={...resource,title:v.title,description:v.description,url:v.url,storage_key:v.storage_key,original_name:v.original_name,mime_type:v.mime_type,size_bytes:v.size_bytes,parent_id:v.parent_id,revision:resource.revision+1,updated_at:now()};
    await run('UPDATE resources SET title=?,description=?,url=?,storage_key=?,original_name=?,mime_type=?,size_bytes=?,parent_id=?,revision=?,updated_at=? WHERE id=?',next.title,next.description,next.url,next.storage_key,next.original_name,next.mime_type,next.size_bytes,next.parent_id,next.revision,next.updated_at,id);
    await snapshot(next,'version_restored',auth.user.id,next.revision); await audit(auth.user.id,'resource.version_restored',id,{from:revision,to:next.revision}); return json({ok:true});
  }
  throw httpError(400,'未知的操作。');
}

async function download(request:Request,id:string,share:string,revision:string|null) {
  const state=await resourceAccess(request,id,share); let key=state.resource.storage_key,name=state.resource.original_name,type=state.resource.mime_type;
  if(revision){assertEditor(state.permission);const v=await first<{storage_key:string|null;original_name:string|null;mime_type:string|null}>('SELECT storage_key,original_name,mime_type FROM resource_versions WHERE resource_id=? AND revision=?',id,Number(revision));if(!v)throw httpError(404,'找不到版本。');key=v.storage_key;name=v.original_name;type=v.mime_type;}
  if(state.resource.kind!=='file'||!key)throw httpError(404,'找不到檔案。'); const object=await env.FILES.get(key);if(!object)throw httpError(404,'檔案內容不存在。');
  await audit(state.user.id,'resource.downloaded',id,{revision:revision?Number(revision):state.resource.revision}); const safe=(name||'download').replace(/["\r\n]/g,'_');
  return new Response(object.body,{headers:{'Content-Type':type||'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(safe)}`,'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store'}});
}

function handle(error:unknown) {
  const e=error as Error & {status?:number;publicMessage?:string}; if(!e.publicMessage)console.error(error); return json({error:e.publicMessage||'系統暫時無法完成操作。'},e.status||500);
}
