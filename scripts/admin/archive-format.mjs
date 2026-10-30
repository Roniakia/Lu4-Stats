import { createReadStream } from 'node:fs';
import { readFile,stat } from 'node:fs/promises';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { createHash } from 'node:crypto';
import { createGunzip,gunzipSync } from 'node:zlib';
import { validateCollection,servers } from '../../database/core.mjs';
export async function fileDigest(path) {const hash=createHash('sha256');for await(const chunk of createReadStream(path)) hash.update(chunk);return hash.digest('hex');}
export function validateManifest(m) {
 if(![1,2].includes(m.schemaVersion)||!servers.includes(m.server)||!new RegExp(`^${m.server}-\\d{4}-(0[1-9]|1[0-2])\\.(json|ndjson)\\.gz$`).test(m.file??'')||!/^\d{4}-\d{2}-01T00:00:00\.000Z$/.test(m.from??'')||!Number.isFinite(Date.parse(m.to))||!Number.isInteger(m.collections)||m.collections<1||!/^[a-f0-9]{64}$/.test(m.sha256??'')) throw new Error('Invalid archive manifest');
 const end=new Date(m.from);end.setUTCMonth(end.getUTCMonth()+1);if(end.toISOString()!==m.to||!m.file.startsWith(m.server+'-'+m.from.slice(0,7)))throw new Error('Invalid archive month');
 return m;
}
export async function* readArchive(directory,manifest) {
 const m=validateManifest(manifest),path=join(directory,m.file);
 if((await stat(path)).size>2*1024**3)throw new Error('Compressed archive size limit exceeded');
 if(await fileDigest(path)!==m.sha256) throw new Error('Archive checksum mismatch');
 let count=0;
 const validate=value=>{const result=validateCollection(value);if(result.server!==m.server||result.capturedAt<m.from||result.capturedAt>=m.to)throw new Error('Archive collection outside coverage');count++;if(count>40000)throw new Error('Archive collection limit exceeded');return value;};
 if(m.schemaVersion===1){const bytes=await readFile(path);const values=JSON.parse(gunzipSync(bytes,{maxOutputLength:32*1024*1024}).toString());for(const value of values)yield validate(value);}
 else {
  const source=createReadStream(path),stream=source.pipe(createGunzip());source.on('error',error=>stream.destroy(error));
  let buffer='',expanded=0;const decoder=new StringDecoder('utf8');
  try{for await(const chunk of stream){expanded+=chunk.length;if(expanded>8*1024**3)throw new Error('Expanded archive limit exceeded');buffer+=decoder.write(chunk);let newline;
    while((newline=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);if(Buffer.byteLength(line)>20*1024*1024)throw new Error('Archive collection size limit exceeded');if(line)yield validate(JSON.parse(line));}
    if(Buffer.byteLength(buffer)>20*1024*1024)throw new Error('Archive collection size limit exceeded');
   }buffer+=decoder.end();if(buffer.trim())yield validate(JSON.parse(buffer));
  }finally{source.destroy();stream.destroy();}
 }
 if(count!==m.collections)throw new Error('Archive collection count mismatch');
}
