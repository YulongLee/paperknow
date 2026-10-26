import {projectReference} from '../dist/workspace/project-directory.mjs';
import {normalizeThesisSnapshot} from '../backend/thesis-model.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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
test('confirming an outline automatically saves its account record and opens generation with one expanded research-information overview',async()=>{
 const persisted=[],saved=[],f=fixture({handler:async path=>{if(path.startsWith('/theses/by-key/'))throw Object.assign(Error('not found'),{status:404});}});
 try{const stop=mountThesisStage({container:f.$('.dashboard'),ctx:f.ctx,getSnapshot:snapshot,autoCreate:true,createKey:'confirmed-outline-key',onCreateKey:key=>persisted.push(key),onSaved:id=>saved.push(id),onTemplateSettings:()=>{}});await stop.ready;
 assert.deepEqual(persisted,['confirmed-outline-key']);assert.deepEqual(saved,['t1']);assert.equal(f.$('[data-thesis-create]'),null);assert.equal(f.$('.thesis-save-account'),null);assert.ok(f.$('[data-thesis-quote]'));assert.equal(f.$('[data-thesis-view-key="information-overview"]').open,true);assert.equal(f.$('.dashboard').querySelectorAll('[data-thesis-view-key="information-overview"]').length,1);
 assert.equal(f.calls.filter(row=>row.path==='/theses'&&row.data).length,1);assert.equal(f.calls.find(row=>row.path==='/theses'&&row.data).data.clientKey,'confirmed-outline-key');assert.equal(f.calls.filter(row=>/quote|generate/.test(row.path)).length,0);
 f.$('[data-thesis-quote]').click();await settle();assert.equal(f.calls.filter(row=>row.path.endsWith('/generate')).length,1);assert.equal(f.$('[data-thesis-view-key="information-overview"]').open,true);
 }finally{f.close();}
});
test('a recovered automatic save reuses the existing account paper instead of creating another one',async()=>{
 const f=fixture({handler:async path=>path==='/theses/by-key/recovered-outline-key'?{item:thesis()}:undefined});try{const stop=mountThesisStage({container:f.$('.dashboard'),ctx:f.ctx,getSnapshot:snapshot,autoCreate:true,createKey:'recovered-outline-key'});await stop.ready;assert.ok(f.$('[data-thesis-quote]'));assert.equal(f.calls.filter(row=>row.path==='/theses'&&row.data).length,0);assert.equal(f.calls.filter(row=>/quote|generate/.test(row.path)).length,0);}finally{f.close();}
});
test('a lost automatic-save response recovers the original account record on retry without another creation',async()=>{
 let saved=false,posts=0;const f=fixture({handler:async(path,data)=>{if(path.startsWith('/theses/by-key/')){if(saved)return {item:thesis()};throw Object.assign(Error('not found'),{status:404});}if(path==='/theses'&&data){posts++;saved=true;throw new TypeError('合成网络暂断，保存回执未收到');}}});
 try{const stop=mountThesisStage({container:f.$('.dashboard'),ctx:f.ctx,getSnapshot:snapshot,autoCreate:true,createKey:'retry-outline-key'});await stop.ready;assert.match(f.$('.dashboard').textContent,/保存回执未收到/);assert.equal(f.$('[data-thesis-create]'),null);f.$('[data-thesis-reload]').click();await settle();assert.ok(f.$('[data-thesis-quote]'));assert.equal(posts,1);}finally{f.close();}
});
test('automatic save does not send research data when recovery-key persistence fails or the account changes',async()=>{
 const f=fixture();try{const stop=mountThesisStage({container:f.$('.dashboard'),ctx:f.ctx,getSnapshot:snapshot,autoCreate:true,onCreateKey:()=>{throw Error('合成进度保存失败');}});await stop.ready;assert.match(f.$('.dashboard').textContent,/合成进度保存失败/);assert.equal(f.calls.filter(row=>row.path.startsWith('/theses/by-key/')||row.path==='/theses'&&row.data).length,0);}finally{f.close();}
 const next=fixture({handler:async path=>path==='/auth/me'?{user:{id:'u2'}}:undefined});try{const stop=mountThesisStage({container:next.$('.dashboard'),ctx:next.ctx,getSnapshot:snapshot,autoCreate:true});await stop.ready;assert.match(next.$('.dashboard').textContent,/账户已切换|登录状态已变化/);assert.equal(next.calls.filter(row=>row.path.startsWith('/theses/by-key/')||row.path==='/theses'&&row.data).length,0);}finally{next.close();}
});
test('cover information is expanded, saved to its own account endpoint and never starts or quotes a writing job',async()=>{
 const item=thesis({status:'completed',chapters:[{id:'c1',title:'第一章 背景',text:'已保存正文',version:1,status:'saved',sourceIds:[]}]}),f=fixture({item,handler:async(path,data)=>path==='/theses/t1/export-metadata'?{item:{...item,version:2,exportMetadata:data.metadata}}:undefined});
 try{const stop=mountOnlineThesis({id:'t1',container:f.$('.dashboard'),ctx:f.ctx});await stop.ready;assert.equal(f.$('[data-thesis-cover]').open,true);assert.equal(f.$('#thesis-online-docx').disabled,false);input(f,'[data-cover-field="author"]','合成作者');assert.equal(f.$('#thesis-online-docx').disabled,true);assert.equal(f.$('#thesis-online-draft').disabled,true);f.$('[data-save-cover]').click();await settle();assert.equal(f.calls.find(row=>row.path==='/theses/t1/export-metadata').data.metadata.author,'合成作者');assert.equal(f.$('#thesis-online-docx').disabled,false);assert.equal(f.calls.filter(row=>/quote|generate/.test(row.path)).length,0);assert.equal(f.$('[data-cover-field="author"]').value,'合成作者');}finally{f.close();}
});
test('snapshot conversion preserves all research profiles, materials and imported manual body without binding a local project',()=>{
 for(const degree of ['专科','本科','硕士','博士','科研人员']){
  const value=thesisSnapshotFromDraft({title:'研究题目',degree,major:'艺术学',method:'作品分析',researchQuestion:'研究问题',projectId:'local-project',language:'英文',targetWords:1000,knowledgeFiles:[{id:'m1',name:'笔记',purpose:'方法依据',text:'原始材料'}],outlineRows:[{id:'c1',title:'第一章',level:1,words:0},{id:'s1',title:'1.1 方法',level:2,words:1000}],bodySections:[{id:'c1',title:'第一章',text:'手动正文'}]});
  assert.equal(value.profile.level,degree==='科研人员'?'研究工作者':degree);assert.equal(value.profile.language,'English');assert.equal(value.outline[0].targetWords,1000);assert.equal(value.materials[0].purpose,'方法依据');assert.equal(value.bodySections[0].text,'手动正文');assert.equal(value.projectId,undefined);
 }
 assert.throws(()=>thesisSnapshotFromDraft({targetWords:80001}),/80,000/);
 const local={title:'来源编号验证',targetWords:1000,outlineRows:[{id:'c1',title:'第一章',level:1,words:1000}],knowledgeFiles:[{id:'same',name:'材料一',text:'正文一'},{id:'same',name:'材料二',text:'正文二'},{name:'未设置编号',text:'正文三'}],writingReferences:[{id:'same',title:'文献一'},{id:'编号 / 💡',title:'文献二'}]},a=thesisSnapshotFromDraft(local),b=thesisSnapshotFromDraft(local);
 const ids=[...a.materials,...a.references].map(row=>row.id);assert.equal(new Set(ids).size,ids.length);assert.deepEqual(ids,[...b.materials,...b.references].map(row=>row.id));assert.ok(ids.every(id=>/^[\p{L}\p{N}_.:-]+$/u.test(id)&&id.length<=100));
});
test('guest uses the account sign-in entry; session errors never appear as a signed-out account',async()=>{
 const f=fixture({user:null});const stop=mountThesisStage({container:f.$('.dashboard'),getSnapshot:snapshot,ctx:f.ctx});await stop.ready;
 assert.match(f.$('.dashboard').textContent,/登录后保存到账户/);assert.equal(f.$('[data-thesis-manual]'),null);assert.equal(f.calls.filter(c=>c.data).length,0);f.close();
 const next=fixture();next.ctx.session=async()=>({status:'error'});const done=mountOnlineThesis({id:'t1',container:next.$('.dashboard'),ctx:next.ctx});await done.ready;assert.match(next.$('.dashboard').textContent,/无法核对登录状态/);assert.equal(next.$('a[href^="/auth.html"]'),null);next.close();
});
test('cloud save is read-only for generation and one explicit generation click checks usage and starts the job',async()=>{
 const f=fixture();try{const stop=mountThesisStage({container:f.$('.dashboard'),getSnapshot:snapshot,ctx:f.ctx});await stop.ready;
 f.$('[data-thesis-create]').click();await settle();assert.equal(f.calls.filter(c=>c.path==='/theses'&&c.data).length,1);assert.equal(f.calls.filter(c=>/generate/.test(c.path)).length,0);
 f.$('[data-thesis-quote]').click();await settle();assert.equal(f.$('.thesis-charge'),null);assert.equal(f.$('[data-thesis-start]'),null);
 const request=f.calls.find(c=>c.path==='/theses/t1/generate');assert.deepEqual(Object.keys(request.data).sort(),['billingToken','clientKey','consent','version']);assert.equal(request.data.billingToken,'quote-token');assert.equal(request.data.consent,true);assert.match(f.$('.thesis-progress').textContent,/排队中/);assert.equal(f.$('[data-thesis-editor]').readOnly,true);assert.equal(f.calls.filter(c=>c.path.endsWith('/generate')).length,1);}finally{f.close();}
});
test('optional source content permits generation and explicitly saved material edits stay in the new snapshot',async()=>{
 const empty=thesis({profile:{...snapshot().profile,method:''},snapshot:{...snapshot(),profile:{...snapshot().profile,method:''},materials:[]}}),f=fixture({item:empty});try{const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;
 assert.match(f.$('.thesis-source-gap').textContent,/可生成待核对初稿/);input(f,'#thesis-research-method','文献分析');input(f,'#thesis-research-supplement','用户提供的原始证据');f.$('[data-thesis-save-research]').click();await settle();const write=f.calls.find(c=>c.path==='/theses/t1'&&c.data);assert.equal(write.data.snapshot.profile.method,'文献分析');assert.equal(write.data.snapshot.materials[0].confirmed,true);assert.equal(write.data.snapshot.materials[0].text,'用户提供的原始证据');assert.equal(f.calls.some(c=>c.path.endsWith('/generate')),false);f.$('[data-thesis-quote]').click();await settle();assert.equal(f.calls.find(c=>c.path.endsWith('/generate')).data.version,2);}finally{f.close();}
});
test('optional blank profile directly generates without a second confirmation',async()=>{
 const value=snapshot();value.profile={level:'本科',language:'中文',targetWords:8000,discipline:'',major:'',direction:'',researchQuestion:'',method:''};const f=fixture({item:thesis({profile:value.profile,snapshot:value})});try{const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;assert.match(f.$('.thesis-sources').textContent,/暂未补充（可选）/);assert.equal(f.calls.some(c=>c.path.endsWith('/generate')),false);f.$('[data-thesis-quote]').click();await settle();assert.equal(f.calls.filter(c=>c.path.endsWith('/quote')).length,1);assert.equal(f.calls.filter(c=>c.path.endsWith('/generate')).length,1);assert.equal(f.$('[data-thesis-consent]'),null);}finally{f.close();}
});
test('blank local optional fields remain empty in an account snapshot instead of receiving a fabricated discipline',()=>{
 const value=thesisSnapshotFromDraft({title:'研究题目',degree:'本科',outlineRows:[{id:'c1',level:1,title:'第一章 研究背景',words:8000}]});for(const key of ['discipline','major','direction','researchQuestion','method'])assert.equal(value.profile[key],'');
});
test('invalid and expired quotes never enable a generation submission',async()=>{
 assert.equal(validThesisQuote({...quote(),expiresAt:new Date(0).toISOString()}),false);assert.equal(validThesisQuote({...quote(),creditCost:0}),false);assert.equal(validThesisQuote({...quote(),source:'membership',creditCost:0}),true);
 const f=fixture({handler:path=>path==='/theses/t1/quote'?{...quote(),expiresAt:new Date(0).toISOString()}:undefined});const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;f.$('[data-thesis-quote]').click();await settle();assert.equal(f.$('[data-thesis-start]'),null);assert.match(f.$('[data-thesis-notice]').textContent,/用量/);f.close();
});
test('direct generation with metadata-only references never promotes them to read sources',async()=>{
 const value={...snapshot(),materials:[],references:[{id:'metadata-only',title:'仅有题录的研究线索',scope:'metadata',text:'',fullTextRead:false,confirmed:true}]},before=structuredClone(value),f=fixture({item:thesis({snapshot:value})});try{const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;assert.match(f.$('.thesis-source-gap').textContent,/可生成待核对初稿/);f.$('[data-thesis-quote]').click();await settle();assert.equal(f.calls.filter(c=>c.path.endsWith('/generate')).length,1);assert.deepEqual(value,before);assert.match(f.$('.thesis-sources').textContent,/仅元数据，不代表已读取原文/);assert.equal(f.$('.thesis-charge'),null);}finally{f.close();}
});
test('usage expiring during authentication cannot authorize direct generation',async()=>{
 const now=Date.now;let expires=false;const f=fixture({handler:path=>{if(path.endsWith('/quote')){const q=quote();expires=true;return q;}if(path==='/auth/me'&&expires)Date.now=()=>now()+120000;}});try{const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;f.$('[data-thesis-quote]').click();await settle();assert.equal(f.calls.some(c=>c.path.endsWith('/generate')),false);assert.match(f.$('[data-thesis-notice]').textContent,/用量.*变化/);assert.equal(f.$('.thesis-charge'),null);}finally{Date.now=now;f.close();}
});
test('export rebuilds current citation indexes and retains uncited confirmed records separately from the cited bibliography',()=>{
 const value=thesis({chapters:[{id:'c1',title:'第一章',text:'真实正文 [source:r-used]；实验记录 [source:m1]。',sourceIds:['m1','r-used','r-unconfirmed']}]});value.snapshot.references=[{id:'r-used',title:'已引用的来源',confirmed:true},{id:'r-unused',title:'未引用题录',confirmed:true},{id:'r-unconfirmed',title:'未确认来源',confirmed:false}];
 const text=thesisDocumentText(value);assert.match(text,/真实正文 \[1\]/);assert.match(text,/已引用的来源/);assert.match(text,/实验笔记/);assert.match(text,/待引用文献（尚未在正文引用）[^]*未引用题录/);assert.doesNotMatch(text,/未确认来源/);assert.equal(thesisDocumentText({...value,fullText:'旧缓存省略了参考文献'}),text);
});
test('refresh preserves unsaved text, optimistic save uses the current version and no local unlock gates exports',async()=>{
 const original=thesis({status:'completed',chapters:[{id:'c1',title:'第一章 <script>恶意</script>',text:'账户原文',version:1,status:'saved',sourceIds:['m1']}]}),f=fixture({item:original});const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;
 assert.equal(f.$('script'),null);assert.equal(f.$('#thesis-online-docx').disabled,false);input(f,'[data-thesis-editor]','我修改的新正文');assert.equal(thesisOnlineHasWork(),true);assert.equal(f.$('#thesis-online-docx').disabled,true);
 f.setItem({...original,version:3});f.$('[data-thesis-refresh]').click();await settle();assert.equal(f.$('[data-thesis-editor]').value,'我修改的新正文');f.$('[data-thesis-save-chapter]').click();await settle();const write=f.calls.find(c=>c.path==='/theses/t1/chapters/c1');assert.deepEqual(write.data,{version:3,text:'我修改的新正文'});assert.equal(thesisOnlineHasWork(),false);assert.equal(f.$('#thesis-online-pdf'),null);assert.equal(f.$('[data-thesis-txt]'),null);assert.equal(f.$('#thesis-online-docx').disabled,false);assert.equal(f.$('#thesis-online-draft').disabled,false);assert.doesNotMatch(f.$('.thesis-export').textContent,/PDF|下载 TXT/);assert.match(thesisDocumentText({...original,chapters:[{title:'第一章',text:'真实正文'}]}),/真实正文/);f.close();
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
 f.$('[data-thesis-quote="resume"]').click();await settle();assert.equal(f.$('[data-thesis-consent]'),null);assert.equal(f.calls.filter(c=>c.path.endsWith('/resume')).length,1);f.close();
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
 assert.match(result,/已有研究指出这一现象 \[1\]/);assert.match(result,/用户观察见 \[材料1\]/);assert.match(result,/未识别来源 \[来源待核对\]/);assert.match(result,/经用户确认的参考文献/);assert.match(result,/实验笔记/);assert.doesNotMatch(result,/\[source:|removed-private-id|旧版服务端全文/);assert.deepEqual(value,raw);
});

test('a stale formatted server cache cannot override the current saved chapters and citation inventory',()=>{
 const value=thesis({chapters:[{id:'c1',title:'第一章',text:'参考研究 [source:r1] 与材料 [source:m1]。',sourceIds:['r1','m1']}]});
 value.snapshot.references=[{id:'r1',title:'研究参考文献',confirmed:true}];
 const formatted='服务端已排版正文\n\n第一章\n保留原有内容与空格  [1]';assert.equal(thesisDocumentText({...value,fullText:formatted}),thesisDocumentText(value));
 const fallback=thesisDocumentText(value);assert.match(fallback,/参考研究 \[1\] 与材料 \[材料1\]/);assert.match(fallback,/研究参考文献/);assert.match(fallback,/实验笔记/);assert.doesNotMatch(fallback,/\[source:/);
});


test('creating an account snapshot normalizes server defaults without falsely requiring a resync',async()=>{
 const local=snapshot();local.requirements={contentMode:'text',researchPlan:{text:'拟采用文献分析并由用户核对',origin:'ai',status:'proposed',jobId:null}};local.bodySections=[{id:'c1',text:'独立手动正文'}];local.projectId='browser-project';
 const f=fixture({handler:(path,data)=>{if(path==='/theses'&&data){const normalized=normalizeThesisSnapshot(data.snapshot),saved=thesis({snapshot:normalized,profile:normalized.profile,outline:normalized.outline});f.setItem(saved);return {item:saved};}}});
 try{const stop=mountThesisStage({container:f.$('.dashboard'),getSnapshot:()=>structuredClone(local),ctx:f.ctx});await stop.ready;f.$('[data-thesis-create]').click();await settle();assert.equal(f.$('.thesis-snapshot-drift'),null);assert.equal(f.$('[data-thesis-quote]').disabled,false);f.$('[data-thesis-quote]').click();await settle();assert.equal(f.$('[data-thesis-consent]'),null);assert.equal(f.calls.filter(row=>row.path.endsWith('/generate')).length,1);}finally{f.close();}
});

test('a changed step-four outline prominently blocks quotations until explicit versioned sync and renewed consent',async()=>{
 let local=snapshot(),confirmations=0;const f=fixture();try{const stop=mountThesisStage({id:'t1',container:f.$('.dashboard'),getSnapshot:()=>structuredClone(local),ctx:f.ctx});await stop.ready;assert.equal(f.$('.thesis-snapshot-drift'),null);local.outline[0].title='第一章 更新后的研究问题';local.outline[0].targetWords=5000;local.outline[1].targetWords=3000;
 f.$('[data-thesis-refresh]').click();await settle();assert.match(f.$('.thesis-snapshot-drift').textContent,/前四步与账户信息不一致/);assert.match(f.$('.thesis-snapshot-drift').textContent,/论文提纲与字数分配/);assert.equal(f.$('[data-thesis-sync-primary]').closest('details'),null);assert.equal(f.$('[data-thesis-quote]').disabled,true);f.$('[data-thesis-quote]').dispatchEvent(new window.MouseEvent('click',{bubbles:true}));await settle();assert.equal(f.calls.some(row=>row.path==='/theses/t1/quote'),false);
 window.confirm=()=>{confirmations++;return true;};f.$('[data-thesis-sync-primary]').click();await settle();assert.equal(confirmations,1);const synced=f.calls.find(row=>row.path==='/theses/t1'&&row.data);assert.equal(synced.data.version,1);assert.equal(synced.data.snapshot.outline[0].title,'第一章 更新后的研究问题');assert.equal(synced.data.snapshot.outline[0].targetWords,5000);assert.equal(f.$('.thesis-snapshot-drift'),null);assert.equal(f.calls.some(row=>row.path.endsWith('/generate')),false);f.$('[data-thesis-quote]').click();await settle();assert.equal(f.$('[data-thesis-start]'),null);assert.equal(f.calls.filter(row=>row.path.endsWith('/generate')).length,1);assert.equal(f.calls.find(row=>row.path.endsWith('/generate')).data.version,2);
 }finally{f.close();}
});

test('account-only research additions stay intact unless the user explicitly chooses to replace them',async()=>{
 const local=snapshot(),saved=snapshot();saved.materials.push({id:'account-only',name:'账户独立补充',text:'独立补充的真实资料',confirmed:true});const f=fixture({item:thesis({version:6,snapshot:saved})});
 try{const stop=mountThesisStage({id:'t1',container:f.$('.dashboard'),getSnapshot:()=>structuredClone(local),ctx:f.ctx});await stop.ready;assert.equal(f.$('[data-thesis-quote]').disabled,true);assert.match(f.$('.thesis-snapshot-drift').textContent,/账户中独立补充/);f.$('[data-thesis-use-account]').click();assert.match(f.$('.thesis-account-choice').textContent,/本次使用账户已保存的信息/);assert.equal(f.calls.some(row=>row.data),false);f.$('[data-thesis-quote]').click();await settle();assert.equal(f.$('[data-thesis-consent]'),null);assert.equal(f.calls.find(row=>row.path.endsWith('/generate')).data.version,6);assert.equal(f.calls.some(row=>row.path==='/theses/t1'&&row.data),false);assert.match(f.$('.thesis-sources').textContent,/账户独立补充/);
 }finally{f.close();}
});

test('an account-version change invalidates an earlier choice to use account information',async()=>{
 const local=snapshot(),saved=snapshot();saved.profile.method='账户补充方法';const f=fixture({item:thesis({snapshot:saved,profile:saved.profile})});
 try{const stop=mountThesisStage({id:'t1',container:f.$('.dashboard'),getSnapshot:()=>structuredClone(local),ctx:f.ctx});await stop.ready;f.$('[data-thesis-use-account]').click();assert.equal(f.$('[data-thesis-quote]').disabled,false);f.setItem(thesis({version:2,snapshot:saved,profile:saved.profile}));f.$('[data-thesis-refresh]').click();await settle();assert.ok(f.$('[data-thesis-use-account]'));assert.equal(f.$('[data-thesis-quote]').disabled,true);assert.equal(f.$('.thesis-account-choice'),null);assert.equal(f.calls.some(row=>row.data),false);
 }finally{f.close();}
});

test('local input changes during usage checking block direct generation until explicitly synchronized',async()=>{
 let local=snapshot(),release;const f=fixture({handler:path=>path.endsWith('/quote')?new Promise(resolve=>release=resolve):undefined});try{const stop=mountThesisStage({id:'t1',container:f.$('.dashboard'),getSnapshot:()=>structuredClone(local),ctx:f.ctx});await stop.ready;f.$('[data-thesis-quote]').click();await settle();local.outline[0].title='费用检查期间修改的新章节';release(quote());await settle();assert.equal(f.calls.some(c=>c.path.endsWith('/generate')),false);assert.ok(f.$('[data-thesis-sync-primary]'));assert.equal(f.$('.thesis-charge'),null);}finally{f.close();}
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
 const f=fixture({item:thesis({status:'draft',job:{status:'completed',completedSections:3,totalSections:3},chapters:[{id:'c1',title:'第一章',text:'已手动修订并保存的完整正文',version:2,status:'saved'}]})});try{const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;assert.equal(f.$('.thesis-progress b').textContent,'草稿已保存');assert.equal(f.$('progress').value,100);assert.match(f.$('.thesis-progress').textContent,/上次任务记录继续保留/);assert.equal(f.$('#thesis-online-docx').disabled,false);assert.equal(f.calls.some(call=>call.data),false);}finally{f.close();}
});


test('an unknown citation displays a clear unverified label without exposing its internal ID in the default editor',async()=>{
 const unknown='unknown-private-implementation-id',raw='尚需核对的依据 [source:'+unknown+']。',f=fixture({item:thesis({chapters:[{id:'c1',title:'第一章',version:1,status:'saved',text:raw,sourceIds:[unknown]}]})});try{const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;assert.equal(f.$('[data-thesis-editor]').value,'尚需核对的依据 〔待核对来源1〕。');assert.match(f.$('.thesis-editor').textContent,/未匹配到当前已保存的资料，请核对来源/);assert.doesNotMatch(f.$('.thesis-editor').textContent,/unknown-private-implementation-id/);input(f,'[data-thesis-editor]',f.$('[data-thesis-editor]').value+' 人工补充');f.$('[data-thesis-save-chapter]').click();await settle();assert.equal(f.calls.find(row=>row.path==='/theses/t1/chapters/c1'&&row.data).data.text,raw+' 人工补充');}finally{f.close();}
});


test('chapter navigation counts canonical prose without long source markers and updates unsaved edits in place',async()=>{
 const body='甲'.repeat(80)+' [source:m1]',original=thesis({chapters:[{id:'c1',title:'第一章',version:1,status:'saved',text:body,targetWords:60,sourceIds:['m1']},{id:'c2',title:'第二章',version:0,status:'pending',text:'',targetWords:40}]}),f=fixture({item:original});try{const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;assert.match(f.$('[data-thesis-chapter-state="c1"]').textContent,/正文 80字 \/ 目标 60字/);assert.match(f.$('[data-thesis-chapter-state="c2"]').textContent,/待生成.*目标 40字/);assert.doesNotMatch(f.$('.thesis-chapter-nav').textContent,/字符/);const editor=f.$('[data-thesis-editor]');input(f,'[data-thesis-editor]',editor.value+'乙乙');assert.equal(f.$('[data-thesis-editor]'),editor);assert.match(f.$('[data-thesis-chapter-state="c1"]').textContent,/未保存修改.*正文 82字 \/ 目标 60字/);assert.equal(f.calls.some(row=>row.data),false);}finally{f.close();}
});

test('English chapter and completed-section previews use the same word count instead of raw character totals',async()=>{
 const text="We can't over-claim. [source:m1]",original=thesis({profile:{...snapshot().profile,language:'English'},status:'needs_materials',job:{status:'needs_materials',completedSections:1,totalSections:2},chapters:[{id:'c1',title:'Introduction',version:1,status:'partial',text,targetWords:60,sourceIds:['m1'],totalSections:2}],sections:[{id:'s1',chapterId:'c1',status:'completed',text,sourceIds:['m1']}]}),f=fixture({item:original});try{const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;assert.match(f.$('[data-thesis-chapter-state="c1"]').textContent,/正文 3词 \/ 目标 60词/);assert.equal(f.$('[data-thesis-part-summary] small').textContent,'3词');assert.equal(f.calls.some(row=>row.data),false);}finally{f.close();}
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


test('project changes during usage checking cannot submit against the old project binding',async()=>{
 const f=fixture({handler:path=>path.endsWith('/quote')?new Promise(resolve=>release=resolve):undefined});let projectRef=projectReference('u1','project-a'),release;try{const panel=mountThesisStage({container:f.$('.dashboard'),getSnapshot:snapshot,getProjectRef:()=>projectRef,ctx:f.ctx});await panel.ready;f.$('[data-thesis-create]').click();await settle();const created=f.calls.find(row=>row.path==='/theses'&&row.data);assert.equal(created.data.projectId,'project-a');assert.equal(created.data.snapshot.projectId,undefined);f.$('[data-thesis-quote]').click();await settle();projectRef=projectReference('u1','project-b');release(quote());await settle();assert.equal(f.calls.some(row=>row.path.endsWith('/generate')),false);f.$('[data-thesis-refresh]').click();await settle();assert.match(f.$('.thesis-snapshot-drift').textContent,/所属项目/);f.$('[data-thesis-sync-primary]').click();await settle();assert.equal(f.calls.filter(row=>row.path==='/theses/t1'&&row.data).at(-1).data.projectId,'project-b');}finally{f.close();}
});

test('standalone thesis research edits retain the saved account project when no project selector exists',async()=>{
 const f=fixture({item:thesis({projectId:'already-associated'})});try{const panel=mountOnlineThesis({id:'t1',ctx:f.ctx});await panel.ready;input(f,'#thesis-research-method','调整后的真实方法');f.$('[data-thesis-save-research]').click();await settle();const updated=f.calls.find(row=>row.path==='/theses/t1'&&row.data);assert.equal(updated.data.projectId,undefined);assert.equal(f.$('.thesis-snapshot-drift'),null);f.$('[data-thesis-quote]').click();await settle();assert.equal(f.$('[data-thesis-start]'),null);assert.equal(f.calls.filter(row=>row.path.endsWith('/generate')).length,1);}finally{f.close();}
});

test('a foreign account project prevents creating an account thesis',async()=>{
 const f=fixture();try{const panel=mountThesisStage({container:f.$('.dashboard'),getSnapshot:snapshot,getProjectRef:()=>projectReference('other-user','foreign-project'),ctx:f.ctx});await panel.ready;f.$('[data-thesis-create]').click();await settle();assert.equal(f.calls.some(row=>row.path==='/theses'&&row.data),false);assert.match(f.$('[data-thesis-notice]').textContent,/项目|账户/);}finally{f.close();}
});


test('chapter navigation during a direct generation request does not duplicate the task',async()=>{
 let release;const f=fixture({handler:path=>path.endsWith('/quote')?new Promise(resolve=>release=resolve):undefined});try{const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;f.$('[data-thesis-quote]').click();await settle();f.$('[data-thesis-chapter="c2"]').click();f.$('[data-thesis-quote]').dispatchEvent(new window.MouseEvent('click',{bubbles:true}));await settle();assert.equal(f.calls.filter(c=>c.path.endsWith('/quote')).length,1);release(quote());await settle();assert.equal(f.calls.filter(c=>c.path.endsWith('/generate')).length,1);assert.equal(f.$('[data-thesis-consent]'),null);}finally{f.close();}
});

test('account changes during usage checking cannot authorize direct generation',async()=>{
 let owner={id:'u1'};const f=fixture({handler:path=>{if(path==='/auth/me')return {user:owner};if(path.endsWith('/quote')){owner={id:'u2'};return quote();}}});f.ctx.session=async()=>({status:'ready',user:owner});try{const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;f.$('[data-thesis-quote]').click();await settle();assert.equal(f.calls.some(c=>c.path.endsWith('/generate')),false);assert.match(f.$('.dashboard').textContent,/账户已切换/);}finally{f.close();}
});


test('an invalid later usage check cannot reuse an earlier token after a rejected request',async()=>{
 let quotes=0;const f=fixture({handler:path=>{if(path.endsWith('/quote'))return ++quotes===1?quote():{...quote(),token:''};if(path.endsWith('/generate'))throw Object.assign(Error('积分不足，请充值'),{status:402});}});try{const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;f.$('[data-thesis-quote]').click();await settle();assert.match(f.$('[data-thesis-notice]').textContent,/积分不足/);f.$('[data-thesis-quote]').click();await settle();assert.equal(f.calls.filter(c=>c.path.endsWith('/generate')).length,1);assert.match(f.$('[data-thesis-notice]').textContent,/用量/);assert.equal(f.$('.thesis-charge'),null);}finally{f.close();}
});

test('routine explanations stay collapsed and direct generation exposes no second fee panel',async()=>{
 const f=fixture();try{const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;assert.equal(f.$('.thesis-service-details').open,false);assert.match(f.$('.thesis-service-details').textContent,/80,000/);assert.equal(f.$('[data-thesis-quote]').closest('details'),null);f.$('[data-thesis-quote]').click();await settle();assert.equal(f.$('.thesis-charge'),null);assert.equal(f.$('.thesis-generation-details'),null);assert.equal(f.$('[data-thesis-start]'),null);assert.equal(f.calls.filter(c=>c.path.endsWith('/generate')).length,1);}finally{f.close();}
});

test('an ambiguous generation response keeps the same command on an explicit retry',async()=>{
 const f=fixture({handler:path=>{if(path.endsWith('/generate'))throw Error('响应中断');}});try{const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;f.$('[data-thesis-quote]').click();await settle();assert.match(f.$('[data-thesis-notice]').textContent,/响应中断/);f.$('[data-thesis-quote]').click();await settle();const posts=f.calls.filter(c=>c.path.endsWith('/generate'));assert.equal(posts.length,2);assert.equal(posts[0].data.clientKey,posts[1].data.clientKey);}finally{f.close();}
});


test('a short optional explanation no longer blocks the quotation or promotes itself to read literature',async()=>{
 const value=snapshot();value.materials=[{id:'m1',name:'研究说明',text:'1',confirmed:true}];const before=structuredClone(value),f=fixture({item:thesis({snapshot:value})});
 try{const panel=mountOnlineThesis({id:'t1',ctx:f.ctx});await panel.ready;assert.match(f.$('.thesis-source-gap').textContent,/可生成待核对初稿/);f.$('[data-thesis-quote]').click();await settle();assert.equal(f.calls.filter(row=>row.path==='/theses/t1/quote').length,1);assert.equal(f.$('[data-thesis-start]'),null);assert.equal(f.calls.filter(row=>row.path.endsWith('/generate')).length,1);assert.deepEqual(value,before);assert.doesNotMatch(f.$('[data-thesis-notice]').textContent,/100|不足以生成/);}finally{f.close();}
});

for(const references of [[],[{id:'bibliography',title:'仅题录的可选文献',confirmed:true,text:'',scope:'metadata',fullTextRead:false}]])test('an empty source body '+(references.length?'with only bibliography':'without research uploads')+' reaches a quote while the paid action still requires the start button',async()=>{
 const value=snapshot();value.materials=[];value.references=references;const f=fixture({item:thesis({snapshot:value})});
 try{const panel=mountOnlineThesis({id:'t1',ctx:f.ctx});await panel.ready;assert.equal(f.$('[data-thesis-quote]').disabled,false);assert.match(f.$('.thesis-source-gap').textContent,/只有题录也可以继续生成/);assert.match(f.$('.thesis-source-gap').textContent,/待补充标记/);assert.doesNotMatch(f.$('.thesis-run-controls').textContent,/100.*字符|至少.*正文/);assert.equal(f.calls.some(row=>row.data),false);f.$('[data-thesis-quote]').click();await settle();assert.equal(f.calls.filter(row=>row.path.endsWith('/quote')).length,1);assert.equal(f.$('[data-thesis-start]'),null);assert.equal(f.calls.filter(row=>row.path.endsWith('/generate')).length,1);}finally{f.close();}
});

test('a confirmed reference abstract supports quoting when optional Step 2 research uploads are empty',async()=>{
 const value=snapshot();value.materials=[];value.references=[{id:'abstract-only',title:'合成文献摘要',text:'【合成验收摘要】本文资料用于说明参考文献摘要可以成为有限的背景依据，不表示已读取全文。'.repeat(4),sourceLabel:'Crossref · 来源摘要，未读取全文',confirmed:true}];
 const f=fixture({item:thesis({snapshot:value})});try{const panel=mountOnlineThesis({id:'t1',ctx:f.ctx});await panel.ready;assert.equal(f.$('.thesis-source-gap'),null);f.$('[data-thesis-quote]').click();await settle();assert.equal(f.calls.filter(row=>row.path==='/theses/t1/quote').length,1);assert.equal(f.$('[data-thesis-start]'),null);assert.equal(f.calls.filter(row=>row.path.endsWith('/generate')).length,1);}finally{f.close();}
});

test('the draft source notice offers optional reference enrichment without forcing it or charging',async()=>{
 const f=fixture({item:thesis({snapshot:{...snapshot(),materials:[]}})});let returned=0;try{const panel=mountThesisStage({id:'t1',ctx:f.ctx,container:f.$('.dashboard'),onReferences:()=>{returned++;}});await panel.ready;assert.match(f.$('.thesis-source-gap').textContent,/第二步.*上传可选/);assert.match(f.$('.thesis-source-gap').textContent,/第三步.*摘要/);assert.match(f.$('[data-thesis-references]').textContent,/可选/);assert.equal(f.$('[data-thesis-quote]').disabled,false);f.$('[data-thesis-references]').click();assert.equal(returned,1);assert.equal(f.calls.some(row=>row.path.endsWith('/quote')||row.path.endsWith('/generate')),false);}finally{f.close();}
});


test('completed reviewable drafts keep verification metadata hidden without treating it as a source failure',async()=>{
 const original=thesis({status:'completed',snapshot:{...snapshot(),materials:[],references:[]},job:{status:'completed',stage:'completed',completedSections:2,totalSections:2,missingEvidence:['待补充实际访谈记录','待核对来源 <img src=x onerror=1>','待补充实际访谈记录']},chapters:[{id:'c1',title:'第一章',text:'研究问题与方法初稿。\n【待补充：访谈实施记录与结果】',status:'saved',version:1,sourceIds:[]}]}),before=structuredClone(original),f=fixture({item:original});
 try{const panel=mountOnlineThesis({id:'t1',ctx:f.ctx});await panel.ready;const list=f.$('.thesis-review-checklist');assert.ok(list);assert.equal(list.hidden,true);assert.match(list.textContent,/初稿已生成，请逐项核对/);assert.equal(list.querySelectorAll('li').length,2,'repeat deficiencies are shown once');assert.match(list.textContent,/待补充实际访谈记录/);assert.match(list.textContent,/待核对来源 <img src=x onerror=1>/);assert.equal(f.$('img'),null);assert.equal(f.$('.thesis-progress .thesis-error'),null);assert.equal(f.$('.thesis-source-gap'),null);assert.equal(f.$('[data-thesis-editor]').readOnly,false);assert.match(f.$('[data-thesis-editor]').value,/待补充/);assert.deepEqual(original,before);assert.equal(f.calls.some(row=>row.data),false);}finally{f.close();}
});

for(const changed of [false,true])test((changed?'changed-snapshot':'updated draft')+' keeps old failed-run diagnostics in history instead of showing a current review requirement',async()=>{
 const original=thesis({status:changed?'completed':'draft',job:{status:'needs_materials',stage:'needs_materials',snapshotChanged:changed,completedSections:0,totalSections:2,error:'旧任务：来源正文不足100字',missingEvidence:['旧任务：缺少访谈材料'],canResume:false},chapters:[{id:'c1',title:'当前保存的初稿',text:'当前正文与【待核对：研究背景】。',status:'saved',version:2,sourceIds:[]}]}),f=fixture({item:original});
 try{const panel=mountOnlineThesis({id:'t1',ctx:f.ctx});await panel.ready;assert.match(f.$('.thesis-previous-run').textContent,/上次任务记录|此前任务/);assert.match(f.$('.thesis-previous-run').textContent,/旧任务：来源正文不足100字/);assert.equal(f.$('.thesis-previous-run').open,false);assert.equal(f.$('.thesis-progress .thesis-error'),null);assert.ok(f.$('.thesis-review-checklist'));assert.equal(f.$('[data-thesis-review-scroll]').querySelectorAll('li').length,0);assert.doesNotMatch(f.$('.thesis-review-checklist').textContent,/旧任务：/);assert.match(f.$('.thesis-progress>b')?.textContent||f.$('.thesis-progress').textContent,/草稿已保存|已完成/);assert.equal(f.calls.some(row=>row.data),false);assert.match(f.$('[data-thesis-editor]').value,/当前正文/);}finally{f.close();}
});

for(const status of ['queued','running'])test(status+' keeps verification metadata hidden before the first item arrives',async()=>{
 const original=thesis({status,job:{id:'run-1',status,stage:status,completedSections:0,totalSections:3,missingEvidence:[]}}),f=fixture({item:original});
 try{const panel=mountOnlineThesis({id:'t1',ctx:f.ctx});await panel.ready;const checklist=f.$('.thesis-review-checklist'),scroll=f.$('[data-thesis-review-scroll]');assert.ok(checklist);assert.equal(checklist.hidden,true,'internal verification metadata must not be shown in the generation UI');assert.ok(scroll&&checklist.contains(scroll));assert.equal(scroll.getAttribute('data-scroll-key'),'thesis-review:t1');assert.equal(scroll.getAttribute('role'),'region');assert.equal(scroll.tabIndex,0);assert.equal(scroll.querySelectorAll('li').length,0);assert.ok(scroll.textContent.trim(),'an empty review window explains that checks are still running');assert.doesNotMatch(checklist.querySelector('h3')?.textContent||'',/初稿已生成/);assert.equal(f.calls.some(row=>row.data),false);}finally{f.close();}
});

test('queued, running and completed polling keeps identical retention guidance without changing its line content',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const copy='生成期间关闭页面不影响后台任务；已完成内容独立保存，正式使用前请核对。',original=thesis({status:'queued',job:{id:'run-1',status:'queued',stage:'queued',completedSections:0,totalSections:20,missingEvidence:[]}}),f=fixture({item:original});Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});
 try{const panel=mountOnlineThesis({id:'t1',ctx:f.ctx});await panel.ready;const paragraphs=()=>[...f.$('.thesis-progress').children].filter(row=>row.tagName==='P').map(row=>row.textContent);assert.deepEqual(paragraphs(),[copy]);assert.match(f.$('.thesis-progress > div').textContent,/排队中/);for(const [index,status] of ['running','completed'].entries()){f.setItem({...original,version:index+2,status,job:{...original.job,status,stage:status==='running'?'generating_section':'completed',completedSections:status==='running'?8:20}});t.mock.timers.tick(4000);await settle();assert.deepEqual(paragraphs(),[copy],status+' must not shorten the guidance and pull the editor upward');assert.equal(f.$('progress').value,status==='running'?40:100);}assert.match(f.$('.thesis-progress > div').textContent,/已完成/);assert.equal(f.calls.filter(row=>row.path==='/theses/t1'&&!row.data).length,3);assert.equal(f.calls.some(row=>row.data),false);}finally{f.close();t.mock.timers.reset();}
});

test('automatic warning updates stay inside one review window without moving its scroll position, focus or recovered edits',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const original=thesis({status:'running',job:{id:'run-1',status:'running',stage:'generating_section',completedSections:0,totalSections:3,missingEvidence:[]},chapters:[{id:'c1',title:'研究背景',version:1,status:'saved',text:'账户中的正文',sourceIds:[]}]}),f=fixture({item:original}),edited='尚未保存到账户的编辑正文与待核对说明。',unsafe='待核对来源 <img src=x onerror=1> & <script>unsafe()</script>';
 Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});
 window.localStorage.setItem('paperknow-thesis-edits-v1:u1:t1',JSON.stringify({schema:1,actorId:'u1',thesisId:'t1',revision:'warning-scroll-recovery',selected:'c1',chapters:[{id:'c1',text:edited,baseText:'账户中的正文',baseVersion:1}],research:null}));
 try{
  const panel=mountOnlineThesis({id:'t1',ctx:f.ctx});await panel.ready;const empty=f.$('[data-thesis-review-scroll]');assert.ok(empty);const scrollKey=empty.getAttribute('data-scroll-key');let editor=f.$('[data-thesis-editor]');assert.equal(editor.value,edited);assert.equal(editor.readOnly,true);editor.focus();editor.setSelectionRange(3,10);editor.scrollTop=91;Object.defineProperty(window,'scrollY',{configurable:true,writable:true,value:640});
  const first=['待补充真实访谈记录',unsafe,...Array.from({length:12},(_,i)=>'第 '+(i+1)+' 项：核对来源与研究记录')];f.setItem({...original,version:2,job:{...original.job,completedSections:1,missingEvidence:[...first,'  待补充真实访谈记录  ',null,' ']}});t.mock.timers.tick(4000);await settle();
  const scroll=f.$('[data-thesis-review-scroll]');assert.ok(scroll);assert.equal(scroll.getAttribute('data-scroll-key'),scrollKey);assert.equal(scroll.querySelectorAll('li').length,first.length);assert.deepEqual([...scroll.querySelectorAll('li')].map(row=>row.querySelector('p').textContent),first);assert.match(scroll.textContent,/<img src=x onerror=1>/);assert.equal(f.$('img,script'),null);assert.equal(f.$('.thesis-progress > .thesis-error'),null,'verification notes must not create a second page-growing error paragraph');assert.equal(document.activeElement,f.$('[data-thesis-editor]'));assert.equal(f.$('[data-thesis-editor]').value,edited);assert.equal(f.$('[data-thesis-editor]').selectionStart,3);assert.equal(f.$('[data-thesis-editor]').selectionEnd,10);assert.equal(f.$('[data-thesis-editor]').scrollTop,91);assert.equal(window.scrollY,640);
  scroll.scrollTop=123;editor=f.$('[data-thesis-editor]');editor.focus();editor.setSelectionRange(5,12);editor.scrollTop=107;const final=[...first,'补充最终分析所需的实际研究数据'];f.setItem({...original,version:3,status:'completed',job:{...original.job,status:'completed',stage:'completed',completedSections:3,missingEvidence:[...final,unsafe]},chapters:[{...original.chapters[0],text:'账户中的正文'}]});t.mock.timers.tick(4000);await settle();
  const completed=f.$('[data-thesis-review-scroll]');assert.ok(completed&&f.$('.thesis-review-checklist').contains(completed));assert.equal(completed.getAttribute('data-scroll-key'),scrollKey);assert.equal(completed.scrollTop,123,'completion must preserve the reader position instead of jumping to the newest item');assert.deepEqual([...completed.querySelectorAll('li')].map(row=>row.querySelector('p').textContent),final);assert.equal(f.$('.thesis-progress > .thesis-error'),null);assert.equal(f.$('[data-thesis-editor]').readOnly,false);assert.equal(f.$('[data-thesis-editor]').value,edited);assert.equal(document.activeElement,f.$('[data-thesis-editor]'));assert.equal(f.$('[data-thesis-editor]').selectionStart,5);assert.equal(f.$('[data-thesis-editor]').selectionEnd,12);assert.equal(f.$('[data-thesis-editor]').scrollTop,107);assert.equal(window.scrollY,640);assert.equal(thesisOnlineHasWork(),true);assert.equal(JSON.parse(window.localStorage.getItem('paperknow-thesis-edits-v1:u1:t1')).chapters[0].text,edited);assert.equal(f.calls.filter(row=>row.path==='/theses/t1'&&!row.data).length,3,'two real scheduled refreshes ran');assert.equal(f.calls.some(row=>row.data),false,'polling never saves or starts a task');
 }finally{f.close();t.mock.timers.reset();}
});

