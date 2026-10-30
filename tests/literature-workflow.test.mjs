import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readingWorkflowMarkup,updateReadingWorkflow,bindReadingWorkflow} from '../dist/workspace/literature-workflow.mjs';
import {mountLiteratureDiscovery} from '../dist/workspace/literature-discovery.mjs';
import {mountLiteratureAi} from '../dist/workspace/literature-ai.mjs';
import {mountDocumentTranslation} from '../dist/workspace/document-translation.mjs';
import {validateSavedLiteratureAiResults} from '../dist/workspace/literature-ai-model.mjs';
const reply=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>structuredClone(body)});
const until=async check=>{for(let i=0;i<200;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,3));}assert.ok(check(),'Workflow did not settle');};
function fixture(t,hash='#category/literature'){
 const dom=new JSDOM('<div id="app"><main class="dashboard"><div id="host"></div></main></div>',{url:'https://reading.test/workspace.html'+hash});
 const old={};for(const key of ['window','document','localStorage','FormData','location','AbortController','MutationObserver']){old[key]=globalThis[key];globalThis[key]=dom.window[key];}
 const scrolls=[];dom.window.HTMLElement.prototype.scrollIntoView=function(){scrolls.push(this);};
 const f={w:dom.window,host:dom.window.document.querySelector('#host'),$:s=>dom.window.document.querySelector(s),scrolls,disposers:[],input(selector,value,type='input'){const node=this.$(selector);assert.ok(node,selector);node.value=value;node.dispatchEvent(new dom.window.Event(type,{bubbles:true}));}};
 t.after(()=>{for(const dispose of f.disposers)dispose();Object.assign(globalThis,old);dom.window.close();});return f;
}
const nav=f=>f.$('[data-reading-workflow]');
const record=()=>({id:'paper1',title:'Synthetic research',scope:'full',text:'First actual paragraph describes a verified research method.\n\nSecond actual paragraph describes evidence and limitations.',notes:[],aiResults:[]});
function aiFixture(t,operation='read',options={}){
 const f=fixture(t,'#literature/paper1');let paper=record(),job,snapshot;const calls=[];
 const nativeTimeout=f.w.setTimeout.bind(f.w);f.w.setTimeout=(fn,ms,...args)=>nativeTimeout(fn,ms===2500||ms===1000?5:ms,...args);
 const ctx={notify(){},api:async(path,data)=>{calls.push({path,data});if(path==='/auth/me')return {user:{id:'owner'}};if(path==='/tool-runs/capabilities')return {ready:true};if(path==='/tool-runs/quote')return {type:'agent',source:'credits',title:'Reading',token:'flow-quote',creditCost:10,expiresAt:new Date(Date.now()+60000).toISOString()};if(path==='/tool-runs/jobs'){snapshot=data.snapshot;job={id:'flow-job',kind:'literature',operation,status:'queued',completedUnits:0,totalUnits:2};return {item:job};}if(path==='/tool-runs/jobs/flow-job')return {item:job};throw Error('Unexpected API '+path);}};
 if(options.paper)paper=options.paper;
 const ui=mountLiteratureAi({container:f.host,ctx,getPaper:()=>paper,updatePaper:fn=>{paper=fn(paper);},initialOperation:operation});f.disposers.push(()=>ui.dispose());
 return {...f,calls,paper:()=>paper,job:()=>job,snapshot:()=>snapshot,setStatus(status){job={...job,status};},complete(){const materials=snapshot.materials;job={...job,status:'completed',completedUnits:2,output:{text:'Research interpretation grounded in the selected source.',sourceIds:materials.map(p=>p.id),...(operation==='translate'?{targetLanguage:snapshot.language,segments:materials.map(part=>({id:part.id,source:part.text,translation:'Translated source paragraph.'}))}:{citations:materials.map(part=>({sourceId:part.id,quote:part.text.slice(0,20)}))})}};}};
}

test('workflow changes only existing step nodes and navigation never invokes a processing action',t=>{
 const f=fixture(t);f.host.innerHTML=readingWorkflowMarkup('read');const element=nav(f),buttons=[...element.querySelectorAll('button')],visits=[];bindReadingWorkflow(element,step=>visits.push(step));
 updateReadingWorkflow(element,{step:2,phase:'review',hint:'<script>plain text</script>',disabled:[4]});assert.equal(element.querySelector('script'),null);assert.match(element.textContent,/<script>plain text/);buttons[1].click();buttons[3].click();assert.deepEqual(visits,[2]);
 updateReadingWorkflow(element,{step:3,phase:'running',hint:'Processing',disabled:[4]});assert.deepEqual([...element.querySelectorAll('button')],buttons);assert.equal(buttons[2].getAttribute('aria-current'),'step');assert.equal(buttons[0].querySelector('[data-reading-workflow-number]').textContent,'✓');assert.equal(f.scrolls.length,0);
});

