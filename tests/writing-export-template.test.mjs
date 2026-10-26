import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import JSZip from 'jszip';
import {createWritingDocx} from '../src/writing-document.js';
import {writingExportTemplate,writingStandardFields,writingStandards} from '../dist/workspace/writing-standard.mjs';
import {writingFlowSnapshot,writingFlowSpecs} from '../dist/workspace/writing-flow-model.mjs';
import {mountWritingFlow,disposeWritingFlows} from '../dist/workspace/writing-flows.mjs';
import {mountAccountDraft,disposeAccountDraft} from '../dist/workspace/account-draft-editor.mjs';
import {clearEditor,flushEditorDraft} from '../dist/workspace/edit-guard.mjs';
import {list,keys} from '../dist/workspace/state.mjs';

const until=async predicate=>{for(let i=0;i<500;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,3));}assert.fail('template action did not settle');};
const original={version:1,status:'ready',source:{fileId:'original',name:'原开题模板.docx',size:20,sha256:'a'.repeat(64)}};
async function templateFile(){
 const base=await createWritingDocx('{{论文题目}}\n{{正文}}',{documentKind:'writing',metadata:{title:'{{论文题目}}'}}),zip=await JSZip.loadAsync(base);
 zip.file('word/styles.xml',(await zip.file('word/styles.xml').async('string')).replace(/w:eastAsia="宋体"/g,'w:eastAsia="仿宋"'));
 zip.file('word/document.xml',(await zip.file('word/document.xml').async('string')).replace(/w:left="\d+"/g,'w:left="1984"'));
 const bytes=await zip.generateAsync({type:'uint8array'});
 return {bytes,name:'新开题排版.docx',size:bytes.length,arrayBuffer:async()=>bytes.buffer};
}
async function fixture(t,{kind='proposal',failSave=false,delayUpload=false,account=true}={}){
 const dom=new JSDOM('<main class="dashboard"></main>',{url:'https://paperknow.test/workspace.html#tool/'+kind});
 for(const key of ['window','document','localStorage','location','AbortController','MutationObserver','FormData'])globalThis[key]=dom.window[key];
 const fields=writingStandardFields(kind),spec=writingFlowSpecs[kind],calls=[],artifacts=[],downloads=[],originalFetch=globalThis.fetch;
 let releaseUpload;const uploadGate=new Promise(resolve=>{releaseUpload=resolve;});
 const flow={version:1,title:'模板替换验收',level:'本科',major:'信息管理',language:'中文',targetWords:1000,instructions:'',notes:'研究尚未开展，拟使用公开资料完成分析。',materials:[],references:[],outline:[{id:'c1',title:'拟开展研究',targetWords:1000}],outlineConfirmed:true,body:'拟开展研究\n本研究拟使用公开资料开展比较分析，研究尚未实施。',stage:spec.steps.length-1,unlocked:spec.steps.length-1,jobs:{},versions:[],completed:spec.panels.slice(0,-1),[fields.template]:structuredClone(original),[fields.templateText]:'学校要求：说明拟开展计划。'};
 flow.bodyInputKey=JSON.stringify(writingFlowSnapshot(kind,flow));
 // This fixture represents a previously checked plan; export-only template
 // replacement must retain its material check while still rechecking layout.
 flow.quality={coverage:{complete:true},supplementCheck:{version:1,phase:'final',status:'final_ready',coverage:{total:1,checked:1,complete:true},items:[{id:'plan',title:'拟开展研究',status:'not_required',requirement:'计划性内容',reason:'未声称已有实验结果',evidence:[],missing:[]}]}};flow.qualityText=flow.body;
 let cloud={id:'draft',tool:kind,title:flow.title,project_id:'',version:1,payload:{id:'draft',tool:kind,title:flow.title,writingResume:true,writingFlow:flow}};
 const files=new Map(),json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
 globalThis.fetch=async(path,options={})=>{
  const body=options.body?JSON.parse(options.body):undefined;calls.push({path:String(path),body});
  if(path==='/api/auth/me')return json({user:{id:'alice'}});
  if(path==='/api/projects')return json({items:[]});
  if(path==='/api/workspace/drafts/draft'){
   if(body){if(failSave)return new Response(JSON.stringify({error:'模拟账户保存失败'}),{status:409});cloud={...cloud,...body,version:cloud.version+1};}
   return json({item:structuredClone(cloud)});
  }
  if(path==='/api/files'){files.set('new-template',Buffer.from(body.data,'base64'));return json({id:'new-template'});}
  if(String(path).startsWith('/api/files/'))return new Response(files.get(String(path).split('/')[3]));
  if(path==='/api/theses/document-render')return json({pages:1,data:Buffer.from('%PDF-synthetic-page').toString('base64'),docxData:body.data,fieldsRefreshed:true,pageCheck:{status:'passed'}});
  if(path==='/api/artifacts'){
   const bytes=Buffer.from(body.data,'base64'),id='export-'+artifacts.length;artifacts.push({id,bytes});return json({item:{id,bytes:bytes.length}});
  }
  if(String(path).startsWith('/api/artifacts/'))return new Response(artifacts.find(row=>String(path).includes(row.id)).bytes);
  throw Error('Unexpected fetch '+path);
 };
 const ctx={api:async(path,body)=>{
  calls.push({path,body});if(path==='/auth/me')return {user:{id:'alice'}};
  if(path==='/files'){if(delayUpload)await uploadGate;const id='new-template';files.set(id,Buffer.from(body.data,'base64'));return {id};}
  throw Error('Unexpected API '+path);
 }};
 dom.window.HTMLAnchorElement.prototype.click=function(){downloads.push(this.download);};
 async function mount(){if(!account){localStorage.setItem(keys.drafts,JSON.stringify([cloud.payload]));mountWritingFlow({kind,container:document.querySelector('.dashboard'),ctx,draftId:'draft'});return;}await mountAccountDraft('draft',{notify(){},mount:row=>mountWritingFlow({kind,container:document.querySelector('.dashboard'),ctx,draftId:row.id}),saveNative:()=>flushEditorDraft()});}
 t.after(()=>{releaseUpload();disposeAccountDraft();clearEditor();disposeWritingFlows();globalThis.fetch=originalFetch;clearTimeout(document.getElementById('artifact-export-notice')?._artifactTimer);dom.window.close();});
 await mount();
 return {dom,fields,calls,artifacts,downloads,releaseUpload,ctx,get cloud(){return cloud;},mount,
  q:selector=>document.querySelector(selector),local:()=>list(keys.drafts)[0].writingFlow,
  settings(){document.querySelector('[data-writing-step="'+((spec.panels.includes('materials')?spec.panels.indexOf('materials'):0)+1)+'"]').click();assert.ok(document.querySelector('[data-wf-knowledge] [data-template-file]'));},
  result(){document.querySelector('[data-writing-step="'+spec.steps.length+'"]').click();assert.equal(document.querySelectorAll('[data-wf-export] [data-document-export]').length,2);assert.equal(document.querySelector('[data-wf-export] [data-template-file]'),null);},
  select(file){document.querySelector('[data-writing-step="'+((spec.panels.includes('materials')?spec.panels.indexOf('materials'):0)+1)+'"]').click();const input=document.querySelector('[data-template-file]');Object.defineProperty(input,'files',{value:[file],configurable:true});input.dispatchEvent(new window.Event('change',{bubbles:true}));}
 };
}