test('an unchanged scheduled response keeps the existing editor and review DOM nodes intact',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const original=thesis({status:'running',job:{id:'run-1',status:'running',stage:'generating_section',completedSections:1,totalSections:3,missingEvidence:['待核对当前研究依据']},chapters:[{id:'c1',title:'研究背景',version:1,status:'saved',text:'正在处理时可查看的已保存正文',sourceIds:[]}]}),f=fixture({item:original});Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});
 try{const panel=mountOnlineThesis({id:'t1',ctx:f.ctx});await panel.ready;const editor=f.$('[data-thesis-editor]'),scroll=f.$('[data-thesis-review-scroll]'),checklist=f.$('.thesis-review-checklist');assert.ok(scroll);scroll.scrollTop=51;editor.focus();editor.setSelectionRange(2,8);t.mock.timers.tick(4000);await settle();assert.equal(f.calls.filter(row=>row.path==='/theses/t1'&&!row.data).length,2);assert.equal(f.$('[data-thesis-editor]'),editor,'identical polling data must not replace the editor');assert.equal(f.$('[data-thesis-review-scroll]'),scroll,'identical polling data must not recreate the scrolling region');assert.equal(f.$('.thesis-review-checklist'),checklist);assert.equal(scroll.scrollTop,51);assert.equal(document.activeElement,editor);assert.equal(editor.selectionStart,2);assert.equal(editor.selectionEnd,8);assert.equal(f.calls.some(row=>row.data),false);}finally{f.close();t.mock.timers.reset();}
});