test('discovery shows a stable search state, ignores cancelled late replies, then saves and invalidates the right result',async t=>{
 const f=fixture(t,'#category/literature?view=search');let release,held=true;const calls=[],imports=[];
 const row={id:'paper-search',title:'Verified research title',authors:'Author',year:2025,doi:'10.1000/flow',source:'crossref',sourceId:'10.1000/flow',documentType:'journal'};
 const api=mountLiteratureDiscovery({container:f.host,modal(){},getExisting:()=>[],onImport:rows=>imports.push(rows),fetcher:async url=>{calls.push(url);if(['/api/capabilities','/api/literature/capabilities'].includes(url))return reply({academicSearchSources:['crossref']});if(held)return new Promise(resolve=>release=resolve);return reply({items:[row],page:1,hasMore:false});}});f.disposers.push(()=>api.dispose());await api.ready;
 const element=nav(f),buttons=[...element.querySelectorAll('button')];f.input('[name=q]','verified research');assert.equal(element.dataset.currentStep,'2');const input=f.$('[name=q]');f.$('form').dispatchEvent(new f.w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>!!release);assert.equal(element.dataset.phase,'searching');assert.equal(f.$('[data-ld-wait]').hidden,false);assert.equal(f.$('[data-ld-results]').hidden,true);assert.equal(f.$('[name=q]'),input);
 f.$('[data-ld-cancel]').click();assert.equal(element.dataset.phase,'cancelled');release(reply({items:[row],page:1}));await new Promise(resolve=>setTimeout(resolve,8));assert.equal(f.$('[data-ld-pick]'),null);assert.equal(imports.length,0);
 held=false;await api.search();assert.equal(element.dataset.currentStep,'3');const pick=f.$('[data-ld-pick]');pick.checked=true;pick.dispatchEvent(new f.w.Event('change',{bubbles:true}));f.$('[data-ld-import]').click();await until(()=>element.dataset.phase==='complete');assert.equal(element.dataset.currentStep,'4');assert.equal(imports.length,1);assert.deepEqual([...element.querySelectorAll('button')],buttons);
 f.input('[name=q]','different research');assert.equal(element.dataset.currentStep,'1');assert.equal(element.querySelector('[data-reading-workflow-step="4"]').disabled,true);assert.equal(imports.length,1);
});

for(const operation of ['read','answer','translate'])test(operation+' keeps a single visible workflow from one-click submission to saved result and changed settings',async t=>{
 const f=aiFixture(t,operation);if(operation==='answer')f.input('[data-lit-ai-question]','What method was used?');const element=nav(f),input=f.$('[data-lit-ai-start]'),buttons=[...element.querySelectorAll('button')];assert.equal(element.dataset.currentStep,'2');buttons[1].click();assert.equal(f.calls.length,0);
 f.$('[data-lit-ai-open]').click();f.$('[data-lit-ai-open]').click();await until(()=>element.dataset.phase==='queued');assert.equal(f.calls.filter(c=>c.path==='/tool-runs/jobs').length,1);f.setStatus('running');await until(()=>element.dataset.phase==='running');assert.deepEqual([...element.querySelectorAll('button')],buttons);assert.equal(f.$('[data-lit-ai-start]'),input);
 f.complete();await until(()=>nav(f)?.dataset.phase==='complete');assert.equal(nav(f).dataset.currentStep,'4');assert.equal(f.paper().aiResults.length,1);assert.equal(f.$('[data-tj-consent]'),null);assert.ok(f.$('[data-reading-result-current]'));assert.equal(f.scrolls.length,1,'only the explicit step navigation scrolls');
 if(operation==='answer')f.input('[data-lit-ai-question]','What limitations are described?');else if(operation==='translate')f.input('[data-lit-ai-language]','en');else f.input('[data-lit-ai-end]','1');
 assert.equal(nav(f).dataset.currentStep,'2');assert.equal(nav(f).querySelector('[data-reading-workflow-step="4"]').disabled,true);assert.equal(f.paper().aiResults.length,1);assert.equal(f.calls.filter(c=>c.path==='/tool-runs/jobs').length,1);
});

test('failed reading and metadata-only input never mark an uncreated result as complete',async t=>{
 const f=aiFixture(t);f.$('[data-lit-ai-open]').click();await until(()=>!!f.job());f.setStatus('failed');await until(()=>nav(f).dataset.phase==='failed');assert.equal(nav(f).dataset.currentStep,'3');assert.equal(nav(f).querySelector('[data-reading-workflow-step="4"]').disabled,true);assert.equal(f.paper().aiResults.length,0);
});

test('changing the next question returns to review while keeping the saved answer without a history checkbox',async t=>{
 const f=aiFixture(t,'answer');f.input('[data-lit-ai-question]','What method was used?');f.$('[data-lit-ai-open]').click();await until(()=>!!f.job());f.complete();await until(()=>nav(f)?.dataset.phase==='complete');
 assert.equal(f.$('[data-lit-include-history]'),null);f.input('[data-lit-ai-question]','What are the limitations?');await new Promise(resolve=>setTimeout(resolve,180));assert.equal(nav(f).dataset.phase,'review');assert.equal(nav(f).dataset.currentStep,'2');assert.equal(nav(f).querySelector('[data-reading-workflow-step="4"]').disabled,true);assert.equal(f.paper().aiResults.length,1);assert.equal(f.calls.filter(c=>c.path==='/tool-runs/jobs').length,1);
});

