import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountRevisionReportEntry} from '../dist/workspace/revision-report-entry.mjs';
import {createRevision} from '../dist/workspace/revision-model.mjs';
import {prepareAigcText} from '../backend/aigc-detection-client.mjs';
const marked='这段连续的原文是报告明确标记的修改位置，应保留其研究含义与真实证据。';
const plain='另一段未标记的论文内容，应当完整保留，不应被误选或者重新生成。';
const tick=()=>new Promise(r=>setTimeout(r,0));
async function until(check){for(let i=0;i<100;i++){if(check())return;await tick();}assert.ok(check(),'report entry did not settle');}
function aiResponse(text){const p=prepareAigcText(text);return{ownerId:'owner',text,item:{id:'ai-1',title:'本站合成论文',status:'completed',analysisVersion:'paragraph-v2',characters:p.characters,partCount:p.parts.length,completedParts:p.parts.length,parts:p.parts.map(({content,...part},i)=>({...part,label:i?'ugc':'aigc',confidence:95}))}};}
function fixture(t,{text=marked+'\n\n'+plain,kind='similarity',reader,api,hash,initialMode,productModes=false}={}){
 const dom=new JSDOM('<main><header class="revision-entry-heading"></header><form id="revision-entry-form"><textarea id="original"></textarea><div class="revision-entry-submit"></div></form></main>',{url:'https://paperknow.test/workspace.html'+(hash||'#category/'+(kind==='aigc'?'aigc':'reduce'))}),w=dom.window,root=w.document.querySelector('main'),$=s=>root.querySelector(s),calls=[],notices=[];let title='自有合成论文';$('#original').value=text;
 const getDocument=()=>createRevision({title,text:$('#original').value,mode:kind==='aigc'?'reduce':'rewrite'},'preview','now');
 const entry=mountRevisionReportEntry({root,kind,initialMode,productModes,ctx:{notify:s=>notices.push(s),api:async(...args)=>{calls.push(args);return api?api(...args):{user:{id:'owner'}};}},getOriginalText:()=>$('#original').value,getDocument,adoptOriginal:(value,info)=>{$('#original').value=value;title=info.title||title;},...(reader?{readFile:reader}:{})});
 const click=s=>{assert.ok($(s),s);$(s).click();},input=(s,value)=>{$(s).value=value;$(s).dispatchEvent(new w.Event('input',{bubbles:true}));};
 const file=(name='report.html')=>{Object.defineProperty($('[data-rrp-file]'),'files',{configurable:true,value:[new w.File(['synthetic'],name)]});$('[data-rrp-file]').dispatchEvent(new w.Event('change',{bubbles:true}));};
 t.after(()=>{entry.dispose();dom.window.close();});return{entry,w,$,root,calls,notices,getDocument,click,input,file};
}
test('both entries default to report-first and cannot proceed with only a score or an unmarked full report',async t=>{
 for(const kind of ['similarity','aigc']){const f=fixture(t,{kind});assert.equal(f.entry.mode,'report');assert.equal(f.$('.revision-report-preparation').hidden,false);assert.equal(f.calls.length,0);await assert.rejects(f.entry.prepare(f.getDocument()),/提供.*报告/);
  f.click('[data-rrp-input="paste"]');f.input('[data-rrp-paste]',kind==='aigc'?'AIGC检测报告\nAI率：40%':'重复率检测报告\n总文字复制比：40%');f.click('[data-rrp-locate]');assert.equal(f.$('[data-rrp-pick]'),null);await assert.rejects(f.entry.prepare(f.getDocument()),/没有可核对/);assert.equal(f.calls.length,0);
  f.click('[data-report-basis="direct"]');assert.equal(f.$('.revision-report-preparation').hidden,true);assert.equal(await f.entry.prepare(f.getDocument()),null);assert.equal(f.calls.length,0);
 }
});
test('explicit report excerpts preselect only unique exact marks and original edits are revalidated before creation',async t=>{
 const f=fixture(t);f.click('[data-rrp-input="paste"]');f.input('[data-rrp-paste]','私人报告页眉不应保存\n原文片段：'+marked);f.click('[data-rrp-locate]');assert.equal(f.$('[data-rrp-pick]').checked,true);const report=await f.entry.prepare(f.getDocument());assert.deepEqual(report.paragraphIds,['p0']);assert.equal(report.evidence[0].excerpt,marked);assert.doesNotMatch(JSON.stringify(report),/私人报告页眉|另一段未标记/);
 f.input('#original',plain);await assert.rejects(f.entry.prepare(f.getDocument()),/没有可核对/);assert.equal(f.calls.length,0);
});
test('ambiguous repeated excerpts require a specific location instead of selecting every occurrence',async t=>{
 const f=fixture(t,{text:marked+'\n\n'+marked});f.click('[data-rrp-input="paste"]');f.input('[data-rrp-paste]','原文片段：'+marked);f.click('[data-rrp-locate]');const boxes=[...f.root.querySelectorAll('[data-rrp-pick]')];assert.equal(boxes.length,2);assert.ok(boxes.every(b=>!b.checked));await assert.rejects(f.entry.prepare(f.getDocument()),/具体修改位置/);boxes[1].click();const report=await f.entry.prepare(f.getDocument());assert.deepEqual(report.paragraphIds,['p1']);
});
test('the wrong report type is rejected without creating a task or obtaining a quote',async t=>{
 const f=fixture(t,{kind:'aigc'});f.click('[data-rrp-input="paste"]');f.input('[data-rrp-paste]','重复率检测报告\n原文片段：'+marked);f.click('[data-rrp-locate]');assert.match(f.$('[data-rrp-error]').textContent,/报告类型/);await assert.rejects(f.entry.prepare(f.getDocument()),/报告类型/);assert.equal(f.calls.length,0);
});
test('report-file reads have a persistent waiting state and canceled or superseded reads never change the original',async t=>{
 let resolve,options;const f=fixture(t,{reader:(_file,o)=>{options=o;return new Promise(r=>{resolve=r;});}});f.file();assert.equal(f.entry.busy,true);assert.equal(f.$('[data-rrp-progress]').hidden,false);await assert.rejects(f.entry.prepare(f.getDocument()),/正在读取/);f.click('[data-rrp-cancel]');assert.equal(options.signal.aborted,true);resolve({text:marked,originalText:'不同的报告原文',markedOnly:true,explicitExcerpts:[{start:0,end:marked.length}]});await tick();assert.equal(f.$('#original').value,marked+'\n\n'+plain);assert.equal(f.$('[data-rrp-pick]'),null);assert.equal(f.entry.busy,false);
 f.file();f.click('[data-rrp-input="paste"]');resolve({text:marked,originalText:'又一份原文',markedOnly:true,explicitExcerpts:[{start:0,end:marked.length}]});await tick();assert.equal(f.$('#original').value,marked+'\n\n'+plain);assert.equal(f.$('[data-rrp-pick]'),null);
});
test('multiple archived reports require a choice and pass the archived styles to the selected file',async t=>{
 const reads=[],styles=[{name:'style.css',bytes:new Uint8Array([1])}],f=fixture(t,{reader:async(file,options)=>{reads.push({name:file.name,styles:options.styles});return file.name.endsWith('.zip')?{archive:{styles,files:[{name:'summary.html',bytes:new Uint8Array([1])},{name:'full.html',bytes:new Uint8Array([2])}]}}:{fileName:file.name,text:marked,markedOnly:true,explicitExcerpts:[{start:0,end:marked.length}]};}});
 f.file('reports.zip');await until(()=>!f.entry.busy);assert.equal(f.$('[data-rrp-archive]').hidden,false);assert.equal(f.$('[data-rrp-archive-file]').value,'');assert.equal(f.$('[data-rrp-pick]'),null);f.click('[data-rrp-archive-read]');assert.match(f.$('[data-rrp-error]').textContent,/请选择压缩包/);f.$('[data-rrp-archive-file]').value='1';f.click('[data-rrp-archive-read]');await until(()=>!!f.$('[data-rrp-pick]'));assert.equal(reads[1].name,'full.html');assert.deepEqual(reads[1].styles,styles);assert.deepEqual((await f.entry.prepare(f.getDocument())).paragraphIds,['p0']);
});
test('selecting an owned report fills an empty original and reuses its completed result without redetection',async t=>{
 const source=marked+'\n\n'+plain,response=aiResponse(source),f=fixture(t,{text:'',kind:'aigc',api:async path=>path==='/auth/me'?{user:{id:'owner'}}:path==='/aigc-detections'?{ownerId:'owner',items:[response.item]}:response});f.click('[data-rrp-input="account"]');f.click('[data-rrp-list]');await until(()=>!!f.$('[data-rrp-owned]'));f.click('[data-rrp-owned]');await until(()=>!!f.$('[data-rrp-pick]'));assert.equal(f.$('#original').value,source);assert.equal(f.entry.ownerId,'owner');assert.deepEqual((await f.entry.prepare(f.getDocument())).paragraphIds,['p0']);assert.ok(f.calls.every(([path])=>path==='/auth/me'||path==='/aigc-detections'||path==='/aigc-detections/ai-1/report'));
});
test('an owned report never overwrites a different prepared original and explicit switches can be reversed',async t=>{
 const source=marked+'\n\n'+plain,prior='用户已经准备的另一份原文，任何报告都不应自动覆盖这部分内容。',response=aiResponse(source),f=fixture(t,{text:prior,kind:'aigc',hash:'#category/aigc?aigcReport=ai-1',initialMode:'direct',api:async path=>path==='/auth/me'?{user:{id:'owner'}}:response});assert.equal(f.entry.mode,'report');f.click('.revision-report-handoff');await until(()=>!f.entry.busy);assert.equal(f.$('#original').value,prior);assert.equal(f.$('[data-rrp-original-switch]').hidden,false);f.click('[data-rrp-use-original]');assert.equal(f.$('#original').value,source);assert.ok(f.$('[data-rrp-pick]'));f.click('[data-rrp-restore-original]');assert.equal(f.$('#original').value,prior);assert.equal(f.$('[data-rrp-pick]'),null);
});
test('a changed account clears private preparation and blocks generation',async t=>{
 let owner='owner';const response=aiResponse(marked+'\n\n'+plain),f=fixture(t,{kind:'aigc',hash:'#category/aigc?aigcReport=ai-1',api:async path=>path==='/auth/me'?{user:{id:owner}}:response});f.click('.revision-report-handoff');await until(()=>!!f.$('[data-rrp-pick]'));owner='different';await assert.rejects(f.entry.prepare(f.getDocument()),/账户已变化/);assert.equal(f.$('#original').value,'');assert.equal(f.$('form').hidden,true);assert.match(f.notices[0],/账户已变化/);assert.ok(f.calls.every(([path])=>!path.includes('tool-runs')));
});
test('a changed report source while authentication is pending cannot silently change generation scope',async t=>{
 let resolveAuth,pending=false;const response=aiResponse(marked+'\n\n'+plain),f=fixture(t,{kind:'aigc',hash:'#category/aigc?aigcReport=ai-1',api:async path=>path==='/auth/me'?(pending?new Promise(r=>{resolveAuth=r;}):{user:{id:'owner'}}):response});f.click('.revision-report-handoff');await until(()=>!!f.$('[data-rrp-pick]'));pending=true;const preparation=f.entry.prepare(f.getDocument());await until(()=>!!resolveAuth);f.$('[data-rrp-source]').value='other';f.$('[data-rrp-source]').dispatchEvent(new f.w.Event('change',{bubbles:true}));resolveAuth({user:{id:'owner'}});await assert.rejects(preparation,/已变化/);
});