test('generated section previews stay collapsed until opened and preserve reading state when the chapter completes',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const chapter={id:'c1',title:'研究背景',version:0,status:'pending',text:'',sourceIds:[],totalSections:2},original=thesis({status:'running',job:{id:'run-1',status:'running',stage:'generating_section',completedSections:0,totalSections:2},chapters:[chapter],sections:[]}),first={id:'s1',chapterId:'c1',status:'completed',text:'已完成的第一个小节，包含待核对研究说明。',sourceIds:[]},f=fixture({item:original});Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});
 try{
  const panel=mountOnlineThesis({id:'t1',ctx:f.ctx});await panel.ready;assert.equal(f.$('[data-thesis-parts-panel]').open,false);f.setItem({...original,version:2,job:{...original.job,completedSections:1},sections:[first]});t.mock.timers.tick(4000);await settle();assert.equal(f.$('[data-thesis-parts-panel]').open,false,'a newly saved section must not expand the page');assert.equal(f.$('[data-thesis-parts-summary] small').textContent,'1 / 2');const parts=f.$('[data-thesis-parts-panel]'),scroll=f.$('[data-thesis-parts-scroll]'),part=f.$('[data-thesis-view-key="part:s1"]'),text=part.querySelector('pre');assert.equal(scroll.getAttribute('data-scroll-key'),'thesis-parts:c1');parts.open=true;part.open=true;scroll.scrollTop=81;text.scrollTop=29;f.$('[data-thesis-part-summary="s1"]').focus();
  f.setItem({...original,version:3,status:'completed',job:{...original.job,status:'completed',stage:'completed',completedSections:2},chapters:[{...chapter,status:'saved',version:1,text:first.text+'\n第二个小节的账户正文'}],sections:[first,{id:'s2',chapterId:'c1',status:'completed',text:'第二个已经保存的小节。',sourceIds:[]}]});t.mock.timers.tick(4000);await settle();assert.equal(f.$('[data-thesis-parts-panel]').open,true,'completion must keep the same preview surface and user expansion choice');assert.equal(f.$('[data-thesis-view-key="part:s1"]').open,true);assert.equal(f.$('[data-thesis-view-key="part:s2"]').open,false);assert.equal(f.$('[data-thesis-parts-summary] small').textContent,'2 / 2');assert.equal(f.$('[data-thesis-parts-scroll]').scrollTop,81);assert.equal(f.$('[data-thesis-view-key="part:s1"] pre').scrollTop,29);assert.equal(document.activeElement,f.$('[data-thesis-part-summary="s1"]'));assert.equal(f.$('[data-thesis-editor]').readOnly,false);assert.match(f.$('[data-thesis-editor]').value,/第二个小节的账户正文/);assert.equal(f.calls.some(row=>row.data),false);
 }finally{f.close();t.mock.timers.reset();}
});

