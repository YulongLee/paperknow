import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountResearchDrawing,researchDrawingSnapshot,researchDrawingArtifact,validateResearchDrawingBlob,normalizeResearchDrawingDraft,researchDrawingDraftKey} from '../dist/workspace/research-drawing-studio.mjs';
import {basicResearchFigures,professionalResearchFigures,researchFigureChoices} from '../dist/workspace/research-figure-catalog.mjs';
import {beginDraftScope,endDraftScope} from '../dist/workspace/state.mjs';
import {pngFixture} from './fixtures/research-image.mjs';

const until=async check=>{for(let i=0;i<120;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,2));}assert.ok(check(),'异步界面未达到预期状态');};
const baseForm=()=>({title:'【合成验收】研究技术路线',prompt:'从研究问题、资料收集、分析方法到研究结论，画一张清晰的流程示意图。',language:'中文',figureType:'flowchart',aspectRatio:'16:9',palette:'academic'});
const imageOutput=()=>({text:'科研图片已生成，请核对。',image:{artifactId:'image-alice',downloadUrl:'/api/artifacts/image-alice/download',fileName:'合成验收.png',mimeType:'image/png',width:1600,height:900},artifacts:[{id:'image-alice',name:'合成验收.png',kind:'png',role:'image',downloadUrl:'/api/artifacts/image-alice/download'}],sourceIds:[],requiresReview:true});
const completedJob=()=>({id:'job-alice',kind:'research',operation:'image',status:'completed',title:'【合成验收】科研流程',createdAt:new Date().toISOString(),completedUnits:1,totalUnits:1,snapshot:researchDrawingSnapshot(baseForm()),output:imageOutput()});
function fixture(t,{mode='basic',owner='alice',jobs=[],stored,storageFails=false,artifactBlob,initialize}={}){
 const dom=new JSDOM('<main class="dashboard"><div id="drawing"></div></main>',{url:'https://paperknow.cn/workspace.html#category/research'}),w=dom.window,container=w.document.querySelector('#drawing'),requests=[],downloads=[],created=[],revoked=[],notices=[];
 let identity=owner,job=completedJob(),blobRead=artifactBlob||(()=>Promise.resolve(new Blob([pngFixture(1600,900)],{type:'application/octet-stream'})));
 w.URL.createObjectURL=blob=>{created.push(blob);return 'blob:https://paperknow.cn/fixture-'+created.length;};w.URL.revokeObjectURL=value=>revoked.push(value);w.HTMLAnchorElement.prototype.click=function(){downloads.push({href:this.href,name:this.download});};
 if(stored!==undefined)w.localStorage.setItem(researchDrawingDraftKey+':'+mode+':'+(owner||'guest'),stored);
 if(storageFails)w.Storage.prototype.setItem=function(){throw Error('fixture storage full');};
 const api=async(path,data,options={})=>{requests.push({path,data:data===undefined?undefined:structuredClone(data),headers:options.headers,owner:identity});
  if(path==='/auth/me'){if(!identity)throw Object.assign(Error('请先登录'),{status:401});return {user:{id:identity}};}
  if(path==='/tool-runs/jobs'&&data===undefined)return {items:structuredClone(jobs)};
  if(path==='/tool-runs/capabilities')return {ready:true,researchImages:{ready:true}};
  if(path==='/tool-runs/quote')return {type:'agent',source:'credits',creditCost:10,title:'科研绘图',token:'fixture-image-quote',expiresAt:new Date(Date.now()+60000).toISOString()};
  if(path==='/tool-runs/jobs'&&data){job={...completedJob(),snapshot:structuredClone(data.snapshot)};return {item:structuredClone(job)};}
  if(path==='/tool-runs/jobs/job-alice')return {item:structuredClone(job)};
  if(path.startsWith('/tool-runs/jobs/by-key/'))throw Object.assign(Error('未找到原任务'),{status:404});
  if(path==='/tool-runs/jobs/job-alice/cancel'){job={...job,status:'cancelled'};return {item:structuredClone(job)};}
  throw Error('测试不允许的请求 '+path);
 };
 const fetchImpl=async(path,options)=>{requests.push({path,headers:options.headers,owner:identity});if(!path.startsWith('/api/artifacts/image-alice/download?'))throw Error('测试不允许的文件请求 '+path);return {ok:true,blob:()=>blobRead()};};
 initialize?.(w);
 const mount=mountResearchDrawing(container,{api,fetchImpl,notify:value=>notices.push(value)},{mode});
 t.after(()=>{mount.dispose();endDraftScope();w.close();});
 const enter=(selector,value)=>{const input=container.querySelector(selector);assert.ok(input,'未找到输入 '+selector);input.value=value;input.dispatchEvent(new w.Event('input',{bubbles:true}));};
 const click=selector=>{const button=container.querySelector(selector);assert.ok(button,'未找到按钮 '+selector);button.click();};
 return {w,container,mount,requests,downloads,created,revoked,notices,enter,click,setOwner:value=>identity=value,setJob:value=>job=structuredClone(value),setBlob:value=>blobRead=value,fill(){enter('[data-rd-title]',baseForm().title);click('[data-rd-figure="flowchart"]');enter('[data-rd-prompt]',baseForm().prompt);},consent(){const input=container.querySelector('[data-tj-consent]');assert.ok(input);input.checked=true;input.dispatchEvent(new w.Event('change',{bubbles:true}));}};
}

