// Binary exports are only uploaded when the user explicitly chooses an export.
// Local drafts and their original source files are never traversed or uploaded here.
export const artifactExportLimit=20*1024*1024;
const sourceTypes=new Set(['writing','thesis','literature','revision','detection','presentation','format','research','backup','other']);
export function artifactSourceType(path=globalThis.location?.hash||''){
 if(/thesis|tool\/writing/.test(path))return 'thesis';
 if(/literature|reading|translation/.test(path))return 'literature';
 if(/ppt|presentation/.test(path))return 'presentation';
 if(/format/.test(path))return 'format';
 if(/research/.test(path))return 'research';
 if(/detection|precheck/.test(path))return 'detection';
 if(/reduce|rewrite|aigc|review/.test(path))return 'revision';
 if(/tool\//.test(path))return 'writing';
 return 'other';
}
export function artifactExportNotice(message,{error=false,documentObject=globalThis.document}={}){
 if(!documentObject?.body)return;
 let node=documentObject.getElementById('artifact-export-notice');
 if(!node){node=documentObject.createElement('div');node.id='artifact-export-notice';node.setAttribute('role','status');node.setAttribute('aria-live','polite');Object.assign(node.style,{position:'fixed',bottom:'24px',right:'24px',zIndex:'10020',maxWidth:'min(460px,calc(100vw - 48px))',padding:'14px 18px',border:'1px solid #d7e2fa',borderRadius:'12px',background:'#fff',color:'#263954',boxShadow:'0 8px 32px #16356c24',fontSize:'14px',lineHeight:'1.6'});documentObject.body.append(node);}
 node.textContent=message;node.dataset.state=error?'error':'status';node.style.borderColor=error?'#efb9b9':'#d7e2fa';node.style.color=error?'#a52626':'#263954';node.hidden=false;
 clearTimeout(node._artifactTimer);node._artifactTimer=setTimeout(()=>{node.hidden=true;},error?14000:9000);
}
async function json(response){return response.json().catch(()=>null);}
async function owner(fetchImpl){const response=await fetchImpl('/api/auth/me',{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(60000)});if(response.status===401)return null;const value=await json(response);if(!response.ok||!value||!Object.hasOwn(value,'user'))throw Error('无法确认当前账户，未保存云文件、未发起下载。请稍后重试。');if(value.user===null)return null;if(typeof value.user?.id!=='string'||!value.user.id)throw Error('当前账户状态无法确认，请重新登录后导出。');return value.user.id;}
export async function artifactBase64(blob){const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));return btoa(binary);}
export async function exportGeneratedFile({name,content,type='text/plain;charset=utf-8',sourceType=artifactSourceType(),sourceId='',projectId=''}={},dependencies={}){
 const {fetchImpl=globalThis.fetch,documentObject=globalThis.document,urlAPI=globalThis.URL,notify=artifactExportNotice,setTimeoutImpl=globalThis.setTimeout}=dependencies;
 if(content===undefined||content===null)throw Error('文件内容为空，未保存也未发起下载。');
 const filename=String(name||'研究成果.txt').replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').slice(0,180),blob=content instanceof Blob?content:new Blob([content],{type});
 if(!blob.size)throw Error('文件内容为空，未保存也未发起下载。');
 if(blob.size>artifactExportLimit)throw Error('导出文件超过 20 MB，请拆分内容后重试；当前内容仍保留。');
 const userId=await owner(fetchImpl);let saved=null,output=blob;
 if(userId){
  notify('正在保存到账户云文件，保存成功后开始下载…');
  const payload={name:filename,data:await artifactBase64(blob),sourceType:sourceTypes.has(sourceType)?sourceType:'other',expectedUserId:userId};
  if(sourceId)payload.sourceId=String(sourceId).slice(0,120);if(projectId)payload.projectId=projectId;
  const response=await fetchImpl('/api/artifacts',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(120000)}),value=await json(response);
  if(!response.ok)throw Error((value?.error||'云文件保存失败')+'；未发起下载，当前内容仍保留，请重试。');
  if(typeof value?.item?.id!=='string'||!value.item.id)throw Error('云文件保存结果无法核对，未发起下载。请到“我的成果”核对后重试。');
  saved=value.item;
  if(await owner(fetchImpl)!==userId)throw Error('文件已保存到原账户，但当前登录已变化；已停止下载，请切回原账户后在“我的成果”下载。');
  const downloadResponse=await fetchImpl('/api/artifacts/'+encodeURIComponent(saved.id)+'/download?expectedUserId='+encodeURIComponent(userId),{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(60000)});
  if(!downloadResponse.ok){const failure=await json(downloadResponse);throw Error((failure?.error||'云文件下载暂时失败')+'；文件已保存，可在“我的成果”重试下载。');}
  output=await downloadResponse.blob();if(!output.size)throw Error('云文件返回为空；未发起下载，请在“我的成果”核对后重试。');if(Number.isSafeInteger(saved.bytes)&&output.size!==saved.bytes)throw Error('云文件大小与保存记录不一致，已停止下载；请在“我的成果”核对后重试。');
 }
 const url=urlAPI.createObjectURL(output),anchor=documentObject.createElement('a');anchor.href=url;anchor.download=filename;documentObject.body.append(anchor);anchor.click();anchor.remove();setTimeoutImpl(()=>urlAPI.revokeObjectURL(url),10000);
 const message=saved?'已保存到账户云文件并发起下载，可在“我的成果”再次下载。':'已发起本地下载；当前未登录，文件未上传云端。';notify(message);return {saved:!!saved,item:saved,message};
}
export async function downloadGeneratedFile(name,content,type,options={}){try{return await exportGeneratedFile({name,content,type,...options});}catch(error){artifactExportNotice(error.message||'导出失败，当前内容仍保留。',{error:true});throw error;}}
