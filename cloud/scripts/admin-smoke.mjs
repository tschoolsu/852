// Run against a disposable PostgreSQL database named tfiles_admin_smoke.
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { Pool } from 'pg';
import { SMTPServer } from 'smtp-server';

if (process.env.ADMIN_SMOKE_ENV_FILE) process.loadEnvFile(process.env.ADMIN_SMOKE_ENV_FILE);
const testUrl = process.env.ADMIN_SMOKE_DATABASE_URL ? new URL(process.env.ADMIN_SMOKE_DATABASE_URL) : process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
if (testUrl && !process.env.ADMIN_SMOKE_DATABASE_URL) testUrl.pathname = '/tfiles_admin_smoke';
const databaseUrl = testUrl?.toString();
if (!databaseUrl || new URL(databaseUrl).pathname !== '/tfiles_admin_smoke') throw Error('ADMIN_SMOKE_DATABASE_URL must point to tfiles_admin_smoke.');
const port = 3398, origin = `http://127.0.0.1:${port}`, secret = 'admin-smoke-session-secret', csrf = 'admin-smoke-csrf';
const db = new Pool({ connectionString:databaseUrl });
const tokens = { admin:'admin-smoke-token',member:'member-smoke-token' };
const cookie = name => `tfiles_session=${tokens[name]}`;
const hash = value => createHmac('sha256',secret).update(value).digest('hex');
const mail = [];
const smtp = new SMTPServer({ secure:false,disabledCommands:['STARTTLS'],allowInsecureAuth:true,logger:false,
  onAuth(auth,session,callback) { callback(auth.username==='fixture'&&auth.password==='fixture'?null:Error('Invalid fixture SMTP login'),{user:'fixture'}); },
  onData(stream,session,callback) { let raw='';stream.on('data',c=>raw+=c);stream.on('end',()=>{mail.push({to:session.envelope.rcptTo[0].address,raw});callback()}); },
});
let server;
const check = (condition,message) => { if(!condition)throw Error(message); };
async function api(path,as='admin',method='GET',body) {
  const response = await fetch(`${origin}${path}`,{method,headers:{Cookie:cookie(as),Origin:origin,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  return {status:response.status,data:await response.json().catch(()=>({}))};
}
try {
  await db.query(await readFile(new URL('../postgres/001_initial.sql',import.meta.url),'utf8'));
  await db.query(`TRUNCATE audit_log,auth_rate_limits,auth_tokens,password_credentials,sessions,resource_versions,resource_members,share_links,resources,users RESTART IDENTITY`);
  await db.query(`INSERT INTO users(id,email,display_name,google_subject,role,status,created_at,updated_at) VALUES
    ('admin','11430106@tschool.tp.edu.tw','管理員','local:admin','admin','active','2026-01-01','2026-01-01'),
    ('member','member@tschool.tp.edu.tw','測試成員','local:member','member','active','2026-02-01','2026-02-01')`);
  await db.query(`INSERT INTO resources(id,kind,title,description,url,owner_id,access_level,revision,created_at,updated_at) VALUES
    ('private-link','link','私人連結','私有資料','https://example.com/','member','private',1,'2026-02-02','2026-02-02')`);
  for(const [name,value] of Object.entries(tokens)) await db.query(`INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at,created_at) VALUES($1,$2,$3,$4,$5)`,[hash(value),name,csrf,'2099-01-01','2026-03-01']);
  await db.query(`INSERT INTO password_credentials VALUES ('member','fixture-hash','2026-01-01','2026-01-01')`);
  await new Promise(resolve=>smtp.listen(2527,'127.0.0.1',resolve));
  server = spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{cwd:new URL('..',import.meta.url),env:{...process.env,DATABASE_URL:databaseUrl,SESSION_SECRET:secret,ADMIN_EMAILS:'11430106@tschool.tp.edu.tw',APP_URL:origin,FILE_STORAGE_PATH:'/tmp/tfiles-admin-smoke-files',SMTP_HOST:'127.0.0.1',SMTP_PORT:'2527',SMTP_USER:'fixture',SMTP_PASSWORD:'fixture',SMTP_FROM_EMAIL:'fixture@example.com'},stdio:['ignore','pipe','pipe']});
  let logs='';server.stdout.on('data',c=>logs+=c);server.stderr.on('data',c=>logs+=c);
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(origin)).status<500){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,200))}
  if(!ready)throw Error('Next server did not start: '+logs.slice(-1000));
  const adminList=await api('/api/admin?view=members');check(adminList.status===200,`Admin members failed: ${JSON.stringify(adminList)}`);
  check(adminList.data.members.some(m=>m.id==='member'&&Number(m.links)===1),'Member statistics incorrect');
  check((await api('/api/admin?view=members','member')).status===403,'Ordinary member reached admin API');
  check((await api('/api/admin','member','POST',{csrf,operation:'reset-registration',userId:'admin'})).status===403,'Ordinary member changed account');
  const adminDetail=await api('/api/resources/private-link');check(adminDetail.status===200&&adminDetail.data.resource.permission==='editor','Admin did not receive inherited private access');
  check((await api('/api/resources/private-link','member')).status===200,'Owner lost resource access');
  const shares=await db.query('SELECT * FROM resource_members');check(shares.rowCount===0,'Admin access was exposed as a share');
  const events=await api('/api/admin?view=events&member=admin&from=2026-01-01&order=oldest');check(events.status===200&&events.data.events.some(e=>e.action==='admin.resource_opened'),'Admin access was not audited');
  check((await api('/api/admin?view=files')).status===200,'File size view failed');
  const health=await api('/api/admin?view=health');check(health.status===200&&health.data.health.backup.configured===false,'Backup health incorrectly reported as verified');
  check((await api('/api/admin','admin','POST',{csrf:'wrong',operation:'reset-registration',userId:'member'})).status===403,'Admin CSRF was bypassed');
  const reset=await api('/api/admin','admin','POST',{csrf,operation:'reset-registration',userId:'member'});check(reset.status===200,`Reset failed: ${JSON.stringify(reset)}`);
  const identity=await db.query('SELECT id,status FROM users WHERE email=$1',['member@tschool.tp.edu.tw']);
  check(identity.rows[0].id==='member'&&identity.rows[0].status==='reset_required','Reset changed member identity or status incorrectly');
  check((await db.query('SELECT owner_id FROM resources WHERE id=$1',['private-link'])).rows[0].owner_id==='member','Reset changed file ownership');
  check((await api('/api/me','member')).status===401,'Old session survived reset');
  const resend=await api('/api/admin','admin','POST',{csrf,operation:'resend-mail',userId:'member'});check(resend.status===200&&mail.at(-1)?.to==='member@tschool.tp.edu.tw','Resend did not use school mailbox');
  console.log('Admin smoke passed: access isolation, hidden administrative permission, members/events/health, CSRF, identity-preserving reset and SMTP resend.');
} finally {
  server?.kill(); await new Promise(resolve=>smtp.close(resolve)); await db.end();
}
