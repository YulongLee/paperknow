import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {zipSync,strToU8} from 'fflate';
import {createRevision} from '../dist/workspace/revision-model.mjs';
import {extractMarkedRevisionHtml} from '../dist/workspace/revision-marked-html.mjs';
import {matchRevisionReport,normalizeConfirmedRevisionReport} from '../dist/workspace/revision-report-model.mjs';
import {revisionAiSnapshot,applyRevisionAiOutput} from '../dist/workspace/revision-ai-model.mjs';
import {normalizeToolRequest,toolRunPlan,toolRunTask,parseToolOutput,joinToolOutputs,restoreRevisionCheckpoint} from '../backend/tool-run-model.mjs';
import {revisionReportChangeAllowed} from '../dist/workspace/revision-report-context.mjs';
import {readReportPdfPage,extractReportPdf,readReportZip} from '../src/revision-report-parser.js';
import {aigcReportHtml} from '../dist/workspace/aigc-report.mjs';
import {prepareAigcText} from '../backend/aigc-detection-client.mjs';
import {revisionInputFromAigcReport,revisionInputFromSimilarityReport,loadOwnedRevisionReport} from '../dist/workspace/revision-owned-report.mjs';
import {parseDocument,analyzeDocument} from '../dist/precheck/engine.mjs';
const first='值得注意的是，本研究进行进一步的分析，保留研究对象、样本范围及其证据边界。',second='第二段属于未标记的原文，包含独立说明与必要条件，应完整保留，不进行无依据修改。';
const DOMParserClass=new JSDOM().window.DOMParser;
const makeAi=(text=first+'\n\n'+second)=>{const p=prepareAigcText(text);return{id:'owned-ai',status:'completed',analysisVersion:'paragraph-v2',title:'自有合成论文',characters:p.characters,partCount:p.parts.length,completedParts:p.parts.length,verdict:'mixed',parts:p.parts.map(({content,...part},i)=>({...part,label:i?'ugc':'aigc',confidence:95}))};};
test('a complete PaperKnow AI report imports only its marked original, excluding human paragraphs and advice copies',()=>{
 const text=first+'\n\n'+second,html=aigcReportHtml(makeAi(text),{text}),result=extractMarkedRevisionHtml(html,{DOMParserClass});assert.equal(result.originalText,text);assert.equal(result.kind,'aigc');assert.ok(result.explicitExcerpts.length);assert.ok(result.explicitExcerpts.every(r=>!result.text.slice(r.start,r.end).includes(second)));
 const doc=createRevision({title:'自有合成论文',text,mode:'reduce'},'draft','2026-10-27'),matched=matchRevisionReport(doc,{...result,source:'paperknow'});assert.deepEqual([...new Set(matched.candidates.map(c=>c.paragraphId))],['p0']);assert.equal(matched.candidates[0].excerpt,first);
});
test('owned similarity marks preserve original sections, exclude verified quotations and reject corrupt source ranges',()=>{
 const hit='真正与来源一致的连续原文应进行对应修改并保留未标记的上下文',original=['前置说明保留原样。','第一章 绪论','😀'+hit+'。',second,'参考文献','文献列表应完整保留。'].join('\n\n'),report=analyzeDocument(parseDocument(original,'合成论文'),[{id:'source',title:'真实对照文章',text:hit}],{id:'report-1',mode:'web'}),result=revisionInputFromSimilarityReport(report);assert.equal(result.originalText.trim(),original);assert.deepEqual(result.explicitExcerpts.map(r=>result.text.slice(r.start,r.end)),[hit]);
 const row=report.sections.flatMap(s=>s.paragraphs).find(p=>p.matches.length),match=row.matches[0];match.excludedRanges=[match.range];assert.equal(revisionInputFromSimilarityReport(report).explicitExcerpts.length,0);match.excludedRanges=[];match.sourceRange[0]++;assert.throws(()=>revisionInputFromSimilarityReport(report),/不一致/);
 const html='<h1>重复率检测报告</h1><div class="report-review-original"><p class="report-text"><mark class="quoted">'+first+'</mark><mark class="matched">'+second+'</mark></p></div>',parsed=extractMarkedRevisionHtml(html,{DOMParserClass});assert.deepEqual(parsed.explicitExcerpts.map(r=>parsed.text.slice(r.start,r.end)),[second]);
});
test('CSS ancestor selectors cannot mark an entire manuscript and partial marks keep their exact original offsets',()=>{
 const fragment='只有这段连续的原文需要依据检测报告调整表达，其他内容保持完整。',text='保持前文原样。'+fragment+'保持后文原样。',html='<style>.paper .red{color:#c00000}.paper mark{color:red}.blue{color:#0099ff}</style><h1>重复率检测报告</h1><div class="paper"><p>'+second+'</p><p>保持前文原样。<span class="red">'+fragment+'</span>保持后文原样。</p></div>',result=extractMarkedRevisionHtml(html,{DOMParserClass}),doc=createRevision({title:'测试',text:second+'\n\n'+text,mode:'rewrite'},'d','now'),matched=matchRevisionReport(doc,{...result,source:'cnki'});
 assert.equal(matched.candidates.length,1);assert.equal(matched.candidates[0].paragraphId,'p1');assert.equal(matched.candidates[0].excerpt,fragment);assert.equal(matched.candidates[0].start,text.indexOf(fragment));assert.equal(result.kind,'similarity');
});
test('report HTML never loads resources, preserves literal text and does not turn unmarked full text into evidence',()=>{
 const html='<script>throw 1</script><img src="https://untrusted.invalid/private"><iframe src="https://untrusted.invalid/"></iframe><p>'+first+'</p><p>'+second+'</p><iframe src="https://untrusted.invalid/incomplete',result=extractMarkedRevisionHtml(html,{DOMParserClass});assert.equal(result.explicitExcerpts.length,0);assert.doesNotMatch(result.text,/throw 1|untrusted.invalid\/private/);
 const doc=createRevision({title:'测试',text:first+'\n\n'+second},'d','now');assert.equal(matchRevisionReport(doc,{...result,source:'other'}).candidates.length,0);
});
function reportDoc(){const prefix='本段未标记的前文保持原样。',target='这部分连续的原文被报告明确标记，修改时保留原有研究含义与证据边界。',suffix='本段未标记的结尾也保持原样。',text=prefix+target+suffix;let doc=createRevision({title:'报告针对性修改',text,mode:'rewrite'},'targeted','now');const evidence=matchRevisionReport(doc,{source:'cnki',kind:'similarity',markedOnly:true,text:'原文片段：'+target}).candidates,report=normalizeConfirmedRevisionReport({source:'cnki',kind:'similarity',evidence},doc);doc={...doc,plan:'strong',reportRequired:true,reportAttachment:report,aiSelection:{scope:'selected',paragraphIds:['p0'],origin:'report'}};return{doc,prefix,target,suffix,text};}
test('confirmed report ranges survive the snapshot and fixed backend instructions without copying raw report headers',()=>{
 const {doc,target}=reportDoc(),snapshot=revisionAiSnapshot(doc,{scope:'selected',paragraphIds:['p0']}),value=normalizeToolRequest({kind:'revision',operation:'rewrite',snapshot}),unit=toolRunPlan(value)[0],task=toolRunTask(value,unit);
 assert.equal(snapshot.context.report.kind,'similarity');assert.equal(snapshot.context.report.paragraphs[0].ranges.length,1);assert.equal(unit.paragraphs[0].original.slice(...unit.paragraphs[0].reportRanges[0]),target);assert.match(task.instructions,/范围以外.*逐字保留/);assert.equal(snapshot.context.reportAttachment,undefined);assert.equal(snapshot.context.report.text,undefined);
});
test('backend parsing, checkpoint restoration and final assembly reject edits outside the report marks',()=>{
 const {doc,prefix,target,suffix,text}=reportDoc(),snapshot=revisionAiSnapshot(doc,{scope:'selected',paragraphIds:['p0']}),value=normalizeToolRequest({kind:'revision',operation:'rewrite',snapshot}),plan=toolRunPlan(value),unit=plan[0],revised=prefix+target.replace('这部分连续的原文','报告标出的这些原文')+suffix;
 const output=next=>({text:JSON.stringify({complete:true,sourceIds:[],paragraphs:[{id:'p0',original:text,revised:next,action:'revise',reason:'调整报告标出的表达，保留其他内容。'}]})});
 const valid=parseToolOutput(output(revised),value,unit);assert.equal(valid.paragraphs[0].revised,revised);assert.equal(joinToolOutputs('rewrite',[valid],plan).changedParagraphs,1);
 for(const bad of [revised.replace(prefix,'改动了未标记的前文。'),revised.replace(suffix,'改动了未标记的结尾。')]){
  assert.throws(()=>parseToolOutput(output(bad),value,unit),/报告标记范围/);const checkpoint={...valid,paragraphs:[{...valid.paragraphs[0],revised:bad}]};assert.throws(()=>restoreRevisionCheckpoint(checkpoint,value,unit,0),/报告标记范围/);assert.throws(()=>joinToolOutputs('rewrite',[checkpoint],plan),/报告标记范围/);
 }
});
test('the browser also rejects changed report scope and cannot replace existing accepted edits with a late result',()=>{
 const {doc,prefix,target,suffix,text}=reportDoc(),snapshot=revisionAiSnapshot(doc,{scope:'selected',paragraphIds:['p0']}),revised=prefix+target.replace('这部分连续的原文','标记范围内的这部分原文')+suffix;
 assert.ok(applyRevisionAiOutput(doc,{paragraphs:[{id:'p0',original:text,revised,action:'revise',reason:'仅修改标记。'}]},snapshot));assert.throws(()=>applyRevisionAiOutput(doc,{paragraphs:[{id:'p0',original:text,revised:revised.replace(prefix,'换掉前文。'),action:'revise',reason:'错误范围'}]},snapshot),/标记以外/);
 assert.throws(()=>applyRevisionAiOutput({...doc,reportRequired:false,aiSelection:{scope:'all',paragraphIds:['p0']}},{paragraphs:[{id:'p0',original:text,revised,action:'revise',reason:'旧报告'}]},snapshot),/报告定位已变化/);
 assert.equal(revisionReportChangeAllowed('A target B other C','A changed B revised C',[[2,8],[11,16]]),true);assert.equal(revisionReportChangeAllowed('A target B other C','A changed X revised C',[[2,8],[11,16]]),false);
});
test('report type and malformed, missing or unrelated ranges fail before a quote or model call',()=>{
 const {doc}=reportDoc(),snapshot=revisionAiSnapshot(doc,{scope:'selected',paragraphIds:['p0']});
 for(const report of [{...snapshot.context.report,kind:'aigc'},{...snapshot.context.report,paragraphs:[]},{...snapshot.context.report,paragraphs:[{paragraphId:'p0',ranges:[[0,999999]]}]},{...snapshot.context.report,paragraphs:[{paragraphId:'other',ranges:[[0,20]]}]}])assert.throws(()=>normalizeToolRequest({kind:'revision',operation:'rewrite',snapshot:{...snapshot,context:{...snapshot.context,report}}}));
 assert.throws(()=>revisionAiSnapshot({...doc,reportAttachment:null},{scope:'selected',paragraphIds:['p0']}),/报告|摘录/);
});
test('a long marked passage is fully split into bounded evidence rather than silently dropping its end',()=>{
 const text=('完整报告标记中的原文应当逐段保留并核对。').repeat(160),doc=createRevision({title:'长报告',text,mode:'rewrite'},'d','now'),matched=matchRevisionReport(doc,{source:'other',text,markedOnly:true,explicitExcerpts:[{start:0,end:text.length}]});assert.ok(matched.candidates.length>1);assert.equal(matched.candidates.map(c=>c.excerpt).join(''),text);assert.ok(matched.candidates.every(c=>c.excerpt.length<=2000&&!c.excerptTruncated));
});
const OPS={save:1,restore:2,setFillRGBColor:3,showText:4,setGState:5,setTextRenderingMode:6};
test('PDF text color yields exact mark ranges and never marks black context or invisible text',async()=>{
 const black='Unmarked original context is preserved. ',red='This marked original sentence requires expression changes.',tail=' Final original context remains unchanged.';
 const glyph=s=>[...s].map(unicode=>({unicode})),page={getTextContent:async()=>({items:[{str:black,transform:[1,0,0,1,0,0],width:100,height:10},{str:red,transform:[1,0,0,1,100,0],width:100,height:10},{str:tail,transform:[1,0,0,1,200,0],width:100,height:10}]}),getOperatorList:async()=>({fnArray:[3,4,1,3,4,2,4],argsArray:[['#000000'],[glyph(black)],[],['#c00000'],[glyph(red)],[],[glyph(tail)]]}),getAnnotations:async()=>[]};
 const result=await readReportPdfPage(page,OPS);assert.equal(result.explicitExcerpts.length,1);assert.equal(result.text.slice(result.explicitExcerpts[0].start,result.explicitExcerpts[0].end),red);
 const hidden={...page,getOperatorList:async()=>({fnArray:[3,6,4],argsArray:[['#ff0000'],[3],[glyph(black+red+tail)]]})};assert.equal((await readReportPdfPage(hidden,OPS)).explicitExcerpts.length,0);
});
test('PDF reading rejects encrypted, excessive-page and scanned files and destroys its worker on failure',async()=>{
 let destroyed=0;const data=strToU8('%PDF-test');const mock=doc=>({OPS,getDocument:()=>({promise:Promise.resolve(doc),destroy:async()=>{destroyed++;}})});
 await assert.rejects(extractReportPdf(data,{pdfjs:mock({numPages:101})}),/100页/);
 await assert.rejects(extractReportPdf(data,{pdfjs:mock({numPages:1,getPage:async()=>({getTextContent:async()=>({items:[]}),getOperatorList:async()=>({fnArray:[],argsArray:[]}),cleanup(){}})})}),/扫描页/);assert.equal(destroyed,2);
});
test('ZIP reports keep multiple choices and CSS while refusing traversal, excessive extraction and unsupported contents',async()=>{
 const archive=await readReportZip(zipSync({'full.html':strToU8('<mark>Original</mark>'),'other.pdf':strToU8('%PDF-test'),'styles/report.css':strToU8('.red{color:red}'),'script.js':strToU8('never executed')}));assert.equal(archive.files.length,2);assert.equal(archive.styles.length,1);
 await assert.rejects(readReportZip(zipSync({'../report.html':strToU8('bad')})),/目录/);await assert.rejects(readReportZip(zipSync({'only.js':strToU8('bad')})),/应包含/);
 await assert.rejects(readReportZip(zipSync({'large.txt':new Uint8Array(20*1024*1024+1)})),/过大/);
});
test('owned AI report reads preserve original positions and account changes cannot transfer a private report',async()=>{
 const text=first+'\n\n'+second,item=makeAi(text),input=revisionInputFromAigcReport({item,text});assert.equal(input.originalText,text);assert.equal(input.explicitExcerpts.length,1);let checks=0;
 const api=async path=>path==='/auth/me'?{user:{id:++checks===1?'alice':'bob'}}:{item,text};await assert.rejects(loadOwnedRevisionReport(api,'aigc',item.id,'alice'),/账户已变化/);
});