for(const kind of Object.keys(writingStandards))test(kind+' can replace its export format without changing the confirmed writing snapshot',async t=>{
 const f=await fixture(t,{kind}),before=structuredClone(f.cloud.payload.writingFlow),file=await templateFile();
 assert.ok(f.q('[data-wf-export]'));assert.equal(f.q('[data-wf-standard-summary]'),null);assert.equal(document.querySelectorAll('[data-template-file]').length,0);f.settings();assert.equal(document.querySelectorAll('[data-template-file]').length,1);
 let opened=0;f.q('[data-template-file]').showPicker=()=>opened++;f.q('[data-wf-template-choose]').click();assert.equal(opened,1);
 f.select(file);assert.equal(f.q('[data-writing-step="'+writingFlowSpecs[kind].steps.length+'"]').disabled,true);
 await until(()=>!f.q('[data-wf-template-choose]').disabled);
 const saved=f.cloud.payload.writingFlow;
 assert.equal(saved[f.fields.exportTemplate].source.fileId,'new-template');
 assert.equal(saved[f.fields.template].source.fileId,'original');
 assert.equal(saved.body,before.body);assert.equal(saved.outlineConfirmed,true);assert.equal(saved.stage,writingFlowSpecs[kind].panels.includes('materials')?writingFlowSpecs[kind].panels.indexOf('materials'):0);assert.equal(saved.unlocked,before.unlocked);
 assert.deepEqual(saved.outline,before.outline);assert.deepEqual(writingFlowSnapshot(kind,saved),writingFlowSnapshot(kind,before));
 assert.match(f.q('[data-wf-standard] h3').textContent,/新开题排版/);f.result();
 assert.doesNotMatch(f.q('[data-wf-export]').textContent,/当前正文来自此前版本/);
 assert.equal(f.calls.some(row=>/quote|\/writing\/jobs/.test(row.path)),false);
 await f.mount();assert.equal(f.local()[f.fields.exportTemplate].source.fileId,'new-template');
 assert.equal(f.q('[aria-current="step"]').dataset.writingStep,String(saved.stage+1));f.result();assert.equal(writingExportTemplate(kind,f.local()).source.name,'新开题排版.docx');
});

