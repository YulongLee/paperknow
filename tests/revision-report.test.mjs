import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {reportSources,revisionReportLimits,normalizeRevisionReportText,normalizeRevisionReport,extractRevisionReportHtml,matchRevisionReport,normalizeConfirmedRevisionReport} from '../dist/workspace/revision-report-model.mjs';
import {openRevisionReport} from '../dist/workspace/revision-report.mjs';

const sample='This synthetic paragraph records twenty four observations and preserves the original evidence boundary.';
const doc=(paragraphs=[{id:'p1',original:sample}],extra={})=>({title:'Synthetic original document',paragraphs,...extra});
const report=(text=sample,extra={})=>({source:'cnki',text,fileName:'synthetic-report.txt',format:'paste',...extra});
const key=value=>String(value).normalize('NFKC').replace(/\s/gu,'');
const confirmed=(evidence,extra={})=>({source:'cnki',fileName:'synthetic-report.txt',evidence,confirmedAt:'2026-10-20T00:00:00.000Z',...extra});
function assertPositions(candidate,original,rawReport){
 assert.equal(original.slice(candidate.start,candidate.end),candidate.excerpt);
 assert.equal(rawReport.slice(candidate.reportStart,candidate.reportEnd),candidate.reportExcerpt);
 assert.equal(key(candidate.excerpt),key(candidate.reportExcerpt));
}

test('report normalization accepts only declared sources, preserves report content and never changes the original',()=>{
 const original=doc(),before=structuredClone(original),input=report('  '+sample+'  ',{fileName:'/private/reports/<synthetic>.txt',unexpected:'do not persist'}),normalized=normalizeRevisionReport(input);
 assert.equal(normalized.source,'cnki');assert.equal(normalized.text,sample);assert.equal(normalized.fileName,'synthetic.txt');assert.equal(normalized.unexpected,undefined);
 const found=matchRevisionReport(original,input);assert.equal(found.candidates.length,1);assert.deepEqual(original,before);assert.equal(input.text,'  '+sample+'  ');
 for(const source of Object.keys(reportSources))assert.equal(normalizeRevisionReport(report(sample,{source})).source,source);
 for(const source of ['constructor','__proto__','toString','not-a-source',undefined])assert.throws(()=>normalizeRevisionReport(report(sample,{source})),/来源/);
});

test('NFKC and whitespace matching retains exact UTF-16 source offsets including ligatures, combining marks and emoji',()=>{
 const original=' \tＡＢＣ study uses the ﬃ procedure and cafe\u0301 observations 😀 with exact original evidence.\n';
 const text='Report header\n'+key(original)+'\nReport footer',found=matchRevisionReport(doc([{id:'unicode',original}]),report(text));
 assert.equal(found.candidates.length,1);assertPositions(found.candidates[0],original,text);assert.equal(found.candidates[0].start,2);assert.equal(found.candidates[0].end,original.length-1);assert.ok(found.candidates[0].excerpt.includes('ﬃ'));assert.ok(found.candidates[0].excerpt.includes('e\u0301'));
 const mapped=normalizeRevisionReportText('xﬃ e\u0301😀');assert.equal(mapped.key,'xffié😀');for(let index=1;index<=3;index++)assert.deepEqual(mapped.spans[index],{start:1,end:2});assert.deepEqual(mapped.spans.at(-1),{start:5,end:7});
});

test('unmarked report text matches only complete original paragraphs, while explicit labels may locate a partial excerpt',()=>{
 const fragment='The observed sample contains twenty four participants from the same synthetic classroom.';
 const original='Context outside the detected passage. '+fragment+' Further limitations remain outside this excerpt.';
 assert.equal(matchRevisionReport(doc([{id:'p1',original}]),report('Report description: '+fragment)).candidates.length,0);
 const text='重复率：17.6%\n疑似片段：'+fragment+'\n检测说明：只是一条用户提供的报告。',found=matchRevisionReport(doc([{id:'p1',original}]),report(text));
 assert.equal(found.candidates.length,1);assert.equal(found.candidates[0].excerpt,fragment);assert.equal(found.candidates[0].kind,'explicit-excerpt');assertPositions(found.candidates[0],original,text);assert.ok(found.candidates[0].start>0);
});

