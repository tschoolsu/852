import { randomBytes, timingSafeEqual } from 'node:crypto';

const iterations=600000;
export function validPassword(value:unknown):value is string {
  return typeof value==='string' && Array.from(value).length>=8 && Array.from(value).length<=128;
}
async function derive(password:string,salt:string) {
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  return Buffer.from(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:new TextEncoder().encode(salt),iterations},key,256));
}
export async function hashPassword(password:string) {
  const salt=Buffer.from(randomBytes(16)).toString('hex');
  const hash=(await derive(password,salt)).toString('hex');
  return `pbkdf2-sha256$${iterations}$${salt}$${hash}`;
}
export async function verifyPassword(password:string,encoded:string|null) {
  const parts=encoded?.split('$');
  const valid=parts?.length===4&&parts[0]==='pbkdf2-sha256'&&parts[1]===String(iterations)&&/^[a-f0-9]{32}$/.test(parts[2])&&/^[a-f0-9]{64}$/.test(parts[3]);
  // Perform the same expensive derivation for unknown users and Google-only accounts.
  const salt=valid?parts[2]:'00000000000000000000000000000000';
  const expected=Buffer.from(valid?parts[3]:'0'.repeat(64),'hex');
  const actual=await derive(password,salt);
  return timingSafeEqual(expected,actual)&&Boolean(valid);
}
