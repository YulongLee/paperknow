import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {parseDocument} from '../dist/precheck/engine.mjs';
import {publicSourceHref} from '../dist/precheck/source-url.mjs';
import {planWebQueries,webSimilarityInput} from '../backend/web-similarity-model.mjs';
import {validateDetectionSource} from '../dist/workspace/detection-model.mjs';
import {mountWebSimilarity,previewWebText} from '../dist/workspace/web-similarity.mjs';
import {reportHtml,reportExportView,sourceCopyText} from '../dist/precheck/export.mjs';
const body='本研究正文用于核对来源保留真实记录研究设计与分析方法请在使用时核对相关证据并正确注明引用出处这是拥有完整检索长度的自然段落';
const other='另一篇合成研究正文讨论课程教学反馈采集与描述性分析过程应当保留样本数字和原始引用并核对本地提供的研究材料这是不同的完整段落';
const caps={ready:true,pointsCharged:false,maxCharacters:20000,maxQueries:3,maxSources:8,userDailyLimit:3};
const response=value=>({ok:true,status:200,json:async()=>({ownerId:'u1',...value})});
const flush=async()=>{for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));};
function fixture({importDocument,handler=()=>null}={}){
 const dom=new JSDOM('<main class="dashboard"><section id="host"></section></main>',{url:'https://example.test/workspace.html#category/detection?view=web'}),calls=[],doc=dom.window.document;
 let owner='u1',confirms=[],allow=true;
 dom.window.confirm=message=>{confirms.push(message);return allow;};
 const fetchImpl=async(url,init={})=>{const payload=init.body?JSON.parse(init.body):null;calls.push({url,payload});const custom=await handler(url,payload);if(custom)return custom;if(url==='/api/auth/me')return response({user:{id:owner}});if(url==='/api/capabilities')return response({webSimilarity:caps});if(url==='/api/web-similarity'&&!payload)return response({items:[]});throw Error('Unexpected route');};
 const panel=mountWebSimilarity({container:doc.querySelector('#host'),fetchImpl,importDocument,uuid:()=> 'controlled-key-1',pollInterval:600000}),$=s=>doc.querySelector(s);
 return {dom,panel,$,calls,confirms,set allow(value){allow=value;},set owner(value){owner=value;},input(value){$('[data-web-text]').value=value;$('[data-web-text]').dispatchEvent(new dom.window.Event('input',{bubbles:true}));},file(){const input=$('[data-web-file]');Object.defineProperty(input,'files',{configurable:true,value:[{name:'合成论文.txt',size:100}]});input.dispatchEvent(new dom.window.Event('change'));},close(){panel.dispose();dom.window.close();}};
}
test('query sampling backfills repeated priority windows and retains real original offsets',()=>{
 const parsed=parseDocument([body,other,body,'独立的第三组材料描述检索与证据比对过程保留真实来源并讨论研究边界和实际内容防止用摘要冒充全文这是第三个完整自然段落',body].join('\n\n'));
 const plan=planWebQueries(parsed);
 assert.equal(plan.queries.length,3);assert.equal(new Set(plan.queries.map(row=>row.excerpt)).size,3);assert.deepEqual(planWebQueries(parsed),plan);
 const paragraphs=new Map(parsed.sections.flatMap(section=>section.paragraphs).map(p=>[p.id,p]));
 for(const row of plan.queries)assert.equal(Array.from(paragraphs.get(row.paragraphId).text).slice(row.start,row.end).join(''),row.excerpt);
 assert.equal(planWebQueries(parseDocument([body,body,body].join('\n\n'))).queries.length,1);
});
test('admission preview matches server effective scope and prevents impossible short-paragraph searches',()=>{
 const text='第一章 研究内容\n\n'+body+'\n\n参考文献\n\n'+other,preview=previewWebText(text),input=webSimilarityInput({text,title:'合成论文',expectedUserId:'u1',consent:true,idempotencyKey:'controlled-key'},{id:'u1'});
 assert.equal(preview.characters,input.characters);assert.deepEqual(preview.plan,planWebQueries(input.parsed));assert.ok(preview.parsed.sections.some(section=>section.excluded));
 assert.throws(()=>previewWebText(['十六个有效字符组成短段用于校验','十六个有效字符组成短段用于校验','十六个有效字符组成短段用于校验'].join('\n\n')),/完整段落/);
 assert.throws(()=>previewWebText('!'.repeat(60)),/有效正文字符/);
});
test('source admission and legacy report export never retain credential or signed source URLs',()=>{
 const privateUrls=['https://user:PRIVATE_A@example.org/paper','https://example.org/paper?access_token=PRIVATE_B','https://example.org/paper?X-Amz-Signature=PRIVATE_C','https://example.org/paper#access_token=PRIVATE_D'];
 const material={title:'自有材料',text:body};
 for(const url of privateUrls){assert.equal(publicSourceHref(url),null);assert.throws(()=>validateDetectionSource({...material,url}),/不能包含/);const html=reportHtml({id:'old',title:'旧报告',mode:'local',sources:[{id:'source',...material,url}],sections:[]});assert.equal(privateUrls.some(value=>html.includes(value)),false);assert.equal(/PRIVATE_[A-D]/.test(html),false);assert.match(html,/链接已隐藏/);}
 const publicUrl='https://example.org/paper?doi=10.1000%2Fabc#section-2';assert.equal(publicSourceHref(publicUrl),publicUrl);assert.equal(validateDetectionSource({...material,url:publicUrl}).url,publicUrl);
});
test('input method tabs preserve draft, import decline preserves it and no mode action submits',async()=>{
 let imports=0;const f=fixture({importDocument:async()=>{imports++;return {text:other};}});try{await f.panel.ready;f.input(body);f.$('[data-web-input-mode="upload"]').click();assert.equal(f.$('[data-web-upload-panel]').hidden,false);f.$('[data-web-input-mode="paste"]').click();assert.equal(f.$('[data-web-text]').value,body);f.allow=false;f.file();await flush();assert.equal(imports,0);assert.equal(f.$('[data-web-text]').value,body);assert.equal(f.calls.some(row=>row.payload),false);assert.equal(f.confirms.length,1);assert.equal(f.$('[data-web-consent]').checked,false);}finally{f.close();}
});
test('late extraction cannot overwrite edits made during import and adopting requires explicit choice',async()=>{
 let release;const f=fixture({importDocument:()=>new Promise(resolve=>release=resolve)});try{await f.panel.ready;f.input(body);f.file();await flush();assert.equal(f.$('[data-web-text]').disabled,false);f.input(body+'保留手动新增句子');release({text:other});await flush();assert.equal(f.$('[data-web-text]').value,body+'保留手动新增句子');assert.ok(f.$('[data-web-adopt-import]'));assert.equal(f.calls.some(row=>row.payload),false);f.allow=false;f.$('[data-web-adopt-import]').click();assert.equal(f.$('[data-web-text]').value,body+'保留手动新增句子');f.allow=true;f.$('[data-web-adopt-import]').click();assert.equal(f.$('[data-web-text]').value,other);assert.equal(f.$('[data-web-consent]').checked,false);assert.equal(f.$('[data-web-pending-import]').hidden,true);}finally{f.close();}
});
test('owner switch during extraction aborts waiting and clears preview as well as raw draft',async()=>{
 let release,signal;const f=fixture({importDocument:(_file,_status,options)=>{signal=options.signal;return new Promise(resolve=>release=resolve);}});try{await f.panel.ready;f.input('第一章 私有章节标题\n\n'+body);f.file();await flush();f.owner='u2';f.dom.window.dispatchEvent(new f.dom.window.Event('focus'));await flush();assert.equal(signal.aborted,true);release({text:other});await flush();assert.equal(f.$('[data-web-text]').value,'');assert.doesNotMatch(f.$('[data-web-scope]').textContent,/私有章节标题/);assert.equal(f.$('[data-web-start]').disabled,true);assert.equal(f.calls.some(row=>row.payload),false);}finally{f.close();}
});
test('unsubmitted draft guards route changes without storing manuscript; accepted task may be left',async()=>{
 const f=fixture({handler:(url,payload)=>url==='/api/web-similarity'&&payload?response({item:{id:'job-1',title:'合成',status:'running',stage:'searching',characters:50}}):null});try{await f.panel.ready;f.input(body);assert.equal(f.panel.canLeave(),false);f.dom.window.history.replaceState({},'', '#category/format');f.allow=false;assert.equal(f.panel.canLeave(),false);f.allow=true;assert.equal(f.panel.canLeave(),true);assert.doesNotMatch(JSON.stringify({...f.dom.window.localStorage}),/本研究正文/);f.$('[data-web-consent]').checked=true;f.$('[data-web-consent]').dispatchEvent(new f.dom.window.Event('change'));f.$('[data-web-start]').click();await flush();assert.equal(f.calls.filter(row=>row.payload).length,1);assert.equal(f.panel.canLeave(),true);}finally{f.close();}
});
test('reused failed task explains cooldown and exposes neither fabricated score nor automatic retry',async()=>{
 const f=fixture({handler:(url,payload)=>url==='/api/web-similarity'&&payload?response({item:{id:'failed-1',title:'原任务',status:'failed',stage:'failed',characters:50}}):null});try{await f.panel.ready;f.input(body);f.$('[data-web-consent]').checked=true;f.$('[data-web-consent]').dispatchEvent(new f.dom.window.Event('change'));f.$('[data-web-start]').click();await flush();assert.match(f.$('[data-web-status]').textContent,/原失败任务/);assert.match(f.$('[data-web-result]').textContent,/24 小时/);assert.doesNotMatch(f.$('[data-web-result]').textContent,/0\.0|0%/);assert.equal(f.$('[data-web-download]'),null);assert.equal(f.calls.filter(row=>row.payload).length,1);}finally{f.close();}
});

