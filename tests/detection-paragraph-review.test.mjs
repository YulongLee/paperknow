import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {JSDOM} from 'jsdom';
import {prepareAigcText} from '../backend/aigc-detection-client.mjs';
import {createAigcDetectionService} from '../backend/aigc-detection-service.mjs';
import {aigcInputHash} from '../backend/aigc-input-hash.mjs';
import {normalizeAigcResult,aigcLabelCoverage} from '../dist/workspace/aigc-detection-model.mjs';
import {aigcReportHtml} from '../dist/workspace/aigc-report.mjs';
import {parseDocument,analyzeDocument} from '../dist/precheck/engine.mjs';
import {reportHtml} from '../dist/precheck/export.mjs';
import {publicWebQueryPlan} from '../dist/precheck/web-query-plan.mjs';
const config={aigcDetectionEnabled:true,moderationAccessKeyId:'synthetic-id',moderationAccessKeySecret:'synthetic-secret'};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t,detect){
 const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE users(id TEXT PRIMARY KEY);INSERT INTO users VALUES('alice'),('bob');");t.after(()=>db.close());
 const calls=[],client={ready:true,async detect(content,options){calls.push(content);return detect?detect(content,options):{label:content.startsWith('A')?'aigc':'ugc',confidence:91};}};
 const service=createAigcDetectionService(db,config,{client});
 const submit=(text,user='alice',key=crypto.randomUUID())=>service.handle({path:'/api/aigc-detections',method:'POST',user:{id:user},readBody:async()=>({text,consent:true,expectedUserId:user,idempotencyKey:key})});
 const get=(id,user='alice')=>service.handle({path:'/api/aigc-detections/'+id,method:'GET',user:{id:user}});
 return{db,service,calls,submit,get};
}
test('paragraph partitions preserve Unicode, blank separators and full original while respecting provider units',()=>{
 const text='  A论文🙂\r\n\r\nB研究材料\n\n'+ '长'.repeat(5001)+'\n🙂🙂\n';
 const p=prepareAigcText(text);assert.equal(p.paragraphs,4);assert.equal(p.calls,4);assert.equal(p.parts.map(p=>p.content).join(''),text);assert.deepEqual(p.parts.map(p=>p.paragraphNumber),[1,2,3,3,4]);
 let offset=0;for(const part of p.parts){assert.equal(part.start,offset);assert.equal(part.characters,Array.from(part.content).length);assert.ok(part.content.length<=5000);offset=part.end;}assert.equal(offset,Array.from(text).length);
 assert.equal(p.parts.at(-1).effectiveCharacters,0);assert.throws(()=>prepareAigcText('🙂🙂'),{status:400});
 assert.throws(()=>prepareAigcText(Array.from({length:301},(_,i)=>'论文'+i).join('\n')),{status:413});
});
test('new jobs independently detect each natural paragraph and preserve paragraph ownership in the report',async t=>{
 const f=fixture(t),text='A'.repeat(100)+'\r\n\r\n'+'B'.repeat(60)+'\n🙂🙂';
 const pending=await f.submit(text);await f.service.waitForIdle();const raw=(await f.get(pending.value.id)).value;
 assert.equal(raw.status,'completed');assert.equal(raw.analysisVersion,'paragraph-v2');assert.equal(f.calls.length,2);assert.ok(f.calls[0].startsWith('A'));assert.ok(f.calls[1].startsWith('B'));assert.deepEqual(raw.parts.map(p=>p.label),['aigc','ugc','undetermined']);assert.equal(raw.parts[2].skipReason,'non_text');
 const normalized=normalizeAigcResult(raw),coverage=aigcLabelCoverage(normalized);assert.equal(coverage.aiCharacters,100);assert.equal(coverage.humanCharacters,60);
 const dom=new JSDOM(aigcReportHtml(raw,{text})),doc=dom.window.document;
 assert.equal(doc.querySelectorAll('[data-ai-paragraph]').length,3);assert.equal([...doc.querySelectorAll('.report-review-original .report-text')].map(n=>n.textContent).join(''),text.replace(/\r\n?/g,'\n'));
 assert.ok(doc.querySelector('[data-ai-paragraph="1"] .aigc-report-text-risk'));assert.equal(doc.querySelectorAll('[data-ai-paragraph="2"] .aigc-report-text-risk').length,0);assert.equal(doc.querySelector('#ai-analysis-2').innerHTML,'');assert.equal(doc.querySelector('#ai-analysis-3').innerHTML,'');assert.match(doc.querySelector('#ai-analysis-1').textContent,/91 \/ 100/);assert.doesNotMatch(doc.querySelector('#ai-analysis-1').textContent,/91%/);dom.window.close();
});
test('legacy idempotent retries retrieve the original record while a new request uses paragraph analysis',async t=>{
 const f=fixture(t),text='A研究\nB研究',first=await f.submit(text,'alice','legacy-test-key');await f.service.waitForIdle();const id=first.value.id,hash=aigcInputHash(text,'length-v1');
 f.db.prepare("UPDATE aigc_detections SET input_hash=?,partition_version='length-v1' WHERE id=?").run(hash,id);f.db.prepare('UPDATE aigc_detection_requests SET input_hash=? WHERE detection_id=?').run(hash,id);
 const calls=f.calls.length,retry=await f.submit(text,'alice','legacy-test-key');assert.equal(retry.value.id,id);assert.equal(retry.value.analysisVersion,'length-v1');assert.equal(f.calls.length,calls);
 const next=await f.submit(text);assert.notEqual(next.value.id,id);await f.service.waitForIdle();assert.equal(f.calls.length,calls+2);assert.equal((await f.get(id)).value.analysisVersion,'length-v1');
});
test('old chunk verdicts remain range references and cannot become independent paragraph conclusions',()=>{
 const text='第一段原文。\n第二段原文。',size=Array.from(text).length,item={id:'legacy-record',status:'completed',characters:size,partCount:1,completedParts:1,parts:[{index:0,start:0,end:size,characters:size,label:'aigc',confidence:90}],verdict:'aigc'};
 const dom=new JSDOM(aigcReportHtml(item,{text})),doc=dom.window.document;assert.equal(doc.querySelectorAll('[data-ai-paragraph]').length,2);assert.doesNotMatch(doc.body.textContent,/本段独立分析/);assert.equal([...doc.querySelectorAll('.report-review-detail')].filter(n=>n.textContent.includes('本段没有独立判断结果')).length,2);dom.window.close();
});
test('inconclusive paragraph stops new paid calls, joins started calls and never concludes success',async t=>{
 let resolveSecond;const f=fixture(t,content=>content.startsWith('A')?Promise.resolve({label:'undetermined',confidence:null}):new Promise(resolve=>resolveSecond=resolve));
 const pending=await f.submit('A正文\nB正文\nC正文\nD正文');await tick();assert.equal(f.calls.length,2);assert.ok(resolveSecond);resolveSecond({label:'ugc',confidence:94});await f.service.waitForIdle();assert.equal(f.calls.length,2);const row=(await f.get(pending.value.id)).value;assert.equal(row.status,'failed');assert.equal(row.conclusive,false);assert.equal(row.completedParts,2);
});
test('two simultaneous jobs share one detector concurrency bound and cancellation prevents queued calls',async t=>{
 let active=0,peak=0;const pending=[];const f=fixture(t,()=>{active++;peak=Math.max(peak,active);return new Promise(resolve=>pending.push(()=>{active--;resolve({label:'ugc',confidence:92});}));});
 const a=await f.submit('A正文\nA第二段\nA第三段'),b=await f.submit('B正文\nB第二段','bob');await tick();assert.equal(f.calls.length,2);
 await f.service.handle({path:'/api/aigc-detections/'+b.value.id+'/cancel',method:'POST',user:{id:'bob'},readBody:async()=>({expectedUserId:'bob'})});
 for(let step=0;step<5;step++){for(const resolve of pending.splice(0))resolve();await tick();}
 await f.service.waitForIdle();assert.equal(peak,2);assert.equal(f.calls.length,3);assert.equal((await f.get(a.value.id)).value.status,'completed');assert.equal((await f.get(b.value.id,'bob')).value.completedParts,0);
});
test('source review keeps full original on the left and all matching identities on the corresponding right',()=>{
 const text='正文中有真实文字匹配并且包含能够逐一核对的研究材料与实验方法，末尾原创说明不应标红。',source={id:'s1',fileName:'实际研究材料.docx',title:'实际研究材料',text:'正文中有真实文字匹配并且包含能够逐一核对的研究材料与实验方法，另一份材料的说明。',authors:['作者甲'],year:2026,kind:'user',url:'https://example.org/paper'};
 const report=analyzeDocument(parseDocument(text,'原文'),[source]);const before=JSON.stringify(report),dom=new JSDOM(reportHtml(report)),doc=dom.window.document,row=doc.querySelector('.report-review-row');
 assert.equal(row.querySelector('.report-review-original .report-text').textContent,text);assert.match(row.querySelector('.report-review-detail').textContent,/实际研究材料/);assert.doesNotMatch([...row.querySelectorAll('.report-review-original mark')].map(n=>n.textContent).join(''),/末尾原创说明/);assert.equal(row.querySelectorAll('.report-source-match').length,1);assert.match(row.querySelector('.report-source-excerpt').textContent,/正文中有真实文字匹配/);assert.equal(JSON.stringify(report),before);dom.window.close();
});
test('candidate queries cover six distinct paragraphs before repeating a paragraph',()=>{
 const parsed=parseDocument(Array.from({length:8},(_,i)=>String.fromCharCode(65+i).repeat(250)).join('\n\n'));
 const plan=publicWebQueryPlan(parsed);assert.equal(plan.queries.length,6);assert.equal(plan.sampledParagraphs,6);assert.equal(new Set(plan.queries.map(q=>q.paragraphId)).size,6);assert.deepEqual(publicWebQueryPlan(parsed,0).queries,[]);
});
