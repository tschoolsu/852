import { httpError } from './cloud';

export async function readJsonBody(request:Request,maxBytes:number):Promise<Record<string,unknown>> {
  if(!request.headers.get('content-type')?.includes('application/json'))throw httpError(415,'不支援的要求格式。');
  const declared=Number(request.headers.get('content-length'));
  if(Number.isFinite(declared)&&declared>maxBytes)throw httpError(413,'要求內容過長。');
  const reader=request.body?.getReader();
  if(!reader)throw httpError(400,'要求格式錯誤。');
  const decoder=new TextDecoder('utf-8',{fatal:true});
  let size=0,raw='';
  try {
    while(true){
      const chunk=await reader.read();
      if(chunk.done)break;
      size+=chunk.value.byteLength;
      if(size>maxBytes){void reader.cancel().catch(()=>{});throw httpError(413,'要求內容過長。');}
      raw+=decoder.decode(chunk.value,{stream:true});
    }
    raw+=decoder.decode();
  } catch(error) {
    if((error as {status?:number}).status)throw error;
    throw httpError(400,'要求格式錯誤。');
  } finally {reader.releaseLock();}
  let body:unknown;
  try{body=JSON.parse(raw);}catch{throw httpError(400,'要求格式錯誤。');}
  if(!body||typeof body!=='object'||Array.isArray(body))throw httpError(400,'要求格式錯誤。');
  return body as Record<string,unknown>;
}
