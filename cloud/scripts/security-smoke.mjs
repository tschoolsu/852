// Requires a disposable PostgreSQL database named tfiles_security_smoke.
import {readFile,mkdtemp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHmac} from 'node:crypto';
import {Pool} from 'pg';
import {SMTPServer} from 'smtp-server';

if(process.env.SECURITY_SMOKE_ENV_FILE)process.loadEnvFile(process.env.SECURITY_SMOKE_ENV_FILE);
const databaseUrl=process.env.SECURITY_SMOKE_DATABASE_URL||(()=>{const url=new URL(process.env.DATABASE_URL);url.pathname='/tfiles_security_smoke';return url.toString()})();
if(new URL(databaseUrl).pathname!=='/tfiles_security_smoke')throw Error('Use a disposable tfiles_security_smoke database.');
const origin='http://127.0.0.1:3399',secret='security-smoke-secret',csrf='security-smoke-csrf';
const db=new Pool({connectionString:databaseUrl});
const storage=await mkdtemp(path.join(tmpdir(),'tfiles-security-smoke-'));
const tokens={owner:'owner-session',editor:'editor-session',recipient:'recipient-session',imposter:'imposter-session'};
const cookie=name=>`tfiles_session=${tokens[name]}`;
const hash=value=>createHmac('sha256',secret).update(value).digest('hex');
const mail=[];
const smtp=new SMTPServer({secure:false,disabledCommands:['STARTTLS'],allowInsecureAuth:true,logger:false,
  onAuth(auth,session,done){done(auth.username==='fixture'&&auth.password==='fixture'?null:Error('Bad test credentials'),{user:'fixture'});},
  onData(stream,session,done){stream.resume();stream.on('end',()=>{mail.push(session.envelope.rcptTo[0].address);done();});},
});
let server,logs='';
const assert=(condition,message)=>{if(!condition)throw Error(message)};
async function api(endpoint,{as='owner',method='GET',body}={}){
  const multipart=body instanceof FormData;
  const response=await fetch(origin+endpoint,{method,headers:{Cookie:cookie(as),Origin:origin,...(!multipart&&body?{'Content-Type':'application/json'}:{})},body:multipart?body:body?JSON.stringify(body):undefined});
  return {status:response.status,data:await response.json().catch(()=>({}))};
}
const mutate=(id,operation,data={},as='owner')=>api('/api/resources/'+id,{as,method:'POST',body:{csrf,operation,...data}});
function form(kind,title,parentId=''){
  const result=new FormData();result.set('csrf',csrf);result.set('kind',kind);result.set('title',title);if(parentId)result.set('parentId',parentId);
  if(kind==='link')result.set('url','https://example.com/');
  if(kind==='file')result.set('file',new File(['test-file'],'test.txt',{type:'text/plain'}));
  return result;
}
const fileCount=async()=>{let count=0;async function walk(directory){for(const entry of await readdir(directory,{withFileTypes:true})){if(entry.isDirectory())await walk(path.join(directory,entry.name));else count++;}}await walk(storage);return count;};

