import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountRevisionProduct,revisionProductSpec} from '../dist/workspace/revision-product.mjs';
import {beginDraftScope,endDraftScope,keys,list} from '../dist/workspace/state.mjs';
import {toolBillingIdentity} from '../dist/workspace/tool-billing-identity.mjs';
import {normalizeToolRequest,toolRunPlan,toolRunTask,joinToolOutputs,parseToolOutput} from '../backend/tool-run-model.mjs';
import {revisionAiSnapshot} from '../dist/workspace/revision-ai-model.mjs';
import {createRevision} from '../dist/workspace/revision-model.mjs';
const paragraphs=['第一段说明研究背景与具体应用情境，讨论依据仅限于本次提供的研究材料。','第二段使用 24 份样本[1]进行分析，保留 3.5 mg/mL 及公式 $x=2y$，不扩写未知结论。','第三段说明方法适用范围和研究局限，全部数据与引用均应保持原样。'];
const revised=text=>text+' 调整后的表述保持原有研究边界。';
const settle=async check=>{for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,2));}assert.ok(check(),'three-mode flow did not settle');};
function fixture(t,{kind='similarity',queued=false,transform=output=>output,quoteError,dependencies={},initialDocument,knownJobs,switchAccountOnSubmit=false}={}){
 const dom=new JSDOM('<main class="dashboard"></main>',{url:'https://paperknow.test/workspace.html#category/'+(kind==='aigc'?'aigc':'reduce')}),w=dom.window,root=w.document.querySelector('main'),$=selector=>root.querySelector(selector),calls=[],jobs=knownJobs||new Map(),downloads=[];let owner='owner';
 globalThis.document=w.document;globalThis.window=w;globalThis.localStorage=w.localStorage;beginDraftScope({ownerId:owner,drafts:initialDocument?[initialDocument]:[]});
 const api=async(path,data)=>{calls.push({path,data});if(path==='/auth/me')return {user:{id:owner}};if(path==='/tool-runs/capabilities')return {ready:true};if(path==='/tool-runs/quote'){if(quoteError)throw Object.assign(Error(quoteError),{status:402});return {type:'agent',source:'credits',creditCost:500,title:'合成测试',token:'quote',expiresAt:new Date(Date.now()+600000).toISOString()};}
  if(path==='/tool-runs/jobs'){const parts=data.snapshot.text.split('\n\n'),output=transform({paragraphs:data.snapshot.context.paragraphIds.map((id,i)=>({id,original:parts[i],revised:revised(parts[i]),action:'revise',reason:'保留真实信息，调整表达衔接。'}))});output.text=output.paragraphs.map(p=>p.revised).join('\n\n');const item={id:'job-'+(jobs.size+1),kind:'revision',operation:'rewrite',status:queued?'queued':'completed',completedUnits:queued?0:1,totalUnits:1,output:queued?null:output,_output:output};jobs.set(item.id,item);if(switchAccountOnSubmit)owner='different';return {item};}
  const id=path.split('/')[3],item=jobs.get(id);if(path.endsWith('/cancel')){item.status='cancelled';return {item};}if(item)return {item};throw Error('Unexpected API '+path);
 };
 const product=mountRevisionProduct({container:root,ctx:{api,notify(){}},kind,initialDocument,dependencies:{loadDocument:async()=>({createWritingDocx:async text=>new TextEncoder().encode(text)}),downloadFile:async(...args)=>{downloads.push(args);return {message:'已下载'};},...dependencies}});
 t.after(()=>{product.dispose();endDraftScope();dom.window.close();});
 return {w,root,$,calls,jobs,downloads,product,owner:value=>{owner=value;},click:selector=>$(selector).click(),input(selector,text){$(selector).value=text;$(selector).dispatchEvent(new w.Event('input',{bubbles:true}));},submit(){ $('#revision-entry-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));},choose:mode=>$('[data-report-basis="'+mode+'"]').click(),file(name='论文.docx'){Object.defineProperty($('#revision-service-file'),'files',{configurable:true,value:[new w.File(['synthetic'],name)]});$('#revision-service-file').dispatchEvent(new w.Event('change',{bubbles:true}));},draft:()=>list(keys.drafts)[0]};
}
for(const kind of ['similarity','aigc']){
 test(kind+' exposes exactly the requested three modes and preserves separate input when switching',t=>{
  const f=fixture(t,{kind});assert.deepEqual([...f.root.querySelectorAll('[data-report-basis]')].map(b=>b.dataset.reportBasis),['report','paragraph','dual']);assert.equal(f.$('[data-report-basis="report"]').getAttribute('aria-pressed'),'true');assert.doesNotMatch(f.root.textContent,/与对照文章比对|更多表达处理方案|英文学术优化|AI 文本鉴别/);
  f.choose('paragraph');assert.equal(f.$('[data-product-paste-pane]').hidden,false);assert.equal(f.$('[data-product-file-pane]').hidden,true);assert.equal(f.$('.revision-report-preparation').hidden,true);f.input('#revision-service-text',paragraphs[0]);f.choose('dual');assert.equal(f.$('[data-product-file-pane]').hidden,false);assert.equal(f.$('[data-product-import-tabs]').hidden,true);assert.equal(f.$('#revision-service-text').value,'');f.choose('paragraph');assert.equal(f.$('#revision-service-text').value,paragraphs[0]);assert.equal(f.calls.length,0);
 });
 test(kind+' paragraph generation is one click and automatically returns a complete downloadable manuscript',async t=>{
  const f=fixture(t,{kind});f.choose('paragraph');f.input('#revision-service-text',paragraphs.join('\n\n'));f.submit();f.submit();await settle(()=>!f.$('[data-product-result]').hidden);
  const submitted=f.calls.filter(c=>c.path==='/tool-runs/jobs');assert.equal(submitted.length,1);assert.equal(submitted[0].data.snapshot.mode,kind==='aigc'?'reduce':'rewrite');assert.equal(submitted[0].data.snapshot.context.plan,'strong');assert.equal(submitted[0].data.snapshot.context.scope,'all');assert.equal(submitted[0].data.snapshot.context.report,undefined);assert.ok(f.draft().paragraphs.every(p=>p.accepted));assert.equal(f.$('[data-product-revised]').textContent,paragraphs.map(revised).join('\n\n'));assert.equal(f.$('[data-product-original]').textContent,paragraphs.join('\n\n'));assert.equal(f.$('[data-tj-preview]'),null);assert.equal(f.$('[data-tj-apply]'),null);assert.equal(f.$('#revision-product-export-pdf'),null);
  f.click('#revision-product-export-docx');await settle(()=>f.downloads.length===1);assert.match(f.downloads[0][0],/\.docx$/);assert.ok(new TextDecoder().decode(f.downloads[0][1]).endsWith(paragraphs.map(revised).join('\n\n')));
 });
 test(kind+' report mode selects exact marks, preserves unmarked text and never forwards report headers',async t=>{
  const f=fixture(t,{kind});f.click('[data-product-input="paste"]');f.input('#revision-service-text',paragraphs.join('\n\n'));f.submit();await settle(()=>!!f.$('[data-product-error]').textContent);assert.equal(f.calls.length,0);
  f.click('[data-rrp-input="paste"]');f.input('[data-rrp-paste]','PRIVATE HEADER\n原文片段：'+paragraphs[1]);f.submit();await settle(()=>!f.$('[data-product-result]').hidden);
  const request=f.calls.find(c=>c.path==='/tool-runs/jobs').data.snapshot;assert.equal(request.text,paragraphs[1]);assert.equal(request.context.report.kind,kind);assert.doesNotMatch(JSON.stringify(request),/PRIVATE HEADER/);assert.equal(f.$('[data-product-revised]').textContent,[paragraphs[0],revised(paragraphs[1]),paragraphs[2]].join('\n\n'));
 });
 test(kind+' entire-document dual mode uses one dual allowance identity and all original paragraphs',async t=>{
  const f=fixture(t,{kind,dependencies:{importDocument:async()=>({text:paragraphs.join('\n\n')})}});f.choose('dual');f.file();await settle(()=>/已读取/.test(f.$('#revision-service-file-status').textContent));f.submit();await settle(()=>!f.$('[data-product-result]').hidden);
  const request=f.calls.find(c=>c.path==='/tool-runs/jobs').data;assert.equal(request.snapshot.context.plan,'dual');assert.equal(toolBillingIdentity(request).serviceKey,'revision-dual');assert.equal(request.snapshot.text,paragraphs.join('\n\n'));assert.equal(f.calls.filter(c=>c.path==='/tool-runs/jobs').length,1);assert.equal(f.draft().original,paragraphs.join('\n\n'));assert.ok(f.draft().paragraphs.every(p=>p.accepted));
 });
}
test('waiting locks form and all three modes, and cancel unlocks without applying a partial result',async t=>{
 const f=fixture(t,{queued:true});f.choose('paragraph');f.input('#revision-service-text',paragraphs[0]);f.submit();await settle(()=>!!f.$('[data-tj-cancel]'));assert.equal(f.$('[data-product-start]').disabled,true);assert.ok([...f.root.querySelectorAll('[data-report-basis]')].every(b=>b.disabled));assert.equal(f.$('[data-product-result]').hidden,true);f.click('[data-tj-cancel]');await settle(()=>!f.$('[data-product-start]').disabled);assert.ok(f.draft().paragraphs.every(p=>!p.accepted));assert.equal(f.calls.filter(c=>c.path==='/tool-runs/jobs').length,1);
});
test('protected facts reject the whole result and preserve the complete original',async t=>{
 const f=fixture(t,{transform:output=>({...output,paragraphs:output.paragraphs.map(p=>({...p,revised:p.revised.replace('24','99')}))})});f.choose('paragraph');f.input('#revision-service-text',paragraphs.join('\n\n'));f.submit();await settle(()=>/整批尚未采用/.test(f.$('.tool-job-error')?.textContent||''));assert.equal(f.$('[data-product-result]').hidden,true);assert.ok(f.draft().paragraphs.every(p=>!p.accepted&&p.suggestion===p.original));
});
test('insufficient credits show their actual reason and create no task',async t=>{
 const f=fixture(t,{quoteError:'积分不足，本次需要 500 积分'});f.choose('paragraph');f.input('#revision-service-text',paragraphs[0]);f.submit();await settle(()=>/积分不足/.test(f.$('.tool-job-error')?.textContent||''));assert.equal(f.calls.filter(c=>c.path==='/tool-runs/jobs').length,0);assert.equal(f.$('[data-product-start]').disabled,false);
});
test('switching modes aborts a pending file read and its late text cannot enter a different mode',async t=>{
 let finish,signal;const f=fixture(t,{dependencies:{importDocument:async(_file,_status,options)=>{signal=options.signal;return new Promise(resolve=>finish=resolve);}}});f.choose('dual');f.file();f.choose('paragraph');assert.equal(signal.aborted,true);assert.equal(f.$('[data-product-start]').disabled,false);f.input('#revision-service-text',paragraphs[1]);finish({text:paragraphs[0]});await new Promise(r=>setTimeout(r,4));assert.equal(f.$('#revision-service-text').value,paragraphs[1]);f.submit();await settle(()=>!f.$('[data-product-result]').hidden);assert.equal(f.calls.find(c=>c.path==='/tool-runs/jobs').data.snapshot.text,paragraphs[1]);
});
test('dual backend planning and joining preserve every paragraph and use the same billing service',()=>{
 const raw={kind:'revision',operation:'rewrite',snapshot:{title:'合成双降',text:paragraphs.join('\n\n'),mode:'reduce',context:{plan:'dual'}}},value=normalizeToolRequest(raw),plan=toolRunPlan(value),output=joinToolOutputs('rewrite',plan.map(unit=>parseToolOutput({text:JSON.stringify({complete:true,paragraphs:unit.paragraphs.map(p=>({...p,revised:revised(p.original),action:'revise',reason:'保留研究信息，优化表达。'})),sourceIds:[]})},value,unit)),plan);assert.equal(output.text,paragraphs.map(revised).join('\n\n'));assert.equal(toolBillingIdentity(value).serviceKey,'revision-dual');assert.equal(revisionProductSpec('similarity','dual').plan,'dual');
});
test('an entire long paper is submitted once and each automatic unit only reads its assigned original',()=>{
 const text=Array.from({length:160},(_,i)=>'第'+i+'段：'+('本段为独立合成研究材料，保留原有论点与证据范围。'.repeat(12))).join('\n\n'),doc={...createRevision({title:'长篇合成论文',text,mode:'reduce'},'large','now'),plan:'dual',revisionProduct:{version:1,kind:'aigc',mode:'dual'}},snapshot=revisionAiSnapshot(doc,{scope:'all'}),value=normalizeToolRequest({kind:'revision',operation:'rewrite',snapshot}),plan=toolRunPlan(value);
 assert.ok(text.length>40000);assert.equal(value.snapshot.text,text);assert.equal(plan.flatMap(u=>u.paragraphs).length,160);assert.equal(plan.flatMap(u=>u.paragraphs).map(p=>p.original).join('\n\n'),text);assert.equal(toolBillingIdentity(value).serviceKey,'revision-dual');
 for(const unit of plan){const task=toolRunTask(value,unit);assert.equal(task.materials.length,1);assert.equal(task.materials[0].text,unit.paragraphs.map(p=>p.original).join('\n\n'));assert.ok(task.materials[0].text.length<4000);}
 for(const change of [{mode:'polish'},{context:{...snapshot.context,plan:'strong'}},{context:{...snapshot.context,revisionProduct:{version:1,kind:'aigc',mode:'unknown'}}}])assert.throws(()=>normalizeToolRequest({kind:'revision',operation:'rewrite',snapshot:{...snapshot,...change}}),/功能|方案/);
});
test('English text keeps its original language without adding an extra product mode',async t=>{
 const f=fixture(t);f.choose('paragraph');f.input('#revision-service-text','The study describes the supplied materials and preserves its evidence boundary.');f.submit();await settle(()=>!f.$('[data-product-result]').hidden);assert.equal(f.calls.find(c=>c.path==='/tool-runs/jobs').data.snapshot.language,'en');assert.equal(f.root.querySelectorAll('[data-report-basis]').length,3);
});

test('returning to an unfinished task reads its existing job and delivers output without a second quote or submission',async t=>{
 const first=fixture(t,{queued:true});first.choose('paragraph');first.input('#revision-service-text',paragraphs[0]);first.submit();await settle(()=>!!first.$('[data-tj-cancel]'));const saved=structuredClone(first.draft()),job=first.jobs.values().next().value;job.status='completed';job.output=job._output;
 const restored=fixture(t,{initialDocument:saved,knownJobs:first.jobs});await settle(()=>!restored.$('[data-product-result]').hidden);assert.equal(restored.$('#revision-service-text').value,paragraphs[0]);assert.equal(restored.$('[data-report-basis="paragraph"]').getAttribute('aria-pressed'),'true');assert.equal(restored.calls.filter(c=>c.path==='/tool-runs/quote'||c.path==='/tool-runs/jobs').length,0);assert.equal(restored.$('[data-product-revised]').textContent,revised(paragraphs[0]));
});
test('an account change after submission cannot automatically adopt or export the original account result',async t=>{
 const f=fixture(t,{switchAccountOnSubmit:true});f.choose('paragraph');f.input('#revision-service-text',paragraphs[0]);f.submit();await settle(()=>/账户已变化/.test(f.root.textContent));assert.equal(f.$('[data-product-result]').hidden,true);assert.ok(f.draft().paragraphs.every(p=>!p.accepted));assert.equal(f.downloads.length,0);
});
test('report editing retains leading and trailing whitespace outside its marked original',async t=>{
 const f=fixture(t);f.click('[data-product-input="paste"]');f.input('#revision-service-text','  '+paragraphs[0]+'  \n\n  '+paragraphs[1]+'  ');f.click('[data-rrp-input="paste"]');f.input('[data-rrp-paste]','原文片段：'+paragraphs[1]);f.submit();await settle(()=>!f.$('[data-product-result]').hidden);assert.equal(f.$('[data-product-revised]').textContent,'  '+paragraphs[0]+'  \n\n  '+revised(paragraphs[1])+'  ');
});

test('switching modes clears export notices and a later result cannot inherit a previous saved-file message',async t=>{
 const f=fixture(t);f.choose('paragraph');f.input('#revision-service-text',paragraphs[0]);f.submit();await settle(()=>!f.$('[data-product-result]').hidden);f.click('#revision-product-export-docx');await settle(()=>/已下载/.test(f.$('[data-product-export-status]').textContent));const oldButton=f.$('#revision-product-export-docx');
 f.choose('dual');assert.equal(oldButton.isConnected,false);assert.equal(f.$('[data-product-export-status]').textContent,'');f.choose('paragraph');f.submit();await settle(()=>!f.$('[data-product-result]').hidden);assert.equal(f.$('[data-product-export-status]').textContent,'');f.click('#revision-product-export-docx');await settle(()=>f.downloads.length===2);
});
test('an export finishing after a mode switch cannot show its result in a different manuscript',async t=>{
 let finish;const f=fixture(t,{dependencies:{downloadFile:async()=>new Promise(resolve=>finish=resolve)}});f.choose('paragraph');f.input('#revision-service-text',paragraphs[0]);f.submit();await settle(()=>!f.$('[data-product-result]').hidden);f.click('#revision-product-export-docx');await settle(()=>!!finish);f.choose('dual');finish({message:'OLD RESULT SAVED'});await new Promise(r=>setTimeout(r,4));assert.equal(f.$('[data-product-export-status]').textContent,'');assert.equal(f.$('[data-product-result]').hidden,true);
});
