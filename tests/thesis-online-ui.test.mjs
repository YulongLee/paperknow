import {projectReference} from '../dist/workspace/project-directory.mjs';
import {normalizeThesisSnapshot} from '../backend/thesis-model.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountThesisStage,mountOnlineThesis,mountThesisLibrary,disposeOnlineThesis,thesisOnlineHasWork,thesisOnlineSessionChanged,validThesisQuote,thesisDocumentText} from '../dist/workspace/thesis-online.mjs';
import {thesisSnapshotFromDraft} from '../dist/workspace/writing-model.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const settle=async()=>{for(let i=0;i<5;i++)await tick();};
const snapshot=()=>({title:'真实研究',profile:{level:'博士',discipline:'物理学',language:'中文',targetWords:8000,method:'实验记录与文献分析',researchQuestion:'材料如何变化'},materials:[{id:'m1',name:'实验笔记',text:'真实实验记录，待自行核对。'.repeat(12),purpose:'研究过程',confirmed:true}],references:[{id:'r1',title:'用户导入文献',sourceLabel:'本地题录，未核验',confirmed:true}],outline:[{id:'c1',title:'第一章 背景',targetWords:4000},{id:'c2',title:'第二章 讨论',targetWords:4000}]});
const thesis=(overrides={})=>({id:'t1',version:1,title:'真实研究',profile:snapshot().profile,snapshot:snapshot(),outline:snapshot().outline,status:'draft',job:null,chapters:[{id:'c1',title:'第一章 背景',version:0,status:'pending',text:'',sourceIds:[]},{id:'c2',title:'第二章 讨论',version:0,status:'pending',text:'',sourceIds:[]}],...overrides});
const quote=()=>({type:'agent',source:'credits',title:'论文分章生成',token:'quote-token',creditCost:10,expiresAt:new Date(Date.now()+60000).toISOString()});
function fixture({item=thesis(),user={id:'u1'},cap={ready:true},handler}={}){
 disposeOnlineThesis();const dom=new JSDOM('<div class="breadcrumb"><strong></strong></div><main class="dashboard"></main>',{url:'https://example.test/workspace.html#thesis/t1'});
 for(const key of ['window','document','location','AbortController'])globalThis[key]=dom.window[key];
 dom.window.confirm=()=>true;let record=structuredClone(item);const calls=[];
 const api=async(path,data)=>{calls.push({path,data});if(handler){const handled=await handler(path,data);if(handled!==undefined)return handled;}
  if(path==='/auth/me')return {user};if(path==='/capabilities')return {thesis:cap};if(path==='/theses/t1/quote')return quote();
  if(path==='/theses'&&data){record=thesis({snapshot:data.snapshot,profile:data.snapshot.profile,projectId:data.projectId||null});return {item:structuredClone(record)};}
  if(path==='/theses')return {items:[structuredClone(record)]};if(path==='/theses/t1'&&!data)return {item:structuredClone(record)};
  if(path==='/theses/t1/generate'||path==='/theses/t1/resume'){record={...record,version:record.version+1,status:'queued',job:{status:'queued',completedSections:0,totalSections:3}};return {item:structuredClone(record)};}
  if(path==='/theses/t1/cancel'){record={...record,version:record.version+1,status:'cancelled',job:{status:'cancelled',canResume:true,completedSections:1,totalSections:3}};return {item:structuredClone(record)};}
  if(path==='/theses/t1'&&data){record={...record,version:record.version+1,status:'draft',snapshot:data.snapshot,profile:data.snapshot.profile,...(Object.hasOwn(data,'projectId')?{projectId:data.projectId}:{})};return {item:structuredClone(record)};}
  if(path==='/theses/t1/chapters/c1'){record={...record,version:record.version+1,chapters:record.chapters.map(c=>c.id==='c1'?{...c,text:data.text,version:c.version+1,status:'saved'}:c)};return {item:structuredClone(record)};}
  throw Error('Unexpected request '+path);
 };
 const ctx={api,session:async()=>user?{status:'ready',user}:{status:'guest',user:null}};
 return {dom,ctx,calls,setItem:value=>{record=structuredClone(value);},$:selector=>document.querySelector(selector),close(){disposeOnlineThesis();dom.window.close();}};
}
function input(f,selector,value){const element=f.$(selector);element.value=value;element.dispatchEvent(new window.Event('input',{bubbles:true}));}
test('snapshot conversion preserves all research profiles, materials and imported manual body without binding a local project',()=>{
 for(const degree of ['专科','本科','硕士','博士','科研人员']){
  const value=thesisSnapshotFromDraft({title:'研究题目',degree,major:'艺术学',method:'作品分析',researchQuestion:'研究问题',projectId:'local-project',language:'英文',targetWords:1000,knowledgeFiles:[{id:'m1',name:'笔记',purpose:'方法依据',text:'原始材料'}],outlineRows:[{id:'c1',title:'第一章',level:1,words:0},{id:'s1',title:'1.1 方法',level:2,words:1000}],bodySections:[{id:'c1',title:'第一章',text:'手动正文'}]});
  assert.equal(value.profile.level,degree==='科研人员'?'研究工作者':degree);assert.equal(value.profile.language,'English');assert.equal(value.outline[0].targetWords,1000);assert.equal(value.materials[0].purpose,'方法依据');assert.equal(value.bodySections[0].text,'手动正文');assert.equal(value.projectId,undefined);
 }
 assert.throws(()=>thesisSnapshotFromDraft({targetWords:80001}),/80,000/);
 const local={title:'来源编号验证',targetWords:1000,outlineRows:[{id:'c1',title:'第一章',level:1,words:1000}],knowledgeFiles:[{id:'same',name:'材料一',text:'正文一'},{id:'same',name:'材料二',text:'正文二'},{name:'未设置编号',text:'正文三'}],writingReferences:[{id:'same',title:'文献一'},{id:'编号 / 💡',title:'文献二'}]},a=thesisSnapshotFromDraft(local),b=thesisSnapshotFromDraft(local);
 const ids=[...a.materials,...a.references].map(row=>row.id);assert.equal(new Set(ids).size,ids.length);assert.deepEqual(ids,[...b.materials,...b.references].map(row=>row.id));assert.ok(ids.every(id=>/^[\p{L}\p{N}_.:-]+$/u.test(id)&&id.length<=100));
});
test('guest can keep manual drafting; session errors never appear as a signed-out account',async()=>{
 const f=fixture({user:null});const stop=mountThesisStage({container:f.$('.dashboard'),getSnapshot:snapshot,ctx:f.ctx,onManual:()=>{}});await stop.ready;
 assert.match(f.$('.dashboard').textContent,/登录后保存到账户/);assert.ok(f.$('[data-thesis-manual]'));assert.equal(f.calls.filter(c=>c.data).length,0);f.close();
 const next=fixture();next.ctx.session=async()=>({status:'error'});const done=mountOnlineThesis({id:'t1',container:next.$('.dashboard'),ctx:next.ctx});await done.ready;assert.match(next.$('.dashboard').textContent,/无法核对登录状态/);assert.equal(next.$('a[href^="/auth.html"]'),null);next.close();
});
test('cloud save does not generate; model generation requires a valid quote and explicit source consent',async()=>{
 const f=fixture();const stop=mountThesisStage({container:f.$('.dashboard'),getSnapshot:snapshot,ctx:f.ctx});await stop.ready;
 f.$('[data-thesis-create]').click();await settle();assert.equal(f.calls.filter(c=>c.path==='/theses'&&c.data).length,1);assert.equal(f.calls.filter(c=>/generate/.test(c.path)).length,0);
 f.$('[data-thesis-quote]').click();await settle();assert.match(f.$('.thesis-charge').textContent,/10 科研积分/);assert.equal(f.$('[data-thesis-consent]').checked,true);assert.equal(f.$('[data-thesis-start]').disabled,false);assert.equal(f.calls.filter(c=>/generate/.test(c.path)).length,0);
 f.$('[data-thesis-start]').click();await settle();
 const request=f.calls.find(c=>c.path==='/theses/t1/generate');assert.deepEqual(Object.keys(request.data).sort(),['billingToken','clientKey','consent','version']);assert.equal(request.data.billingToken,'quote-token');assert.equal(request.data.consent,true);assert.match(f.$('.thesis-progress').textContent,/排队中/);assert.equal(f.$('[data-thesis-editor]').disabled,false);assert.equal(f.$('[data-thesis-editor]').readOnly,true);f.close();
});
test('missing research evidence blocks quoting and saving research materials creates an explicit new snapshot',async()=>{
 const empty=thesis({profile:{...snapshot().profile,method:''},snapshot:{...snapshot(),profile:{...snapshot().profile,method:''},materials:[]}}),f=fixture({item:empty});const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;
 f.$('[data-thesis-quote]').click();await settle();assert.equal(f.calls.filter(c=>c.path==='/theses/t1/quote').length,0);assert.match(f.$('[data-thesis-notice]').textContent,/含正文的研究材料/);
 input(f,'#thesis-research-method','文献分析');input(f,'#thesis-research-supplement','用户提供的原始证据');f.$('[data-thesis-save-research]').click();await settle();const write=f.calls.find(c=>c.path==='/theses/t1'&&c.data);assert.equal(write.data.snapshot.profile.method,'文献分析');assert.equal(write.data.snapshot.materials[0].confirmed,true);assert.equal(write.data.snapshot.materials[0].text,'用户提供的原始证据');f.close();
});
test('optional blank profile reaches the quote with the generation checkbox ready and still waits for an explicit start',async()=>{
 const value=snapshot();value.profile={level:'本科',language:'中文',targetWords:8000,discipline:'',major:'',direction:'',researchQuestion:'',method:''};
 const f=fixture({item:thesis({profile:value.profile,snapshot:value})});try{const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;assert.match(f.$('.thesis-sources').textContent,/暂未补充（可选）/);f.$('[data-thesis-quote]').click();await settle();assert.equal(f.calls.filter(c=>c.path==='/theses/t1/quote').length,1);assert.equal(f.$('[data-thesis-consent]').checked,true);assert.equal(f.$('[data-thesis-start]').disabled,false);assert.equal(f.calls.filter(c=>/generate/.test(c.path)).length,0);const consent=f.$('[data-thesis-consent]');consent.checked=true;consent.dispatchEvent(new window.Event('change'));f.$('[data-thesis-start]').click();await settle();assert.equal(f.calls.filter(c=>c.path==='/theses/t1/generate').length,1);}finally{f.close();}
});
test('blank local optional fields remain empty in an account snapshot instead of receiving a fabricated discipline',()=>{
 const value=thesisSnapshotFromDraft({title:'研究题目',degree:'本科',outlineRows:[{id:'c1',level:1,title:'第一章 研究背景',words:8000}]});for(const key of ['discipline','major','direction','researchQuestion','method'])assert.equal(value.profile[key],'');
});
test('invalid and expired quotes never enable a generation submission',async()=>{
 assert.equal(validThesisQuote({...quote(),expiresAt:new Date(0).toISOString()}),false);assert.equal(validThesisQuote({...quote(),creditCost:0}),false);assert.equal(validThesisQuote({...quote(),source:'membership',creditCost:0}),true);
 const f=fixture({handler:path=>path==='/theses/t1/quote'?{...quote(),expiresAt:new Date(0).toISOString()}:undefined});const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;f.$('[data-thesis-quote]').click();await settle();assert.equal(f.$('[data-thesis-start]'),null);assert.match(f.$('[data-thesis-notice]').textContent,/报价/);f.close();
});
test('metadata-only sources cannot request a billable generation quote even when research method is present',async()=>{
 const f=fixture({item:thesis({snapshot:{...snapshot(),materials:[]}})});const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;f.$('[data-thesis-quote]').click();await settle();assert.equal(f.calls.some(call=>call.path==='/theses/t1/quote'),false);assert.match(f.$('[data-thesis-notice]').textContent,/仅有文献题录不足以生成论文/);assert.ok(f.$('[data-thesis-save-research]'));f.close();
});
test('a quote that expires after display still cannot start generation after the user consents',async()=>{
 const f=fixture(),now=Date.now;try{const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;f.$('[data-thesis-quote]').click();await settle();const consent=f.$('[data-thesis-consent]');consent.checked=true;consent.dispatchEvent(new window.Event('change'));Date.now=()=>now()+120000;f.$('[data-thesis-start]').click();await settle();assert.equal(f.calls.some(call=>call.path.endsWith('/generate')),false);assert.match(f.$('[data-thesis-notice]').textContent,/重新确认费用/);assert.equal(f.$('.thesis-charge'),null);}finally{Date.now=now;f.close();}
});
test('export uses the server full text or only confirmed cited sources in a partial response',()=>{
 const value=thesis({chapters:[{id:'c1',title:'第一章',text:'真实正文',sourceIds:['m1','r-used','r-unconfirmed']}]});value.snapshot.references=[{id:'r-used',title:'已引用的来源',confirmed:true},{id:'r-unused',title:'未引用题录',confirmed:true},{id:'r-unconfirmed',title:'未确认来源',confirmed:false}];
 assert.match(thesisDocumentText(value),/已引用的来源/);assert.match(thesisDocumentText(value),/实验笔记/);assert.doesNotMatch(thesisDocumentText(value),/未引用题录|未确认来源/);assert.equal(thesisDocumentText({...value,fullText:'服务端整理的真实全文与来源'}),'服务端整理的真实全文与来源');
});
test('refresh preserves unsaved text, optimistic save uses the current version and no local unlock gates exports',async()=>{
 const original=thesis({status:'completed',chapters:[{id:'c1',title:'第一章 <script>恶意</script>',text:'账户原文',version:1,status:'saved',sourceIds:['m1']}]}),f=fixture({item:original});const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;
 assert.equal(f.$('script'),null);assert.equal(f.$('#thesis-online-docx').disabled,false);input(f,'[data-thesis-editor]','我修改的新正文');assert.equal(thesisOnlineHasWork(),true);assert.equal(f.$('#thesis-online-docx').disabled,true);
 f.setItem({...original,version:3});f.$('[data-thesis-refresh]').click();await settle();assert.equal(f.$('[data-thesis-editor]').value,'我修改的新正文');f.$('[data-thesis-save-chapter]').click();await settle();const write=f.calls.find(c=>c.path==='/theses/t1/chapters/c1');assert.deepEqual(write.data,{version:3,text:'我修改的新正文'});assert.equal(thesisOnlineHasWork(),false);assert.equal(f.$('#thesis-online-pdf').disabled,false);assert.match(thesisDocumentText({...original,chapters:[{title:'第一章',text:'真实正文'}]}),/真实正文/);f.close();
});
test('chapter conflicts retain manual input and never automatically overwrite newer account text',async()=>{
 const original=thesis({chapters:[{id:'c1',title:'第一章',version:1,status:'saved',text:'旧正文'}]}),f=fixture({item:original,handler:(path,data)=>{if(path.includes('/chapters/')&&data)throw Object.assign(Error('冲突'),{status:409});}});const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;input(f,'[data-thesis-editor]','尚未保存的文字');f.$('[data-thesis-save-chapter]').click();await settle();assert.equal(f.$('[data-thesis-editor]').value,'尚未保存的文字');assert.match(f.$('[data-thesis-notice]').textContent,/版本已更新/);assert.equal(thesisOnlineHasWork(),true);f.close();
});
test('a chapter history preview stays read-only until explicitly loaded and saved as a new version',async()=>{
 const original=thesis({status:'completed',chapters:[{id:'c1',title:'第一章',version:3,status:'saved',text:'最新账户正文'}]}),f=fixture({item:original,handler:path=>{
  if(path==='/theses/t1/chapters/c1/versions')return {items:[{id:'v3',version:3,source:'manual',createdAt:'2026-10-17T00:00:00Z'},{id:'v1',version:1,source:'agent',createdAt:'2026-10-16T00:00:00Z'}],limit:50};
  if(path==='/theses/t1/chapters/c1/versions/1')return {item:{id:'v1',chapterId:'c1',version:1,source:'agent',text:'较早的真实正文 <img src=x onerror=1>',sourceIds:['m1'],createdAt:'2026-10-16T00:00:00Z'}};
 }});const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;
 f.$('[data-thesis-history]').click();await settle();assert.ok(f.$('.thesis-history-list'));
 f.$('[data-thesis-history-version="1"]').click();await settle();assert.match(f.$('.thesis-history-preview').textContent,/较早的真实正文/);assert.equal(f.$('img'),null);assert.equal(f.$('[data-thesis-editor]').value,'最新账户正文');assert.equal(f.calls.filter(c=>c.data).length,0);
 f.$('[data-thesis-history-use]').click();assert.match(f.$('[data-thesis-editor]').value,/较早的真实正文/);assert.equal(thesisOnlineHasWork(),true);assert.equal(f.calls.filter(c=>c.data).length,0);f.$('[data-thesis-save-chapter]').click();await settle();assert.equal(f.calls.find(c=>c.path==='/theses/t1/chapters/c1'&&c.data).data.text,'较早的真实正文 <img src=x onerror=1>');f.close();
});
test('stop and resume are separate explicit actions, failures do not automatically submit generation',async()=>{
 const f=fixture({item:thesis({status:'running',job:{status:'running',completedSections:1,totalSections:3}})});const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;f.$('[data-thesis-cancel]').click();await settle();assert.equal(f.calls.filter(c=>c.path.endsWith('/cancel')).length,1);assert.ok(f.$('[data-thesis-quote="resume"]'));assert.equal(f.calls.filter(c=>c.path.endsWith('/resume')).length,0);
 f.$('[data-thesis-quote="resume"]').click();await settle();const consent=f.$('[data-thesis-consent]');consent.checked=true;consent.dispatchEvent(new window.Event('change'));f.$('[data-thesis-start]').click();await settle();assert.equal(f.calls.filter(c=>c.path.endsWith('/resume')).length,1);f.close();
});
test('a failed chapter exposes genuinely completed sections without replacing the saved chapter or claiming completion',async()=>{
 const f=fixture({item:thesis({status:'needs_materials',job:{status:'needs_materials',stage:'agent_tools',completedSections:1,totalSections:3,canResume:true,missingEvidence:['缺少真实访谈记录']},chapters:[{id:'c1',title:'第一章',text:'此前研究资料生成的整章',version:2,status:'saved',stale:true,totalSections:3}],sections:[{id:'u1',chapterId:'c1',status:'completed',text:'本次已完成的真实小节 <script>不执行</script>'},{id:'u2',chapterId:'c1',status:'failed',text:''}]})});const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;
 assert.match(f.$('.thesis-completed-sections').textContent,/本次已完成的真实小节/);assert.match(f.$('.thesis-completed-sections').textContent,/尚未全部完成/);assert.equal(f.$('[data-thesis-editor]').value,'此前研究资料生成的整章');assert.equal(f.$('script'),null);assert.match(f.$('.thesis-progress').textContent,/待补研究证据/);assert.match(f.$('.thesis-progress').textContent,/缺少真实访谈记录/);assert.doesNotMatch(f.$('.thesis-progress').textContent,/agent_tools|needs_materials/);assert.equal(f.calls.some(call=>call.data),false);f.close();
});
test('switching account before saving prevents an old account draft from being submitted',async()=>{
 let user={id:'u1'};const f=fixture({handler:path=>path==='/auth/me'?{user}:undefined});const stop=mountThesisStage({container:f.$('.dashboard'),ctx:f.ctx,getSnapshot:snapshot});await stop.ready;user={id:'u2'};f.$('[data-thesis-create]').click();await settle();assert.equal(f.calls.filter(c=>c.path==='/theses'&&c.data).length,0);assert.match(f.$('.dashboard').textContent,/账户已切换/);f.close();
});
test('account library reads real server items and session change clears private content',async()=>{
 const f=fixture({item:thesis({title:'私人论文 <img src=x onerror=1>'})});const stop=mountThesisLibrary({ctx:f.ctx});await stop.ready;assert.equal(f.$('.thesis-library a').getAttribute('href'),'#thesis/t1');assert.equal(f.$('img'),null);thesisOnlineSessionChanged(null);assert.doesNotMatch(f.$('.dashboard').textContent,/私人论文/);f.close();
});
test('a delayed response after disposal cannot repaint another route',async()=>{
 let resolve;const f=fixture({handler:path=>path==='/theses/t1'?new Promise(done=>{resolve=done;}):undefined});const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await settle();stop();f.$('.dashboard').innerHTML='<h1>其他页面</h1>';resolve({item:thesis()});await stop.ready;assert.equal(f.$('.dashboard').textContent,'其他页面');f.close();
});

