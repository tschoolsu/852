import { env } from 'cloudflare:workers';
import { all, httpError, validSchoolEmail } from './cloud';

export async function accessSettings(value:unknown,ownerId:string){
  const data=value as {level?:string;members?:Array<{recipient:string;role:string}>;linkRole?:string};
  if(!data||!['private','selected','members'].includes(data.level||'')||!['','viewer','editor'].includes(data.linkRole||''))throw httpError(400,'存取權設定無效。');
  if(!Array.isArray(data.members)||data.members.length>50)throw httpError(400,'每次最多指定 50 位成員。');
  const members=new Map<string,string>();
  for(const member of data.members){
    if(typeof member?.recipient!=='string'||!['viewer','editor'].includes(member.role))throw httpError(400,'成員或權限無效。');
    const query=member.recipient.trim();
    const users=await all<{id:string;email:string}>("SELECT id,email FROM users WHERE status='active' AND (email=? COLLATE NOCASE OR display_name=? COLLATE NOCASE) LIMIT 2",query,query);
    if(users.length!==1||!validSchoolEmail(users[0].email))throw httpError(400,`找不到唯一的學校成員：${query}。請使用已登入過系統的學校信箱。`);
    if(users[0].id!==ownerId)members.set(users[0].id,member.role);
  }
  return {level:data.level==='members'?'members':'private',statements:(id:string)=>[
    env.DB.prepare('DELETE FROM resource_members WHERE resource_id=?').bind(id),
    ...[...members].map(([userId,role])=>env.DB.prepare('INSERT INTO resource_members(resource_id,user_id,role) VALUES(?,?,?)').bind(id,userId,role)),
    env.DB.prepare('DELETE FROM share_links WHERE resource_id=?').bind(id),
  ]};
}
