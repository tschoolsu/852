// Local-only, resettable API fixture for manually checking slow/error UI paths.
// First build and start the app on port 3210, then run this and visit :3211.
import http from 'node:http';
const origin = 'http://127.0.0.1:3210';
let records, delay = 1800, failNext = false, requests = [];
function reset() {
  records = [{id:'fixture',kind:'link',title:'可重設的測試項目',description:'僅本機測試資料',url:'https://example.com',owner_id:'test',owner_name:'測試成員',permission:'owner',access_level:'private',revision:1,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),trashed_at:null}];
  records.push({...records[0],id:'locked-link',title:'受限連結測試',description:'所有人看得到的說明',owner_id:'other',owner_name:'其他成員',permission:'',url:undefined});
  requests = []; failNext = false;
}
reset();
http.createServer(async(req,res)=>{
  const url = new URL(req.url, 'http://127.0.0.1:3211');
  const json = (data,status=200)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));};
  try {
    if(url.pathname === '/__fixture') {
      if(url.searchParams.has('reset')) reset();
      if(url.searchParams.has('fail')) failNext = true;
      if(url.searchParams.has('delay')) delay = Number(url.searchParams.get('delay'));
      return json({records,requests,delay,failNext});
    }
    if(!url.pathname.startsWith('/api/')) {
      const upstream = await fetch(origin+req.url);
      const headers = Object.fromEntries(upstream.headers);
      delete headers['content-encoding']; delete headers['content-length'];
      res.writeHead(upstream.status,headers);return res.end(Buffer.from(await upstream.arrayBuffer()));
    }
    requests.push({method:req.method,path:req.url});
    if(url.pathname === '/api/me') return json({user:{id:'test',displayName:'測試成員',email:'test@tschool.tp.edu.tw',role:'admin'},csrf:'fixture'});
    if(url.pathname==='/api/users')return json({users:[{id:'viewer',email:'viewer@tschool.tp.edu.tw',display_name:'測試檢視者'}]});
    let body={};
    if(req.method==='POST') {
      const chunks=[];for await(const chunk of req) chunks.push(chunk);
      const request=new Request('http://localhost/',{method:'POST',headers:req.headers,body:Buffer.concat(chunks)});
      body=req.headers['content-type']?.includes('application/json')?await request.json():Object.fromEntries(await request.formData());
    }
    await new Promise(resolve=>setTimeout(resolve,delay));
    if(failNext){failNext=false;return json({error:'測試：連線失敗，請再試一次。'},503);}
    if(req.method==='POST'&&url.pathname==='/api/selection') {
      if(body.operation==='download'){res.writeHead(200,{'content-type':'application/zip'});return res.end('fixture');}
      const results=body.ids.map(id=>{const r=records.find(r=>r.id===id);if(!r)return {id,ok:false,error:'找不到項目'};if(body.operation==='trash')r.trashed_at=new Date().toISOString();if(body.operation==='restore')r.trashed_at=null;if(body.operation==='delete')records=records.filter(x=>x.id!==id);if(body.operation==='move')r.parent_id=body.parentId||null;return {id,ok:true,...(body.operation==='link-generate'?{url:'https://example.com/s/'+id}:{})};});return json({results});
    }
    if(req.method==='POST') {
      if(url.pathname==='/api/resources') {
        const file=body.file,id=crypto.randomUUID();
        const access=body.access?JSON.parse(body.access):{level:'private',members:[],linkRole:''};
        records.push({...records[0],id,parent_id:body.parentId||null,kind:body.kind,title:body.title||file?.name,original_name:file?.name,mime_type:file?.type,description:body.description,url:body.url,trashed_at:null,access_level:access.level,members:access.members.map(m=>({id:m.recipient,email:m.recipient,display_name:m.recipient,role:m.role})),link:access.linkRole?{role:access.linkRole}:null});return json({ok:true,id,url:'http://127.0.0.1:3211/s/'+id},201);
      } else {
        const id=url.pathname.split('/')[3],r=records.find(r=>r.id===id);
        if(body.operation==='delete') records=records.filter(r=>r.id!==id);
        if(body.operation==='trash') r.trashed_at=new Date().toISOString();
        if(body.operation==='restore') r.trashed_at=null;
        if(body.operation==='edit') Object.assign(r,{title:body.title,description:body.description,url:body.url,revision:r.revision+1});
        if(body.operation==='access-config'){r.access_level=body.access.level;r.members=body.access.members.map(m=>({id:m.recipient,email:m.recipient,display_name:m.recipient,role:m.role}));r.link=body.access.linkRole?{role:body.access.linkRole}:null;return json({ok:true,url:'http://127.0.0.1:3211/s/'+id});}
      }
      return json({ok:true});
    }
    if(url.pathname==='/api/resources') return json({items:records.filter(r=>url.searchParams.get('scope')==='trash'?r.trashed_at:!r.trashed_at&&(url.searchParams.get('scope')==='folders'?r.kind==='folder':(r.parent_id||'')===(url.searchParams.get('parent')||''))),folder:records.find(r=>r.id===url.searchParams.get('parent'))||null});
    const resource=records.find(r=>r.id===url.pathname.split('/')[3]);
    if(!resource?.permission)return json({error:'你目前沒有此項目的存取權'},403);return json({resource,versions:[],members:resource?.members||[],shareUrl:'http://127.0.0.1:3211/s/'+resource.id});
  }catch(error){json({error:error.message},500);}
}).listen(3211,'127.0.0.1',()=>console.log('Resettable UI fixture: http://127.0.0.1:3211'));
