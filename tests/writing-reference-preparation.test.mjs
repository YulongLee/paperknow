import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import JSZip from 'jszip';
import {database} from '../backend/database.mjs';
import {createThesisService} from '../backend/thesis-service.mjs';
import {createBillingService} from '../backend/billing-service.mjs';
import {createWritingReferencePreparation,sameAcademicReference,referenceTopicQuery,relevantAcademicReference,autoReferenceLabels} from '../backend/writing-reference-preparation.mjs';
import {normalizeThesisSnapshot,thesisPlan,thesisAgentTask,parseThesisSection,selectThesisEvidence} from '../backend/thesis-model.mjs';
import {thesisDocumentPresentation} from '../dist/workspace/thesis-document.mjs';
import {mergeThesisSupplements} from '../dist/workspace/thesis-simulation-client.mjs';
import {createWritingDocx} from '../src/writing-document.js';

const abstract='This synthetic dog face recognition study describes canine identification using convolutional features and documents the evaluation method and its limitations. Only the abstract is available, with no claim of reading the entire publication.';
const paper=(extra={})=>({id:'r1',title:'Dog face recognition with convolutional features',doi:'10.1234/test',authors:'Test Author',year:2025,abstract,documentType:'journal',journal:'Synthetic Journal',url:'https://doi.org/10.1234/test',...extra});
const snapshot=()=>({title:'基于深度学习的狗脸识别系统',profile:{level:'本科',language:'中文',targetWords:500},materials:[],references:[{...paper(),abstract:undefined,text:'',confirmed:true,year:'2025'}],outline:[{id:'c1',title:'第一章 文献综述',targetWords:500}]});
function prep(handler){const calls=[],search={listSources:()=>['crossref','arxiv','openalex','semantic_scholar','aminer'],search:async(query,options)=>{calls.push({query,options});return {items:await handler(query,options),sources:[]};}};return {calls,search,service:createWritingReferencePreparation({writingLiteratureSearch:search})};}

