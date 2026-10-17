import {esc,icon} from './ui.mjs';
import {withStableView} from './view-stability.mjs';

const size=value=>{const n=Number(value)||0;return n>=1048576?(n/1048576).toFixed(1)+' MB':n>=1024?(n/1024).toFixed(1)+' KB':n+' B';};
const states={ready:'已保存',uploading:'保存中',deleting:'删除待重试',failed:'保存待重试'};
export function mountArtifactLibrary(root,{session,notify=()=>{},fetchImpl=globalThis.fetch}={}){
 let disposed=false,request=0,page=1,query='',owner=null,data=null,armed=null,busy=false;
 const controllers=new Set(),alive=()=>!disposed&&root.isConnected;
 const paint=html=>{if(alive())withStableView(root.closest('.dashboard')||root,()=>{root.innerHTML=html;});};
 const heading='<div class="cloud-artifact-heading"><div><span class="cloud-artifact-icon">'+icon('file',22)+'</span><div><h2>生成文件</h2><p>已导出的文档、演示和图表，保存在你的私有云文件中。</p></div></div><button type="button" data-cloud-refresh>刷新</button></div>';
 async function api(path,input){const c=new AbortController();controllers.add(c);const timeout=setTimeout(()=>c.abort(),60000);try{const r=await fetchImpl('/api/artifacts'+path,{method:input?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:input?{'Content-Type':'application/json'}:{},body:input?JSON.stringify(input):undefined,signal:c.signal});if(!r.ok){const v=await r.json().catch(()=>({}));throw Error(v.error||'云文件暂时无法读取，请稍后重试');}return r;}finally{clearTimeout(timeout);controllers.delete(c);}}
 function content(){
  const rows=data.items||[],pages=Math.max(1,Math.ceil(data.total/10));
  paint(heading+`<form class="cloud-artifact-search"><label for="cloud-artifact-query">查找文件</label><input id="cloud-artifact-query" name="q" maxlength="120" placeholder="按文件名称搜索" value="${esc(query)}"><button type="submit">搜索</button></form><p class="cloud-artifact-quota">已用 ${size(data.usedBytes)} / ${size(data.quotaBytes)} · 单文件最大 ${size(data.maxFileBytes)} · 仅当前账户可下载</p><div class="cloud-artifact-list">${rows.length?rows.map(row=>`<article class="cloud-artifact-row"><span class="cloud-artifact-kind">${esc(row.kind.toUpperCase())}</span><div class="cloud-artifact-copy"><b>${esc(row.name)}</b><small>${size(row.bytes)} · ${esc(new Date(row.createdAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}))} · ${esc(states[row.status]||'待核对')}</small>${armed===row.id?'<p>删除后无法从云端恢复，已下载的本地文件不受影响。</p>':''}</div><div class="cloud-artifact-actions">${armed===row.id?`<button type="button" data-cloud-remove-confirm="${esc(row.id)}" class="cloud-artifact-danger">确认删除</button><button type="button" data-cloud-remove-cancel>取消</button>`:`${row.status==='ready'?`<button type="button" data-cloud-download="${esc(row.id)}">下载</button>`:''}<button type="button" data-cloud-remove="${esc(row.id)}">${row.status==='deleting'?'重试删除':'删除'}</button>`}</div></article>`).join(''):'<div class="cloud-artifact-empty">'+icon('file',28)+'<h3>'+ (query?'没有匹配的文件':'还没有生成文件')+'</h3><p>登录状态下主动导出文件，成功保存后会出现在这里。本地草稿不会自动上传。</p></div>'}</div><div class="cloud-artifact-footer"><span>共 ${data.total} 个文件 · 第 ${page} / ${pages} 页</span><div><button type="button" data-cloud-page="${page-1}" ${page<=1?'disabled':''}>上一页</button><button type="button" data-cloud-page="${page+1}" ${page>=pages?'disabled':''}>下一页</button></div></div>`);
 }
 async function refresh(){
  const version=++request;armed=null;data=null;paint(heading+'<p class="cloud-artifact-empty" role="status">正在读取云文件…</p>');
  try{
   const current=await session();if(!alive()||version!==request)return;
   owner=current?.user?.id||null;
   if(!owner){paint(heading+'<p class="cloud-artifact-empty">登录后可查看自己的生成文件。</p>');return;}
   const response=await api('?'+new URLSearchParams({page:String(page),pageSize:'10',q:query,expectedUserId:owner})),value=await response.json();
   if(!alive()||version!==request)return;
   if(!Array.isArray(value.items)||!Number.isSafeInteger(value.total)||value.items.some(r=>!r||!/^[A-Za-z0-9_-]+$/.test(r.id)||typeof r.name!=='string'||typeof r.kind!=='string'))throw Error('云文件列表响应无法核对，请刷新重试');
   data=value;content();
  }catch(error){if(alive()&&version===request&&error.name!=='AbortError')paint(heading+'<p class="cloud-artifact-error" role="alert">'+esc(error.message)+'</p>');}
 }
 async function action(event){
  const button=event.target.closest('button');if(!button||!root.contains(button)||busy)return;
  if(button.hasAttribute('data-cloud-refresh')){void refresh();return;}
  if(button.hasAttribute('data-cloud-page')){page=Number(button.dataset.cloudPage);void refresh();return;}
  if(button.hasAttribute('data-cloud-remove-cancel')){armed=null;content();return;}
  if(button.hasAttribute('data-cloud-remove')){armed=button.dataset.cloudRemove;content();return;}
  const id=button.dataset.cloudDownload||button.dataset.cloudRemoveConfirm,row=data?.items.find(r=>r.id===id);if(!row||!owner)return;
  busy=true;button.disabled=true;
  try{
   const current=await session();if(current?.user?.id!==owner)throw Error('登录账户已变化，请刷新后重试');
   if(button.hasAttribute('data-cloud-download')){
    const response=await api('/'+encodeURIComponent(id)+'/download?'+new URLSearchParams({expectedUserId:owner})),blob=await response.blob();
    if(blob.size!==row.bytes)throw Error('文件大小校验未通过，未发起下载');
    if(!alive())return;
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=row.name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);notify('已发起云文件下载，请确认浏览器保存完成。');
   }else{
    await api('/'+encodeURIComponent(id)+'/delete',{expectedSha256:row.sha256,expectedUserId:owner});notify('云文件已删除。');if(page>1&&data.items.length===1)page--;await refresh();
   }
  }catch(error){if(alive())notify(error.message||'操作未完成，请稍后重试');}
  finally{busy=false;if(button.isConnected)button.disabled=false;}
 }
 function search(event){if(!event.target.matches('.cloud-artifact-search'))return;event.preventDefault();if(busy)return;query=event.target.querySelector('input').value.trim();page=1;void refresh();}
 root.classList.add('cloud-artifact-library','card');root.addEventListener('click',action);root.addEventListener('submit',search);void refresh();
 return {refresh,dispose(){disposed=true;request++;controllers.forEach(c=>c.abort());root.removeEventListener('click',action);root.removeEventListener('submit',search);}};
}