try{
  await db.query(await readFile(new URL('../postgres/001_initial.sql',import.meta.url),'utf8'));
  await db.query('TRUNCATE audit_log,auth_rate_limits,auth_tokens,password_credentials,sessions,resource_versions,resource_members,share_links,resources,users RESTART IDENTITY');
  for(const name of Object.keys(tokens)){
    await db.query('INSERT INTO users(id,email,display_name,google_subject,role,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [name,`${name}@tschool.tp.edu.tw`,name,`local:${name}`,'member','active','2026-01-01','2026-01-01']);
    await db.query('INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at,created_at) VALUES($1,$2,$3,$4,$5)',[hash(tokens[name]),name,csrf,'2099-01-01','2026-01-01']);
  }
  await db.query("UPDATE users SET display_name='recipient@tschool.tp.edu.tw' WHERE id='imposter'");
  await new Promise(resolve=>smtp.listen(2528,'127.0.0.1',resolve));
  server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3399'],{cwd:new URL('..',import.meta.url),env:{...process.env,DATABASE_URL:databaseUrl,SESSION_SECRET:secret,APP_URL:origin,ADMIN_EMAILS:'nobody@tschool.tp.edu.tw',FILE_STORAGE_PATH:storage,
    SMTP_HOST:'127.0.0.1',SMTP_PORT:'2528',SMTP_USER:'fixture',SMTP_PASSWORD:'fixture',SMTP_FROM_EMAIL:'fixture@example.com'},stdio:['ignore','pipe','pipe']});
  server.stdout.on('data',chunk=>logs+=chunk);server.stderr.on('data',chunk=>logs+=chunk);
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(origin)).status<500){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,200));}
  assert(ready,'Test server unavailable: '+logs.slice(-1000));

  assert((await api('/api/resources',{method:'POST',body:form('file','   ')})).status===400,'Invalid upload accepted');
  assert(await fileCount()===0,'Invalid upload left a file');
  const created=await api('/api/resources',{method:'POST',body:form('file','valid.txt')});
  assert(created.status===201,'Valid upload failed: '+JSON.stringify(created));
  const fileId=created.data.id;
  assert(await fileCount()===1,'Valid upload missing its file');
  const badEdit=new FormData();badEdit.set('csrf',csrf);badEdit.set('operation','edit');badEdit.set('title','   ');badEdit.set('file',new File(['replacement'],'replacement.txt'));
  assert((await api('/api/resources/'+fileId,{method:'POST',body:badEdit})).status===400,'Invalid replacement accepted');
  assert(await fileCount()===1,'Invalid replacement left a file');

  await db.query(`CREATE FUNCTION tfiles_smoke_reject_upload() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'test rejection'; END $$ LANGUAGE plpgsql`);
  await db.query('CREATE TRIGGER tfiles_smoke_reject_upload BEFORE INSERT ON resources FOR EACH ROW EXECUTE FUNCTION tfiles_smoke_reject_upload()');
  assert((await api('/api/resources',{method:'POST',body:form('file','db-rejected.txt')})).status===500,'Database rejection did not fail upload');
  assert(await fileCount()===1,'Database failure left an orphan file');
  await db.query('DROP TRIGGER tfiles_smoke_reject_upload ON resources');await db.query('DROP FUNCTION tfiles_smoke_reject_upload()');

  const folder=(await api('/api/resources',{method:'POST',body:form('folder','Shared')})).data.id;
  const recipientFolder=(await api('/api/resources',{as:'recipient',method:'POST',body:form('folder','Recipient private')})).data.id;
  assert((await mutate(folder,'member-add',{recipient:'editor@tschool.tp.edu.tw',role:'editor'})).status===200,'Editor share failed');
  const moved=(await api('/api/resources',{method:'POST',body:form('link','Historical parent',recipientFolder)}));
  assert(moved.status===403,'Owner unexpectedly created inside another user folder');
  const link=(await api('/api/resources',{method:'POST',body:form('link','Shared link')})).data.id;
  assert((await mutate(link,'move',{parentId:folder})).status===200,'Move to shared folder failed');

  const access=await mutate(link,'access-config',{access:{level:'private',members:[{recipient:'recipient@tschool.tp.edu.tw',role:'viewer'}],linkRole:''}});
  assert(access.status===200,'Exact email sharing failed despite matching display name: '+JSON.stringify(access));
  const recipients=(await db.query('SELECT user_id FROM resource_members WHERE resource_id=$1',[link])).rows;
  assert(recipients.length===1&&recipients[0].user_id==='recipient','Email sharing selected an impersonator');
  assert((await mutate(link,'member-add',{recipient:'missing@tschool.tp.edu.tw',role:'viewer'})).status===400,'Nonexistent email resolved as a display name');

  const firstShare=await mutate(fileId,'member-add',{recipient:'recipient@tschool.tp.edu.tw',role:'viewer'});
  assert(firstShare.status===200&&firstShare.data.notificationSent,'Initial share notification failed');
  for(let i=0;i<4;i++)assert((await mutate(fileId,'member-add',{recipient:'recipient@tschool.tp.edu.tw',role:'viewer'})).status===200,'Idempotent share failed');
  assert(mail.filter(email=>email==='recipient@tschool.tp.edu.tw').length===1,'Unchanged sharing sent duplicate mail');
  for(let i=0;i<5;i++)await mutate(fileId,'member-add',{recipient:'recipient@tschool.tp.edu.tw',role:i%2?'viewer':'editor'});
  assert(mail.filter(email=>email==='recipient@tschool.tp.edu.tw').length<=3,'Share notification rate limit failed');
  assert((await mutate(fileId,'member-remove',{userId:'recipient'})).status===200,'Member removal failed');
  assert((await mutate(fileId,'access-level',{level:'members'})).status===200,'Access level change failed');
  const events=(await db.query("SELECT action FROM audit_log WHERE target_id=$1 AND action IN ('share.member_removed','share.access_level_changed')",[fileId])).rows.map(row=>row.action);
  assert(events.includes('share.member_removed')&&events.includes('share.access_level_changed'),'Permission changes missing audit records');

  const simultaneous=await Promise.all(['A','B'].map(title=>mutate(fileId,'edit',{title,description:'',url:''})));
  assert(simultaneous.every(response=>[200,409].includes(response.status)),'Concurrent edit returned unexpected result');
  const current=(await db.query('SELECT title,revision FROM resources WHERE id=$1',[fileId])).rows[0];
  const latest=(await db.query('SELECT title FROM resource_versions WHERE resource_id=$1 AND revision=$2',[fileId,current.revision])).rows[0];
  assert(current.title===latest?.title,'Current content differs from its version');

  for(let i=0;i<21;i++){
    const response=await api('/api/selection',{method:'POST',body:{csrf,operation:'link-generate',ids:[fileId]}});
    if(i===20)assert(response.status===429,'Batch request limit did not apply');
  }
  console.log('Security smoke passed: upload cleanup, email identity, notification dedup/rate limit, permission audit, revision integrity, and batch limit.');
} finally {
  if(server){server.kill();await new Promise(resolve=>{if(server.exitCode!==null)return resolve();server.once('exit',resolve);setTimeout(resolve,3000);});}
  await new Promise(resolve=>smtp.close(resolve));
  await db.end();
  if(storage.startsWith(path.join(tmpdir(),'tfiles-security-smoke-')))await rm(storage,{recursive:true,force:true});
}
