import test from 'node:test';import assert from 'node:assert/strict';
import {PassThrough,Readable} from 'node:stream';import {readFile} from 'node:fs/promises';
import {preloadLiteratureRanges,resolveReadingCitations,readingPreviewText} from '../backend/literature-execution.mjs';
import {createLiteraturePreview} from '../backend/literature-preview.mjs';
import {runAgentTask} from '../backend/agent-runtime.mjs';import {normalizeToolRequest,toolRunPlan,toolRunTask,validateToolCandidate} from '../backend/tool-run-model.mjs';
import {database} from '../backend/database.mjs';import {commercialToolIdentity} from '../backend/v1-commercial-policy.mjs';import {v1CommercialVersion} from '../dist/workspace/v1-pricing.mjs';
import {locatePdfQuote} from '../dist/workspace/pdf-quote-location.mjs';import {restorePdfFootnotes,readPdfTextIndex} from '../backend/pdf-reading-text.mjs';
import {repairAcademicTranslation} from '../backend/literature-translation-quality.mjs';import JSZip from 'jszip';

test('server preloads exact selected ranges without exposing an unselected source or changing offsets',()=>{
 const task={skill:'tool-task',context:{operation:'answer',unit:{ranges:[{sourceId:'one',start:7,end:15}]}},materials:[{id:'one',name:'One',text:'prefix source A suffix'},{id:'other',text:'Never exposed'}]},out=preloadLiteratureRanges(task);
 assert.equal(out.materials[0].text,'source A');assert.equal(out.materials.length,1);assert.deepEqual(out.trace[0],{tool:'read_material',status:'completed',materialId:'one',offset:7,limit:8,preloaded:true});
 assert.throws(()=>preloadLiteratureRanges({...task,context:{operation:'answer',unit:{ranges:[{sourceId:'other-account',start:0,end:10}]}}}),/授权/);
});
test('partial JSON preview waits for complete escapes and never emits other tool arguments',()=>{
 assert.equal(readingPreviewText('{"candidate":{"text":"first\\nline\\u4e2d\\u'), 'first\nline中');
 assert.equal(readingPreviewText('{"other":{"text":"must not appear"}}'),'');
 assert.equal(readingPreviewText('{"candidate":{"text":"<img onerror=alert(1)>"}}'),'<img onerror=alert(1)>');
});
test('excerpt selection restores exact source characters and rejects fabricated or mismatched references',()=>{
 const text='Source includes $\\sqrt{d_k}$ and 27.3.\n'+('A long exact sentence about the controlled source. '.repeat(25)),task={skill:'tool-task',context:{operation:'read',unit:{ranges:[{sourceId:'p1',start:0,end:text.length}]}},materials:[{id:'p1',name:'Original',text}]},loaded=preloadLiteratureRanges(task);
 assert.equal(loaded.citationSources.flatMap(s=>s.excerpts.map(e=>e.text)).every(t=>text.includes(t)),true);
 for(const [excerptId,e]of loaded.evidence){assert.ok(e.quote.length<=600);assert.deepEqual(resolveReadingCitations({citations:[{sourceId:'p1',excerptId}]},loaded).citations,[{sourceId:'p1',quote:e.quote}]);}
 for(const c of [{sourceId:'p1',excerptId:'missing'},{sourceId:'foreign',excerptId:'e1'},{sourceId:'p1',excerptId:'e1',quote:'Fabricated'}])assert.throws(()=>resolveReadingCitations({citations:[c]},loaded),/编号/);
});
test('provisional text waits for moderation, clears on close and never publishes rejected content',async()=>{
 const db=database(':memory:');db.exec('CREATE TABLE tool_run_previews(run_id TEXT PRIMARY KEY,text TEXT,updated_at TEXT)');const signal=new AbortController().signal;let permit,checks=0;
 const preview=createLiteraturePreview({db,id:'one',signal,isActive:()=>true,config:{literaturePreviewIntervalMs:1,moderationEnabled:true,moderation:{ready:true,async checkText(){checks++;return new Promise(r=>{permit=r;});}}}});
 preview.write('Provisional authorized answer');await new Promise(r=>setTimeout(r,5));assert.equal(checks,1);assert.equal(db.prepare('SELECT count(*) n FROM tool_run_previews').get().n,0);permit({allowed:true});await new Promise(r=>setTimeout(r,5));assert.match(db.prepare('SELECT text FROM tool_run_previews').get().text,/Provisional/);await preview.close();assert.equal(db.prepare('SELECT count(*) n FROM tool_run_previews').get().n,0);
 const blocked=createLiteraturePreview({db,id:'two',signal,isActive:()=>true,config:{literaturePreviewIntervalMs:1,moderationEnabled:true,moderation:{ready:true,checkText:async()=>({allowed:false})}}});blocked.write('Rejected answer');await new Promise(r=>setTimeout(r,5));assert.equal(db.prepare('SELECT count(*) n FROM tool_run_previews').get().n,0);await blocked.close();db.close();
});
test('real SDK reads preloaded source and streams a candidate using just one mocked provider generation',async()=>{
 const source='Exact authorized source reports a measured score of 27.3.',value=normalizeToolRequest({kind:'literature',operation:'answer',snapshot:{title:'One source',question:'What is the score?',materials:[{id:'p1',name:'Paper',text:source}],context:{answerEvidencePolicy:'grounded-v2'}}}),unit=toolRunPlan(value)[0],candidate={complete:true,answered:true,text:'原文报告的分数为 27.3。这里是实际资料的简洁解释。',sourceIds:['p1'],citations:[{sourceId:'p1',excerptId:'e1'}]},previews=[],calls=[];let validatedAt=0;
 const packet=v=>'event: '+v.type+'\ndata: '+JSON.stringify(v)+'\n\n';
 const httpsRequest=(options,callback)=>{const req=new PassThrough(),parts=[];req.on('data',x=>parts.push(x));req.on('end',()=>{const body=JSON.parse(Buffer.concat(parts));if(options.path.endsWith('count_tokens')){const res=Readable.from(['{"input_tokens":10}']);res.statusCode=200;res.headers={'content-type':'application/json'};callback(res);return;}calls.push(body);assert.ok(calls.length<=1);assert.deepEqual(body.tools.map(t=>t.name),['mcp__paperknow__submit_writing_output']);assert.match(JSON.stringify(body.messages),/Exact authorized source/);
  const json=JSON.stringify({candidate}),events=[{type:'message_start',message:{id:'reading-one-call',type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,usage:{input_tokens:10,output_tokens:0}}},{type:'content_block_start',index:0,content_block:{type:'tool_use',id:'tool-reading',name:'mcp__paperknow__submit_writing_output',input:{}}}];
  for(let i=0;i<json.length;i+=24)events.push({type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:json.slice(i,i+24)}});events.push({type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'tool_use'},usage:{input_tokens:10,output_tokens:100}},{type:'message_stop'});
  const res=Readable.from((async function*(){for(const e of events){yield packet(e);await new Promise(r=>setTimeout(r,5));}})());res.statusCode=200;res.headers={'content-type':'text/event-stream'};callback(res);
 });return req;};
 const out=await runAgentTask({settings:{enabled:true,engine:'claude-agent-sdk',baseURL:'https://provider.example.com/anthropic',model:'fixture-model',apiKey:'not-a-real-key',maxTurns:4,timeoutMs:20000,maxOutputTokens:2048,maxCostUsd:.1,maxTotalTokens:100000},task:toolRunTask(value,unit,[]),onText:text=>previews.push({text,at:Date.now()}),validateToolOutput:output=>{validatedAt=Date.now();return validateToolCandidate(output,value,unit);},dependencies:{lookup:async()=>[{address:'8.8.8.8',family:4}],httpsRequest}});
 assert.equal(JSON.parse(out.text).citations[0].quote,source);assert.equal(out.providerRequests,1);assert.equal(out.submitted,true);assert.ok(out.trace.some(r=>r.tool==='read_material'&&r.preloaded));assert.ok(previews.length>1);assert.ok(previews[0].at<validatedAt);assert.equal(previews.at(-1).text,candidate.text);
});
test('commercial full-paper reading accepts 18k while question and beyond-range submissions remain bounded',()=>{
 const db=database(':memory:');try{db.exec('CREATE TABLE commercial_launches(version TEXT PRIMARY KEY)');db.prepare('INSERT INTO commercial_launches VALUES(?)').run(v1CommercialVersion);
  const request=n=>normalizeToolRequest({kind:'literature',operation:'read',snapshot:{title:'Bounded overview',text:'x'.repeat(n)}});
  assert.equal(commercialToolIdentity(db,request(18000)).serviceKey,'literature-read');assert.throws(()=>commercialToolIdentity(db,request(18001)),/18,000/);
  const answer=normalizeToolRequest({kind:'literature',operation:'answer',snapshot:{title:'Question',text:'x'.repeat(3001),question:'Question?'}});assert.throws(()=>commercialToolIdentity(db,answer),/3,000/);
 }finally{db.close();}
});
test('formula citation uses an exact prose anchor when LaTeX and PDF glyph order differ',()=>{
 const lines=[{page:4,text:'We compute the dot products of the query with all keys, divide each by dk, and apply a softmax function to obtain the weights.',y:.4}];
 const found=locatePdfQuote(lines,'We compute the dot products of the query with all keys, divide each by $\\sqrt{d_k}$, and apply a softmax function to obtain the weights.');assert.equal(found.page,4);
 assert.equal(locatePdfQuote([...lines,{...lines[0],page:6}],'We compute the dot products of the query with all keys, divide each by $\\sqrt{d_k}$, and apply a softmax function to obtain the weights.'),null);
});
test('native footnote recovery keeps provider text and restores only missing small-font footnotes',()=>{
 const lines=[{text:'A normal source paragraph already in the document.',h:.02,y:.3},{text:'4 To illustrate the variance, assume independent random variables.',h:.015,y:.82},{text:'The dot product has variance dk.',h:.015,y:.84}],base={text:'A normal source paragraph already in the document.',markdown:'Provider markdown',pages:[{pageIndex:0,text:'Provider page'}]},next=restorePdfFootnotes(base,{pages:[{pageIndex:0,lines}]});
 assert.ok(next.text.startsWith(base.text));assert.equal(next.recoveredFootnotes,1);assert.match(next.text,/variance dk/);assert.equal(restorePdfFootnotes(next,{pages:[{pageIndex:0,lines}]}),next);
});
test('academic translation restores protected terminology, split-run decimal and an anchored damaged citation without touching media',async()=>{
 const zip=new JSZip(),W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');zip.file('word/document.xml',`<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>剩余辍学 [444] 变压器的培训率 0</w:t></w:r><w:r><w:t>。1。</w:t></w:r></w:p></w:body></w:document>`);zip.file('word/media/image1.png',Buffer.from([1,2,3,4]));
 const out=await repairAcademicTranslation(await zip.generateAsync({type:'nodebuffer'}),{source:{text:'The Transformer neural network uses training. Residual Dropout We apply dropout [33] at 0.1.',title:''}}),read=await JSZip.loadAsync(out.bytes),xml=await read.file('word/document.xml').async('string');
 assert.match(xml,/残差 Dropout/);assert.match(xml,/\[33\]/);assert.doesNotMatch(xml,/444|变压器|培训|辍学/);assert.match(xml,/0\.1/);assert.deepEqual(out.audit.unresolvedCitations,[]);assert.equal(out.audit.citationCorrections,1);assert.deepEqual(await read.file('word/media/image1.png').async('nodebuffer'),Buffer.from([1,2,3,4]));
});
test('translated numeric tables keep exact values on one line without paragraph indents and remain idempotent',async()=>{
 const zip=new JSZip(),W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');zip.file('word/document.xml',`<w:document xmlns:w="${W}"><w:body><w:tbl><w:tr><w:tc><w:tcPr><w:tcW w:w="642" w:type="dxa"/></w:tcPr><w:p><w:pPr><w:ind w:left="108" w:right="94"/></w:pPr><w:r><w:t>2048</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`);
 const source={text:'The neural network training uses d_model = 2048.'},first=await repairAcademicTranslation(await zip.generateAsync({type:'nodebuffer'}),{source}),second=await repairAcademicTranslation(first.bytes,{source}),xml=await(await JSZip.loadAsync(first.bytes)).file('word/document.xml').async('string');assert.match(xml,/>2048</);assert.match(xml,/w:noWrap/);assert.match(xml,/w:left="0"/);assert.match(xml,/w:right="0"/);assert.equal(first.audit.tableLayoutCorrections,1);assert.equal(second.audit.tableLayoutCorrections,0);
});
