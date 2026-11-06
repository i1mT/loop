// 分片可恢复、并发上传；所有对象校验完成后才切换清单。服务端凭证只从维护者环境读取。
import {readFileSync,writeFileSync,renameSync,openSync,readSync,closeSync,statSync,createReadStream,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
const dir=resolve(process.argv[2]);
const base=process.env.LOOP_GATEWAY;
const token=process.env.LOOP_ADMIN_TOKEN;
if(!base||!token)throw new Error('缺少发布环境变量');
const headers={authorization:`Bearer ${token}`};
const progressFile=join(dir,'.upload-progress.json');
const progress=existsSync(progressFile)?JSON.parse(readFileSync(progressFile,'utf8')):{};
function save(){const temporary=progressFile+'.tmp';writeFileSync(temporary,JSON.stringify(progress),{mode:0o600});renameSync(temporary,progressFile);}
async function call(file,method,query='',body,extra={}){
 for(let attempt=0;;attempt++){
  try{
   const res=await fetch(`${base}/api/daemon-releases/${file}${query}`,{method,headers:{...headers,...extra},body,redirect:'manual',signal:AbortSignal.timeout(120000)});
   if(!res.ok)throw new Error(`发布失败 ${file} HTTP ${res.status}: ${(await res.text()).slice(0,150)}`);
   return await res.json();
  }catch(error){if(method!=='PUT'||attempt>=2)throw error;await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));}
 }
}
const manifest=JSON.parse(readFileSync(join(dir,'manifest.json'),'utf8'));
for(const {file,sha256} of Object.values(manifest)){
 const local=join(dir,file);const size=statSync(local).size;
 const hash=createHash('sha256');for await(const chunk of createReadStream(local))hash.update(chunk);
 if(hash.digest('hex')!==sha256)throw new Error('安装包与清单摘要不同：'+file);
 const remote=await fetch(`${base}/api/daemon-releases/${file}`,{method:'HEAD',headers,redirect:'manual',cache:'no-store'});
 if(remote.ok&&remote.headers.get('x-loop-sha256')===sha256&&Number(remote.headers.get('content-length'))===size){console.log(`${file}: 已经上传并核验，跳过`);continue;}
 let state=progress[file];
 if(!state||state.sha256!==sha256){
  const {uploadId}=await call(file,'POST','?action=create',JSON.stringify({sha256}),{'content-type':'application/json'});
  state=progress[file]={uploadId,sha256,parts:{}};save();
 }
 const fd=openSync(local,'r');
 try{
  const chunkSize=8*1024*1024;const count=Math.ceil(size/chunkSize);
  const pending=Array.from({length:count},(_,index)=>index+1).filter(number=>!state.parts[number]);let next=0;
  const outcomes=await Promise.allSettled(Array.from({length:4},async()=>{
   for(;;){
    const number=pending[next++];if(number===undefined)return;
    const start=(number-1)*chunkSize;const buffer=Buffer.alloc(Math.min(chunkSize,size-start));
    const bytes=readSync(fd,buffer,0,buffer.length,start);if(bytes!==buffer.length)throw new Error('读取分片失败');
    state.parts[number]=await call(file,'PUT',`?uploadId=${encodeURIComponent(state.uploadId)}&partNumber=${number}`,buffer);
    save();console.log(`${file}: 分片 ${Object.keys(state.parts).length}/${count}`);
   }
  }));
  const failure=outcomes.find(outcome=>outcome.status==='rejected');
  if(failure)throw failure.reason;
  const parts=Object.values(state.parts).sort((a,b)=>a.partNumber-b.partNumber);
  await call(file,'POST','?action=complete',JSON.stringify({uploadId:state.uploadId,parts}),{'content-type':'application/json'});
  delete progress[file];save();
 }finally{closeSync(fd);}
}
await call('manifest.json','PUT','',JSON.stringify(manifest),{'content-type':'application/json'});
console.log('全部安装包已发布。');