test('identity matching requires the actual title, supplied DOI and publication year rather than nearest search results',()=>{
 assert.equal(sameAcademicReference(paper(),paper()),true);
 assert.equal(sameAcademicReference(paper(),paper({title:'Dog-face recognition with convolutional features'})),true);
 for(const candidate of [paper({title:'A different face recognition study'}),paper({doi:'10.1234/other'}),paper({year:2024})])assert.equal(sameAcademicReference(paper(),candidate),false);
 assert.match(referenceTopicQuery(snapshot().title),/dog face/);assert.equal(relevantAcademicReference(snapshot().title,paper()),true);
 for(const candidate of [paper({title:'Vietnamese idiom exercises',abstract:'Teaching foreign students using classroom exercises.'}),paper({title:'Human face recognition using deep learning',abstract:'This study only concerns human faces.'}),paper({title:'Network anomaly detection',abstract:'Deep learning network anomaly detection analysis.'})])assert.equal(relevantAcademicReference(snapshot().title,candidate),false);
 assert.equal(relevantAcademicReference(snapshot().title,paper({title:'Network shallowing: a backyard dog case study',abstract:"This human face recognition algorithm is called the backyard dog problem. It identifies members of a family."})),false);
 assert.equal(relevantAcademicReference(snapshot().title,paper({title:'Multispecies animal face recognition',abstract:'This study recognizes individual animals from their faces, using datasets of dogs, cattle and primates.'})),true);
 assert.equal(relevantAcademicReference(snapshot().title,paper({title:'Visual summarization of concepts in neural networks',abstract:'This generic tool visualizes animal concepts such as dog faces and supports image recognition interpretation.'})),false);
});
test('metadata gains a real matching abstract without replacing the imported record, explicit source text or user notes',async()=>{
 const f=prep(async()=>[paper()]),original=snapshot();original.references.push({...paper({id:'own',title:'Author notes'}),text:'Author supplied text.',confirmed:true});const before=structuredClone(original),result=await f.service.prepare(original,{userId:'isolated'});
 assert.deepEqual(original,before);assert.equal(result.references[0].id,'r1');assert.equal(result.references[0].text,abstract);assert.equal(result.references[0].sourceLabel,autoReferenceLabels[0]);assert.equal(result.references[1].text,'Author supplied text.');assert.equal(result.summary.retrievedCount,1);assert.equal(result.summary.addedCount,0);assert.equal(result.summary.fullTextRead,false);assert.equal(f.calls.length,1);assert.equal(f.calls[0].query.q,'10.1234/test');assert.equal(f.calls[0].options.allowAminer,false);assert.equal(f.calls[0].options.allowSemanticScholar,false);
});
test('a stored abstract is automatically usable without another lookup or a paid AI call',async()=>{
 const f=prep(async()=>{throw Error('No lookup expected');}),value=snapshot();value.references[0].abstract=abstract;const result=await f.service.prepare(value);assert.equal(f.calls.length,0);assert.equal(result.references[0].text,abstract);assert.equal(result.summary.readableCount,1);
});
test('a missing or mismatched abstract never attaches to an unrelated imported reference and relevant alternatives are deduplicated',async()=>{
 const unrelated={...paper({id:'unrelated',title:'Vietnamese idiom exercises',doi:'10.1234/idioms'}),abstract:undefined,text:'',confirmed:true};
 const f=prep(async query=>query.q==='10.1234/idioms'?[paper()]:[paper(),paper({doi:'',title:paper().title}),paper({id:'human',title:'Human face recognition',doi:'10.1234/human',abstract:'A human face deep learning recognition investigation.'}),paper({id:'other',title:'Canine individual recognition',doi:'10.1234/canine'}),paper({id:'third',title:'Dog identification using face recognition',doi:'10.1234/dog3'}),paper({id:'fourth',title:'Dog face recognition',doi:'10.1234/dog4'})]);const result=await f.service.prepare({...snapshot(),references:[unrelated]});
 assert.equal(result.references[0].id,'unrelated');assert.equal(result.references[0].text,'');assert.equal(result.references.length,4);assert.equal(result.summary.addedCount,3);assert.deepEqual(result.summary.unresolvedIds,['unrelated']);assert.ok(result.references.slice(1).every(row=>row.id.startsWith('reference:auto-')&&row.sourceLabel===autoReferenceLabels[1]));assert.equal(new Set(result.references.map(row=>row.title)).size,4);
});
test('no private manuscript, author identity, research notes or cover data is submitted to discovery',async()=>{
 const f=prep(async()=>[]),s=snapshot();s.materials=[{name:'PRIVATE_NOTE',text:'PRIVATE_BODY',confirmed:true}];s.exportMetadata={author:'PRIVATE_AUTHOR'};await f.service.prepare(s,{userId:'isolated'});assert.doesNotMatch(JSON.stringify(f.calls),/PRIVATE_NOTE|PRIVATE_BODY|PRIVATE_AUTHOR/);
});
test('public-source failures preserve metadata and never invent sources or block a reviewable draft',async()=>{
 const f=prep(async()=>{throw Error('private api key upstream error');}),s=snapshot(),result=await f.service.prepare(s);assert.deepEqual(result.references,s.references);assert.equal(result.summary.unavailable,true);assert.equal(result.summary.readableCount,0);assert.doesNotMatch(JSON.stringify(result),/api key/);
});
test('changed ownership/version aborts preparation without writing late evidence',async()=>{
 let current=true;const f=prep(async()=>{current=false;return [paper()];});await assert.rejects(f.service.prepare(snapshot(),{isCurrent:()=>current}),e=>e.status===409);
});
test('an existing readable user source is not replaced with automatically discovered alternatives',async()=>{
 const f=prep(async()=>[]),s=snapshot();s.references[0].text='Original author-approved source content.';const result=await f.service.prepare(s);assert.equal(f.calls.length,0);assert.equal(result.summary.addedCount,0);assert.equal(result.references[0].text,s.references[0].text);
});
test('automatic abstracts respect the source-character budget without blocking an otherwise valid snapshot',async()=>{
 const f=prep(async()=>[paper()]),value=snapshot();value.materials=[{id:'m',name:'Already supplied research',text:'x'.repeat(100000),confirmed:true}];const result=await f.service.prepare(value);assert.equal(f.calls.length,0);assert.equal(result.references[0].text,'');assert.doesNotThrow(()=>normalizeThesisSnapshot({...value,references:result.references}));
});