test('JSON and copy export views redact only unsafe URL metadata without changing original evidence',()=>{
 const source={id:'source-1',title:'自有合成材料',text:body,url:'https://example.org/paper?access_token=PRIVATE_EXPORT_SENTINEL',authors:['合成作者'],doi:'10.1000/owned'},paragraph={id:'p1',text:body,matches:[{sourceId:'source-1',range:[0,20],sourceRange:[3,23]}]},report={id:'legacy',sources:[source],sections:[{id:'s1',paragraphs:[paragraph]}],web:{querySamples:[{paragraphId:'p1',start:0,end:20,excerpt:body.slice(0,20)}],sources:[{url:source.url,title:'合成来源',status:'failed'}]}},before=JSON.stringify(report),safe=reportExportView(report);
 const json=JSON.stringify(safe);assert.equal(json.includes('PRIVATE_EXPORT_SENTINEL'),false);assert.equal(safe.sources[0].url,null);assert.equal(safe.sources[0].urlRedacted,true);assert.equal(safe.web.sources[0].url,null);assert.equal(safe.sections,report.sections);assert.equal(safe.sections[0].paragraphs[0],paragraph);assert.deepEqual(safe.sources[0].text,source.text);assert.deepEqual(safe.web.querySamples,report.web.querySamples);assert.equal(JSON.stringify(report),before);assert.equal(sourceCopyText(source).includes('PRIVATE_EXPORT_SENTINEL'),false);assert.match(sourceCopyText(source),/链接已隐藏/);
 const valid={...source,url:'https://example.org/paper#methods'};assert.equal(sourceCopyText(valid).includes(valid.url),true);assert.equal(reportExportView({sources:[valid]}).sources[0].url,valid.url);
});
