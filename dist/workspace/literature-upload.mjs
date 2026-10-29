import {readFileBytes} from './file-bytes.mjs';
import {reuseStoredOriginal} from './file-selection.mjs';

export async function saveLiteratureOriginal(file,{fetchImpl=(...args)=>fetch(...args),signal,isCurrent=()=>true}={}){
 if(!file||!/^.+\.(txt|docx)$/i.test(file.name)||file.size>2*1024*1024)throw Error('Word、TXT 文献最大支持 2MB，请压缩文档或改用 PDF。');
 const current=()=>!signal?.aborted&&isCurrent();
 async function api(path,body){
  if(!current())throw Object.assign(Error('文献导入已停止'),{name:'AbortError'});
  const response=await fetchImpl('/api'+path,{credentials:'same-origin',cache:'no-store',redirect:'error',signal,method:body===undefined?'GET':'POST',...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
  let value;try{value=await response.json();}catch{throw Error('文献原件保存服务返回异常，请在文件管理中核对后重试。');}if(!current())throw Object.assign(Error('文献导入已停止'),{name:'AbortError'});
  if(!response.ok)throw Error(response.status===401?'请先登录，再上传文献。':value?.error?.message||typeof value?.error==='string'&&value.error||'文献原件未能保存，请稍后重试。');return value;
 }
 const session=await api('/auth/me'),owner=session.user?.id;if(!owner)throw Error('请先登录，再上传文献。');
 let uploaded=await reuseStoredOriginal(file,{api,expectedUserId:owner});
 if(!uploaded){const bytes=await readFileBytes(file,{signal,maxBytes:2*1024*1024});if(!bytes.length||bytes.length>2*1024*1024)throw Error('Word、TXT 文献最大支持 2MB。');if(!current())throw Object.assign(Error('文献导入已停止'),{name:'AbortError'});let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));uploaded=await api('/files',{name:file.name,data:btoa(binary),expectedUserId:owner});}
 if(!uploaded?.id)throw Error('文献原件未确认保存，请在文件管理中核对。');
 const checked=await api('/auth/me');if(checked.user?.id!==owner)throw Error('登录账户已变化，原件已保留在原账户，请重新打开文献。');
 return {originalFileId:uploaded.id,originalOwnerId:owner};
}
