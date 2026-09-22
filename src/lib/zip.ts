// Streaming ZIP (stored entries, UTF-8 names, data descriptors). Files stay out of RAM.
export type ZipEntry={name:string;size:number;open:()=>Promise<ReadableStream<Uint8Array>>};
const encoder=new TextEncoder();
const table=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function bytes(length:number,fields:Array<[number,number,number]>){const a=new Uint8Array(length),v=new DataView(a.buffer);for(const [offset,size,value] of fields){if(size===2)v.setUint16(offset,value,true);else v.setUint32(offset,value,true);}return a;}
export function zipStream(entries:ZipEntry[]){
  async function* generate(){
    let offset=0;const directory:Uint8Array[]=[];
    for(const entry of entries){
      const name=encoder.encode(entry.name),start=offset;
      const header=bytes(30,[[0,4,0x04034b50],[4,2,20],[6,2,0x808],[12,2,33],[26,2,name.length]]);
      yield header;yield name;offset+=header.length+name.length;
      let crc=0xffffffff,size=0;const reader=(await entry.open()).getReader();let completed=false;
      try{while(true){const part=await reader.read();if(part.done){completed=true;break;}size+=part.value.length;for(const b of part.value)crc=table[(crc^b)&255]^(crc>>>8);yield part.value;offset+=part.value.length;}}finally{if(!completed)await reader.cancel();reader.releaseLock();}
      if(size!==entry.size)throw new Error('檔案在下載期間變更，請重新下載。');
      crc=(crc^0xffffffff)>>>0;
      const descriptor=bytes(16,[[0,4,0x08074b50],[4,4,crc],[8,4,size],[12,4,size]]);yield descriptor;offset+=16;
      directory.push(bytes(46,[[0,4,0x02014b50],[4,2,20],[6,2,20],[8,2,0x808],[14,2,33],[16,4,crc],[20,4,size],[24,4,size],[28,2,name.length],[42,4,start]]),name);
    }
    const start=offset;for(const part of directory){yield part;offset+=part.length;}
    yield bytes(22,[[0,4,0x06054b50],[8,2,entries.length],[10,2,entries.length],[12,4,offset-start],[16,4,start]]);
  }
  const iterator=generate();
  return new ReadableStream<Uint8Array>({async pull(controller){try{const part=await iterator.next();if(part.done)controller.close();else controller.enqueue(part.value);}catch(error){controller.error(error);}},async cancel(){await iterator.return(undefined);}});
}
