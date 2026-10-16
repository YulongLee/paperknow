import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountThesisStage,mountOnlineThesis,mountThesisLibrary,disposeOnlineThesis,thesisOnlineHasWork,thesisOnlineSessionChanged,validThesisQuote,thesisDocumentText} from '../dist/workspace/thesis-online.mjs';
import {thesisSnapshotFromDraft} from '../dist/workspace/writing-model.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const settle=async()=>{for(let i=0;i<5;i++)await tick();};
const snapshot=()=>({title:'真实研究',profile:{level:'博士',discipline:'物理学',language:'中文',targetWords:8000,method:'实验记录与文献分析',researchQuestion:'材料如何变化'},materials:[{id:'m1',name:'实验笔记',text:'真实实验记录，待自行核对。',purpose:'研究过程',confirmed:true}],references:[{id:'r1',title:'用户导入文献',sourceLabel:'本地题录，未核验',confirmed:true}],outline:[{id:'c1',title:'第一章 背景',targetWords:4000},{id:'c2',title:'第二章 讨论',targetWords:4000}]});
const thesis=(overrides={})=>({id:'t1',version:1,title:'真实研究',profile:snapshot().profile,snapshot:snapshot(),outline:snapshot().outline,status:'draft',job:null,chapters:[{id:'c1',title:'第一章 背景',version:0,status:'pending',text:'',sourceIds:[]},{id:'c2',title:'第二章 讨论',version:0,status:'pending',text:'',sourceIds:[]}],...overrides});
const quote=()=>({type:'agent',source:'credits',title:'论文分章生成',token:'quote-token',creditCost:10,expiresAt:new Date(Date.now()+60000).toISOString()});
function fixture({item=thesis(),user={id:'u1'},cap={ready:true},handler}={}){
 disposeOnlineThesis();const dom=new JSDOM('<div class="breadcrumb"><strong></strong></div><main class="dashboard"></main>',{url:'https://example.test/workspace.html#thesis/t1'});
 for(const key of ['window','document','location','AbortController'])globalThis[key]=dom.window[key];
 dom.window.confirm=()=>true;let record=structuredClone(item);const calls=[];
 const api=async(path,data)=>{calls.push({path,data});if(handler){const handled=await handler(path,data);if(handled!==undefined)return handled;}
  if(path==='/auth/me')return {user};if(path==='/capabilities')return {thesis:cap};if(path==='/billing/quote')return quote();
  if(path==='/theses'&&data){record=thesis({snapshot:data.snapshot,profile:data.snapshot.profile});return {item:structuredClone(record)};}
  if(path==='/theses')return {items:[structuredClone(record)]};if(path==='/theses/t1'&&!data)return {item:structuredClone(record)};
  if(path==='/theses/t1/generate'||path==='/theses/t1/resume'){record={...record,version:record.version+1,status:'queued',job:{status:'queued',completedSections:0,totalSections:3}};return {item:structuredClone(record)};}
  if(path==='/theses/t1/cancel'){record={...record,version:record.version+1,status:'cancelled',job:{status:'cancelled',canResume:true,completedSections:1,totalSections:3}};return {item:structuredClone(record)};}
  if(path==='/theses/t1'&&data){record={...record,version:record.version+1,status:'draft',snapshot:data.snapshot,profile:data.snapshot.profile};return {item:structuredClone(record)};}
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
 f.$('[data-thesis-quote]').click();await settle();assert.match(f.$('.thesis-charge').textContent,/10 科研积分/);assert.equal(f.$('[data-thesis-start]').disabled,true);assert.equal(f.calls.filter(c=>/generate/.test(c.path)).length,0);
 const consent=f.$('[data-thesis-consent]');consent.checked=true;consent.dispatchEvent(new window.Event('change'));f.$('[data-thesis-start]').click();await settle();
 const request=f.calls.find(c=>c.path==='/theses/t1/generate');assert.deepEqual(Object.keys(request.data).sort(),['billingToken','clientKey','consent','version']);assert.equal(request.data.billingToken,'quote-token');assert.equal(request.data.consent,true);assert.match(f.$('.thesis-progress').textContent,/排队中/);assert.equal(f.$('[data-thesis-editor]').disabled,true);f.close();
});
test('missing research evidence blocks quoting and saving research materials creates an explicit new snapshot',async()=>{
 const empty=thesis({profile:{...snapshot().profile,method:''},snapshot:{...snapshot(),profile:{...snapshot().profile,method:''},materials:[]}}),f=fixture({item:empty});const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;
 f.$('[data-thesis-quote]').click();await settle();assert.equal(f.calls.filter(c=>c.path==='/billing/quote').length,0);assert.match(f.$('[data-thesis-notice]').textContent,/研究方法/);
 input(f,'#thesis-research-method','文献分析');input(f,'#thesis-research-supplement','用户提供的原始证据');f.$('[data-thesis-save-research]').click();await settle();const write=f.calls.find(c=>c.path==='/theses/t1'&&c.data);assert.equal(write.data.snapshot.profile.method,'文献分析');assert.equal(write.data.snapshot.materials[0].confirmed,true);assert.equal(write.data.snapshot.materials[0].text,'用户提供的原始证据');f.close();
});
test('invalid and expired quotes never enable a generation submission',async()=>{
 assert.equal(validThesisQuote({...quote(),expiresAt:new Date(0).toISOString()}),false);assert.equal(validThesisQuote({...quote(),creditCost:0}),false);assert.equal(validThesisQuote({...quote(),source:'membership',creditCost:0}),true);
 const f=fixture({handler:path=>path==='/billing/quote'?{...quote(),expiresAt:new Date(0).toISOString()}:undefined});const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;f.$('[data-thesis-quote]').click();await settle();assert.equal(f.$('[data-thesis-start]'),null);assert.match(f.$('[data-thesis-notice]').textContent,/报价/);f.close();
});
test('metadata-only sources cannot request a billable generation quote even when research method is present',async()=>{
 const f=fixture({item:thesis({snapshot:{...snapshot(),materials:[]}})});const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;f.$('[data-thesis-quote]').click();await settle();assert.equal(f.calls.some(call=>call.path==='/billing/quote'),false);assert.match(f.$('[data-thesis-notice]').textContent,/仅有文献题录不足以生成论文/);assert.ok(f.$('[data-thesis-save-research]'));f.close();
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