test('the production review layout has a fixed height before and after many warnings, and latest only scrolls its own list',async()=>{
 const original=thesis(),f=fixture({item:original});
 try{
  const style=document.createElement('style');style.textContent=readFileSync(new URL('../dist/workspace/thesis-detail-commercial.css',import.meta.url),'utf8');document.head.append(style);const panel=mountOnlineThesis({id:'t1',ctx:f.ctx});await panel.ready;assert.ok(f.$('.thesis-review-checklist'));const height=window.getComputedStyle(f.$('.thesis-review-checklist')).height;assert.equal(height,'260px','a draft with no task already reserves the final review window height');
  f.setItem({...original,version:2,status:'completed',job:{id:'run-1',status:'completed',stage:'completed',completedSections:3,totalSections:3,missingEvidence:Array.from({length:40},(_,i)=>'待补充第 '+(i+1)+' 项实际研究资料')}});f.$('[data-thesis-refresh]').click();await settle();const frame=f.$('.thesis-review-checklist'),scroll=f.$('[data-thesis-review-scroll]'),scrollerStyle=window.getComputedStyle(scroll);assert.equal(window.getComputedStyle(frame).height,height);assert.equal(scrollerStyle.overflow,'auto');assert.equal(scroll.querySelectorAll('li').length,40);Object.defineProperty(scroll,'scrollHeight',{configurable:true,value:1700});scroll.scrollTop=28;Object.defineProperty(window,'scrollY',{configurable:true,writable:true,value:560});let pageScrolls=0;window.scrollTo=()=>{pageScrolls++;};const button=f.$('[data-thesis-review-latest]');assert.ok(button);button.focus();button.click();assert.equal(scroll.scrollTop,1700);assert.equal(document.activeElement,button,'reading the latest item does not move keyboard focus into the list');assert.equal(window.scrollY,560);assert.equal(pageScrolls,0);assert.equal(f.$('[data-thesis-review-scroll]'),scroll);assert.equal(f.calls.some(row=>row.data),false);
 }finally{f.close();}
});

