// Account archives contain private research and account data. They are downloaded
// directly to the user's device and are never re-uploaded as generated artifacts.
const archiveError=message=>Object.assign(Error(message),{archiveSafe:true});
export function validateAccountArchive(value,ownerId){
 if(!value||value.format!=='paperknow-account-archive'||value.version!==1||value.scope!=='account'||typeof value.account?.id!=='string'||!value.account.id||!['projects','drafts','files','results','jobs','feedback'].every(key=>Array.isArray(value[key])))throw archiveError('服务器返回的资料包无法识别，已停止下载，请稍后重试。');
 if(value.account.id!==ownerId)throw archiveError('资料包所属账户与当前登录不一致，已停止下载。请重新进入设置后导出。');
 return value;
}
export async function downloadAccountArchive({fetchImpl=globalThis.fetch,documentObject=globalThis.document,urlAPI=globalThis.URL,isCurrent=()=>true,signal,setTimeoutImpl=globalThis.setTimeout}={}){
 const win=documentObject.defaultView,controller=new AbortController();let ownerId=null,invalid='',url=null,timer;
 const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 const guard=()=>{if(invalid)throw archiveError(invalid);if(controller.signal.aborted||!isCurrent())throw new DOMException('资料导出已中断','AbortError');};
 async function json(path){guard();let response;try{response=await fetchImpl(path,{credentials:'same-origin',cache:'no-store',redirect:'error',headers:ownerId?{'X-PaperKnow-User':ownerId}:{},signal:controller.signal});}catch(error){guard();throw archiveError('账户资料暂时无法读取，请检查网络后重试。');}guard();const value=await response.json().catch(()=>null);guard();if(!response.ok){if(response.status===401)throw archiveError('登录已失效，请重新登录账户后导出资料。');if(response.status===409){invalid='登录账户已变化，已停止资料导出；请重新进入设置后重试。';controller.abort();throw archiveError(invalid);}if(response.status===413)throw archiveError('账户资料超过单次导出大小，请按项目下载原件与成果。');throw archiveError('账户资料暂时无法导出，请稍后重试。');}return value;}
 async function verifyOwner(){const value=await json('/api/auth/me');guard();if(typeof value?.user?.id!=='string'||!value.user.id)throw archiveError('请先登录账户，再导出账户资料。');if(ownerId&&ownerId!==value.user.id){invalid='登录账户已变化，已停止资料导出；请重新进入设置后重试。';controller.abort();throw archiveError(invalid);}return value.user.id;}
 const checkSession=()=>{if(!ownerId||invalid||controller.signal.aborted||!isCurrent())return;void verifyOwner().catch(error=>{if(error.name==='AbortError')return;invalid=error.archiveSafe?error.message:'无法核对登录状态，已停止资料导出。';controller.abort();});};
 try{
  ownerId=await verifyOwner();guard();win?.addEventListener('focus',checkSession);win?.addEventListener('storage',checkSession);
  const archive=validateAccountArchive(await json('/api/account/export'),ownerId);guard();await verifyOwner();guard();
  const blob=new Blob([JSON.stringify(archive,null,2)],{type:'application/json;charset=utf-8'});url=urlAPI.createObjectURL(blob);guard();const anchor=documentObject.createElement('a');anchor.href=url;anchor.download='PaperKnow-账户资料包.json';documentObject.body.append(anchor);try{guard();anchor.click();}finally{anchor.remove();}
  const savedUrl=url;timer=setTimeoutImpl(()=>urlAPI.revokeObjectURL(savedUrl),10000);timer?.unref?.();url=null;return {ownerId,message:'已发起账户资料包下载，请确认浏览器已保存文件；资料包仅下载到本机，原件和云文件需另外下载。'};
 }finally{signal?.removeEventListener('abort',abort);win?.removeEventListener('focus',checkSession);win?.removeEventListener('storage',checkSession);if(url)urlAPI.revokeObjectURL(url);controller.abort();}
}