test('the actual final export reads the replacement template from the cloud and applies its font and margin',async t=>{
 const f=await fixture(t),file=await templateFile();f.select(file);await until(()=>!f.q('[data-wf-template-choose]').disabled);f.result();
 f.q('#wf-body-docx').click();await until(()=>!f.q('#wf-body-docx').disabled);
 assert.equal(f.artifacts.length,1,f.q('#writing-status').textContent);assert.equal(f.downloads.length,1);
 assert.ok(f.calls.some(row=>row.path==='/api/files/new-template/download?expectedUserId=alice'));
 assert.equal(f.calls.some(row=>row.path.includes('/api/files/original/')),false);
 const zip=await JSZip.loadAsync(f.artifacts[0].bytes),xml=await zip.file('word/document.xml').async('string');
 assert.match(await zip.file('word/styles.xml').async('string'),/仿宋/);assert.match(xml,/w:left="1984"/);
 assert.match(xml,/本研究拟使用公开资料开展比较分析/);assert.doesNotMatch(xml,/\{\{正文\}\}|独创性声明/);
 assert.equal(f.calls.filter(row=>row.path==='/api/theses/document-render').length,1);
 assert.equal(f.calls.some(row=>/quote|\/writing\/jobs/.test(row.path)),false);
});

test('restoring the generic export format survives reopening without discarding the earlier writing requirements',async t=>{
 const f=await fixture(t),before=structuredClone(f.cloud.payload.writingFlow);f.settings();f.q('[data-wf-template-reset]').click();
 await until(()=>f.q('[data-wf-template-reset]')===null);
 assert.equal(writingExportTemplate('proposal',f.local()),null);
 assert.deepEqual(writingFlowSnapshot('proposal',f.local()),writingFlowSnapshot('proposal',before));
 await f.mount();assert.equal(writingExportTemplate('proposal',f.local()),null);f.result();assert.equal(f.q('[data-wf-export] [data-template-file]'),null);
 assert.equal(f.local().outlineConfirmed,true);assert.equal(f.local().body,before.body);
});

test('cancelling a replacement and rejecting an invalid file retain the template, body and confirmed outline',async t=>{
 const f=await fixture(t),before=structuredClone(f.local());f.settings();const input=f.q('[data-template-file]');
 input.showPicker=()=>{};f.q('[data-wf-template-choose]').click();input.dispatchEvent(new window.Event('cancel'));assert.equal(f.calls.some(row=>row.path==='/files'),false);
 f.select({name:'不支持.txt',size:1,arrayBuffer:async()=>new Uint8Array([1]).buffer});await until(()=>!f.q('[data-wf-template-choose]').disabled);
 assert.match(f.q('[data-wf-error]').textContent,/仅支持 DOCX/);assert.equal(writingExportTemplate('proposal',f.local()).source.fileId,'original');
 assert.equal(f.local().body,before.body);assert.equal(f.local().outlineConfirmed,true);
 assert.equal(f.calls.some(row=>row.path==='/files'),false);
});