test('research drawing has a comprehensive type catalog and twelve illustrative professional domains',()=>{
 assert.ok(basicResearchFigures.length>=32);assert.equal(professionalResearchFigures.length,12);
 for(const mode of ['basic','professional']){const choices=researchFigureChoices(mode);assert.equal(new Set(choices.map(item=>item.id)).size,choices.length);for(const item of choices){assert.match(item.id,/^[A-Za-z0-9_-]{1,80}$/);assert.match(item.categoryId,/^[A-Za-z0-9_-]{1,80}$/);assert.ok(item.example.length>20);assert.ok(item.description);}}
 assert.ok(basicResearchFigures.some(item=>item.id==='sequence'));assert.ok(basicResearchFigures.some(item=>item.id==='architecture'));assert.ok(professionalResearchFigures.some(item=>item.id==='biomedicine'));assert.ok(professionalResearchFigures.some(item=>item.id==='automation'));
});

test('drawing snapshot requires a natural language prompt but no table, nodes or multi-step setup',()=>{
 const value=researchDrawingSnapshot(baseForm());assert.equal(value.text,baseForm().prompt);assert.deepEqual(value.materials,[]);assert.deepEqual(value.context,{categoryId:'basic',figureType:'flowchart',aspectRatio:'16:9',palette:'academic'});assert.equal(value.mode,'basic');assert.equal(value.requirements,undefined);assert.equal(value.context.table,undefined);
 assert.throws(()=>researchDrawingSnapshot({...baseForm(),prompt:'  '}),/请描述/);assert.throws(()=>researchDrawingSnapshot({...baseForm(),prompt:'a'.repeat(6001)}),/最多/);assert.throws(()=>researchDrawingSnapshot({...baseForm(),aspectRatio:'broken'}),/有效/);
});

test('private image descriptor only accepts its owned artifact download route',()=>{
 assert.equal(researchDrawingArtifact(imageOutput()).fileName,'合成验收.png');
 for(const image of [{...imageOutput().image,downloadUrl:'https://provider.example/private.png'},{...imageOutput().image,downloadUrl:'/api/artifacts/another-owner/download'},{...imageOutput().image,mimeType:'text/html'},{...imageOutput().image,fileName:'../private.png'},{...imageOutput().image,artifactId:'bad/id'}])assert.throws(()=>researchDrawingArtifact({image}));
});

