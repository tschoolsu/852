// Local-only, resettable API fixture for manually checking slow/error UI paths.
// First build and start the app on port 3210, then run this and visit :3211.
import http from 'node:http';
const origin = 'http://127.0.0.1:3210';
let records, delay = 1800, failNext = false, requests = [];
function reset() {
  records = [{id:'fixture',kind:'link',title:'可重設的測試項目',description:'僅本機測試資料',url:'https://example.com',owner_id:'test',owner_name:'測試成員',permission:'owner',access_level:'private',revision:1,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),trashed_at:null}];
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
        const file=body.file;
        records.push({...records[0],id:crypto.randomUUID(),kind:body.kind,title:body.title||file?.name,original_name:file?.name,mime_type:file?.type,description:body.description,url:body.url,trashed_at:null});
      } else {
        const id=url.pathname.split('/')[3],r=records.find(r=>r.id===id);
        if(body.operation==='delete') records=records.filter(r=>r.id!==id);
        if(body.operation==='trash') r.trashed_at=new Date().toISOString();
        if(body.operation==='restore') r.trashed_at=null;
        if(body.operation==='edit') Object.assign(r,{title:body.title,description:body.description,url:body.url,revision:r.revision+1});
      }
      return json({ok:true});
    }
    if(url.pathname==='/api/resources') return json({items:records.filter(r=>url.searchParams.get('scope')==='trash'?r.trashed_at:!r.trashed_at),folder:null});
    const resource=records.find(r=>r.id===url.pathname.split('/')[3]);
    return json({resource,versions:[],members:[],link:null});
  }catch(error){json({error:error.message},500);}
}).listen(3211,'127.0.0.1',()=>console.log('Resettable UI fixture: http://127.0.0.1:3211'));
