import JSZip from 'jszip';
import {digest} from './auth.mjs';
import {createArtifactService} from './artifact-service.mjs';

const MANIFEST='ppt-delivery';
const safeName=title=>String(title||'演示文稿').replace(/[\x00-\x1f\x7f/\\:*?"<>|\u202a-\u202e\u2066-\u2069]/g,'_').slice(0,110)||'演示文稿';
const escape=value=>String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

export function presentationDeliveryManifest(db,runId){
 const row=db.prepare('SELECT output FROM tool_checkpoints WHERE run_id=? AND unit_id=?').get(runId,MANIFEST);
 if(!row)return{artifacts:[],createdIds:[]};
 return JSON.parse(row.output);
}

// The intermediate SVGs are bounded resumable task checkpoints. The completed
// delivery, its visual preview, and the editable sources live in private OSS.
export async function savePresentationDelivery(db,config,{runId,userId,title,slides,pptx,revision,isActive,signal,onStage}){
 const artifacts=createArtifactService(db,config),items=[],createdIds=[];
 const active=()=>!signal?.aborted&&isActive();
 const manifest=()=>db.prepare('INSERT INTO tool_checkpoints(run_id,unit_id,position,output,created_at) VALUES(?,?,?,?,?) ON CONFLICT(run_id,unit_id) DO UPDATE SET output=excluded.output').run(runId,MANIFEST,2000,JSON.stringify({artifacts:items,createdIds}),new Date().toISOString());
 const check=()=>{if(!active())throw Object.assign(new Error('演示任务已停止'),{status:499});};
 async function save(name,buffer,role){
  check();if(!Buffer.isBuffer(buffer)||!buffer.length||buffer.length>20*1024*1024)throw Object.assign(new Error('演示成果超过文件大小限制，请减少页数后重试'),{status:413});
  const response=await artifacts({path:'/api/artifacts',method:'POST',user:{id:userId},readBody:async()=>({name,data:buffer.toString('base64'),sha256:digest(buffer),sourceType:'presentation',sourceId:runId,expectedUserId:userId})});
  const item=response.value.item;items.push({...item,role});if(!response.value.deduplicated)createdIds.push(item.id);
  // Persist each acknowledged upload before proceeding or observing cancellation.
  manifest();check();return item;
 }
 try{
  check();onStage?.('storing');const stem=safeName(title),deck=await save(stem+'.pptx',pptx,'deck');
  const html=Buffer.from(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · 版式预览</title><style>body{margin:0;padding:32px;background:#edf1f8;color:#172b4b;font:16px/1.6 system-ui,sans-serif}main{max-width:1280px;margin:auto}h1{font-size:24px}p{color:#63738b}.page{margin:24px 0;background:#fff;box-shadow:0 8px 30px #172b4b15;border-radius:12px;overflow:hidden}.page svg{width:100%;height:auto;display:block}.caption{padding:12px 20px;border-top:1px solid #e8edf5;color:#63738b}@media print{body{padding:0;background:white}.page{break-after:page;box-shadow:none;margin:0;border-radius:0}.caption,h1,main>p{display:none}}</style><main><h1>${escape(title)}</h1><p>本次生成版式预览，共 ${slides.length} 页。PowerPoint、WPS 和本预览的字体与显示效果可能略有差异，请核对后使用。</p>${slides.map((slide,index)=>`<section class="page">${slide.svg}<div class="caption">${index+1} / ${slides.length} · ${escape(slide.title)}</div></section>`).join('')}</main></html>`);
  const preview=await save(stem+'-版式预览.html',html,'preview');
  const zip=new JSZip();
  slides.forEach((slide,index)=>{const n=String(index+1).padStart(2,'0');zip.file('slides/slide-'+n+'.svg',slide.svg);zip.file('notes/slide-'+n+'.txt',slide.notes||'');});
  zip.file('manifest.json',JSON.stringify({format:'paperknow-presentation-sources',version:1,title,pageCount:slides.length,pages:slides.map(({id,title,body,notes})=>({id,title,body,notes}))},null,2));
  zip.file('README.txt','PaperKnow 演示源稿\nSVG 页面与演讲备注对应本次已确认的生成版本。\nPPTX 由 PPT Master 原生编译器生成，相关开源许可随部署保留。\n修改页面后需要重新编译，不会自动改变已下载的文件。\n');
  const sources=await save(stem+'-页面源稿.zip',await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:6}}),'sources');
  check();return{presentation:{artifactId:deck.id,downloadUrl:deck.downloadUrl,fileName:deck.name,pageCount:slides.length,previewArtifactId:preview.id,sourcesArtifactId:sources.id},artifacts:items};
 }catch(error){
  await cleanupPresentationDelivery(db,config,runId,userId,createdIds);
  throw error;
 }
}

export async function cleanupPresentationDelivery(db,config,runId,userId,additional=[]){
 const artifacts=createArtifactService(db,config),manifest=presentationDeliveryManifest(db,runId),remaining=[];
 const unacknowledged=db.prepare("SELECT id FROM artifacts WHERE user_id=? AND source_type='presentation' AND source_id=? AND status!='deleted'").all(userId,runId).map(row=>row.id);
 for(const id of new Set([...manifest.createdIds,...additional,...unacknowledged])){
  const row=db.prepare("SELECT id,sha256 FROM artifacts WHERE id=? AND user_id=? AND source_type='presentation' AND source_id=? AND status!='deleted'").get(id,userId,runId);if(!row)continue;
  try{await artifacts({path:'/api/artifacts/'+row.id+'/delete',method:'POST',user:{id:userId},readBody:async()=>({expectedSha256:row.sha256,expectedUserId:userId})});}catch{remaining.push(row.id);}
 }
 if(unacknowledged.length||manifest.createdIds.length||additional.length)db.prepare('INSERT INTO tool_checkpoints(run_id,unit_id,position,output,created_at) VALUES(?,?,?,?,?) ON CONFLICT(run_id,unit_id) DO UPDATE SET output=excluded.output,created_at=excluded.created_at').run(runId,MANIFEST,2000,JSON.stringify({...manifest,createdIds:remaining}),new Date().toISOString());
 return remaining;
}