test('short labels, scores, headings and unsupported guesses cannot become detected source evidence',()=>{
 const original=doc([{id:'title',original:sample,type:'heading'},{id:'score',original:'AI 100% 重复率 98.5% 检测结果 23456'},{id:'short',original:'十九个字符不足以作为有效原文片段'}]);
 const found=matchRevisionReport(original,report(original.paragraphs.map(row=>row.original).join('\n')));assert.equal(found.candidates.length,0);assert.match(found.warnings.join(' '),/未定位成功|没有找到/);
 const exactNineteen='一'.repeat(19),exactTwenty='二'.repeat(20);assert.equal(matchRevisionReport(doc([{id:'p1',original:exactNineteen}]),report('原文：'+exactNineteen)).candidates.length,0);assert.equal(matchRevisionReport(doc([{id:'p1',original:exactTwenty}]),report('原文：'+exactTwenty)).candidates.length,1);
 const misses=matchRevisionReport(doc(),report('This synthetic report has no verbatim occurrence of the actual source document.'));assert.equal(misses.candidates.length,0);assert.match(misses.warnings.join(' '),/至少 20/);
});

test('invisible padding and punctuation cannot satisfy the minimum actual evidence length',()=>{
 for(const original of ['Short words'+String.fromCodePoint(0x200b).repeat(40),'。'.repeat(30),'!'.repeat(30),'1234567890'.repeat(3),'ＡＩ 100% 重复率 98.5% 检测结果 23456'])assert.equal(matchRevisionReport(doc([{id:'p1',original}]),report('原文片段：'+original)).candidates.length,0,JSON.stringify(original));
 const padded='actual source'+String.fromCodePoint(0x200b).repeat(40);assert.throws(()=>normalizeConfirmedRevisionReport(confirmed([{paragraphId:'p1',excerpt:padded,start:0,end:padded.length}]),doc([{id:'p1',original:padded}])),/摘录或原文位置/);
 for(const control of ['\u0085','\u009f'])assert.throws(()=>normalizeRevisionReport(report(sample+control)),/控制字符/);
});

test('English score-only summaries cannot become manuscript evidence even when explicitly labelled',()=>{
 const original='Overall similarity score: 97.8% with reference overlap score 97.8%';for(const text of [original,'原文片段：'+original])assert.equal(matchRevisionReport(doc([{id:'score-en',original}]),report(text)).candidates.length,0);
});

test('a marked document title embedded in a body paragraph is not mistaken for a detected substantive excerpt',()=>{
 const title='A synthetic research document title with enough characters to exceed the evidence minimum',original='Opening substantive paragraph context. '+title+'. The study explains observations and their factual limitations.',source=doc([{id:'body',original}],{title}),dom=new JSDOM('');try{const extracted=extractRevisionReportHtml('<p>报告标题</p><p><mark>'+title+'</mark></p>',dom.window.DOMParser),found=matchRevisionReport(source,report(extracted.text,{format:'html',explicitExcerpts:extracted.explicitExcerpts}));assert.equal(found.candidates.length,0);assert.equal(matchRevisionReport(source,report('原文片段：'+title)).candidates.length,0);assert.equal(matchRevisionReport(source,report(original)).candidates.length,1);}finally{dom.window.close();}
});

test('duplicate passages across paragraphs and repeated partial occurrences stay explicitly ambiguous',()=>{
 const original=doc([{id:'p1',original:sample},{id:'p2',original:sample}]),found=matchRevisionReport(original,report(sample));assert.equal(found.candidates.length,2);assert.equal(found.ambiguous,true);assert.ok(found.candidates.every(row=>row.ambiguous&&row.matchCount===2));assert.match(found.warnings.join(' '),/多个原文位置/);
 const repeated=sample+' Intervening source context. '+sample,partial=matchRevisionReport(doc([{id:'repeat',original:repeated}]),report('原文片段：'+sample));assert.equal(partial.candidates.length,2);assert.deepEqual(partial.candidates.map(row=>row.start),[0,sample.length+' Intervening source context. '.length]);assert.ok(partial.candidates.every(row=>row.ambiguous));
});