test('chapter actions and status refresh preserve keyboard focus and open research disclosure',async()=>{
 const f=fixture(),stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;
 const second=f.$('[data-thesis-chapter="c2"]');second.focus();second.click();
 assert.equal(document.activeElement.getAttribute('data-thesis-chapter'),'c2');
 f.$('.thesis-sources').open=true;
 const refresh=f.$('[data-thesis-refresh]');refresh.focus();refresh.click();await settle();
 assert.equal(document.activeElement.hasAttribute('data-thesis-refresh'),true);assert.equal(f.$('.thesis-sources').open,true);
 f.close();
});


test('legacy full-text exports render citation labels and inventories without changing stored chapter markers',()=>{
 const original='已有研究指出这一现象 [source:r1]。用户观察见 [source:m1]；未识别来源 [source:removed-private-id]。';
 const value=thesis({title:'来源呈现测试',fullText:'旧版服务端全文 '+original,chapters:[{id:'c1',title:'第一章',text:original,sourceIds:['r1','m1','removed-private-id']}]});
 value.snapshot.references=[{id:'r1',title:'经用户确认的参考文献',authors:'研究者甲',year:'2025',confirmed:true},{id:'unused',title:'未使用文献',confirmed:true}];
 const raw=structuredClone(value),result=thesisDocumentText(value);
 assert.match(result,/已有研究指出这一现象 \[1\]/);assert.match(result,/用户观察见 \[材料1\]/);assert.match(result,/未识别来源 \[来源待核对\]/);assert.match(result,/经用户确认的参考文献/);assert.match(result,/实验笔记/);assert.doesNotMatch(result,/\[source:|removed-private-id|未使用文献|旧版服务端全文/);assert.deepEqual(value,raw);
});

test('an already formatted server document passes through verbatim and fallback uses citation presentation',()=>{
 const value=thesis({chapters:[{id:'c1',title:'第一章',text:'参考研究 [source:r1] 与材料 [source:m1]。',sourceIds:['r1','m1']}]});
 value.snapshot.references=[{id:'r1',title:'研究参考文献',confirmed:true}];
 const formatted='服务端已排版正文\n\n第一章\n保留原有内容与空格  [1]';assert.equal(thesisDocumentText({...value,fullText:formatted}),formatted);
 const fallback=thesisDocumentText(value);assert.match(fallback,/参考研究 \[1\] 与材料 \[材料1\]/);assert.match(fallback,/研究参考文献/);assert.match(fallback,/实验笔记/);assert.doesNotMatch(fallback,/\[source:/);
});


test('creating an account snapshot normalizes server defaults without falsely requiring a resync',async()=>{
 const local=snapshot();local.requirements={contentMode:'text',researchPlan:{text:'拟采用文献分析并由用户核对',origin:'ai',status:'proposed',jobId:null}};local.bodySections=[{id:'c1',text:'独立手动正文'}];local.projectId='browser-project';
 const f=fixture({handler:(path,data)=>{if(path==='/theses'&&data){const normalized=normalizeThesisSnapshot(data.snapshot),saved=thesis({snapshot:normalized,profile:normalized.profile,outline:normalized.outline});f.setItem(saved);return {item:saved};}}});
 try{const stop=mountThesisStage({container:f.$('.dashboard'),getSnapshot:()=>structuredClone(local),ctx:f.ctx});await stop.ready;f.$('[data-thesis-create]').click();await settle();assert.equal(f.$('.thesis-snapshot-drift'),null);assert.equal(f.$('[data-thesis-quote]').disabled,false);f.$('[data-thesis-quote]').click();await settle();assert.ok(f.$('[data-thesis-consent]'));assert.equal(f.$('[data-thesis-consent]').checked,true);assert.equal(f.$('[data-thesis-start]').disabled,false);assert.equal(f.calls.some(row=>row.path.endsWith('/generate')),false);}finally{f.close();}
});

test('a changed step-four outline prominently blocks quotations until explicit versioned sync and renewed consent',async()=>{
 let local=snapshot(),confirmations=0;const f=fixture();try{const stop=mountThesisStage({id:'t1',container:f.$('.dashboard'),getSnapshot:()=>structuredClone(local),ctx:f.ctx});await stop.ready;assert.equal(f.$('.thesis-snapshot-drift'),null);local.outline[0].title='第一章 更新后的研究问题';local.outline[0].targetWords=5000;local.outline[1].targetWords=3000;
 f.$('[data-thesis-refresh]').click();await settle();assert.match(f.$('.thesis-snapshot-drift').textContent,/前四步与账户信息不一致/);assert.match(f.$('.thesis-snapshot-drift').textContent,/论文提纲与字数分配/);assert.equal(f.$('[data-thesis-sync-primary]').closest('details'),null);assert.equal(f.$('[data-thesis-quote]').disabled,true);f.$('[data-thesis-quote]').dispatchEvent(new window.MouseEvent('click',{bubbles:true}));await settle();assert.equal(f.calls.some(row=>row.path==='/theses/t1/quote'),false);
 window.confirm=()=>{confirmations++;return true;};f.$('[data-thesis-sync-primary]').click();await settle();assert.equal(confirmations,1);const synced=f.calls.find(row=>row.path==='/theses/t1'&&row.data);assert.equal(synced.data.version,1);assert.equal(synced.data.snapshot.outline[0].title,'第一章 更新后的研究问题');assert.equal(synced.data.snapshot.outline[0].targetWords,5000);assert.equal(f.$('.thesis-snapshot-drift'),null);assert.equal(f.calls.some(row=>row.path.endsWith('/generate')),false);f.$('[data-thesis-quote]').click();await settle();assert.equal(f.$('[data-thesis-start]').disabled,false);const consent=f.$('[data-thesis-consent]');consent.checked=true;consent.dispatchEvent(new window.Event('change'));f.$('[data-thesis-start]').click();await settle();assert.equal(f.calls.filter(row=>row.path.endsWith('/generate')).length,1);assert.equal(f.calls.find(row=>row.path.endsWith('/generate')).data.version,2);
 }finally{f.close();}
});

test('account-only research additions stay intact unless the user explicitly chooses to replace them',async()=>{
 const local=snapshot(),saved=snapshot();saved.materials.push({id:'account-only',name:'账户独立补充',text:'独立补充的真实资料',confirmed:true});const f=fixture({item:thesis({version:6,snapshot:saved})});
 try{const stop=mountThesisStage({id:'t1',container:f.$('.dashboard'),getSnapshot:()=>structuredClone(local),ctx:f.ctx});await stop.ready;assert.equal(f.$('[data-thesis-quote]').disabled,true);assert.match(f.$('.thesis-snapshot-drift').textContent,/账户中独立补充/);f.$('[data-thesis-use-account]').click();assert.match(f.$('.thesis-account-choice').textContent,/本次使用账户已保存的信息/);assert.equal(f.calls.some(row=>row.data),false);f.$('[data-thesis-quote]').click();await settle();const consent=f.$('[data-thesis-consent]');consent.checked=true;consent.dispatchEvent(new window.Event('change'));f.$('[data-thesis-start]').click();await settle();assert.equal(f.calls.find(row=>row.path.endsWith('/generate')).data.version,6);assert.equal(f.calls.some(row=>row.path==='/theses/t1'&&row.data),false);assert.match(f.$('.thesis-sources').textContent,/账户独立补充/);
 }finally{f.close();}
});

test('an account-version change invalidates an earlier choice to use account information',async()=>{
 const local=snapshot(),saved=snapshot();saved.profile.method='账户补充方法';const f=fixture({item:thesis({snapshot:saved,profile:saved.profile})});
 try{const stop=mountThesisStage({id:'t1',container:f.$('.dashboard'),getSnapshot:()=>structuredClone(local),ctx:f.ctx});await stop.ready;f.$('[data-thesis-use-account]').click();assert.equal(f.$('[data-thesis-quote]').disabled,false);f.setItem(thesis({version:2,snapshot:saved,profile:saved.profile}));f.$('[data-thesis-refresh]').click();await settle();assert.ok(f.$('[data-thesis-use-account]'));assert.equal(f.$('[data-thesis-quote]').disabled,true);assert.equal(f.$('.thesis-account-choice'),null);assert.equal(f.calls.some(row=>row.data),false);
 }finally{f.close();}
});

test('local information changed after quotation cannot reuse stale consent to start generation',async()=>{
 let local=snapshot();const f=fixture();try{const stop=mountThesisStage({id:'t1',container:f.$('.dashboard'),getSnapshot:()=>structuredClone(local),ctx:f.ctx});await stop.ready;f.$('[data-thesis-quote]').click();await settle();const consent=f.$('[data-thesis-consent]');local.outline[0].title='报价后修改的新章节';consent.checked=true;consent.dispatchEvent(new window.Event('change'));assert.equal(f.$('[data-thesis-start]').disabled,true);f.$('[data-thesis-start]').dispatchEvent(new window.MouseEvent('click',{bubbles:true}));await settle();assert.equal(f.calls.some(row=>row.path.endsWith('/generate')),false);assert.match(f.$('[data-thesis-notice]').textContent,/前四步已更新/);assert.ok(f.$('[data-thesis-sync-primary]'));assert.equal(f.$('[data-thesis-start]'),null);
 }finally{f.close();}
});

test('a failed snapshot read blocks generation instead of assuming that the previous account outline is current',async()=>{
 const f=fixture();try{const stop=mountThesisStage({id:'t1',container:f.$('.dashboard'),getSnapshot:()=>{throw Error('新提纲中尚有空标题');},ctx:f.ctx});await stop.ready;assert.match(f.$('.thesis-snapshot-drift').textContent,/新提纲中尚有空标题/);assert.equal(f.$('[data-thesis-quote]').disabled,true);assert.equal(f.$('[data-thesis-use-account]'),null);f.$('[data-thesis-quote]').dispatchEvent(new window.MouseEvent('click',{bubbles:true}));await settle();assert.equal(f.calls.some(row=>row.path==='/theses/t1/quote'),false);assert.equal(f.calls.some(row=>row.path.endsWith('/generate')),false);
 }finally{f.close();}
});

test('changes while a quotation is being fetched invalidate that quotation before it can be confirmed',async()=>{
 let local=snapshot(),resolveQuote;const f=fixture({handler:path=>path==='/theses/t1/quote'?new Promise(resolve=>{resolveQuote=resolve;}):undefined});try{const stop=mountThesisStage({id:'t1',container:f.$('.dashboard'),getSnapshot:()=>structuredClone(local),ctx:f.ctx});await stop.ready;f.$('[data-thesis-quote]').click();await settle();assert.ok(resolveQuote);local.profile.targetWords=9000;resolveQuote(quote());await settle();assert.equal(f.$('[data-thesis-consent]'),null);assert.equal(f.calls.some(row=>row.path.endsWith('/generate')),false);assert.ok(f.$('[data-thesis-sync-primary]'));
 }finally{f.close();}
});


test('cancelling snapshot synchronization preserves the account version and leaves changed local information blocked',async()=>{
 const local=snapshot();local.outline[0].title='尚未同步的新提纲';const f=fixture();try{const stop=mountThesisStage({id:'t1',container:f.$('.dashboard'),getSnapshot:()=>structuredClone(local),ctx:f.ctx});await stop.ready;window.confirm=()=>false;f.$('[data-thesis-sync-primary]').click();await settle();assert.equal(f.calls.some(row=>row.path==='/theses/t1'&&row.data),false);assert.match(f.$('.thesis-summary').textContent,/真实研究/);assert.equal(f.$('[data-thesis-quote]').disabled,true);assert.ok(f.$('[data-thesis-use-account]'));assert.equal(f.calls.some(row=>row.path.endsWith('/generate')),false);
 }finally{f.close();}
});

test('an optimistic conflict during snapshot synchronization retains the unsynced choice and never retries generation',async()=>{
 const local=snapshot();local.outline[0].title='本地新提纲';const f=fixture({handler:(path,data)=>path==='/theses/t1'&&data?Promise.reject(Object.assign(Error('账户版本冲突'),{status:409})):undefined});try{const stop=mountThesisStage({id:'t1',container:f.$('.dashboard'),getSnapshot:()=>structuredClone(local),ctx:f.ctx});await stop.ready;f.$('[data-thesis-sync-primary]').click();await settle();assert.match(f.$('[data-thesis-notice]').textContent,/内容版本已更新/);assert.equal(f.calls.filter(row=>row.path==='/theses/t1'&&row.data).length,1);assert.equal(f.$('[data-thesis-quote]').disabled,true);assert.ok(f.$('[data-thesis-use-account]'));assert.equal(f.calls.some(row=>row.path.endsWith('/generate')),false);
 }finally{f.close();}
});


test('a completed empty bibliography is labelled unused rather than pending, including legacy reference headings',async()=>{
 for(const reference of [{id:'refs',title:'参考文献',status:'pending',text:'',version:0},{id:'refs',title:'研究来源清单',kind:'references',status:'pending',text:'',version:0}]){
  const f=fixture({item:thesis({status:'completed',job:{status:'completed',completedSections:3,totalSections:3},chapters:[{id:'c1',title:'第一章',text:'引用真实私有研究材料 [source:m1]',sourceIds:['m1'],version:1,status:'saved'},reference]})});
  try{const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;const row=f.$('[data-thesis-chapter="refs"]');assert.match(row.textContent,/未编入文献/);assert.doesNotMatch(row.textContent,/待生成/);row.click();assert.match(f.$('.thesis-editor').textContent,/当前正文未引用选中题录/);assert.match(f.$('.thesis-editor').textContent,/未读取全文的题录不会冒充正文依据/);assert.match(f.$('[data-thesis-edit-state]').textContent,/未引用选中题录/);assert.equal(f.$('[data-thesis-editor]').value,'');assert.equal(f.calls.some(call=>call.data),false);assert.match(f.$('.thesis-progress').textContent,/已完成/);assert.equal(f.$('progress').value,100);}finally{f.close();}
 }
});

test('a pending bibliography remains pending while real generation is still running',async()=>{
 const f=fixture({item:thesis({status:'running',job:{status:'running',completedSections:2,totalSections:3},chapters:[{id:'refs',title:'参考文献',kind:'references',status:'pending',text:'',version:0}]})});try{const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;assert.match(f.$('[data-thesis-chapter="refs"]').textContent,/待生成/);assert.doesNotMatch(f.$('.thesis-editor').textContent,/当前正文未引用选中题录|未编入文献/);assert.equal(f.$('[data-thesis-editor]').readOnly,true);assert.equal(f.calls.some(call=>call.data),false);}finally{f.close();}
});

test('the chapter editor shows short source labels while local recovery and explicit account saves retain canonical IDs',async()=>{
 const raw='用户材料中的研究背景 [source:m1]；文献待核对 [source:r1]。',f=fixture({item:thesis({status:'completed',chapters:[{id:'c1',title:'第一章',version:1,status:'saved',text:raw,sourceIds:['m1','r1']}]})});try{const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;assert.equal(f.$('[data-thesis-editor]').value,'用户材料中的研究背景 〔材料1〕；文献待核对 〔文献1〕。');assert.match(f.$('.thesis-editor-citations').textContent,/材料1.*实验笔记/);assert.match(f.$('.thesis-editor-citations').textContent,/文献1.*用户导入文献.*仅题录，未读取全文/);assert.doesNotMatch(f.$('[data-thesis-editor]').value,/\[source:/);
 input(f,'[data-thesis-editor]',f.$('[data-thesis-editor]').value+' 人工补充及 〔材料99〕');assert.match(f.$('[data-thesis-notice]').textContent,/未关联来源的短标记/);const stored=JSON.parse(window.localStorage.getItem('paperknow-thesis-edits-v1:u1:t1'));assert.equal(stored.chapters[0].text,raw+' 人工补充及 〔材料99〕');assert.doesNotMatch(stored.chapters[0].text,/〔材料1〕|〔文献1〕/);f.$('[data-thesis-save-chapter]').click();await settle();assert.equal(f.calls.find(row=>row.path==='/theses/t1/chapters/c1'&&row.data).data.text,raw+' 人工补充及 〔材料99〕');
 }finally{f.close();}
});

test('recovered canonical chapter drafts follow their original source when account source order changes',async()=>{
 const raw='引用原有资料 [source:m1]。',original=thesis({chapters:[{id:'c1',title:'第一章',version:1,status:'saved',text:raw,sourceIds:['m1']}]}),f=fixture({item:original});try{const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;input(f,'[data-thesis-editor]',f.$('[data-thesis-editor]').value+' 保留手动修改');const newer=structuredClone(original);newer.version=2;newer.snapshot.materials.unshift({id:'m2',name:'另一份资料',text:'不同原文',confirmed:true});f.setItem(newer);f.$('[data-thesis-refresh]').click();await settle();assert.equal(f.$('[data-thesis-editor]').value,'引用原有资料 〔材料2〕。 保留手动修改');assert.match(f.$('.thesis-editor-citations').textContent,/材料2.*实验笔记/);f.$('[data-thesis-save-chapter]').click();await settle();const saved=f.calls.find(row=>row.path==='/theses/t1/chapters/c1'&&row.data);assert.equal(saved.data.version,2);assert.equal(saved.data.text,raw+' 保留手动修改');assert.doesNotMatch(saved.data.text,/source:m2/);
 }finally{f.close();}
});

test('a literal display-label collision keeps raw text intact and explains why the chapter is not transformed',async()=>{
 const raw='既有说明〔材料1〕，真实引用[source:m1]。',f=fixture({item:thesis({chapters:[{id:'c1',title:'第一章',version:1,status:'saved',text:raw,sourceIds:['m1']}]})});try{const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;assert.equal(f.$('[data-thesis-editor]').value,raw);assert.match(f.$('.thesis-editor').textContent,/为避免误关联，本章按原始文字显示/);input(f,'[data-thesis-editor]',raw+' 补充');f.$('[data-thesis-save-chapter]').click();await settle();assert.equal(f.calls.find(row=>row.path==='/theses/t1/chapters/c1'&&row.data).data.text,raw+' 补充');
 }finally{f.close();}
});

test('a manually saved draft remains a saved draft rather than being labelled as needing generation',async()=>{
 const f=fixture({item:thesis({status:'draft',job:{status:'completed',completedSections:3,totalSections:3},chapters:[{id:'c1',title:'第一章',text:'已手动修订并保存的完整正文',version:2,status:'saved'}]})});try{const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;assert.equal(f.$('.thesis-progress b').textContent,'草稿已保存');assert.equal(f.$('progress').value,100);assert.match(f.$('.thesis-progress').textContent,/下面为上次任务进度/);assert.equal(f.$('#thesis-online-docx').disabled,false);assert.equal(f.calls.some(call=>call.data),false);}finally{f.close();}
});


test('an unknown citation displays a clear unverified label without exposing its internal ID in the default editor',async()=>{
 const unknown='unknown-private-implementation-id',raw='尚需核对的依据 [source:'+unknown+']。',f=fixture({item:thesis({chapters:[{id:'c1',title:'第一章',version:1,status:'saved',text:raw,sourceIds:[unknown]}]})});try{const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;assert.equal(f.$('[data-thesis-editor]').value,'尚需核对的依据 〔待核对来源1〕。');assert.match(f.$('.thesis-editor').textContent,/未匹配到当前已保存的资料，请核对来源/);assert.doesNotMatch(f.$('.thesis-editor').textContent,/unknown-private-implementation-id/);input(f,'[data-thesis-editor]',f.$('[data-thesis-editor]').value+' 人工补充');f.$('[data-thesis-save-chapter]').click();await settle();assert.equal(f.calls.find(row=>row.path==='/theses/t1/chapters/c1'&&row.data).data.text,raw+' 人工补充');}finally{f.close();}
});


test('chapter navigation counts canonical prose without long source markers and updates unsaved edits in place',async()=>{
 const body='甲'.repeat(80)+' [source:m1]',original=thesis({chapters:[{id:'c1',title:'第一章',version:1,status:'saved',text:body,targetWords:60,sourceIds:['m1']},{id:'c2',title:'第二章',version:0,status:'pending',text:'',targetWords:40}]}),f=fixture({item:original});try{const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;assert.match(f.$('[data-thesis-chapter-state="c1"]').textContent,/正文 80字 \/ 目标 60字/);assert.match(f.$('[data-thesis-chapter-state="c2"]').textContent,/待生成.*目标 40字/);assert.doesNotMatch(f.$('.thesis-chapter-nav').textContent,/字符/);const editor=f.$('[data-thesis-editor]');input(f,'[data-thesis-editor]',editor.value+'乙乙');assert.equal(f.$('[data-thesis-editor]'),editor);assert.match(f.$('[data-thesis-chapter-state="c1"]').textContent,/本地编辑草稿.*正文 82字 \/ 目标 60字/);assert.equal(f.calls.some(row=>row.data),false);}finally{f.close();}
});

test('English chapter and completed-section previews use the same word count instead of raw character totals',async()=>{
 const text="We can't over-claim. [source:m1]",original=thesis({profile:{...snapshot().profile,language:'English'},status:'needs_materials',job:{status:'needs_materials',completedSections:1,totalSections:2},chapters:[{id:'c1',title:'Introduction',version:1,status:'partial',text,targetWords:60,sourceIds:['m1'],totalSections:2}],sections:[{id:'s1',chapterId:'c1',status:'completed',text,sourceIds:['m1']}]}),f=fixture({item:original});try{const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;assert.match(f.$('[data-thesis-chapter-state="c1"]').textContent,/正文 3词 \/ 目标 60词/);assert.equal(f.$('.thesis-completed-sections summary small').textContent,'3词');assert.equal(f.calls.some(row=>row.data),false);}finally{f.close();}
});


test('an unused empty bibliography stays uncompiled after a completed manuscript is manually saved as a draft',async()=>{
 const f=fixture({item:thesis({status:'draft',job:{status:'completed',completedSections:3,totalSections:3},chapters:[{id:'c1',title:'第一章',version:2,status:'saved',text:'手动修订并保存的正文',sourceIds:['m1']},{id:'refs',title:'参考文献',version:0,status:'pending',text:''}]})});try{const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;assert.match(f.$('[data-thesis-chapter="refs"]').textContent,/未编入文献/);assert.doesNotMatch(f.$('[data-thesis-chapter="refs"]').textContent,/待生成/);f.$('[data-thesis-chapter="refs"]').click();assert.match(f.$('.thesis-editor').textContent,/当前正文未引用选中题录/);assert.equal(f.$('.thesis-progress b').textContent,'草稿已保存');assert.equal(f.$('progress').value,100);assert.equal(f.calls.some(row=>row.data),false);}finally{f.close();}
});

test('an empty bibliography is uncompiled when all body chapters are saved, while a truly pending manuscript remains pending',async()=>{
 for(const saved of [true,false]){const f=fixture({item:thesis({status:'draft',job:null,chapters:[{id:'c1',title:'第一章',version:saved?1:0,status:saved?'saved':'pending',text:saved?'用户手写并保存的正文':''},{id:'refs',title:'参考文献',version:0,status:'pending',text:''}]})});try{const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;assert.match(f.$('[data-thesis-chapter="refs"]').textContent,saved?/未编入文献/:/待生成/);assert.equal(f.calls.some(row=>row.data),false);}finally{f.close();}}
});


test('a focused ordinary library link cannot crash the next thesis mount during view capture',async()=>{
 const f=fixture();try{const library=mountThesisLibrary({ctx:f.ctx});await library.ready;const link=f.$('.thesis-library a');link.focus();assert.equal(document.activeElement,link);assert.equal(link.id,'');assert.equal(link.attributes.length,1);let next;assert.doesNotThrow(()=>{next=mountOnlineThesis({id:'t1',ctx:f.ctx});});await next.ready;assert.ok(f.$('[data-thesis-editor]'));assert.equal(f.$('.thesis-library'),null);assert.match(f.$('.thesis-summary').textContent,/真实研究/);}finally{f.close();}
});

test('view capture accepts plain focused elements without an ID or thesis data attribute',async()=>{
 for(const markup of ['<button type="button">普通按钮</button>','<input name="plain-field">','<div tabindex="0">普通可聚焦区域</div>']){const f=fixture();try{const control=document.createElement('div');control.innerHTML=markup;const focused=control.firstElementChild;f.$('.dashboard').append(focused);focused.focus();assert.equal(document.activeElement,focused);let next;assert.doesNotThrow(()=>{next=mountOnlineThesis({id:'t1',ctx:f.ctx});});await next.ready;assert.ok(f.$('[data-thesis-editor]'));}finally{f.close();}}
});


test('account thesis creation and explicit synchronization use the selected account project and protect quote binding',async()=>{
 const f=fixture();let projectRef=projectReference('u1','project-a');try{const panel=mountThesisStage({container:f.$('.dashboard'),getSnapshot:snapshot,getProjectRef:()=>projectRef,ctx:f.ctx});await panel.ready;f.$('[data-thesis-create]').click();await settle();const created=f.calls.find(row=>row.path==='/theses'&&row.data);assert.equal(created.data.projectId,'project-a');assert.equal(created.data.snapshot.projectId,undefined);assert.equal(f.$('.thesis-snapshot-drift'),null);f.$('[data-thesis-quote]').click();await settle();assert.ok(f.$('[data-thesis-start]'));projectRef=projectReference('u1','project-b');const consent=f.$('[data-thesis-consent]');consent.checked=true;consent.dispatchEvent(new window.Event('change'));assert.equal(f.$('[data-thesis-start]').disabled,true);f.$('[data-thesis-refresh]').click();await settle();assert.match(f.$('.thesis-snapshot-drift').textContent,/所属项目/);f.$('[data-thesis-sync-primary]').click();await settle();assert.equal(f.calls.filter(row=>row.path==='/theses/t1'&&row.data).at(-1).data.projectId,'project-b');assert.equal(f.calls.some(row=>row.path.endsWith('/generate')),false);}finally{f.close();}
});

test('standalone thesis research edits retain the saved account project when no project selector exists',async()=>{
 const f=fixture({item:thesis({projectId:'already-associated'})});try{const panel=mountOnlineThesis({id:'t1',ctx:f.ctx});await panel.ready;input(f,'#thesis-research-method','调整后的真实方法');f.$('[data-thesis-save-research]').click();await settle();const updated=f.calls.find(row=>row.path==='/theses/t1'&&row.data);assert.equal(updated.data.projectId,undefined);assert.equal(f.$('.thesis-snapshot-drift'),null);f.$('[data-thesis-quote]').click();await settle();assert.ok(f.$('[data-thesis-start]'));}finally{f.close();}
});

test('a foreign account project prevents creating an account thesis',async()=>{
 const f=fixture();try{const panel=mountThesisStage({container:f.$('.dashboard'),getSnapshot:snapshot,getProjectRef:()=>projectReference('other-user','foreign-project'),ctx:f.ctx});await panel.ready;f.$('[data-thesis-create]').click();await settle();assert.equal(f.calls.some(row=>row.path==='/theses'&&row.data),false);assert.match(f.$('[data-thesis-notice]').textContent,/项目|账户/);}finally{f.close();}
});


test('thesis generation keeps an explicit opt-out through chapter rerenders and does not submit until reselected',async()=>{
 const f=fixture();try{const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;f.$('[data-thesis-quote]').click();await settle();assert.equal(f.$('[data-thesis-consent]').checked,true);assert.equal(f.calls.some(c=>c.path.endsWith('/generate')),false);
 const consent=f.$('[data-thesis-consent]');consent.checked=false;consent.dispatchEvent(new window.Event('change'));assert.equal(f.$('[data-thesis-start]').disabled,true);
 f.$('[data-thesis-chapter="c2"]').click();assert.equal(f.$('[data-thesis-consent]').checked,false);assert.equal(f.$('[data-thesis-start]').disabled,true);f.$('[data-thesis-start]').dispatchEvent(new window.MouseEvent('click',{bubbles:true}));await settle();assert.equal(f.calls.some(c=>c.path.endsWith('/generate')),false);
 const checked=f.$('[data-thesis-consent]');checked.checked=true;checked.dispatchEvent(new window.Event('change'));f.$('[data-thesis-start]').click();await settle();assert.equal(f.calls.filter(c=>c.path.endsWith('/generate')).length,1);
 }finally{f.close();}
});

test('a default-ready thesis quote cannot authorize generation into a changed account',async()=>{
 let owner={id:'u1'};const f=fixture({handler:path=>path==='/auth/me'?{user:owner}:undefined});f.ctx.session=async()=>({status:'ready',user:owner});try{const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;f.$('[data-thesis-quote]').click();await settle();assert.equal(f.$('[data-thesis-consent]').checked,true);owner={id:'u2'};f.$('[data-thesis-start]').click();await settle();assert.equal(f.calls.some(c=>c.path.endsWith('/generate')),false);assert.match(f.$('.dashboard').textContent,/账户已切换/);}finally{f.close();}
});


test('an invalid new thesis quote removes the previous ready quote instead of reusing its default check',async()=>{
 let quotes=0;const f=fixture({handler:path=>path==='/theses/t1/quote'?(++quotes===1?quote():{...quote(),token:''}):undefined});try{const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;f.$('[data-thesis-quote]').click();await settle();assert.equal(f.$('[data-thesis-consent]').checked,true);f.$('[data-thesis-quote]').click();await settle();assert.equal(f.$('[data-thesis-start]'),null);assert.equal(f.calls.some(c=>c.path.endsWith('/generate')),false);assert.match(f.$('[data-thesis-notice]').textContent,/报价/);}finally{f.close();}
});

test('thesis generation keeps routine explanations collapsed and the quoted cost and start action visible',async()=>{
 const f=fixture();try{const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;
 assert.equal(f.$('.thesis-service-details').open,false);assert.match(f.$('.thesis-service-details').textContent,/80,000/);assert.equal(f.$('[data-thesis-quote]').closest('details'),null);
 f.$('[data-thesis-quote]').click();await settle();const disclosure=f.$('.thesis-generation-details');assert.equal(disclosure.open,false);assert.equal(f.$('.thesis-charge>strong').closest('details'),null);assert.match(f.$('.thesis-charge>strong').textContent,/10 科研积分/);assert.equal(f.$('[data-thesis-start]').closest('details'),null);assert.equal(f.$('[data-thesis-start]').disabled,false);assert.equal(f.$('[data-thesis-consent]').closest('details'),disclosure);assert.equal(f.calls.some(c=>c.path.endsWith('/generate')),false);
 f.$('[data-thesis-start]').click();await settle();assert.equal(f.calls.filter(c=>c.path.endsWith('/generate')).length,1);
 }finally{f.close();}
});

test('opening thesis fee details retains its state and opt-out across chapter redraws, and can be collapsed again',async()=>{
 const f=fixture();try{const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;f.$('[data-thesis-quote]').click();await settle();
 f.$('.thesis-generation-details').open=true;const consent=f.$('[data-thesis-consent]');consent.checked=false;consent.dispatchEvent(new window.Event('change'));f.$('[data-thesis-chapter="c2"]').click();assert.equal(f.$('.thesis-generation-details').open,true);assert.equal(f.$('[data-thesis-consent]').checked,false);assert.equal(f.$('[data-thesis-start]').disabled,true);
 const summary=f.$('[data-thesis-disclosure="fees"]');summary.focus();f.$('[data-thesis-start]').dispatchEvent(new window.MouseEvent('click',{bubbles:true}));await settle();assert.equal(f.calls.some(c=>c.path.endsWith('/generate')),false);assert.equal(document.activeElement,summary);
 f.$('.thesis-generation-details').open=false;f.$('[data-thesis-chapter="c1"]').click();assert.equal(f.$('.thesis-generation-details').open,false);assert.equal(f.$('[data-thesis-start]').disabled,true);
 }finally{f.close();}
});


test('one-character placeholder evidence is rejected before a quote or generation request',async()=>{
 const value=snapshot();value.materials=[{id:'m1',name:'研究说明',text:'1',confirmed:true}];const f=fixture({item:thesis({snapshot:value})});try{const panel=mountOnlineThesis({id:'t1',ctx:f.ctx});await panel.ready;f.$('[data-thesis-quote]').click();await settle();assert.equal(f.calls.some(row=>row.path==='/theses/t1/quote'),false);assert.equal(f.calls.some(row=>row.path.endsWith('/generate')),false);assert.match(f.$('[data-thesis-notice]').textContent,/100/);}finally{f.close();}
});