test('safe octet-stream HTTP downloads become local PNG previews only after matching bounded file signatures',async()=>{
 const response=new Response(pngFixture(1600,900),{headers:{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="artifact.png"','X-Content-Type-Options':'nosniff'}}),received=await response.blob();assert.equal(received.type,'application/octet-stream');const verified=await validateResearchDrawingBlob(received,imageOutput().image);assert.equal(verified.type,'image/png');assert.equal(verified.size,received.size);assert.equal(response.headers.get('Content-Type'),'application/octet-stream');
 for(const [blob,file] of [[new Blob(['<svg><script>bad()</script></svg>'],{type:'application/octet-stream'}),imageOutput().image],[new Blob([pngFixture(1600,900)],{type:'text/html'}),imageOutput().image],[new Blob([pngFixture(1600,900)],{type:'application/octet-stream'}),{...imageOutput().image,mimeType:'image/jpeg'}],[new Blob([pngFixture(256,256)],{type:'application/octet-stream'}),imageOutput().image]])await assert.rejects(()=>validateResearchDrawingBlob(blob,file),/校验未通过/);
});

test('drawing entry is a prompt-first studio, type selection preserves typed content, and examples never silently overwrite',async t=>{
 const f=fixture(t);await f.mount.ready;assert.equal(f.container.querySelectorAll('.rd-type-list>[data-rd-figure]').length,basicResearchFigures.length);assert.ok(f.container.querySelector('[data-rd-prompt]'));assert.equal(f.container.querySelector('input[type=file]'),null);assert.equal(f.container.querySelector('table'),null);
 f.enter('[data-rd-prompt]','我自己的科研绘图描述');f.click('[data-rd-figure="network"]');assert.equal(f.container.querySelector('[data-rd-prompt]').value,'我自己的科研绘图描述');assert.equal(f.container.querySelector('[data-rd-figure-label]').textContent,'关系图');f.click('[data-rd-example]');assert.equal(f.container.querySelector('[data-rd-prompt]').value,'我自己的科研绘图描述');assert.match(f.container.querySelector('[data-rd-status]').textContent,/当前描述已保留/);
 f.enter('[data-rd-prompt]','');f.click('[data-rd-example]');assert.match(f.container.querySelector('[data-rd-prompt]').value,/研究合作关系图/);f.click('[data-rd-language="English"]');assert.equal(f.mount.getSnapshot().language,'English');
 const saved=JSON.parse(f.w.localStorage.getItem(researchDrawingDraftKey+':basic:alice'));assert.equal(saved.form.prompt,f.container.querySelector('[data-rd-prompt]').value);assert.equal(saved.form.figureType,'network');assert.equal(saved.form.language,'English');assert.equal(f.requests.filter(row=>row.path==='/tool-runs/quote').length,0);
});

test('professional domain choices send their own semantic category without claiming desktop software integration',async t=>{
 const f=fixture(t,{mode:'professional'});await f.mount.ready;assert.equal(f.container.querySelectorAll('details[data-rd-group]').length,12);f.click('[data-rd-figure="cell-mechanism"]');f.click('[data-rd-example]');const value=f.mount.getSnapshot();assert.equal(value.mode,'professional');assert.equal(value.context.categoryId,'biomedicine');assert.equal(value.context.figureType,'cell-mechanism');assert.match(value.text,/细胞信号/);assert.doesNotMatch(f.container.textContent,/已接入.*(?:Blender|AutoCAD|BioRender)|可运行仿真/);assert.match(f.container.textContent,/不执行仿真/);
});

test('drawing generation previews its quote, requires consent, submits image operation, and adopts an owned binary',async t=>{
 const f=fixture(t);await f.mount.ready;f.fill();f.click('[data-rd-generate]');await until(()=>!!f.container.querySelector('[data-tj-consent]'));assert.match(f.container.textContent,/10 科研积分/);assert.equal(f.container.querySelector('[data-tj-start]').disabled,true);assert.equal(f.requests.filter(row=>row.path==='/tool-runs/jobs'&&row.data).length,0);
 f.consent();f.click('[data-tj-start]');await until(()=>!!f.container.querySelector('[data-tj-apply]'));const starts=f.requests.filter(row=>row.path==='/tool-runs/jobs'&&row.data);assert.equal(starts.length,1);assert.equal(starts[0].data.operation,'image');assert.equal(starts[0].data.kind,'research');assert.equal(starts[0].data.snapshot.text,baseForm().prompt);assert.equal(starts[0].headers['X-PaperKnow-User'],'alice');
 f.click('[data-tj-apply]');await until(()=>!!f.container.querySelector('[data-rd-generated-image]'));assert.equal(f.created.length,1);assert.equal(f.created[0].type,'image/png');assert.match(f.container.querySelector('[data-rd-generated-image]').src,/^blob:/);assert.equal(f.requests.find(row=>row.path.startsWith('/api/artifacts/')).headers['X-PaperKnow-User'],'alice');assert.match(f.requests.find(row=>row.path.startsWith('/api/artifacts/')).path,/expectedUserId=alice/);
 f.click('[data-rd-download]');await until(()=>f.downloads.length===1);assert.equal(f.downloads[0].name,'合成验收.png');const raw=f.w.localStorage.getItem(researchDrawingDraftKey+':basic:alice');assert.doesNotMatch(raw,/blob:|provider\.example|imageBase64|image-alice|downloadUrl|fixture-image/);f.mount.dispose();assert.equal(f.revoked.length,1);
});

test('changing a prompt after a fee quote immediately removes consent and stops stale submission',async t=>{
 const f=fixture(t);await f.mount.ready;f.fill();f.click('[data-rd-generate]');await until(()=>!!f.container.querySelector('[data-tj-consent]'));f.consent();assert.equal(f.container.querySelector('[data-tj-start]').disabled,false);const before=f.requests.length;f.enter('[data-rd-prompt]','修改后的研究问题和绘图内容');assert.equal(f.container.querySelector('[data-tj-consent]').checked,false);assert.equal(f.container.querySelector('[data-tj-start]').disabled,true);assert.match(f.container.textContent,/输入已有修改/);assert.equal(f.requests.length,before);assert.equal(f.requests.filter(row=>row.path==='/tool-runs/jobs'&&row.data).length,0);
});

test('a full browser store stops before charging or submitting and preserves editable input',async t=>{
 const f=fixture(t,{storageFails:true});await f.mount.ready;f.fill();f.click('[data-rd-generate]');await until(()=>!!f.container.querySelector('[data-tj-error],.tool-job-error'));assert.equal(f.requests.filter(row=>row.path==='/tool-runs/quote').length,0);assert.equal(f.requests.filter(row=>row.path==='/tool-runs/jobs'&&row.data).length,0);assert.equal(f.container.querySelector('[data-rd-prompt]').value,baseForm().prompt);assert.match(f.container.textContent,/未能保存任务草稿/);
});

test('history only displays image jobs and retrieves an existing owned image without charging',async t=>{
 const rows=[completedJob(),{...completedJob(),id:'legacy-chart',operation:'chart',title:'旧的数据图表'},{...completedJob(),id:'ppt-job',kind:'presentation',operation:'ppt',title:'演示稿'}];const f=fixture(t,{jobs:rows});await f.mount.ready;assert.equal(f.container.querySelectorAll('[data-rd-history-item]').length,1);assert.doesNotMatch(f.container.querySelector('[data-rd-history]').textContent,/旧的数据图表|演示稿/);f.click('[data-rd-history-item]');await until(()=>!!f.container.querySelector('[data-rd-generated-image]'));assert.equal(f.requests.filter(row=>row.path==='/tool-runs/quote'||row.path==='/tool-runs/jobs'&&row.data).length,0);
 f.click('[data-rd-copy-input]');await until(()=>f.container.querySelector('[data-rd-prompt]').value===baseForm().prompt);assert.equal(f.mount.getSnapshot().context.figureType,'flowchart');assert.equal(f.requests.filter(row=>row.path==='/tool-runs/quote').length,0);
});

test('a failed historical task preserves the current prompt and can deliberately restore its original input for retry',async t=>{
 const failed={...completedJob(),status:'failed',error:'生成未完成，请重试',output:null},f=fixture(t,{jobs:[failed]});f.setJob(failed);await f.mount.ready;f.enter('[data-rd-prompt]','尚未提交的另一份描述，不应被历史任务自动覆盖');f.click('[data-rd-history-item]');await until(()=>!!f.container.querySelector('[data-tj-resume]'));assert.equal(f.container.querySelector('[data-rd-prompt]').value,'尚未提交的另一份描述，不应被历史任务自动覆盖');assert.equal(f.container.querySelector('[data-tj-resume]').disabled,true);assert.equal(f.container.querySelector('[data-rd-recover-input]').hidden,false);f.click('[data-rd-recover-input]');await until(()=>f.container.querySelector('[data-rd-prompt]').value===baseForm().prompt);assert.equal(f.container.querySelector('[data-tj-resume]').disabled,false);assert.equal(f.requests.filter(row=>row.path==='/tool-runs/quote'||row.path==='/tool-runs/jobs'&&row.data).length,0);
});

test('account changes while downloading a preview clear private history and never create an object URL or device download',async t=>{
 let resolveBlob;const f=fixture(t,{jobs:[completedJob()],artifactBlob:()=>new Promise(resolve=>{resolveBlob=resolve;})});await f.mount.ready;f.click('[data-rd-history-item]');await until(()=>typeof resolveBlob==='function');f.setOwner('bob');resolveBlob(new Blob([pngFixture(1600,900)],{type:'application/octet-stream'}));await until(()=>/账户已变化/.test(f.container.querySelector('[data-rd-status]').textContent));assert.equal(f.created.length,0);assert.equal(f.downloads.length,0);assert.equal(f.container.querySelector('[data-rd-generated-image]'),null);assert.equal(f.container.querySelector('[data-rd-history-item]'),null);assert.equal(f.container.querySelector('[data-rd-generate]').disabled,true);
});

test('account changes also clear a recovered private prompt and any fee or result content from the old task panel',async t=>{
 const f=fixture(t,{jobs:[completedJob()]});await f.mount.ready;f.fill();f.click('[data-rd-generate]');await until(()=>!!f.container.querySelector('[data-tj-consent]'));assert.match(f.container.querySelector('[data-rd-prompt]').value,/研究问题/);f.setOwner('bob');f.click('[data-rd-history-refresh]');await until(()=>/账户已变化/.test(f.container.querySelector('[data-rd-status]').textContent));assert.equal(f.container.querySelector('[data-rd-prompt]').value,'');assert.equal(f.container.querySelector('[data-rd-title]').value,'');assert.equal(f.container.querySelector('[data-rd-job]').textContent,'');assert.equal(f.container.querySelector('[data-rd-job]').hidden,true);assert.doesNotMatch(f.container.textContent,/合成验收.*研究技术路线|fixture-image-quote/);
});

test('leaving while an image body is arriving never paints or downloads its late result',async t=>{
 let resolveBlob;const f=fixture(t,{jobs:[completedJob()],artifactBlob:()=>new Promise(resolve=>{resolveBlob=resolve;})});await f.mount.ready;f.click('[data-rd-history-item]');await until(()=>typeof resolveBlob==='function');f.mount.dispose();resolveBlob(new Blob([pngFixture(1600,900)],{type:'application/octet-stream'}));await new Promise(resolve=>setTimeout(resolve,15));assert.equal(f.created.length,0);assert.equal(f.downloads.length,0);assert.equal(f.container.querySelector('[data-rd-generated-image]'),null);
});

test('a guest can prepare a prompt and sees login instead of a fake successful history',async t=>{
 const f=fixture(t,{owner:null});await f.mount.ready;assert.match(f.container.querySelector('[data-rd-history]').textContent,/登录后/);f.enter('[data-rd-prompt]','这是访客在本机准备的绘图描述');assert.ok(f.w.localStorage.getItem(researchDrawingDraftKey+':basic:guest'));f.click('[data-rd-generate]');await until(()=>!!f.container.querySelector('.tool-job-panel a[href^="/auth.html"]'));assert.equal(f.requests.filter(row=>row.path==='/tool-runs/quote').length,0);assert.equal(f.requests.filter(row=>row.path==='/tool-runs/jobs'&&row.data).length,0);
});

test('unreadable local records remain intact until a deliberate reset and never get silently overwritten',async t=>{
 const broken='{"not-valid-version":true}',f=fixture(t,{stored:broken});await f.mount.ready;f.fill();assert.equal(f.w.localStorage.getItem(researchDrawingDraftKey+':basic:alice'),broken);assert.equal(f.container.querySelector('[data-rd-draft-recovery]').hidden,false);f.click('[data-rd-generate]');assert.equal(f.requests.filter(row=>row.path==='/tool-runs/quote').length,0);f.click('[data-rd-draft-reset]');const saved=JSON.parse(f.w.localStorage.getItem(researchDrawingDraftKey+':basic:alice'));assert.equal(saved.form.prompt,baseForm().prompt);assert.equal(f.container.querySelector('[data-rd-draft-recovery]').hidden,true);
});

test('private account draft scopes neither read nor write the shared drawing recovery store or submit AI work',async t=>{
 beginDraftScope({ownerId:'alice',drafts:[]});const f=fixture(t);await f.mount.ready;f.fill();f.click('[data-rd-generate]');assert.match(f.notices.at(-1),/先保存当前账户成果/);assert.equal(f.w.localStorage.length,0);assert.equal(f.requests.filter(row=>row.path==='/tool-runs/quote').length,0);
});

test('local drawing normalization omits arbitrary task output and rejects image payloads inside snapshots',()=>{
 const value=normalizeResearchDrawingDraft({version:1,form:baseForm(),jobState:{itemId:'job-alice',ownerId:'alice',output:{imageBase64:'secret'},image:'https://provider.example/private'}});assert.equal(value.jobState.output,undefined);assert.equal(value.jobState.image,undefined);
 const snapshot={...researchDrawingSnapshot(baseForm()),image:'https://provider.example/private'};assert.throws(()=>normalizeResearchDrawingDraft({version:1,form:baseForm(),jobState:{snapshot}}),/恢复信息/);
});