test('original paragraphs take precedence over any generated or modified text property',()=>{
 const original=doc([{id:'p1',original:sample,text:'Generated suggestion must never replace the original evidence.'}]);assert.equal(matchRevisionReport(original,report(sample)).candidates.length,1);assert.equal(matchRevisionReport(original,report(original.paragraphs[0].text)).candidates.length,0);
 assert.equal(matchRevisionReport(doc([{id:'p1',text:sample}]),report()).candidates.length,1);
});

test('HTML extraction strips executable and resource markup while preserving only textual mark evidence',()=>{
 const dom=new JSDOM('',{url:'https://paperknow.test/',runScripts:'dangerously'});try{
 const html='<script>window.reportInjected=true</script><style>body{display:none}</style><iframe src="https://example.invalid/private">hidden</iframe><svg><script>evil()</script></svg><p onclick="evil()">检测摘要 <img src="https://example.invalid/tracker" onerror="evil()"></p><p>疑似内容：<mark data-score="99">'+sample+'</mark></p><p>尾注 &amp; 说明</p>';
 const extracted=extractRevisionReportHtml(html,dom.window.DOMParser);assert.equal(dom.window.reportInjected,undefined);assert.doesNotMatch(extracted.text,/reportInjected|display:none|hidden|evil\(|example\.invalid|data-score/);assert.match(extracted.text,/尾注 & 说明/);assert.equal(extracted.explicitExcerpts.length,1);
 const part=extracted.explicitExcerpts[0];assert.equal(extracted.text.slice(part.start,part.end),sample);const original='Prefix outside mark. '+sample+' End outside mark.',found=matchRevisionReport(doc([{id:'p1',original}]),report(extracted.text,{format:'html',explicitExcerpts:extracted.explicitExcerpts}));assert.equal(found.candidates.length,1);assert.equal(found.candidates[0].excerpt,sample);assertPositions(found.candidates[0],original,extracted.text);assert.match(extracted.warnings.join(' '),/不会执行脚本|本地/);
 }finally{dom.window.close();}
});

test('explicit HTML offsets survive report trim and invalid explicit spans are rejected',()=>{
 const input='  \n'+sample+'\n  ',start=input.indexOf(sample),value=normalizeRevisionReport(report(input,{explicitExcerpts:[{start,end:start+sample.length}]}));assert.equal(value.text,sample);assert.deepEqual(value.explicitExcerpts,[{start:0,end:sample.length}]);
 for(const span of [{start:0,end:input.length},{start:-1,end:5},{start,end:start},{start,end:input.length+1},{start:1.5,end:20}])assert.throws(()=>normalizeRevisionReport(report(input,{explicitExcerpts:[span]})),/片段位置/);
});

test('candidate preview has independent 120-row and 32,000-character limits and reports omitted evidence',()=>{
 const rows=Array.from({length:121},(_,index)=>({id:'p'+index,original:'Observation '+String(index).padStart(3,'0')+' records a distinct synthetic evidence boundary.'})),first=matchRevisionReport(doc(rows),report(rows.map(row=>row.original).join('\n')));
 assert.equal(first.candidates.length,120);assert.equal(first.truncated,true);assert.match(first.warnings.join(' '),/未展示位置未被确认/);assert.ok(first.candidateCharacters<=revisionReportLimits.candidateCharacters);
 const longRows=Array.from({length:24},(_,index)=>({id:'long'+index,original:'Distinct paragraph '+String(index).padStart(3,'0')+': '+String.fromCharCode(65+index).repeat(900)})),second=matchRevisionReport(doc(longRows),report(longRows.map(row=>row.original).join('\n')));assert.ok(second.candidates.length>0&&second.candidates.length<longRows.length);assert.ok(second.candidateCharacters<=32000);assert.equal(second.candidateCharacters,second.candidates.reduce((sum,row)=>sum+row.excerpt.length+row.reportExcerpt.length,0));assert.equal(second.truncated,true);
});

test('long passages expose a bounded complete excerpt without cutting Unicode compatibility expansions',()=>{
 const original='A'.repeat(1999)+'ﬃ'+' explanatory synthetic evidence boundary '.repeat(10),found=matchRevisionReport(doc([{id:'long',original}]),report(original));assert.equal(found.candidates.length,1);const candidate=found.candidates[0];assert.ok(candidate.excerpt.length<=2000);assert.ok(candidate.reportExcerpt.length<=2000);assert.equal(candidate.excerptTruncated,true);assertPositions(candidate,original,original);assert.match(found.warnings.join(' '),/前部摘录/);
});

test('report and document validation rejects oversized or malformed inputs without quietly truncating source text',()=>{
 for(const text of ['', ' ', 'x'.repeat(100001),sample+'\u0000'])assert.throws(()=>normalizeRevisionReport(report(text)),/报告文本/);
 assert.throws(()=>extractRevisionReportHtml('<p>'+'x'.repeat(100000)+'</p>',class{}),/100,000/);
 assert.throws(()=>matchRevisionReport(doc([{id:'duplicate',original:sample},{id:'duplicate',original:sample}]),report()),/编号或文本/);
 assert.throws(()=>matchRevisionReport(doc([{id:'p1',original:'x'.repeat(20001)}]),report()),/编号或文本/);
 assert.throws(()=>matchRevisionReport(doc(Array.from({length:501},(_,i)=>({id:'p'+i,original:sample}))),report()),/原文段落/);
 assert.throws(()=>matchRevisionReport(doc(Array.from({length:6},(_,i)=>({id:'p'+i,original:'x'.repeat(18000)}))),report()),/100,000/);
});

test('confirmed evidence persists only bounded verified snippets and never raw report or unknown fields',()=>{
 const original=doc(),candidate=matchRevisionReport(original,report()).candidates[0],value=normalizeConfirmedRevisionReport(confirmed([candidate],{text:'PRIVATE RAW REPORT',original:'REPORT MUST NOT BECOME ORIGINAL',paragraphIds:['injected'],unknown:'discard'}),original);
 assert.deepEqual(value.paragraphIds,['p1']);assert.deepEqual(value.evidence,[{paragraphId:'p1',excerpt:sample,start:0,end:sample.length,reportExcerpt:sample,reportStart:0,reportEnd:sample.length}]);assert.equal(value.version,1);assert.equal(value.confirmedAt,'2026-10-20T00:00:00.000Z');assert.ok(JSON.stringify(value).length<=10000);assert.doesNotMatch(JSON.stringify(value),/PRIVATE RAW REPORT|MUST NOT BECOME ORIGINAL|discard|injected/);
});

test('confirmed evidence rejects stale originals, changed report snippets, forged offsets and repeated selections',()=>{
 const original=doc(),candidate=matchRevisionReport(original,report()).candidates[0];assert.throws(()=>normalizeConfirmedRevisionReport(confirmed([]),original),/至少勾选/);
 assert.throws(()=>normalizeConfirmedRevisionReport(confirmed([candidate,candidate]),original),/重复/);
 assert.throws(()=>normalizeConfirmedRevisionReport(confirmed([candidate]),doc([{id:'p1',original:sample.replace('twenty four','twenty five')}])),/原文已变化/);
 for(const patch of [{start:1},{end:candidate.end+1},{paragraphId:'absent'},{excerpt:sample+' forged'},{reportExcerpt:'Unrelated fabricated report excerpt with enough characters.'},{reportStart:-1},{reportEnd:candidate.reportEnd+1}])assert.throws(()=>normalizeConfirmedRevisionReport(confirmed([{...candidate,...patch}]),original));
});

test('confirmed record limit counts metadata and both excerpts, including escaped serialized characters',()=>{
 const rows=Array.from({length:4},(_,index)=>({id:'p'+index,original:'Evidence '+index+' '+String.fromCharCode(65+index).repeat(1490)})),original=doc(rows),candidates=matchRevisionReport(original,report(rows.map(row=>row.original).join('\n'))).candidates;
 const small=normalizeConfirmedRevisionReport(confirmed(candidates.slice(0,2)),original);assert.ok(JSON.stringify(small).length<10000);assert.throws(()=>normalizeConfirmedRevisionReport(confirmed(candidates),original),/10,000/);
 const quoteText='\\"'.repeat(990)+' bounded source excerpt',quoteDoc=doc([{id:'quoted',original:quoteText}]),quote=matchRevisionReport(quoteDoc,report(quoteText)).candidates[0];assert.ok(quote.excerpt.length<=2000);const value=normalizeConfirmedRevisionReport(confirmed([quote]),quoteDoc);assert.ok(JSON.stringify(value).length<=10000);
});

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const until=async condition=>{for(let attempt=0;attempt<100;attempt++){if(condition())return;await tick();}assert.ok(condition(),'report UI did not settle');};
function uiFixture(t,{document:original=doc(),onConfirm,initialReport,importDocument=async()=>({text:sample,warnings:[]})}={}){
 const dom=new JSDOM('<main id="original-workspace">Original manuscript stays here.</main><dialog id="workspace-dialog"><div id="workspace-dialog-body"></div></dialog>',{url:'https://paperknow.test/workspace.html#tool/rewrite',runScripts:'outside-only'}),w=dom.window,before={document:globalThis.document,fetch:globalThis.fetch},saved=[],notices=[],imports=[],requests=[];globalThis.document=w.document;globalThis.fetch=async(...args)=>{requests.push(args);throw Error('Report locating must not submit an AI or detection request');};
 const $=selector=>w.document.querySelector(selector),dialog=$('dialog');dialog.close=()=>{dialog.open=false;dialog.dispatchEvent(new w.Event('close'));};
 const panel=openRevisionReport({doc:original,getDocument:()=>original,modal:(_title,html)=>{$('#workspace-dialog-body').innerHTML=html;dialog.open=true;},notify:value=>notices.push(value),onConfirm:async value=>{saved.push(structuredClone(value));await onConfirm?.(value);},initialReport,importDocument:async(...args)=>{imports.push(args);return importDocument(...args);}});
 const input=(selector,value)=>{const target=$(selector);assert.ok(target,selector);target.value=value;target.dispatchEvent(new w.Event('input',{bubbles:true}));};
 const change=(selector,value)=>{const target=$(selector);assert.ok(target,selector);target.value=value;target.dispatchEvent(new w.Event('change',{bubbles:true}));};
 const click=selector=>{assert.ok($(selector),selector);$(selector).click();};
 const file=value=>{const target=$('[data-rr-file]');Object.defineProperty(target,'files',{configurable:true,value:[value]});target.dispatchEvent(new w.Event('change',{bubbles:true}));};
 let closed=false;const close=()=>{if(closed)return;closed=true;panel.dispose();Object.assign(globalThis,before);w.close();};t.after(close);return{dom,w,$,original,saved,notices,imports,requests,panel,dialog,input,change,click,file,close,preview(text=sample){input('[data-rr-text]',text);click('[data-rr-preview]');}};
}

test('opening, restoring and previewing a saved report never preselects or confirms any manuscript evidence',t=>{
 const evidence=matchRevisionReport(doc(),report()).candidates,f=uiFixture(t,{initialReport:normalizeConfirmedRevisionReport(confirmed(evidence),doc())});
 assert.equal(f.saved.length,0);assert.equal(f.$('[data-rr-text]').value,'原文片段：'+sample);assert.equal(f.$('[data-rr-confirm]').disabled,true);assert.equal(f.$('[data-rr-results]').hidden,true);f.click('[data-rr-preview]');assert.equal(f.$('[data-rr-results]').hidden,false);assert.equal(f.$('[data-rr-report-preview]').textContent,'原文片段：'+sample);assert.equal(f.$('[data-rr-pick]').checked,false);assert.equal(f.$('[data-rr-confirm]').disabled,true);assert.equal(f.saved.length,0);assert.equal(f.requests.length,0);
});

test('only an explicitly checked preview position is confirmed, with original and report kept separately',async t=>{
 const original=doc([{id:'p1',original:sample},{id:'p2',original:sample}]),before=structuredClone(original),f=uiFixture(t,{document:original});f.preview();const boxes=[...f.w.document.querySelectorAll('[data-rr-pick]')];assert.equal(boxes.length,2);assert.ok(boxes.every(box=>!box.checked));assert.match(f.$('[data-rr-warnings]').textContent,/多个原文位置/);assert.equal(f.saved.length,0);
 boxes[1].click();assert.equal(f.$('[data-rr-confirm]').disabled,false);assert.equal(f.saved.length,0);f.click('[data-rr-confirm]');await until(()=>!f.dialog.open);assert.equal(f.saved.length,1);assert.deepEqual(f.saved[0].paragraphIds,['p2']);assert.equal(f.saved[0].evidence.length,1);assert.equal(f.saved[0].evidence[0].excerpt,sample);assert.equal(f.saved[0].text,undefined);assert.deepEqual(original,before);assert.equal(f.requests.length,0);
});

test('changing report text or source invalidates previous preview and selections before any confirmation',async t=>{
 const f=uiFixture(t);f.preview();f.click('[data-rr-pick]');f.change('[data-rr-source]','wanfang');assert.equal(f.$('[data-rr-results]').hidden,true);assert.equal(f.$('[data-rr-confirm]').disabled,true);assert.equal(f.saved.length,0);f.click('[data-rr-preview]');assert.equal(f.$('[data-rr-pick]').checked,false);assert.match(f.$('[data-rr-source-label]').textContent,/万方/);f.click('[data-rr-pick]');f.input('[data-rr-text]','No actual source material occurs within this report text.');assert.equal(f.$('[data-rr-confirm]').disabled,true);f.click('[data-rr-preview]');assert.equal(f.$('[data-rr-matches]').children.length,0);assert.match(f.$('[data-rr-status]').textContent,/未定位/);f.click('[data-rr-confirm]');await tick();assert.equal(f.saved.length,0);
});

test('report and original markup are displayed as literal text instead of active HTML in preview and excerpts',t=>{
 const original='<img src=x onerror="window.reportInjected=true"> '+sample+' <script>window.reportInjected=true</script>',f=uiFixture(t,{document:doc([{id:'html-text',original}])});f.preview(original);assert.equal(f.$('[data-rr-report-preview]').textContent,original);assert.equal(f.$('[data-rr-matches] pre').textContent,original);assert.equal(f.$('[data-rr-matches]').querySelectorAll('img,script,iframe').length,0);assert.equal(f.w.reportInjected,undefined);assert.equal(f.requests.length,0);
});

test('local HTML report imports only text and explicit mark passages and still requires preview plus selection',async t=>{
 const original='Leading manuscript context. '+sample+' Trailing manuscript context.',f=uiFixture(t,{document:doc([{id:'html-mark',original}])});f.file({name:'marked-report.html',size:500,text:async()=>'<script>window.reportInjected=true</script><p>来源说明</p><p><mark>'+sample+'</mark></p><img src="https://example.invalid/tracker">'});await until(()=>/已提取/.test(f.$('[data-rr-file-status]').textContent));assert.equal(f.imports.length,0);assert.equal(f.saved.length,0);assert.equal(f.$('[data-rr-confirm]').disabled,true);assert.equal(f.$('[data-rr-results]').hidden,true);assert.doesNotMatch(f.$('[data-rr-text]').value,/reportInjected|example.invalid/);
 f.click('[data-rr-preview]');assert.equal(f.$('[data-rr-pick]').checked,false);assert.equal(f.$('[data-rr-matches] pre').textContent,sample);assert.equal(f.w.reportInjected,undefined);f.click('[data-rr-pick]');f.click('[data-rr-confirm]');await until(()=>f.saved.length===1);assert.equal(f.saved[0].fileName,'marked-report.html');assert.equal(f.saved[0].evidence[0].start,original.indexOf(sample));assert.equal(f.requests.length,0);
});

test('Unicode HTML reports larger than 100,000 bytes remain eligible when their actual text fits the character limit',async t=>{
 const f=uiFixture(t),html='<p>'+'背景'.repeat(20000)+'</p><p><mark>'+sample+'</mark></p>';assert.ok(Buffer.byteLength(html)>100000);assert.ok(html.length<100000);f.file({name:'unicode-report.html',size:Buffer.byteLength(html),text:async()=>html});await until(()=>/已提取/.test(f.$('[data-rr-file-status]').textContent));f.click('[data-rr-preview]');assert.equal(f.w.document.querySelectorAll('[data-rr-pick]').length,1);assert.equal(f.$('[data-rr-pick]').checked,false);assert.equal(f.saved.length,0);
});

test('PDF and local report formats use the established importer with a cancellation signal without changing original text',async t=>{
 for(const name of ['provided-report.txt','provided-report.docx','provided-report.pdf']){
  const f=uiFixture(t);f.file({name,size:100});await until(()=>/已提取/.test(f.$('[data-rr-file-status]').textContent));assert.equal(f.imports.length,1);assert.equal(f.imports[0][0].name,name);assert.equal(f.imports[0][1],f.$('[data-rr-file-status]'));assert.equal(f.imports[0][2].signal.aborted,false);assert.equal(f.$('[data-rr-text]').value,sample);assert.equal(f.original.paragraphs[0].original,sample);assert.equal(f.saved.length,0);assert.equal(f.$('[data-rr-confirm]').disabled,true);f.close();
 }
});

test('new report file selection wins when an ignored-abort older extraction finishes last',async t=>{
 const pending=new Map(),f=uiFixture(t,{importDocument:(file,_status,{signal})=>new Promise(resolve=>pending.set(file.name,{resolve,signal}))});f.file({name:'older.txt',size:100});f.file({name:'newer.txt',size:100});assert.equal(pending.get('older.txt').signal.aborted,true);pending.get('newer.txt').resolve({text:sample,warnings:[]});await until(()=>/已提取/.test(f.$('[data-rr-file-status]').textContent));pending.get('older.txt').resolve({text:'Stale report extraction must never overwrite the latest selected material.',warnings:[]});await tick();assert.equal(f.$('[data-rr-text]').value,sample);f.click('[data-rr-preview]');assert.match(f.$('[data-rr-source-label]').textContent,/newer\.txt/);assert.equal(f.saved.length,0);
});

test('manual text edits during extraction abort waiting and cannot be replaced by a late report result',async t=>{
 let resolve,signal;const f=uiFixture(t,{importDocument:(_file,_status,options)=>{signal=options.signal;return new Promise(done=>{resolve=done;});}});f.file({name:'late.txt',size:100});const typed='New manually supplied report text must survive the older pending extraction.';f.input('[data-rr-text]',typed);assert.equal(signal.aborted,true);resolve({text:sample,warnings:[]});await tick();assert.equal(f.$('[data-rr-text]').value,typed);assert.equal(f.saved.length,0);assert.equal(f.$('[data-rr-confirm]').disabled,true);assert.equal(f.$('[data-rr-preview]').disabled,false);
});

test('closing or leaving a report modal aborts waiting and prevents late extraction from changing the report or saving',async t=>{
 for(const close of ['dialog','route','remove']){
  let resolve,signal;const f=uiFixture(t,{importDocument:(_file,_status,options)=>{signal=options.signal;return new Promise(done=>{resolve=done;});}});f.file({name:'pending.txt',size:100});const textarea=f.$('[data-rr-text]');if(close==='dialog')f.dialog.close();else if(close==='route'){f.w.location.hash='#home';f.w.dispatchEvent(new f.w.HashChangeEvent('hashchange'));}else f.$('#workspace-dialog-body').replaceChildren();await tick();assert.equal(signal.aborted,true);resolve({text:sample,warnings:[]});await tick();assert.equal(textarea.value,'');assert.equal(f.saved.length,0);assert.equal(f.notices.length,0);assert.equal(f.requests.length,0);f.close();
 }
});

test('existing paste is preserved until the user explicitly adopts the imported report',async t=>{
 const f=uiFixture(t),existing='Previously pasted report text is kept until an explicit replacement choice.';f.input('[data-rr-text]',existing);f.file({name:'replacement.txt',size:100});await until(()=>!!f.$('[data-rr-file-status] button'));assert.equal(f.$('[data-rr-text]').value,existing);assert.equal(f.saved.length,0);f.click('[data-rr-file-status] button');assert.equal(f.$('[data-rr-text]').value,sample);assert.equal(f.$('[data-rr-confirm]').disabled,true);assert.equal(f.$('[data-rr-results]').hidden,true);
});

test('changed manuscript text is rejected before preview or final confirmation',async t=>{
 const beforePreview=uiFixture(t);beforePreview.original.paragraphs[0].original+=' Changed after modal opened.';beforePreview.preview();assert.match(beforePreview.$('[data-rr-error]').textContent,/原文已变化/);assert.equal(beforePreview.$('[data-rr-confirm]').disabled,true);assert.equal(beforePreview.saved.length,0);beforePreview.close();
 const beforeConfirm=uiFixture(t);beforeConfirm.preview();beforeConfirm.click('[data-rr-pick]');beforeConfirm.original.paragraphs[0].original+=' Changed after preview.';beforeConfirm.click('[data-rr-confirm]');await tick();assert.equal(beforeConfirm.saved.length,0);assert.match(beforeConfirm.$('[data-rr-error]').textContent,/原文已变化/);assert.equal(beforeConfirm.dialog.open,true);
});

test('confirmation is single flight and a failed save preserves checked evidence for an explicit retry',async t=>{
 let reject,attempt=0;const f=uiFixture(t,{onConfirm:()=>{attempt++;if(attempt===1)return new Promise((_resolve,fail)=>{reject=fail;});}});f.preview();f.click('[data-rr-pick]');f.click('[data-rr-confirm]');assert.equal(f.saved.length,1);assert.equal(f.$('[data-rr-confirm]').disabled,true);assert.equal(f.$('[data-rr-text]').disabled,true);f.click('[data-rr-confirm]');assert.equal(f.saved.length,1);reject(Error('Synthetic local storage unavailable'));await until(()=>!f.$('[data-rr-confirm]').disabled);assert.match(f.$('[data-rr-error]').textContent,/Synthetic local storage unavailable/);assert.equal(f.$('[data-rr-pick]').checked,true);assert.equal(f.dialog.open,true);f.click('[data-rr-confirm]');await until(()=>!f.dialog.open);assert.equal(f.saved.length,2);assert.deepEqual(f.saved[0].evidence,f.saved[1].evidence);assert.equal(f.notices.length,1);
});

test('oversized confirmed selection is rejected before saving and can be reduced without losing the preview',async t=>{
 const paragraphs=Array.from({length:4},(_,index)=>({id:'p'+index,original:'Bounded evidence '+index+' '+String.fromCharCode(65+index).repeat(1490)})),f=uiFixture(t,{document:doc(paragraphs)});f.preview(paragraphs.map(row=>row.original).join('\n'));const boxes=[...f.w.document.querySelectorAll('[data-rr-pick]')];assert.equal(boxes.length,4);for(const box of boxes)box.click();f.click('[data-rr-confirm]');await tick();assert.match(f.$('[data-rr-error]').textContent,/10,000/);assert.equal(f.saved.length,0);assert.equal(f.dialog.open,true);assert.ok(boxes.every(box=>box.checked));boxes[2].click();boxes[3].click();f.click('[data-rr-confirm]');await until(()=>f.saved.length===1);assert.equal(f.saved[0].evidence.length,2);assert.ok(JSON.stringify(f.saved[0]).length<=10000);
});

test('failed report extraction preserves the pasted report and allows a fresh manual preview',async t=>{
 const f=uiFixture(t,{importDocument:async()=>{throw Error('Synthetic report extraction failed');}});f.preview();f.click('[data-rr-pick]');f.file({name:'broken.docx',size:100});await until(()=>/Synthetic report extraction failed/.test(f.$('[data-rr-file-status]').textContent));assert.equal(f.$('[data-rr-text]').value,sample);assert.equal(f.$('[data-rr-confirm]').disabled,true);assert.equal(f.saved.length,0);assert.equal(f.$('[data-rr-preview]').disabled,false);f.click('[data-rr-preview]');assert.equal(f.$('[data-rr-pick]').checked,false);assert.equal(f.saved.length,0);
});

test('oversized and unsupported files fail before extraction while HTML text has an independent character limit',async t=>{
 const f=uiFixture(t);let htmlReads=0;for(const file of [{name:'too-large.pdf',size:20*1024*1024+1},{name:'too-large.docx',size:50*1024*1024+1},{name:'unsupported.doc',size:100},{name:'too-large.html',size:50*1024*1024+1,text:async()=>{htmlReads++;return sample;}}]){f.file(file);await tick();assert.equal(f.$('[data-rr-confirm]').disabled,true);assert.equal(f.saved.length,0);}assert.equal(f.imports.length,0);assert.equal(htmlReads,0);assert.equal(f.$('[data-rr-text]').value,'');
 f.file({name:'long-text.html',size:200000,text:async()=>{htmlReads++;return '<p>'+'字'.repeat(100001)+'</p>';}});await until(()=>/100,000/.test(f.$('[data-rr-file-status]').textContent));assert.equal(htmlReads,1);assert.equal(f.$('[data-rr-text]').value,'');assert.equal(f.imports.length,0);
});