function fixture(t,search){const db=database(':memory:'),user={id:'owner'};for(const id of ['owner','other'])db.prepare('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)').run(id,id,'user',new Date().toISOString());const billing=createBillingService(db,{}),service=createThesisService(db,{writingLiteratureSearch:search,billing});t.after(()=>db.close());const request=async(path,body,actor=user)=>(await service.handle({path,method:body===undefined?'GET':'POST',user:actor,readBody:async()=>body})).value;const create=async(s=snapshot())=>(await request('/api/theses',{clientKey:randomUUID(),snapshot:s})).item;return {db,user,billing,service,request,create};}
test('account reference preparation preserves research and chapter history, saves exactly once and charges nothing',async t=>{
 const p=prep(async()=>[paper()]),f=fixture(t,p.search);let item=await f.create();item=(await f.request('/api/theses/'+item.id+'/chapters/c1',{version:item.version,text:'原有研究正文，内容与章节版本必须保留。'})).item;
 const original=structuredClone(item),body={version:item.version,clientKey:randomUUID()},path='/api/theses/'+item.id+'/references/prepare',first=await f.request(path,body);assert.equal(first.item.version,item.version+1);assert.equal(first.item.snapshot.references[0].text,abstract);assert.deepEqual(first.item.snapshot.materials,original.snapshot.materials);assert.deepEqual(first.item.exportTemplate,original.exportTemplate);assert.deepEqual(first.item.chapters,original.chapters);assert.deepEqual((await f.request(path,body)).item,first.item);assert.equal(p.calls.length,1);assert.equal(f.db.prepare('SELECT count(*) n FROM thesis_runs').get().n,0);assert.equal(f.billing.balance(f.user.id).held,0);assert.equal(f.billing.balance(f.user.id).balance,0);
 const merged=mergeThesisSupplements(original.snapshot,first.item.snapshot);assert.equal(merged.references[0].text,abstract);
});
test('reference preparation rejects unauthenticated, foreign, stale, active and cross-paper replay before a search',async t=>{
 const p=prep(async()=>[paper()]),f=fixture(t,p.search),item=await f.create(),path='/api/theses/'+item.id+'/references/prepare',body={version:item.version,clientKey:randomUUID()};
 await assert.rejects(f.request(path,body,null),e=>e.status===401);await assert.rejects(f.request(path,body,{id:'other'}),e=>e.status===404);await assert.rejects(f.request(path,{...body,version:item.version+1}),e=>e.status===409);f.db.prepare("UPDATE theses SET status='running' WHERE id=?").run(item.id);await assert.rejects(f.request(path,body),e=>e.status===409);assert.equal(p.calls.length,0);f.db.prepare("UPDATE theses SET status='draft' WHERE id=?").run(item.id);await f.request(path,body);const other=await f.create();await assert.rejects(f.request('/api/theses/'+other.id+'/references/prepare',{...body,version:other.version}),e=>e.status===409);
});
test('concurrent retries share a lookup and intervening thesis edits are never overwritten',async t=>{
 let release,started;const entered=new Promise(resolve=>started=resolve),wait=new Promise(resolve=>release=resolve),p=prep(async()=>{started();await wait;return [paper()];}),f=fixture(t,p.search),item=await f.create(),path='/api/theses/'+item.id+'/references/prepare',body={version:item.version,clientKey:randomUUID()};
 const a=f.request(path,body);await entered;const b=f.request(path,body);await assert.rejects(f.request(path,{...body,clientKey:randomUUID()}),e=>e.status===409);release();const [first,second]=await Promise.all([a,b]);assert.equal(first.item.version,second.item.version);assert.equal(p.calls.length,1);
 let resolve2;const p2=prep(async()=>{await new Promise(resolve=>resolve2=resolve);return [paper()];}),f2=fixture(t,p2.search),next=await f2.create(),job=f2.request('/api/theses/'+next.id+'/references/prepare',{version:next.version,clientKey:randomUUID()});while(!resolve2)await new Promise(resolve=>setImmediate(resolve));f2.db.prepare("UPDATE theses SET version=version+1 WHERE id=?").run(next.id);resolve2();await assert.rejects(job,e=>e.status===409);assert.equal(f2.service.get(next.id,f2.user).snapshot.references[0].text,'');
});
test('automatic literature is actually read, numbered by first use and linked to its bibliography in DOCX',async()=>{
 const p=prep(async()=>[paper()]),prepared=await p.service.prepare(snapshot()),s=normalizeThesisSnapshot({...snapshot(),references:prepared.references}),unit=thesisPlan(s)[0],task=thesisAgentTask(s,unit,[]);assert.deepEqual(task.context.citationPolicy.candidateIds,['r1']);assert.match(task.instructions,/先读取相关文献片段/);assert.equal(task.materials[0].id,'r1');assert.match(task.materials[0].text,/canine identification/);
 const raw={text:JSON.stringify({text:'依据文献摘要讨论犬脸识别的研究范围与限制。'.repeat(25)+'[source:r1]',source_ids:['r1'],missing_evidence:[],draft:false,complete:true,figures:[]}),trace:[{tool:'read_material',materialId:'r1',status:'completed'}]},section=parseThesisSection(raw,s,unit);assert.throws(()=>parseThesisSection({...raw,trace:[]},s,unit),e=>e.code==='unread_source');
 const presentation=thesisDocumentPresentation(s,[{id:'c1',title:'第一章 文献综述',text:section.text,sourceIds:section.sourceIds}],{submission:true});assert.match(presentation.text,/\[1\]/);assert.match(presentation.text,/Test Author.*Dog face recognition.*\[J\]/);assert.doesNotMatch(presentation.text,/\[source:/);const bytes=await createWritingDocx(presentation.text,{documentKind:'thesis',metadata:{citationRanges:presentation.citationRanges}}),zip=await JSZip.loadAsync(bytes),xml=await zip.file('word/document.xml').async('string');assert.match(xml,/w:anchor="PKRef_1"/);assert.match(xml,/w:name="PKRef_1"/);
});
test('topic-selected automatic papers retain candidate priority alongside user-selected literature',()=>{
 const s=normalizeThesisSnapshot({...snapshot(),references:[...Array.from({length:8},(_,i)=>({...paper({id:'old'+i,title:'Previous source '+i}),text:abstract,confirmed:true})),{...paper({id:'auto',title:'Dog individual recognition'}),text:abstract,confirmed:true,sourceLabel:autoReferenceLabels[1]}]});assert.equal(selectThesisEvidence(s,thesisPlan(s)[0]).sources[0].id,'auto');
});
test('opaque imported citation labels are preserved without spending lookup requests on placeholder titles',async()=>{
 const calls=[],service=createWritingReferencePreparation({writingLiteratureSearch:{listSources:()=>['crossref'],async search(query){calls.push(query.q);return {items:[],sources:[]};}}}),reference={id:'raw-ref',title:'原稿参考文献条目 2',documentType:'unparsed',citationText:'Smith, J. (2024). A supplied original citation without a type.',text:'',confirmed:true},result=await service.prepare({title:'图像识别方法',materials:[],references:[reference]},{userId:'isolated',isCurrent:()=>true});assert.deepEqual(result.references,[reference]);assert.ok(calls.every(query=>!query.includes('原稿参考文献条目')));assert.ok(result.summary.unresolvedIds.includes(reference.id));
});
