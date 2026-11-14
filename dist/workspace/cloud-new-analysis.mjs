import {resolveAccountProjectId} from './project-directory.mjs';

// A new analysis begins as an account draft, before a user enters any data.
// Keep the same idempotency key for retries so an interrupted response cannot
// silently create a second draft. Existing local history is not touched.
export function mountNewCloudAnalysis({root,fetcher=fetch,location,loginHref,makeId=()=>crypto.randomUUID(),projectRef}){
 const route=location.hash,clientKey=makeId(),nativeId=makeId();let busy=false,initialOwner=null;
 const current=()=>root.isConnected&&location.hash===route;
 const response=async(url,options)=>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);try{const r=await fetcher(url,{credentials:'same-origin',cache:'no-store',...options,signal:controller.signal});let data={};try{data=await r.json();}catch{}if(!r.ok){const e=new Error(data.error||'暂时无法连接，请重试。');e.status=r.status;throw e;}return data;}catch(error){if(controller.signal.aborted)throw Error('连接超时，请重新连接。');throw error;}finally{clearTimeout(timer);}};
 const show=(title,message,button)=>{if(!current())return;root.innerHTML='';const section=root.ownerDocument.createElement('section');section.className='card hub-card';const h=root.ownerDocument.createElement('h1');h.textContent=title;const p=root.ownerDocument.createElement('p');p.textContent=message;section.append(h,p);if(button)section.append(button);root.append(section);};
 const retry=message=>{const b=root.ownerDocument.createElement('button');b.className='btn primary';b.type='button';b.textContent='重新连接';b.onclick=()=>void start();show('暂时无法准备数据分析',message,b);};
 const login=()=>{const a=root.ownerDocument.createElement('a');a.className='btn primary';a.href=loginHref;a.textContent='登录后继续';show('登录后开始数据分析','登录后可保存和继续编辑分析内容。',a);};
 async function start(){if(busy||!current())return;busy=true;show('正在准备数据分析','正在连接账户，请稍候。');try{
  const auth=await response('/api/auth/me');if(!current())return;
  if(typeof auth.user?.id!=='string'||!auth.user.id){login();return;}
  const ownerId=auth.user.id;if(initialOwner!==null&&initialOwner!==ownerId)throw Error('登录账户已变化，请重新打开数据分析。');initialOwner=ownerId;const projectId=resolveAccountProjectId(projectRef,ownerId),title='未命名数据分析';if(projectRef&&!projectId)throw Error('无法确认所属项目，请从项目页面重新进入。');
  const data=await response('/api/workspace/drafts',{method:'POST',headers:{'Content-Type':'application/json','X-PaperKnow-User':ownerId},body:JSON.stringify({title,tool:'analysis',projectId,payload:{id:nativeId,title,tool:'analysis'},clientKey})});
  if(!current())return;if(typeof data.item?.id!=='string'||!data.item.id)throw Error('草稿尚未创建，请重新连接。');
  location.replace('#account-draft/'+encodeURIComponent(data.item.id));
 }catch(error){if(current()){if(error.status===401)login();else retry(error.message||'暂时无法连接，请重试。');}}finally{busy=false;}}
 void start();return {retry:start};
}