test('changing the reduction mode stops a pending report read and ignores its late original and matches',async t=>{
 let finish,signal;const f=fixture(t,{text:plain,reader:async(_file,options)=>{signal=options.signal;return new Promise(resolve=>finish=resolve);}});
 f.file();await until(()=>!!finish);assert.equal(f.entry.busy,true);
 f.click('[data-report-basis="direct"]');assert.equal(f.entry.mode,'direct');assert.equal(f.entry.busy,false);assert.equal(signal.aborted,true);
 finish({text:'原文片段：'+marked,originalText:marked,kind:'similarity',format:'html',explicitExcerpts:[marked]});await tick();await tick();
 assert.equal(f.$('#original').value,plain);assert.equal(f.$('[data-rrp-pick]'),null);assert.equal(await f.entry.prepare(f.getDocument()),null);
 f.click('[data-report-basis="report"]');assert.equal(f.entry.mode,'report');assert.equal(f.$('[data-rrp-progress]').hidden,true);assert.equal(f.$('[data-rrp-locate]').disabled,false);await assert.rejects(()=>f.entry.prepare(f.getDocument()),/提供.*报告/);assert.equal(f.calls.length,0);
});

test('all five visible source choices preserve exact report selection in AI and similarity requests',async t=>{
 for(const kind of ['aigc','similarity'])for(const source of ['paperknow','cnki','vip','wanfang','gzd']){
  const f=fixture(t,{kind,productModes:true});f.click('[data-rrp-provider="'+source+'"]');f.click('[data-rrp-input="paste"]');f.input('[data-rrp-paste]','原文片段：'+marked);const confirmed=await f.entry.prepare(f.getDocument());assert.equal(confirmed.source,source);assert.equal(confirmed.kind,kind);assert.deepEqual(confirmed.paragraphIds,['p0']);assert.equal(f.calls.length,0);
 }
});
test('reading an owned report synchronizes its PaperKnow source with the visible provider selection',async t=>{
 const response=aiResponse(marked+'\n\n'+plain),f=fixture(t,{kind:'aigc',productModes:true,hash:'#category/aigc?aigcReport=ai-1',api:async path=>path==='/auth/me'?{user:{id:'owner'}}:response});f.click('[data-rrp-provider="cnki"]');f.click('.revision-report-handoff');await until(()=>!!f.$('[data-rrp-pick]'));assert.equal(f.$('[data-rrp-provider="paperknow"]').getAttribute('aria-pressed'),'true');assert.equal(f.$('[data-rrp-provider="cnki"]').getAttribute('aria-pressed'),'false');assert.equal((await f.entry.prepare(f.getDocument())).source,'paperknow');
});
