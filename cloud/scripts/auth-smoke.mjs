import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {SMTPServer} from 'smtp-server';

const origin='http://127.0.0.1:3213',state='work/auth-smoke-state';
const bin=fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url));
const config='dist/server/wrangler.json',mail=[];let rejectMail=false;
function sql(command){const r=spawnSync(process.execPath,[bin,'d1','execute','site-creator-d1','--local','--config',config,'--persist-to',state,'--command',command],{encoding:'utf8'});if(r.status!==0)throw Error(r.stderr+r.stdout);}
const migrations=spawnSync(process.execPath,[bin,'d1','migrations','apply','site-creator-d1','--local','--config',config,'--persist-to',state],{encoding:'utf8'});if(migrations.status!==0)throw Error(migrations.stderr+migrations.stdout);
sql(`DELETE FROM auth_rate_limits; DELETE FROM auth_tokens; DELETE FROM password_credentials; DELETE FROM sessions; DELETE FROM resources; DELETE FROM users;
INSERT INTO users VALUES ('legacy','legacy@tschool.tp.edu.tw','舊名稱','google-existing','admin','active','2026-01-01','2026-01-01');
INSERT INTO resources(id,kind,title,description,owner_id,access_level,revision,created_at,updated_at) VALUES ('legacy-file','link','原有檔案','','legacy','private',1,'2026-01-01','2026-01-01');`);
const smtp=new SMTPServer({secure:false,disabledCommands:['STARTTLS'],allowInsecureAuth:true,logger:false,
  onAuth(auth,session,callback){callback(auth.username==='fixture'&&auth.password==='fixture'?null:Error('wrong fixture credentials'),{user:'fixture'});},
  onData(stream,session,callback){let data='';stream.on('data',chunk=>data+=chunk);stream.on('end',()=>{if(rejectMail)return callback(Error('test delivery failure'));mail.push({to:session.envelope.rcptTo[0].address,data});callback();});},
});
await new Promise(resolve=>smtp.listen(2526,'127.0.0.1',resolve));
const server=spawn(process.execPath,[bin,'dev','--config',config,'--persist-to',state,'--port','3213',
  '--var',`APP_URL:${origin}`,'--var','SESSION_SECRET:auth-smoke-secret','--var','SMTP_HOST:127.0.0.1','--var','SMTP_PORT:2526','--var','SMTP_USER:fixture','--var','SMTP_PASSWORD:fixture','--var','SMTP_FROM_EMAIL:fixture@example.com'],{stdio:['ignore','pipe','pipe']});
