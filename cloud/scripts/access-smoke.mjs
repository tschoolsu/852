import { writeFileSync } from 'node:fs';
import { createHmac, createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const port=3212;
const origin=`http://127.0.0.1:${port}`;
const secret='local-access-smoke-secret';
const csrf='smoke-csrf';
const tokens={owner:'owner-token',editor:'editor-token',viewer:'viewer-token',outsider:'outsider-token'};
const hmac=value=>createHmac('sha256',secret).update(value).digest('hex');
const sha=value=>createHash('sha256').update(value).digest('hex');
const wranglerBin=fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url));
const config='dist/server/wrangler.json';

function wrangler(args) {
  const result=spawnSync(process.execPath,[wranglerBin,...args,'--persist-to','work/access-smoke-state'],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  if(result.status!==0) throw new Error(`${result.stdout}\n${result.stderr}`);
}

wrangler(['d1','migrations','apply','site-creator-d1','--local','--config',config]);
const statements=[
  'DELETE FROM resource_members','DELETE FROM share_links','DELETE FROM resource_versions','DELETE FROM resources','DELETE FROM sessions','DELETE FROM users',
  `INSERT INTO users VALUES ('u-owner','owner@tschool.tp.edu.tw','擁有者','g-owner','admin','active','2026-01-01','2026-01-01')`,
  `INSERT INTO users VALUES ('u-editor','editor@tschool.tp.edu.tw','編輯者','g-editor','member','active','2026-01-01','2026-01-01')`,
  `INSERT INTO users VALUES ('u-viewer','viewer@tschool.tp.edu.tw','檢視者','g-viewer','member','active','2026-01-01','2026-01-01')`,
  `INSERT INTO users VALUES ('u-outsider','outsider@tschool.tp.edu.tw','一般成員','g-outsider','member','active','2026-01-01','2026-01-01')`,
  ...Object.entries(tokens).map(([name,value])=>`INSERT INTO sessions VALUES ('${hmac(value)}','u-${name}','${csrf}','2099-01-01','2026-01-01')`),
  `INSERT INTO resources VALUES ('folder-shared','folder','共享資料夾','editor 可編輯',NULL,NULL,NULL,NULL,NULL,'u-owner',NULL,'selected',1,NULL,'2026-01-01','2026-01-01')`,
  `INSERT INTO resources VALUES ('child-link','link','資料夾內連結','繼承資料夾權限','https://example.com/',NULL,NULL,NULL,NULL,'u-owner','folder-shared','private',1,NULL,'2026-01-01','2026-01-01')`,
  `INSERT INTO resources VALUES ('viewer-item','link','指定檢視','viewer 可檢視','https://example.com/view',NULL,NULL,NULL,NULL,'u-owner',NULL,'selected',1,NULL,'2026-01-01','2026-01-01')`,
  `INSERT INTO resources VALUES ('members-item','folder','全體成員','所有登入者可檢視',NULL,NULL,NULL,NULL,NULL,'u-owner',NULL,'members',1,NULL,'2026-01-01','2026-01-01')`,
  `INSERT INTO resources VALUES ('private-item','folder','私人資料夾','只有 owner',NULL,NULL,NULL,NULL,NULL,'u-owner',NULL,'private',1,NULL,'2026-01-01','2026-01-01')`,
  `INSERT INTO resource_members VALUES ('folder-shared','u-editor','editor')`,
  `INSERT INTO resource_members VALUES ('viewer-item','u-viewer','viewer')`,
  `INSERT INTO share_links VALUES ('viewer-item','${sha('edit-link-token')}','editor','2026-01-01')`,
];
wrangler(['d1','execute','site-creator-d1','--local','--config',config,'--command',`${statements.join(';')};`]);

const server=spawn(process.execPath,[wranglerBin,'dev','--config',config,'--port',String(port),'--persist-to','work/access-smoke-state','--var',`SESSION_SECRET:${secret}`,'--var','ALLOWED_EMAIL_DOMAIN:tschool.tp.edu.tw','--var',`APP_URL:${origin}`],{stdio:['ignore','pipe','pipe']});
let logs=''; server.stdout.on('data',chunk=>{logs+=chunk}); server.stderr.on('data',chunk=>{logs+=chunk});

const cookie=name=>`tfiles_session=${tokens[name]}`;
async function api(path,{as='owner',method='GET',body,headers={}}={}) {
  const response=await fetch(`${origin}${path}`,{method,headers:{Cookie:cookie(as),...headers},body});
  const data=await response.json().catch(()=>({})); return {status:response.status,data,response};
}
function assert(condition,message){if(!condition)throw new Error(message)}
async function waitUntilReady(){for(let i=0;i<50;i++){try{const r=await fetch(origin);if(r.status<500)return;}catch{}await new Promise(r=>setTimeout(r,200));}throw new Error(`Dev server did not start.\n${logs}`)}

try {
  await waitUntilReady();
  for(const name of Object.keys(tokens)){const r=await api('/api/me',{as:name});assert(r.status===200,`${name} 無法登入`) }

  const editorList=await api('/api/resources?scope=accessible',{as:'editor'});
  assert(editorList.data.items.some(item=>item.id==='folder-shared'&&item.permission==='editor'),'editor 未取得共享資料夾編輯權限');
  assert(!editorList.data.items.some(item=>item.id==='private-item'),'editor 看見私人資料夾');
  const editorChild=await api('/api/resources?scope=accessible&parent=folder-shared',{as:'editor'});
  assert(editorChild.data.items.some(item=>item.id==='child-link'&&item.permission==='editor'),'子項目未繼承資料夾編輯權限');

  const viewerList=await api('/api/resources?scope=accessible',{as:'viewer'});
  assert(viewerList.data.items.some(item=>item.id==='viewer-item'&&item.permission==='viewer'),'viewer 未取得指定檢視權限');
  assert(viewerList.data.items.some(item=>item.id==='members-item'&&item.permission==='viewer'),'viewer 未取得全體成員檢視權限');
  const outsiderList=await api('/api/resources?scope=accessible',{as:'outsider'});
  assert(outsiderList.data.items.length===1&&outsiderList.data.items[0].id==='members-item','一般成員看見不應存取的項目');

  const editOk=await api('/api/resources/child-link',{as:'editor',method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'edit',csrf,title:'編輯者已修改',description:'通過',url:'https://example.com/edited'})});
  assert(editOk.status===200,'editor 無法編輯共享資料夾內的項目');
  const editDenied=await api('/api/resources/viewer-item',{as:'viewer',method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'edit',csrf,title:'不應成功',url:'https://example.com'})});
  assert(editDenied.status===403,`viewer 編輯請求應回 403，實際為 ${editDenied.status}: ${JSON.stringify(editDenied.data)}`);
  const csrfDenied=await api('/api/resources/viewer-item',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'trash',csrf:'wrong'})});
  assert(csrfDenied.status===403,'錯誤 CSRF 仍可變更資料');

  const unauthLink=await fetch(`${origin}/api/resources/viewer-item?share=edit-link-token`);
  assert(unauthLink.status===401,'未登入者可使用共享連結');
  const authLink=await api('/api/resources/viewer-item?share=edit-link-token',{as:'outsider'});
  assert(authLink.status===200&&authLink.data.resource.permission==='editor','已登入成員未取得連結編輯權限');
  const sharedByName=await api('/api/resources/private-item',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'member-add',csrf,recipient:'一般成員',role:'viewer'})});
  assert(sharedByName.status===200&&sharedByName.data.notificationSent===false&&Boolean(sharedByName.data.warning),'依本名共享或未設定寄信服務的回應不正確');

  for(const [filename,uploadTitle,notes] of [['multi-a.txt','改名檔案.txt','第一份說明'],['multi-b.txt','','第二份說明']]) {
    const form=new FormData();form.set('kind','file');form.set('csrf',csrf);form.set('parentId','private-item');form.set('title',uploadTitle);form.set('description',notes);form.set('file',new File(['bytes-'+filename],filename,{type:'text/plain'}));
    const uploaded=await api('/api/resources',{method:'POST',body:form});assert(uploaded.status===201,'多檔佇列上傳失敗');
    const detail=await api('/api/resources/'+uploaded.data.id);assert(detail.data.resource.parent_id==='private-item'&&detail.data.resource.title===(uploadTitle||filename)&&detail.data.resource.description===notes,'多檔名稱、說明或資料夾不符');
    const downloaded=await fetch(origin+'/api/resources/'+uploaded.data.id+'/download',{headers:{Cookie:cookie('owner')}});assert(downloaded.status===200&&await downloaded.text()==='bytes-'+filename,'多檔下載內容不符');
  }
  console.log('Multi-upload storage checks passed: two files, separate metadata, default name, folder destination and exact download bytes.');

  const fileForm=new FormData(); fileForm.set('kind','file'); fileForm.set('csrf',csrf); fileForm.set('parentId','folder-shared'); fileForm.set('description','R2 smoke'); fileForm.set('file',new File(['version one'],'sample.txt',{type:'text/plain'}));
  const created=await api('/api/resources',{method:'POST',body:fileForm}); assert(created.status===201,'檔案上傳失敗');
  const fileId=created.data.id;
  const filesOnly=await api('/api/resources?scope=files',{as:'editor'});assert(filesOnly.data.items.length===1&&filesOnly.data.items[0].id===fileId&&filesOnly.data.items.every(r=>r.kind==='file'),'檔案專區未跨資料夾篩選或洩漏未授權檔案');
  const linksOnly=await api('/api/resources?scope=links',{as:'editor'});assert(linksOnly.data.items.length===1&&linksOnly.data.items[0].id==='child-link','連結專區未顯示繼承權限的子項目');
  const searched=await api('/api/resources?scope=links&q='+encodeURIComponent('編輯者已修改'),{as:'editor'});assert(searched.data.items.length===1,'連結專區搜尋失敗');
  assert((await api('/api/resources?scope=files&q=nonexistent-query',{as:'owner'})).data.items.length===0,'專區搜尋未篩選');
  assert((await fetch(origin+'/api/resources?scope=files')).status===401,'未登入可使用檔案專區');
  console.log('File/link area checks passed: type filter, nested items, inherited access, search and login restriction.');
  const createdDetail=await api(`/api/resources/${fileId}`); assert(createdDetail.data.resource.title==='sample.txt','未填名稱時沒有使用原始檔名');
  const download=await fetch(`${origin}/api/resources/${fileId}/download`,{headers:{Cookie:cookie('owner')}}); assert(download.status===200&&await download.text()==='version one','檔案下載內容不符');
  const replacement=new FormData(); replacement.set('operation','edit'); replacement.set('csrf',csrf); replacement.set('title','測試文字檔 v2'); replacement.set('description','replaced'); replacement.set('file',new File(['version two'],'sample-v2.txt',{type:'text/plain'}));
  const replaced=await api(`/api/resources/${fileId}`,{method:'POST',body:replacement}); assert(replaced.status===200,'替換檔案失敗');
  const versions=await api(`/api/resources/${fileId}`); assert(versions.data.versions.length===2,'版本紀錄不完整');

  assert((await api('/api/resources/viewer-item',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'trash',csrf})})).status===200,'移到垃圾桶失敗');
  assert((await api('/api/resources/viewer-item?trash=1')).status===200,'垃圾桶項目無法開啟');
  assert((await api('/api/resources/viewer-item',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'restore',csrf})})).status===200,'垃圾桶還原失敗');


  const batch=(ids,operation,data={},as='owner')=>api('/api/selection',{as,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids,operation,csrf,...data})});
  assert((await batch(['private-item'],'trash',{csrf:'wrong'})).status===403,'批次操作未檢查 CSRF');
  assert((await batch(['viewer-item'],'trash',{},'viewer')).data.results[0].ok===false,'檢視者可批次刪除別人內容');
  const shared=await batch(['viewer-item','private-item'],'member-add',{recipient:'viewer@tschool.tp.edu.tw',role:'viewer'});assert(shared.data.results.every(r=>r.ok),'批次共享失敗');
  const links=await batch(['viewer-item','private-item'],'link-generate',{role:'viewer'});assert(links.data.results.every(r=>r.url?.includes('/s/')),'批次共享連結未產生');
  const mixed=await batch(['viewer-item','missing-id'],'move',{parentId:'members-item'});assert(mixed.data.results[0].ok&&!mixed.data.results[1].ok,'部分失敗沒有分開回報');
  assert((await api('/api/resources/viewer-item')).data.resource.parent_id==='members-item','批次移動未生效');
  assert(!(await batch(['folder-shared'],'move',{parentId:'folder-shared'})).data.results[0].ok,'可將資料夾移入自己');
  const zipResponse=await fetch(origin+'/api/selection',{method:'POST',headers:{Cookie:cookie('owner'),'Content-Type':'application/json'},body:JSON.stringify({ids:['folder-shared',fileId],operation:'download',csrf})});
  assert(zipResponse.status===200&&zipResponse.headers.get('content-type')==='application/zip','資料夾 ZIP 下載失敗');writeFileSync('work/selection-test.zip',Buffer.from(await zipResponse.arrayBuffer()));
  const deniedZip=await batch(['folder-shared'],'download',{},'outsider');assert(deniedZip.status===404,'可下載未授權資料夾');
  const trashed=await batch(['folder-shared',fileId],'trash');assert(trashed.data.results.length===1&&trashed.data.results[0].ok,'父子項目重複刪除');
  assert((await batch(['folder-shared'],'download')).status===404,'可下載垃圾桶內容');
  assert((await batch(['folder-shared'],'restore')).data.results[0].ok,'批次還原失敗');
  assert((await batch([fileId],'trash')).data.results[0].ok,'測試檔案移入垃圾桶失敗');
  assert((await batch([fileId],'delete')).data.results[0].ok,'批次永久刪除失敗');
  assert((await api('/api/resources/'+fileId+'?trash=1')).status===404,'永久刪除後仍能存取');
  console.log('Batch checks passed: sharing, share links, move, permission denial, CSRF, partial failure, ZIP, ancestor deduplication, trash, restore and permanent deletion.');

  const uploadAccess={level:'selected',members:[{recipient:'editor@tschool.tp.edu.tw',role:'editor'},{recipient:'檢視者',role:'viewer'}],linkRole:'viewer'};
  const formWithAccess=(access)=>{const f=new FormData();f.set('csrf',csrf);f.set('kind','file');f.set('file',new File(['access test'],'access.txt',{type:'text/plain'}));f.set('access',JSON.stringify(access));return f;};
  const withAccess=await api('/api/resources',{method:'POST',body:formWithAccess(uploadAccess)});assert(withAccess.status===201&&withAccess.data.url,'上傳時權限或共享連結未建立');
  const accessId=withAccess.data.id;
  assert((await api('/api/resources/'+accessId,{as:'editor'})).data.resource.permission==='editor','上傳指定編輯權未生效');
  assert((await api('/api/resources/'+accessId,{as:'viewer'})).data.resource.permission==='viewer','上傳指定檢視權未生效');
  assert((await api('/api/resources/'+accessId,{as:'outsider'})).status===404,'未共享成員可讀取新檔案');
  const rawLink=withAccess.data.url.split('/').pop();assert((await api('/api/resources/'+accessId+'?share='+rawLink,{as:'outsider'})).data.resource.permission==='viewer','上傳連結權限未生效');
  assert((await fetch(origin+'/api/resources/'+accessId+'?share='+rawLink)).status===401,'共享連結未要求登入');
  const configure=(access,as='owner',csrfValue=csrf)=>api('/api/resources/'+accessId,{as,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'access-config',csrf:csrfValue,access})});
  const privateConfig={level:'private',members:[],linkRole:''};
  assert((await configure(privateConfig,'editor')).status===403,'非擁有者可管理權限');
  assert((await configure(privateConfig,'owner','wrong')).status===403,'權限設定未檢查 CSRF');
  assert((await configure({...uploadAccess,members:[{recipient:'nobody@example.com',role:'viewer'}]})).status===400,'接受無效成員');
  assert((await api('/api/resources/'+accessId,{as:'editor'})).data.resource.permission==='editor','無效設定破壞既有權限');
  assert((await configure(privateConfig)).status===200,'已完成上傳無法改為私人');
  assert((await api('/api/resources/'+accessId,{as:'viewer'})).status===404,'私人設定未移除指定成員');
  assert((await api('/api/resources/'+accessId+'?share='+rawLink,{as:'outsider'})).status===404,'私人設定未撤銷共享連結');
  const malformed=await api('/api/resources',{method:'POST',body:formWithAccess({...uploadAccess,members:[{recipient:'nobody@example.com',role:'viewer'}]})});assert(malformed.status===400,'上傳接受無效共享成員');
  const allConfig={level:'members',members:[],linkRole:''};assert((await configure(allConfig)).status===200,'無法設為所有成員');
  assert((await api('/api/resources/'+accessId,{as:'outsider'})).data.resource.permission==='viewer','所有成員權限未生效');
  console.log('Upload access checks passed: atomic initial grants, viewer/editor, links, login, owner-only changes, CSRF, invalid-member rollback and revocation.');
  console.log('Existing access, multi-upload, file/link areas and batch checks passed.');
} catch(error) {
  console.error(logs);
  throw error;
} finally {
  server.kill();
}