test('a completed run from a different snapshot keeps its old gaps out of the current review window',async()=>{
 const old='旧版本缺少的实验材料不属于本稿',f=fixture({item:thesis({status:'completed',job:{id:'old-run',status:'completed',stage:'completed',snapshotChanged:true,completedSections:3,totalSections:3,missingEvidence:[old]},chapters:[{id:'c1',title:'当前初稿',version:2,status:'saved',text:'当前保存的正文',sourceIds:[]}]})});
 try{const panel=mountOnlineThesis({id:'t1',ctx:f.ctx});await panel.ready;assert.ok(f.$('.thesis-review-checklist'));assert.equal(f.$('[data-thesis-review-scroll]').querySelectorAll('li').length,0);assert.doesNotMatch(f.$('.thesis-review-checklist').textContent,/旧版本缺少的实验材料/);assert.match(f.$('.thesis-previous-run').textContent,/旧版本缺少的实验材料/);assert.equal(f.$('.thesis-previous-run').open,false);assert.doesNotMatch(f.$('.thesis-editor').textContent,/旧版本缺少的实验材料/);assert.equal(f.$('[data-thesis-editor]').value,'当前保存的正文');assert.equal(f.calls.some(row=>row.data),false);}finally{f.close();}
});


test('changed active progress updates in place while preserving editor, open previews and reader controls',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const section={id:'s1',chapterId:'c1',status:'completed',text:'第一个已经保存的小节。',sourceIds:[]},chapter={id:'c1',title:'研究背景',version:1,status:'partial',text:'已经保存的章节内容。',sourceIds:[],totalSections:3},original=thesis({status:'queued',job:{id:'run-steady',status:'queued',stage:'queued',completedSections:1,totalSections:3,missingEvidence:['核对已有研究记录']},chapters:[chapter],sections:[section]}),f=fixture({item:original});
 Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});
 try{
  const panel=mountOnlineThesis({id:'t1',ctx:f.ctx});await panel.ready;
  const editor=f.$('[data-thesis-editor]'),progress=f.$('.thesis-progress'),wait=f.$('[data-thesis-wait]'),review=f.$('[data-thesis-review-scroll]'),parts=f.$('[data-thesis-parts-panel]'),partScroll=f.$('[data-thesis-parts-scroll]'),quality=f.$('[data-thesis-quality-panel]'),qualityScroll=f.$('[data-thesis-quality-scroll]'),latest=f.$('[data-thesis-review-latest]');
  assert.equal(wait.getAttribute('aria-busy'),'true');assert.match(wait.textContent,/等待开始/);
  parts.open=true;quality.open=true;review.scrollTop=56;partScroll.scrollTop=49;qualityScroll.scrollTop=38;editor.scrollTop=27;editor.focus();editor.setSelectionRange(1,5);editor.style.height='635px';
  f.setItem({...original,version:2,status:'running',job:{...original.job,status:'running',stage:'generating_section',completedSections:2,missingEvidence:['核对已有研究记录','补充实际样本来源']},chapters:[{...chapter,text:'新保存的章节内容，保留读取位置。',version:2}],sections:[section,{id:'s2',chapterId:'c1',status:'completed',text:'第二个新保存的小节。',sourceIds:[]}]});
  t.mock.timers.tick(4000);await settle();
  for(const [selector,node] of [['[data-thesis-editor]',editor],['.thesis-progress',progress],['[data-thesis-wait]',wait],['[data-thesis-review-scroll]',review],['[data-thesis-parts-panel]',parts],['[data-thesis-parts-scroll]',partScroll],['[data-thesis-quality-panel]',quality],['[data-thesis-quality-scroll]',qualityScroll],['[data-thesis-review-latest]',latest]])assert.equal(f.$(selector),node,selector+' must retain its existing DOM node');
  assert.equal(document.activeElement,editor);assert.equal(editor.selectionStart,1);assert.equal(editor.selectionEnd,5);assert.equal(editor.style.height,'635px');assert.equal(editor.scrollTop,27);assert.match(editor.value,/新保存的章节内容/);assert.equal(review.scrollTop,56);assert.equal(partScroll.scrollTop,49);assert.equal(qualityScroll.scrollTop,38);assert.equal(parts.open,true);assert.equal(quality.open,true);assert.equal(review.querySelectorAll('li').length,2);assert.equal(f.$('[data-thesis-parts-summary] small').textContent,'2 / 3');assert.match(wait.textContent,/正在生成论文/);assert.equal(f.$('progress').value,66);
  Object.defineProperty(review,'scrollHeight',{configurable:true,value:760});latest.click();assert.equal(review.scrollTop,760,'retained control still has its single working handler');assert.equal(f.calls.some(row=>row.data),false);
 }finally{f.close();t.mock.timers.reset();}
});