let logs='';server.stdout.on('data',b=>logs+=b);server.stderr.on('data',b=>logs+=b);
let checks=0;
function assert(value,message){if(!value)throw Error(message);checks++;}
async function post(action,body,extra={}){const r=await fetch(`${origin}/api/auth/${action}`,{method:'POST',headers:{Connection:'close',Origin:origin,'Content-Type':'application/json',...extra},body:JSON.stringify(body)});return {status:r.status,data:await r.json().catch(()=>({error:"Non-JSON HTTP response: "+r.status})),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
async function me(cookie){const r=await fetch(origin+'/api/me',{headers:{Cookie:cookie||''}});return {status:r.status,data:await r.json()};}
function lastToken(email){const sent=mail.filter(m=>m.to===email).at(-1);const data=sent?.data||'';const content=/Content-Transfer-Encoding: base64/i.test(data)?Buffer.from(data.split(/\r?\n\r?\n/).slice(1).join('\n'),'base64').toString():data;const decoded=content.replace(/=\r?\n/g,'').replace(/=([0-9A-F]{2})/g,(_,hex)=>String.fromCharCode(parseInt(hex,16)));const raw=decoded.match(/token=([A-Za-z0-9_-]{43})/)?.[1];if(!raw)throw Error('No reset token received by local SMTP server');return raw;}
const email='new@tschool.tp.edu.tw',password='local-password-one';
try{
  for(let i=0;i<80;i++){try{if((await fetch(origin)).status<500)break;}catch{}await new Promise(r=>setTimeout(r,200));}
  assert((await post('register',{email:'outside@example.com'})).status===400,'external domain accepted');assert((await post('register',{email},{Origin:'https://evil.example'})).status===403,'cross-origin accepted');
  
  assert((await post('register',{email:'outside@example.com'})).status===400,'second rate limit failed');const unknownLogin=await post('login',{email,password});assert(unknownLogin.status===401,'unknown login response: '+JSON.stringify(unknownLogin));
  const register=await post('register',{email});assert(register.status===200,'SMTP register failed: '+JSON.stringify(register.data));
  const reset=lastToken(email);assert(mail.length===1,'registration did not send SMTP mail');
  assert((await post('complete',{token:reset,password:'short',confirmPassword:'short',displayName:'測試名稱'})).status===400,'short password accepted');
  assert((await post('complete',{token:reset,password,confirmPassword:'mismatch',displayName:'測試名稱'})).status===400,'mismatch accepted');
  const completed=await post('complete',{token:reset,password,confirmPassword:password,displayName:'測試名稱'});assert(completed.status===200,'completion failed: '+JSON.stringify(completed.data));
  assert((await post('complete',{token:reset,password,confirmPassword:password,displayName:'測試名稱'})).status===400,'reused token accepted');
  assert((await post('login',{email,password:'wrong-password'})).status===401,'wrong password accepted');
  const login=await post('login',{email,password});assert(login.status===200,'password login failed');
  const current=await me(login.cookie);assert(current.data.user.displayName==='測試名稱','display name missing');
  assert((await post('profile',{displayName:'新名字',csrf:'wrong'},{Cookie:login.cookie})).status===403,'profile CSRF accepted');
  assert((await post('profile',{displayName:'新名字',csrf:current.data.csrf},{Cookie:login.cookie})).status===200,'profile rename failed');
  assert((await me(login.cookie)).data.user.displayName==='新名字','profile name not saved');
  assert((await post('forgot',{email})).status===200,'reset mail failed');const nextToken=lastToken(email);
  assert((await post('login',{email,password})).status===200,'request reset changed old password');
  assert((await post('complete',{token:nextToken,password:'new-password-two',confirmPassword:'new-password-two'})).status===200,'reset completion failed');
  assert((await me(login.cookie)).status===401,'old session survived reset');
  assert((await post('login',{email,password})).status===401,'old password survived reset');
  assert((await post('login',{email,password:'new-password-two'})).status===200,'new password failed');
  const unknown=await post('forgot',{email:'unknown@tschool.tp.edu.tw'});assert(unknown.status===200&&unknown.data.message===register.data.message,'unknown account disclosure');
  assert((await post('forgot',{email:'legacy@tschool.tp.edu.tw'})).status===200,'legacy reset failed');
  assert((await post('complete',{token:lastToken('legacy@tschool.tp.edu.tw'),password,confirmPassword:password,displayName:'自選名稱'})).status===200,'legacy migration failed');
  const oldLogin=await post('login',{email:'legacy@tschool.tp.edu.tw',password});const oldUser=await me(oldLogin.cookie);
  assert(oldUser.data.user.id==='legacy'&&oldUser.data.user.role==='admin'&&oldUser.data.user.displayName==='自選名稱','legacy identity/role lost');
  const files=await fetch(origin+'/api/resources',{headers:{Cookie:oldLogin.cookie}});assert((await files.json()).items.some(r=>r.id==='legacy-file'),'legacy files lost');
  const expired='a'.repeat(43),hash=createHash('sha256').update(expired).digest('hex');sql(`INSERT INTO auth_tokens VALUES('${hash}','${email}','forgot','2000-01-01','2000-01-01');`);
  assert((await post('complete',{token:expired,password,confirmPassword:password})).status===400,'expired token accepted');
  const google=await fetch(origin+'/auth/google',{redirect:'manual'});assert(google.status===302&&google.headers.get('location')===origin+'/','Google still used');
  rejectMail=true;assert((await post('register',{email:'mail-fail@tschool.tp.edu.tw'})).status===503,'SMTP failure reported success');rejectMail=false;
  for(let i=0;i<10;i++)await post('login',{email:'rate@tschool.tp.edu.tw',password});
  assert((await post('login',{email:'rate@tschool.tp.edu.tw',password})).status===429,'login rate limit absent');
  console.log(`Auth smoke passed: ${checks} checks; local SMTP delivery, independent login, reset, migration, permissions and rate limits.`);
}catch(error){console.error('After '+checks+' checks: '+error.message+' '+String(error.cause || ''));await new Promise(r=>setTimeout(r,1000));console.error(logs.split('\n').filter(line=>/phase|ERROR|failed|POST|GET|Error/.test(line)).join('\n'));process.exitCode=1;}finally{server.kill();await new Promise(resolve=>smtp.close(resolve));}
