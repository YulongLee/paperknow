import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountResearchDrawing,researchDrawingSnapshot,researchDrawingArtifact,validateResearchDrawingBlob,normalizeResearchDrawingDraft,researchDrawingDraftKey} from '../dist/workspace/research-drawing-studio.mjs';
import {basicResearchFigures,professionalResearchFigures,researchFigureChoices,researchFigureMatches} from '../dist/workspace/research-figure-catalog.mjs';
import {beginDraftScope,endDraftScope} from '../dist/workspace/state.mjs';
import {pngFixture} from './fixtures/research-image.mjs';

const until=async check=>{for(let i=0;i<120;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,2));}assert.ok(check(),'异步界面未达到预期状态');};
const baseForm=()=>({title:'【合成验收】研究技术路线',prompt:'从研究问题、资料收集、分析方法到研究结论，画一张清晰的流程示意图。',language:'中文',figureType:'flowchart',aspectRatio:'16:9',palette:'academic'});
const imageOutput=()=>({text:'科研图片已生成，请核对。',image:{artifactId:'image-alice',downloadUrl:'/api/artifacts/image-alice/download',fileName:'合成验收.png',mimeType:'image/png',width:1600,height:900},artifacts:[{id:'image-alice',name:'合成验收.png',kind:'png',role:'image',downloadUrl:'/api/artifacts/image-alice/download'}],sourceIds:[],requiresReview:true});
const completedJob=()=>({id:'job-alice',kind:'research',operation:'image',status:'completed',title:'【合成验收】科研流程',createdAt:new Date().toISOString(),completedUnits:1,totalUnits:1,snapshot:researchDrawingSnapshot(baseForm()),output:imageOutput()});
function fixture(t,{mode='basic',owner='alice',jobs=[],stored,storageFails=false,artifactBlob,initialize,beforeApi}={}){
 const dom=new JSDOM('<main class="dashboard"><div id="drawing"></div></main>',{url:'https://paperknow.cn/workspace.html#category/research'}),w=dom.window,container=w.document.querySelector('#drawing'),requests=[],downloads=[],created=[],revoked=[],notices=[];
 let identity=owner,job=completedJob(),blobRead=artifactBlob||(()=>Promise.resolve(new Blob([pngFixture(1600,900)],{type:'application/octet-stream'})));
 w.URL.createObjectURL=blob=>{created.push(blob);return 'blob:https://paperknow.cn/fixture-'+created.length;};w.URL.revokeObjectURL=value=>revoked.push(value);w.HTMLAnchorElement.prototype.click=function(){downloads.push({href:this.href,name:this.download});};
 if(stored!==undefined)w.localStorage.setItem(researchDrawingDraftKey+':'+mode+':'+(owner||'guest'),stored);
 if(storageFails)w.Storage.prototype.setItem=function(){throw Error('fixture storage full');};
 const api=async(path,data,options={})=>{requests.push({path,data:data===undefined?undefined:structuredClone(data),headers:options.headers,owner:identity});
  await beforeApi?.(path,data);if(path==='/auth/me'){if(!identity)throw Object.assign(Error('请先登录'),{status:401});return {user:{id:identity}};}
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

test('drawing directly generates once and adopts an owned binary',async t=>{
 const f=fixture(t);await f.mount.ready;f.fill();f.click('[data-rd-generate]');await until(()=>!!f.container.querySelector('[data-tj-apply]'));const starts=f.requests.filter(row=>row.path==='/tool-runs/jobs'&&row.data);assert.equal(starts.length,1);assert.equal(starts[0].data.operation,'image');assert.equal(starts[0].data.kind,'research');assert.equal(starts[0].data.snapshot.text,baseForm().prompt);assert.equal(starts[0].headers['X-PaperKnow-User'],'alice');
 f.click('[data-tj-apply]');await until(()=>!!f.container.querySelector('[data-rd-generated-image]'));assert.equal(f.created.length,1);assert.equal(f.created[0].type,'image/png');assert.match(f.container.querySelector('[data-rd-generated-image]').src,/^blob:/);assert.equal(f.requests.find(row=>row.path.startsWith('/api/artifacts/')).headers['X-PaperKnow-User'],'alice');assert.match(f.requests.find(row=>row.path.startsWith('/api/artifacts/')).path,/expectedUserId=alice/);
 f.click('[data-rd-download]');await until(()=>f.downloads.length===1);assert.equal(f.downloads[0].name,'合成验收.png');const raw=f.w.localStorage.getItem(researchDrawingDraftKey+':basic:alice');assert.doesNotMatch(raw,/blob:|provider\.example|imageBase64|image-alice|downloadUrl|fixture-image/);f.mount.dispose();assert.equal(f.revoked.length,1);
});

test('changing a prompt during usage checking stops stale direct submission',async t=>{
 let release;const f=fixture(t,{beforeApi:async path=>{if(path==='/tool-runs/quote')await new Promise(resolve=>release=resolve);}});await f.mount.ready;f.fill();f.click('[data-rd-generate]');await until(()=>!!release);f.enter('[data-rd-prompt]','修改后的研究问题和绘图内容');release();await until(()=>!f.container.querySelector('[data-tj-result-window]')||f.container.querySelector('[data-tj-result-window]').getAttribute('aria-busy')!=='true');assert.equal(f.requests.filter(row=>row.path==='/tool-runs/jobs'&&row.data).length,0);assert.equal(f.container.querySelector('[data-rd-prompt]').value,'修改后的研究问题和绘图内容');
});

test('a full browser store stops before charging or submitting and preserves editable input',async t=>{
 const f=fixture(t,{storageFails:true});await f.mount.ready;f.fill();f.click('[data-rd-generate]');await until(()=>!!f.container.querySelector('[data-tj-error],.tool-job-error'));assert.equal(f.requests.filter(row=>row.path==='/tool-runs/quote').length,0);assert.equal(f.requests.filter(row=>row.path==='/tool-runs/jobs'&&row.data).length,0);assert.equal(f.container.querySelector('[data-rd-prompt]').value,baseForm().prompt);assert.match(f.container.textContent,/未能保存任务草稿/);
});

test('history only displays image jobs and retrieves an existing owned image without charging',async t=>{
 const rows=[completedJob(),{...completedJob(),id:'legacy-chart',operation:'chart',title:'旧的数据图表'},{...completedJob(),id:'ppt-job',kind:'presentation',operation:'ppt',title:'演示稿'}];const f=fixture(t,{jobs:rows});await f.mount.ready;assert.equal(f.container.querySelectorAll('[data-rd-history-item]').length,1);assert.doesNotMatch(f.container.querySelector('[data-rd-history]').textContent,/旧的数据图表|演示稿/);f.click('[data-rd-history-item]');await until(()=>!!f.container.querySelector('[data-rd-generated-image]'));assert.equal(f.requests.filter(row=>row.path==='/tool-runs/quote'||row.path==='/tool-runs/jobs'&&row.data).length,0);
 f.click('[data-rd-copy-input]');await until(()=>f.container.querySelector('[data-rd-prompt]').value===baseForm().prompt);assert.equal(f.mount.getSnapshot().context.figureType,'flowchart');assert.equal(f.requests.filter(row=>row.path==='/tool-runs/quote').length,0);
});

test('unchanged drawing history refreshes retain the same controls and nested scroll position',async t=>{
 const f=fixture(t,{jobs:[completedJob()]});await f.mount.ready;
 const target=f.container.querySelector('[data-rd-history]'),button=target.querySelector('[data-rd-history-item]');target.scrollTop=70;button.focus();
 await f.mount.refreshHistory();
 assert.equal(target.querySelector('[data-rd-history-item]'),button);assert.equal(target.scrollTop,70);assert.equal(f.w.document.activeElement,button);
 f.click('[data-rd-history-filter="active"]');assert.equal(target.querySelector('[data-rd-history-item]'),null);
 f.click('[data-rd-history-filter="all"]');assert.ok(target.querySelector('[data-rd-history-item]'));
});

test('owned image previews reserve validated intrinsic dimensions before image decode',async t=>{
 const f=fixture(t,{jobs:[completedJob()]});await f.mount.ready;f.click('[data-rd-history-item]');
 await until(()=>!!f.container.querySelector('img[data-rd-generated-image]'));
 const image=f.container.querySelector('img[data-rd-generated-image]');assert.equal(image.getAttribute('width'),'1600');assert.equal(image.getAttribute('height'),'900');assert.match(image.src,/^blob:/);
});

test('a failed historical task preserves the current prompt and can deliberately restore its original input for retry',async t=>{
 const failed={...completedJob(),status:'failed',error:'生成未完成，请重试',output:null},f=fixture(t,{jobs:[failed]});f.setJob(failed);await f.mount.ready;f.enter('[data-rd-prompt]','尚未提交的另一份描述，不应被历史任务自动覆盖');f.click('[data-rd-history-item]');await until(()=>!!f.container.querySelector('[data-tj-resume]'));assert.equal(f.container.querySelector('[data-rd-prompt]').value,'尚未提交的另一份描述，不应被历史任务自动覆盖');assert.equal(f.container.querySelector('[data-tj-resume]').disabled,true);assert.equal(f.container.querySelector('[data-rd-recover-input]').hidden,false);f.click('[data-rd-recover-input]');await until(()=>f.container.querySelector('[data-rd-prompt]').value===baseForm().prompt);assert.equal(f.container.querySelector('[data-tj-resume]').disabled,false);assert.equal(f.requests.filter(row=>row.path==='/tool-runs/quote'||row.path==='/tool-runs/jobs'&&row.data).length,0);
});

test('account changes while downloading a preview clear private history and never create an object URL or device download',async t=>{
 let resolveBlob;const f=fixture(t,{jobs:[completedJob()],artifactBlob:()=>new Promise(resolve=>{resolveBlob=resolve;})});await f.mount.ready;f.click('[data-rd-history-item]');await until(()=>typeof resolveBlob==='function');f.setOwner('bob');resolveBlob(new Blob([pngFixture(1600,900)],{type:'application/octet-stream'}));await until(()=>/账户已变化/.test(f.container.querySelector('[data-rd-status]').textContent));assert.equal(f.created.length,0);assert.equal(f.downloads.length,0);assert.equal(f.container.querySelector('[data-rd-generated-image]'),null);assert.equal(f.container.querySelector('[data-rd-history-item]'),null);assert.equal(f.container.querySelector('[data-rd-generate]').disabled,true);
});

test('account changes also clear a recovered private prompt and any fee or result content from the old task panel',async t=>{
 const f=fixture(t,{jobs:[completedJob()]});await f.mount.ready;f.fill();f.click('[data-rd-generate]');await until(()=>!!f.container.querySelector('[data-tj-apply]'));assert.match(f.container.querySelector('[data-rd-prompt]').value,/研究问题/);f.setOwner('bob');f.click('[data-rd-history-refresh]');await until(()=>/账户已变化/.test(f.container.querySelector('[data-rd-status]').textContent));assert.equal(f.container.querySelector('[data-rd-prompt]').value,'');assert.equal(f.container.querySelector('[data-rd-title]').value,'');assert.equal(f.container.querySelector('[data-rd-job]').textContent,'');assert.equal(f.container.querySelector('[data-rd-job]').hidden,true);assert.doesNotMatch(f.container.textContent,/合成验收.*研究技术路线|fixture-image-quote/);
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


test('basic drawing covers every observed competitor type while retaining legacy horizontal charts and smart choice',()=>{
 const labels=new Set(basicResearchFigures.map(item=>item.label));
 for(const label of ['流程图','实体关系图','饼图','柱状图','折线图','树图','矩形树图','象形柱图','雷达图','和弦图','热力图','盒须图','仪表盘','散点图','K线图','桑基图','旭日图','矩阵坐标系','日历坐标系','平行坐标系','关系图','漏斗图','路径图','主题河流图','用户旅程图','需求图','ZenUML','时序图','类图','架构图','状态图','时间线图(不带数值)','思维导图(非树状)'])assert.ok(labels.has(label),'缺少基础类型：'+label);
 assert.ok(labels.has('条形图'));assert.ok(labels.has('智能选择'));
});

test('all observed professional software families expose independent scenes and preserve every original draft identifier',()=>{
 const groups=professionalResearchFigures,choices=researchFigureChoices('professional');
 for(const family of ['Blender','Cinema 4D','Maya','ZBrush','ABAQUS','ANSYS','COMSOL','MATLAB','Simulink','FDTD','TracePro','Zemax','ChemOffice','Gaussian','Materials Studio','Origin','VASP','ArcGIS','ENVI','Google Earth','QGIS','AutoCAD','CATIA','ProE/Creo','SolidWorks','UG/NX','3ds Max','Lumion','Revit','SketchUp','天正建筑','Keras','PyTorch','Scikit-learn','TensorFlow','BioRender','ChemDraw','Cytoscape','GraphPad','ImageJ','Pathway Studio','PyMOL','Altium Designer','Cadence','Multisim','Proteus','PSPICE','Minitab','NVivo','SAS','Stata','CoDeSys','LabVIEW','RSLogix','Step 7','TIA Portal'])assert.ok(choices.some(item=>item.familyLabel===family),'缺少专业家族：'+family);
 for(const id of ['3d-structure','product-render','exploded','simulation-structure','simulation-field','simulation-signal','optical-path','optical-system','optical-device','reaction-mechanism','material-structure','molecular-concept','geo-workflow','geo-layers','terrain-concept','engineering-section','engineering-assembly','engineering-system','building-concept','landscape-plan','building-layers','network-architecture','ml-workflow','attention-mechanism','cell-mechanism','experimental-protocol','biomolecule-network','circuit-block','circuit-concept','pcb-structure','stat-study-design','stat-distribution','stat-causal','control-loop','industrial-process','automation-sequence'])assert.ok(choices.some(item=>item.id===id),'旧草稿类型丢失：'+id);
 assert.equal(new Set(choices.map(item=>item.id)).size,choices.length);assert.ok(choices.length>=266);
 for(const group of groups){assert.ok(group.families.length>=4);assert.deepEqual(group.families.flatMap(family=>family.items).map(item=>item.id),group.items.map(item=>item.id));}
});

test('every professional scene can be submitted and recovered with its own immutable category/type selection',()=>{
 for(const choice of researchFigureChoices('professional')){
  const form={...baseForm(),title:'用户自定义作品名',figureType:choice.id},snapshot=researchDrawingSnapshot(form,'professional');
  assert.equal(snapshot.context.categoryId,choice.categoryId);assert.equal(snapshot.context.figureType,choice.id);assert.equal(snapshot.title,'用户自定义作品名');
  const recovered=normalizeResearchDrawingDraft({version:1,form,jobState:{snapshot}},'professional');assert.equal(recovered.form.figureType,choice.id);assert.equal(recovered.jobState.snapshot.context.categoryId,choice.categoryId);
 }
 assert.throws(()=>researchDrawingSnapshot({...baseForm(),figureType:'unknown-software-scene'},'professional'),/有效/);
});

test('professional search understands software/domain/scene combinations and clears without expanding the full catalog',async t=>{
 const f=fixture(t,{mode:'professional'});await f.mount.ready;const visible=()=>[...f.container.querySelectorAll('[data-rd-figure]')].filter(button=>!button.hidden);
 f.enter('[data-rd-type-search]','PyTorch 网络');assert.equal(visible().length,1);assert.match(visible()[0].textContent,/PyTorch - 网络结构/);assert.ok(f.container.querySelector('[data-rd-group="machine-learning"]').open);assert.ok(f.container.querySelector('[data-rd-family="pytorch"]').open);
 visible()[0].click();f.enter('[data-rd-type-search]','');assert.equal(visible().length,researchFigureChoices('professional').length);assert.equal(f.container.querySelector('[data-rd-search-result]').hidden,true);assert.ok(f.container.querySelector('[data-rd-family="pytorch"]').open);assert.equal(f.container.querySelector('[data-rd-family="biorender"]').open,false);// Selection needs no generation or quote.
 f.click('[data-rd-example]');assert.equal(f.mount.getSnapshot().context.figureType,'pytorch-01');assert.match(f.mount.getSnapshot().text,/网络结构/);assert.equal(f.requests.filter(row=>row.path==='/tool-runs/quote').length,0);
 f.enter('[data-rd-type-search]','not-a-real-figure');assert.equal(visible().length,0);assert.match(f.container.querySelector('[data-rd-search-result]').textContent,/没有匹配/);assert.equal(f.container.querySelectorAll('[data-rd-group]:not([hidden])').length,0);
 const imagej=researchFigureChoices('professional').find(item=>item.familyLabel==='ImageJ');assert.equal(researchFigureMatches(imagej,'生物医学 ImageJ'),true);assert.equal(researchFigureMatches(imagej,'材料'),false);
});


test('drawing double-clicks while checking usage cannot submit duplicate jobs',async t=>{
 let release;const f=fixture(t,{beforeApi:async path=>{if(path==='/tool-runs/quote')await new Promise(resolve=>release=resolve);}});await f.mount.ready;f.fill();f.click('[data-rd-generate]');await until(()=>!!release);f.click('[data-rd-generate]');await new Promise(resolve=>setTimeout(resolve,10));release();await until(()=>!!f.container.querySelector('[data-tj-apply]'));assert.equal(f.requests.filter(row=>row.path==='/tool-runs/quote').length,1);assert.equal(f.requests.filter(row=>row.path==='/tool-runs/jobs'&&row.data).length,1);assert.equal(f.container.querySelector('[data-tj-consent]'),null);
});

test('professional image generation directly submits the chosen scene once',async t=>{
 const f=fixture(t,{mode:'professional'});await f.mount.ready;f.click('[data-rd-figure="cell-mechanism"]');f.click('[data-rd-example]');f.click('[data-rd-generate]');await until(()=>!!f.container.querySelector('[data-tj-apply]'));const starts=f.requests.filter(row=>row.path==='/tool-runs/jobs'&&row.data);assert.equal(starts.length,1);assert.equal(starts[0].data.operation,'image');assert.equal(starts[0].data.snapshot.mode,'professional');assert.equal(starts[0].data.snapshot.context.figureType,'cell-mechanism');assert.equal(starts[0].data.consent,true);assert.equal(f.container.querySelector('[data-tj-start]'),null);
});