test('generation feedback remains a fixed reading surface and has no simulated progress or forced scrolling',async()=>{
 const f=fixture({item:thesis({status:'running',job:{id:'run-1',status:'running',stage:'agent_running',completedSections:0,totalSections:3}})});
 try{const style=document.createElement('style');style.textContent=readFileSync(new URL('../dist/workspace/thesis-online.css',import.meta.url),'utf8');document.head.append(style);const panel=mountOnlineThesis({id:'t1',ctx:f.ctx});await panel.ready;const wait=f.$('[data-thesis-wait]');assert.equal(window.getComputedStyle(wait).height,'92px');assert.equal(wait.getAttribute('role'),'status');assert.equal(wait.getAttribute('aria-busy'),'true');assert.match(wait.textContent,/无需重复点击/);assert.equal(f.$('progress').value,0);assert.equal(f.calls.some(row=>row.data),false);assert.match(style.textContent,/prefers-reduced-motion:reduce/);}finally{f.close();}
});


test('one-click generation shows immediate waiting through both usage checking and task submission',async()=>{
 let resolveQuote,resolveSubmission;const feeResponse=new Promise(resolve=>resolveQuote=resolve),submissionResponse=new Promise(resolve=>resolveSubmission=resolve),queued=thesis({version:2,status:'queued',job:{id:'submitted-job',status:'queued',stage:'queued',completedSections:0,totalSections:3}}),f=fixture({handler:path=>path.endsWith('/quote')?feeResponse:path.endsWith('/generate')?submissionResponse:undefined});try{const panel=mountOnlineThesis({id:'t1',ctx:f.ctx});await panel.ready;f.$('[data-thesis-quote]').click();await settle();assert.equal(f.$('[data-thesis-wait]').getAttribute('aria-busy'),'true');assert.match(f.$('[data-thesis-wait-title]').textContent,/正在提交生成任务/);assert.equal(f.$('[data-thesis-quote]').disabled,true);resolveQuote(quote());await settle();assert.equal(f.calls.filter(row=>row.path.endsWith('/generate')).length,1);assert.equal(f.$('[data-thesis-wait]').getAttribute('aria-busy'),'true');assert.match(f.$('[data-thesis-wait]').textContent,/无需重复点击/);assert.equal(f.$('[data-thesis-start]'),null);resolveSubmission({item:queued});await settle();assert.match(f.$('[data-thesis-wait-title]').textContent,/已提交，等待开始/);assert.equal(f.calls.filter(row=>row.path.endsWith('/generate')).length,1);}finally{resolveQuote(quote());resolveSubmission({item:queued});await settle();f.close();}
});

