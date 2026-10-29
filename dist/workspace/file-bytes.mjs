// Read native handles promptly and reuse bytes through parsing and original upload.
// Rejected reads are evicted so reselecting/retrying never keeps a failed handle.
const reads=new WeakMap();
const aborted=()=>Object.assign(Error('文件读取已停止。'),{name:'AbortError'});
export function fileReadError(error){
 if(!['NotReadableError','NotFoundError','SecurityError'].includes(error?.name))return error;
 return Object.assign(Error('暂时无法读取这份本机文件。请重新选择文件；若仍失败，请将文件复制到本机“下载”文件夹后再上传，或从文件管理选择已保存的文件。本次未提交解析。'),{name:'FileReadError',code:'LOCAL_FILE_UNREADABLE',cause:error});
}
function readerBytes(file,Reader){return new Promise((resolve,reject)=>{const reader=new Reader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error||Object.assign(Error('无法读取文件'),{name:'NotReadableError'}));reader.onabort=()=>reject(aborted());reader.readAsArrayBuffer(file);});}
export async function readFileBytes(file,{signal,maxBytes=50*1024*1024,FileReaderImpl=globalThis.FileReader}={}){
 if(signal?.aborted)throw aborted();
 let pending=reads.get(file);
 if(!pending){
  // Start before any authentication, confirmation dialog or network wait.
  try{pending=Promise.resolve(typeof file.arrayBuffer==='function'?file.arrayBuffer():readerBytes(file,FileReaderImpl));}catch(error){pending=Promise.reject(error);}
  pending=pending.catch(error=>{if(error?.name==='NotReadableError'&&FileReaderImpl)return readerBytes(file,FileReaderImpl).catch(fallback=>{throw fallback?.name==='AbortError'?fallback:error;});throw error;}).then(buffer=>{const bytes=new Uint8Array(buffer);if(!bytes.length)throw Error('文件内容为空，请选择完整的文档。');return bytes;}).catch(error=>{reads.delete(file);throw fileReadError(error);});
  reads.set(file,pending);
 }
 let cancel;const stop=new Promise((_,reject)=>{cancel=()=>reject(aborted());signal?.addEventListener('abort',cancel,{once:true});});
 try{const bytes=await Promise.race([pending,stop]);if(signal?.aborted)throw aborted();if(bytes.byteLength>maxBytes)throw Error('文件超过可处理大小，请压缩或拆分后再上传。');return bytes;}finally{signal?.removeEventListener('abort',cancel);}
}