test('a failed account save rolls back the export selection and allows retry without changing the manuscript',async t=>{
 const f=await fixture(t,{failSave:true}),before=structuredClone(f.local());f.select(await templateFile());await until(()=>!f.q('[data-wf-template-choose]').disabled);
 assert.match(f.q('[data-wf-error]').textContent,/账户草稿保存失败/);assert.equal(writingExportTemplate('proposal',f.local()).source.fileId,'original');
 assert.equal(f.local().body,before.body);assert.equal(f.local().outlineConfirmed,true);assert.equal(f.cloud.payload.writingFlow[f.fields.exportTemplate],undefined);
 let opened=0;f.q('[data-template-file]').showPicker=()=>opened++;f.q('[data-wf-template-choose]').click();assert.equal(opened,1);
 f.q('[data-template-file]').dispatchEvent(new window.Event('cancel'));
});

test('template upload exposes a busy state and prevents an export from racing the new format',async t=>{
 const f=await fixture(t,{delayUpload:true}),file=await templateFile();f.select(file);
 await until(()=>f.calls.some(row=>row.path==='/files'));
 assert.equal(f.q('[data-wf-standard]').getAttribute('aria-busy'),'true');assert.equal(f.q('[data-writing-step="5"]').disabled,true);
 f.q('[data-writing-step="5"]').click();assert.equal(f.q('#wf-body-docx'),null);assert.equal(f.artifacts.length,0);
 f.releaseUpload();await until(()=>!f.q('[data-wf-template-choose]').disabled);
 assert.equal(f.q('[data-wf-standard]').getAttribute('aria-busy'),'false');f.result();assert.equal(f.q('#wf-body-docx').disabled,false);
});


for(const nativeAPI of [true,false])test('direct writing entry resolves the signed-in export account '+(nativeAPI?'with':'without')+' an injected API client',async t=>{
 const f=await fixture(t,{account:false}),file=await templateFile();if(!nativeAPI)delete f.ctx.api;f.select(file);await until(()=>!f.q('[data-wf-template-choose]').disabled);
 assert.equal(f.local()[f.fields.exportTemplate].source.fileId,'new-template');f.result();
 f.q('#wf-body-docx').click();await until(()=>!f.q('#wf-body-docx').disabled);
 assert.equal(f.artifacts.length,1,f.q('#writing-status').textContent);assert.equal(f.downloads.length,1);
 assert.ok(f.calls.some(row=>row.path==='/api/files/new-template/download?expectedUserId=alice'));
 const render=f.calls.find(row=>row.path==='/api/theses/document-render');assert.equal(render.body.expectedUserId,'alice');
 const zip=await JSZip.loadAsync(f.artifacts[0].bytes);assert.match(await zip.file('word/styles.xml').async('string'),/仿宋/);
 assert.equal(f.calls.some(row=>/quote|\/writing\/jobs/.test(row.path)),false);
});

for(const kind of Object.keys(writingStandards))test(kind+' actual default export works without uploading or downloading any template first',async t=>{
 const f=await fixture(t,{kind});f.settings();f.q('[data-wf-template-reset]').click();await until(()=>f.q('[data-wf-template-reset]')===null);f.result();
 f.q('#wf-body-draft').click();await until(()=>!f.q('#wf-body-draft').disabled);assert.equal(f.artifacts.length,1,f.q('#writing-status').textContent);
 assert.equal(f.calls.some(row=>row.path.startsWith('/api/files/')),false);assert.equal(f.calls.some(row=>/quote|\/writing\/jobs/.test(row.path)),false);
 const zip=await JSZip.loadAsync(f.artifacts[0].bytes),styles=await zip.file('word/styles.xml').async('string'),normal=styles.match(/w:styleId="PKNormal"[^>]*>([\s\S]*?)<\/w:style>/)?.[1];assert.ok(normal);assert.ok(normal.includes('w:val="'+(kind==='article'?21:24)+'"'));assert.equal(f.q('[data-wf-standard-summary]'),null);assert.equal(writingExportTemplate(kind,f.local()),null);
});

test('practice can download a real generic DOCX from its template entry',async t=>{
 const f=await fixture(t,{kind:'practice'});f.settings();f.q('[data-wf-template-download]').click();await until(()=>f.downloads.length===1);assert.equal(f.artifacts.length,1);const zip=await JSZip.loadAsync(f.artifacts[0].bytes),xml=await zip.file('word/document.xml').async('string');assert.ok(xml.includes('{{标题}}'));assert.ok(xml.includes('{{正文}}'));assert.ok(xml.includes('{{作者}}'));assert.equal(f.calls.some(row=>/quote|\/writing\/jobs/.test(row.path)),false);
});