test('citation inventory uses global first appearance, locates across chapters and retains uncited metadata without any write',async()=>{
 const value=thesis({status:'completed',chapters:[{id:'c1',title:'第一章',version:1,text:'前文引用 [source:b]。',sourceIds:['b']},{id:'c2',title:'第二章',version:1,text:'讨论引用 [source:a] 与再次引用 [source:b]。',sourceIds:['a','b']}]});
 value.snapshot.references=[{id:'a',title:'文献甲',confirmed:true},{id:'b',title:'文献乙',confirmed:true},{id:'c',title:'候选 <script>不可执行</script>',confirmed:true}];
 const f=fixture({item:value});try{const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;
  const panel=f.$('.thesis-bibliography');assert.match(panel.textContent,/已引用 2 篇 · 待引用 1 篇/);assert.match(panel.textContent,/仅题录，未读取原文/);assert.equal(panel.querySelector('script'),null);assert.equal(panel.open,false);
  panel.open=true;f.$('[data-thesis-cite-locate="a"]').click();assert.equal(f.$('[data-thesis-editor]').value,'讨论引用 〔文献2〕 与再次引用 〔文献1〕。');assert.equal(f.$('[data-thesis-editor]').value.slice(f.$('[data-thesis-editor]').selectionStart,f.$('[data-thesis-editor]').selectionEnd),'〔文献2〕');assert.equal(f.$('.thesis-bibliography').open,true);assert.equal(f.calls.filter(row=>row.data).length,0);
 }finally{f.close();}
});