test('a bibliographic record without source text starts at material preparation without any request',t=>{
 const f=aiFixture(t,'read',{paper:{...record(),scope:'metadata',text:''}});assert.equal(nav(f).dataset.currentStep,'1');assert.equal(f.$('[data-lit-ai-open]'),null);assert.equal(f.calls.length,0);assert.ok([...nav(f).querySelectorAll('button')].slice(1).every(button=>button.disabled));
});

function documentFixture(t,{status='running',withArtifact=true}={}){
 const f=fixture(t);let jobStatus=status;const calls=[];const job=()=>({id:'doc-job',fileName:'Source.pdf',sourceLanguage:'en',targetLanguage:'zh',status:jobStatus,...(jobStatus==='completed'?{result:{artifacts:withArtifact?[{downloadUrl:'/api/artifacts/translation-flow/download'}]:[]}}:{})});
 const ui=mountDocumentTranslation({container:f.host,notify(){},pollInterval:600000,fetchImpl:async(url,init)=>{const data=init.body?JSON.parse(init.body):undefined;calls.push({url,data});if(url==='/api/auth/me')return reply({user:{id:'owner'}});if(['/api/capabilities','/api/literature/capabilities'].includes(url))return reply({documentTranslation:{ready:true}});if(url==='/api/files')return reply({items:[{id:'source',name:'Source.pdf',bytes:100}]});if(url==='/api/document-translations')return data?reply({id:'doc-job'},201):reply({items:[]});if(url==='/api/document-translations/doc-job')return reply(job());throw Error('Unexpected API '+url);}});f.disposers.push(()=>ui.dispose());return {...f,calls,ready:ui.ready,setStatus:value=>jobStatus=value};
}

test('document translation follows owned file, settings, stable processing and an actual downloadable result',async t=>{
 const f=documentFixture(t);await f.ready;const element=nav(f);assert.equal(element.dataset.currentStep,'1');f.input('[data-doc-file]','source','change');assert.equal(element.dataset.currentStep,'2');f.$('[data-doc-consent]').checked=true;f.$('form').dispatchEvent(new f.w.Event('submit',{bubbles:true,cancelable:true}));f.$('form').dispatchEvent(new f.w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>element.dataset.phase==='running');assert.equal(f.calls.filter(c=>c.url==='/api/document-translations'&&c.data).length,1);const detail=f.$('.document-service-result'),task=f.$('[data-doc-translation-open]');task.click();await new Promise(resolve=>setTimeout(resolve,10));assert.equal(f.$('.document-service-result'),detail);assert.equal(f.$('[data-doc-translation-open]'),task);
 f.setStatus('completed');task.click();await until(()=>element.dataset.phase==='complete');assert.equal(element.dataset.currentStep,'4');assert.ok(f.$('[data-doc-translation-detail] a'));f.input('[data-doc-source]','zh','change');assert.equal(element.dataset.currentStep,'2');assert.ok(f.$('[data-doc-translation-detail] a'),'previous result remains available');assert.equal(f.calls.filter(c=>c.url==='/api/document-translations'&&c.data).length,1);
});

for(const status of ['completed','failed','cancelled'])test('document '+status+' without a downloadable file does not complete the delivery step',async t=>{
 const f=documentFixture(t,{status,withArtifact:false});await f.ready;f.input('[data-doc-file]','source','change');f.$('[data-doc-consent]').checked=true;f.$('form').dispatchEvent(new f.w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>f.$('.document-service-result'));assert.equal(nav(f).dataset.currentStep,'3');assert.equal(nav(f).dataset.phase,status==='completed'?'result_unavailable':status);assert.equal(nav(f).querySelector('[data-reading-workflow-step="4"]').disabled,true);assert.equal(f.$('[data-doc-translation-detail] a'),null);
});

test('question-history choice survives result backup and rejects invalid settings',()=>{
 const source=record().text.split('\n\n')[0],result={id:'answer',jobId:'answer-job',operation:'answer',includeHistory:true,sourceScope:'full',question:'Method?',language:'',materials:[{id:'p1',name:'Source',text:source}],output:{text:'Grounded answer',sourceIds:['p1'],citations:[{sourceId:'p1',quote:'actual paragraph'}]},createdAt:'2026-10-29'};
 assert.equal(validateSavedLiteratureAiResults([result])[0].includeHistory,true);assert.throws(()=>validateSavedLiteratureAiResults([{...result,includeHistory:'true'}]),/问答设置/);assert.throws(()=>validateSavedLiteratureAiResults([{...result,operation:'read'}]),/问答设置/);
});