test('explicit citation insertion preserves canonical source markers and unsaved prose without automatically saving or generating',async()=>{
 const value=thesis({status:'completed',chapters:[{id:'c1',title:'第一章',version:1,status:'saved',text:'账户原文。',sourceIds:[]}]});value.snapshot.references=[{id:'r1',title:'已选题录',confirmed:true}];
 const f=fixture({item:value});try{const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;
  input(f,'[data-thesis-editor]','我的修改正文。');f.$('[data-thesis-editor]').setSelectionRange(6,6);f.$('[data-thesis-cite-insert="r1"]').click();
  assert.equal(f.$('[data-thesis-editor]').value,'我的修改正文〔文献1〕。');assert.match(f.$('.thesis-bibliography').textContent,/已引用 1 篇 · 待引用 0 篇/);assert.match(f.$('[data-thesis-notice]').textContent,/尚未保存/);assert.equal(f.calls.filter(row=>row.data).length,0);assert.equal(f.$('#thesis-online-docx').disabled,true);
  f.$('[data-thesis-save-chapter]').click();await settle();assert.equal(f.calls.find(row=>row.path==='/theses/t1/chapters/c1'&&row.data)?.data.text,'我的修改正文[source:r1]。');assert.equal(f.$('#thesis-online-docx').disabled,false);assert.equal(f.calls.some(row=>row.path.endsWith('/generate')),false);
 }finally{f.close();}
});

test('citation inventory stays available while generating but never inserts into read-only chapters',async()=>{
 const value=thesis({status:'running',job:{id:'job-1',status:'running'},chapters:[{id:'c1',title:'第一章',version:1,text:'保存正文 [source:r1]。'}]}),f=fixture({item:value});try{const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;
  assert.equal(f.$('[data-thesis-cite-insert="r1"]').disabled,true);assert.equal(f.$('[data-thesis-cite-locate="r1"]').disabled,false);f.$('[data-thesis-cite-locate="r1"]').click();assert.equal(f.$('[data-thesis-editor]').readOnly,true);assert.equal(f.calls.filter(row=>row.data).length,0);
 }finally{f.close();}
});

test('inserting a citation after a selected claim never replaces the selected original',async()=>{
 const value=thesis({status:'completed',chapters:[{id:'c1',title:'第一章',version:1,text:'保留选中的完整论述[source:r1]与结尾。',sourceIds:['r1']}]});value.snapshot.references=[{id:'r1',title:'既有引用',confirmed:true},{id:'r2',title:'新引用',confirmed:true}];
 const f=fixture({item:value});try{const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;
  const editor=f.$('[data-thesis-editor]');editor.setSelectionRange(0,9);f.$('[data-thesis-cite-insert="r2"]').click();assert.match(f.$('[data-thesis-editor]').value,/保留选中的完整论述〔文献1〕〔文献2〕与结尾。/);f.$('[data-thesis-save-chapter]').click();await settle();assert.equal(f.calls.find(row=>row.path==='/theses/t1/chapters/c1'&&row.data)?.data.text,'保留选中的完整论述[source:r2][source:r1]与结尾。');
 }finally{f.close();}
});

test('completed section previews use the same whole-manuscript citation numbers as the chapter editor',async()=>{
 const value=thesis({status:'completed',chapters:[{id:'c1',title:'第一章',version:1,text:'先引乙[source:b]，再引甲[source:a]。',sourceIds:['a','b']}],sections:[{id:'s1',chapterId:'c1',status:'completed',text:'先引乙[source:b]，再引甲[source:a]。'}]});value.snapshot.references=[{id:'a',title:'甲',confirmed:true},{id:'b',title:'乙',confirmed:true}];
 const f=fixture({item:value});try{const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;assert.equal(f.$('.thesis-completed-sections pre').textContent,f.$('[data-thesis-editor]').value);assert.match(f.$('.thesis-completed-sections pre').textContent,/先引乙〔文献1〕，再引甲〔文献2〕/);}finally{f.close();}
});

test('reusing a reference at a caret inside an existing token preserves that token and focuses the newly inserted occurrence',async()=>{
 const value=thesis({status:'completed',chapters:[{id:'c1',title:'第一章',version:1,text:'原有论述[source:r1]，新的论述。',sourceIds:['r1']}]});value.snapshot.references=[{id:'r1',title:'既有来源',confirmed:true}];const f=fixture({item:value});try{const stop=mountOnlineThesis({id:'t1',ctx:f.ctx});await stop.ready;
  const before=f.$('[data-thesis-editor]');before.setSelectionRange(6,6);f.$('[data-thesis-cite-insert="r1"]').click();const after=f.$('[data-thesis-editor]');assert.equal(after.value,'原有论述〔文献1〕〔文献1〕，新的论述。');assert.equal(after.selectionStart,after.value.lastIndexOf('〔文献1〕'));f.$('[data-thesis-save-chapter]').click();await settle();assert.equal(f.calls.find(row=>row.path==='/theses/t1/chapters/c1'&&row.data).data.text,'原有论述[source:r1][source:r1]，新的论述。');
 }finally{f.close();}
});

test('standalone thesis keeps the only template picker in knowledge and final delivery has exactly two DOCX modes',async()=>{
 const f=fixture();try{const panel=mountOnlineThesis({id:'t1',ctx:f.ctx});await panel.ready;
 assert.equal(document.querySelectorAll('[data-template-file]').length,1);
 assert.ok(f.$('[data-template-file]').closest('[data-thesis-template-knowledge]'));
 assert.equal(f.$('.thesis-export [data-template-file]'),null);
 assert.equal(f.$('.thesis-export [data-template-manage]'),null);assert.equal(f.$('.thesis-export [data-template-summary]'),null);assert.deepEqual([...document.querySelectorAll('.thesis-export [data-document-export]')].map(node=>node.dataset.documentExport),['draft','docx']);
 assert.equal(f.calls.some(row=>/quote|generate/.test(row.path)),false);
 }finally{f.close();}
});
test('embedded thesis exports without a duplicate template picker',async()=>{
 const f=fixture();let returned=0;try{const panel=mountThesisStage({id:'t1',ctx:f.ctx,container:f.$('.dashboard'),onTemplateSettings:()=>returned++});await panel.ready;
 assert.equal(f.$('[data-template-file]'),null);assert.equal(f.$('[data-template-summary]'),null);assert.deepEqual([...document.querySelectorAll('.thesis-export [data-document-export]')].map(node=>node.dataset.documentExport),['draft','docx']);assert.equal(returned,0);assert.equal(f.calls.some(row=>/quote|generate/.test(row.path)),false);
 }finally{f.close();}
});
