import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database} from '../backend/database.mjs';
import {createThesisService} from '../backend/thesis-service.mjs';
import {startThesisWorker} from '../backend/thesis-worker.mjs';
import {normalizeThesisSnapshot,compileThesisReferences,thesisAgentTask,thesisPlan} from '../backend/thesis-model.mjs';
import {thesisSnapshotFromDraft} from '../dist/workspace/writing-model.mjs';
import {buildThesisBibliography,renderThesisCitations,presentThesisDocument,formatThesisReference,thesisDocumentPresentation} from '../dist/workspace/thesis-document.mjs';

const publication={documentType:'journal',journal:'合成期刊',publisher:'合成出版机构',publicationSource:'合成来源',volume:'12',issue:'3',pages:'45-49',venue:'合成会议',accessedAt:'2026-10-23'};
const reference=(id,extra={})=>({id,title:'合成文献'+id,authors:'合成作者',year:'2026',doi:'10.9999/'+id,url:'https://example.invalid/'+id,confirmed:true,text:'',...extra});
const snapshot=()=>({title:'合成论文引用验收',profile:{level:'本科',language:'中文',targetWords:500},requirements:{},materials:[{id:'notebook',name:'合成研究笔记',text:'本资料只用于流程测试。'.repeat(20),confirmed:true}],references:[reference('a',publication),reference('b'),reference('catalog-only'),reference('unconfirmed',{confirmed:false})],outline:[{id:'chapter-1',title:'研究背景',targetWords:250},{id:'chapter-2',title:'研究讨论',targetWords:250}]});

test('whole-manuscript citation numbers follow actual prose markers and retain exact editor offsets',()=>{
 const value=snapshot(),chapters=[{id:'refs',title:'参考文献',text:'[source:a]旧列表顺序\n[source:b]旧列表顺序'},{id:'chapter-1',title:'研究背景',text:'😀先引用[source:b]，再引用[source:a]。',sourceIds:['a','catalog-only']},{id:'chapter-2',title:'研究讨论',text:'重复[source:b]与笔记[source:notebook]，未知[source:missing]。'}],before=structuredClone({value,chapters}),index=buildThesisBibliography(value,chapters);
 assert.deepEqual(index.references.map(row=>[row.id,row.number,row.label]),[['b',1,'[1]'],['a',2,'[2]']]);
 assert.equal(index.references[0].occurrences.length,2);assert.equal(index.references[0].occurrences[0].chapterId,'chapter-1');
 const occurrence=index.references[0].occurrences[0];assert.equal(chapters[1].text.slice(occurrence.start,occurrence.end),'[source:b]');
 assert.deepEqual(index.uncitedReferences.map(row=>[row.id,row.associated,row.label]),[['catalog-only',true,'[待引用1]']]);
 assert.equal(index.materials[0].label,'[材料1]');assert.equal(index.unresolved[0].sourceId,'missing');assert.equal(index.counts.citations,3);
 assert.equal(renderThesisCitations(chapters[2].text,index),'重复[1]与笔记[材料1]，未知[来源待核对]。');assert.deepEqual({value,chapters},before);
});

test('selected catalogs stay visible as uncited candidates without creating numeric references or evidence claims',()=>{
 const value=snapshot(),chapters=[{id:'chapter-1',title:'研究背景',text:'待核对的合成草稿。',sourceIds:['a']}],index=buildThesisBibliography(value,chapters),text=presentThesisDocument(value,chapters);
 assert.deepEqual(index.references,[]);assert.equal(index.uncitedReferences.length,3);assert.ok(index.uncitedReferences.every(row=>row.readableSource===false));
 assert.match(text,/待引用文献（尚未在正文引用）/);assert.match(text,/\[待引用1\] 合成作者\. 合成文献a\[J\]/);assert.match(text,/合成期刊, 2026, 12\(3\): 45-49/);
 assert.doesNotMatch(text,/已使用的参考文献|\[1\]|合成文献unconfirmed|\[source:/);
 const raw=structuredClone(value);raw.references.push(reference('notebook'));const ambiguous=buildThesisBibliography(raw,[{id:'c',text:'不能识别[source:notebook]'}]);assert.equal(ambiguous.unresolved.length,1);assert.deepEqual(ambiguous.materials,[]);assert.ok(ambiguous.uncitedReferences.every(row=>row.id!=='notebook'));
});

test('publication metadata survives local conversion, backend normalization and source-order compilation',()=>{
 const draft={title:'合成元数据贯通',degree:'本科',targetWords:500,writingReferences:[reference('a',publication),reference('b')],outlineRows:[{id:'body',title:'研究背景',level:1,words:500}]},before=structuredClone(draft),normalized=normalizeThesisSnapshot(thesisSnapshotFromDraft(draft));
 for(const [key,value] of Object.entries(publication))assert.equal(normalized.references[0][key],value);
 assert.deepEqual(normalizeThesisSnapshot(normalized),normalized);assert.deepEqual(draft,before);
 const compiled=compileThesisReferences(normalized,[normalized.references[1].id,normalized.references[0].id,normalized.references[1].id,'unknown']);assert.ok(compiled.indexOf('[source:'+normalized.references[1].id+']')<compiled.indexOf('[source:'+normalized.references[0].id+']'));assert.match(compiled,/合成文献a\[J\]/);assert.match(compiled,/45-49/);assert.doesNotMatch(compiled,/unknown/);
 const task=thesisAgentTask(normalized,thesisPlan(normalized)[0],[]);assert.equal(task.context.referenceMetadata[0].journal,publication.journal);assert.equal(task.context.referenceMetadata[0].metadataOnly,true);assert.deepEqual(task.materials,[]);assert.match(task.instructions,/不要自行编造\[1\]等数字索引/);
 for(const documentType of ['__proto__','constructor','toString','unknown'])assert.equal(formatThesisReference({title:'原始题名',documentType}),'原始题名');
 assert.throws(()=>normalizeThesisSnapshot({...snapshot(),references:[reference('a',{pages:'x'.repeat(101)})]}),error=>error.status===400);
});

const settings={enabled:true,engine:'claude-agent-sdk',baseURL:'https://model.example.invalid',model:'test',apiKey:'synthetic-secret',version:'v1',maxTurns:3,maxOutputTokens:4096,maxCostUsd:.5,timeoutMs:30000};
function fixture(t,runner){const db=database(':memory:'),user={id:'citation-owner'};db.prepare('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)').run(user.id,'合成测试','user',new Date().toISOString());const config={getAgentSettings:()=>settings,agentTaskRunner:runner,thesisPollMs:60000},service=createThesisService(db,config);let worker;const request=async(path,method='GET',body)=>(await service.handle({path,method,user,readBody:async()=>body})).value;t.after(async()=>{await worker?.stop();db.close();});return {db,user,request,service,start:()=>worker??=startThesisWorker(db,config),create:async body=>(await request('/api/theses','POST',{snapshot:body,clientKey:randomUUID()})).item};}

test('manual metadata-only citations are explicit, owner-bound and recomputed without altering prior chapter versions',async t=>{
 const f=fixture(t),created=await f.create(snapshot()),saved=(await f.request(`/api/theses/${created.id}/chapters/chapter-1`,'POST',{version:created.version,text:'用户核对后手动建立引文[source:a]。'})).item;
 assert.deepEqual(saved.chapters[0].sourceIds,['a']);assert.equal(saved.bibliography.references[0].id,'a');assert.equal(saved.bibliography.references[0].readableSource,false);assert.equal(saved.bibliography.references[0].journal,publication.journal);assert.equal(saved.bibliography.uncitedReferences.length,2);assert.match(saved.fullText,/用户核对后手动建立引文\[1\]/);
 const revised=(await f.request(`/api/theses/${created.id}/chapters/chapter-1`,'POST',{version:saved.version,text:'用户删除了引文标记。'})).item;assert.deepEqual(revised.bibliography.references,[]);assert.deepEqual(revised.chapters[0].sourceIds,[]);assert.equal(revised.bibliography.uncitedReferences.length,3);
 const old=(await f.request(`/api/theses/${created.id}/chapters/chapter-1/versions/1`)).item;assert.equal(old.text,'用户核对后手动建立引文[source:a]。');assert.deepEqual(old.sourceIds,['a']);assert.equal(f.db.prepare('SELECT count(*) n FROM thesis_chapter_versions').get().n,2);
});

test('worker persists citation index and uncited catalogs even without a references outline chapter',async t=>{
 const f=fixture(t,async({task})=>({text:JSON.stringify({text:'研'.repeat(task.context.unit.targetWords)+'[source:b][source:a]',source_ids:['a','b'],missing_evidence:[],complete:true}),trace:['b','a'].map(materialId=>({tool:'read_material',status:'completed',materialId})),usage:{input:10,output:20}})),value=snapshot();value.references[0].text='a文献的合成可读原文。'.repeat(20);value.references[1].text='b文献的合成可读原文。'.repeat(20);
 const created=await f.create(value),quote=await f.request(`/api/theses/${created.id}/quote`,'POST',{version:created.version}),queued=(await f.request(`/api/theses/${created.id}/generate`,'POST',{version:created.version,clientKey:randomUUID(),billingToken:quote.token,consent:true})).item;await f.start().tick();const done=f.service.get(queued.id,f.user);assert.equal(done.status,'completed');assert.equal(done.chapters.length,2,'automatic inventory never rewrites user outline or chapter ids');
 assert.deepEqual(done.bibliography.references.map(row=>row.id),['b','a']);assert.equal(done.bibliography.references[0].occurrences.length,2);assert.equal(done.bibliography.uncitedReferences[0].id,'catalog-only');assert.match(done.fullText,/\[待引用1\].*合成文献catalog-only/);
 const stored=JSON.parse(f.db.prepare('SELECT body FROM results').get().body);assert.deepEqual(stored.bibliography,done.bibliography);assert.equal(stored.references.find(row=>row.id==='a').journal,publication.journal);assert.ok(stored.references.every(row=>!Object.hasOwn(row,'text')));
});


test('legacy reference chapters cannot renumber first prose citations or retain removed references as formal entries',()=>{
 const value=snapshot(),rows=[{id:'legacy-refs',title:'参考文献',text:compileThesisReferences(value,['a','b'])},{id:'chapter-1',title:'研究背景',text:'先出现[source:b]，后来[source:a]。'}],before=structuredClone(rows),text=presentThesisDocument(value,rows);
 assert.match(text,/先出现\[1\]，后来\[2\]/);const heading=text.indexOf('\n\n参考文献\n\n');assert.ok(heading>0);const canonical=text.slice(heading,text.indexOf('待引用文献'));
 assert.ok(canonical.indexOf('[1] 合成作者. 合成文献b')<canonical.indexOf('[2] 合成作者. 合成文献a[J]'));assert.equal((text.match(/合成文献b/g)||[]).length,1);assert.deepEqual(rows,before);
 rows[1].text='正文已经移除了全部引用。';const removed=presentThesisDocument(value,rows);assert.doesNotMatch(removed,/\[1\]|\[2\]|已使用的参考文献/);assert.match(removed,/\[待引用1\] 合成作者\. 合成文献a\[J\]/);assert.match(removed,/\[待引用2\] 合成作者\. 合成文献b/);
});


test('declared material provenance survives without an inline marker while remaining distinct from numeric scholarly citations',()=>{
 const value=snapshot(),rows=[{id:'c',title:'正文',text:'人工修订后没有逐句引文的正文。',sourceIds:['notebook','a','unconfirmed','missing']}],before=structuredClone({value,rows}),index=buildThesisBibliography(value,rows),text=presentThesisDocument(value,rows);
 assert.deepEqual(index.materials,[]);assert.equal(index.associatedMaterials.length,1);assert.equal(index.associatedMaterials[0].id,'notebook');assert.deepEqual(index.associatedMaterials[0].occurrences,[]);assert.equal(index.counts.citations,0);assert.equal(index.counts.materials,0);assert.equal(index.counts.associatedMaterials,1);
 assert.match(text,/研究材料来源/);assert.match(text,/\[关联材料1\] 合成研究笔记（关联来源，当前正文未标注）/);assert.match(text,/\[待引用1\].*合成文献a/);assert.doesNotMatch(text,/已使用的参考文献|\[1\]|合成文献unconfirmed|\[source:/);assert.deepEqual({value,rows},before);
});


test('semantic export ranges originate only in raw body markers, never plain numeric indices or bibliography labels',()=>{
 const value=snapshot(),repeated='😀相同段落 array[1] 与 $v=[1]$；实际引文[source:a]，普通 [1]。',chapters=[{id:'c1',title:'第一章 [1]',text:repeated+'\r\n'+repeated},{id:'c2',title:'第二章',text:'第三处引文[source:b]；已有文字 [2]。'},{id:'refs',title:'参考文献',text:'手动备注[1] [source:a]'}],before=structuredClone({value,chapters}),presentation=thesisDocumentPresentation(value,chapters,{title:'标题 [1]'});
 assert.equal(presentation.text,presentThesisDocument(value,chapters,{title:'标题 [1]'}));assert.equal(presentation.citationRanges.length,3);assert.deepEqual(presentation.citationRanges.map(row=>row.number),[1,1,2]);
 const expected=[...presentation.text.matchAll(/实际引文\[1\]|第三处引文\[2\]/g)].map(match=>{const label=match[0].match(/\[\d+\]$/)[0],start=match.index+match[0].length-label.length;return {start,end:start+label.length,number:Number(label.slice(1,-1))};});
 assert.deepEqual(presentation.citationRanges,expected);for(const range of presentation.citationRanges)assert.equal(presentation.text.slice(range.start,range.end),'['+range.number+']');
 for(const match of presentation.text.matchAll(/array\[1\]|\$v=\[1\]\$|普通 \[1\]|标题 \[1\]|第一章 \[1\]|已有文字 \[2\]/g))assert.ok(presentation.citationRanges.every(range=>range.start<match.index||range.start>=match.index+match[0].length));
 assert.deepEqual({value,chapters},before);
});

test('export presentation normalizes CRLF and forbidden controls before calculating UTF-16 citation ranges',()=>{
 const value=snapshot(),raw='第一章\r\n😀前言\u0000\u0007\r\n数学 $x=[1]$，引用[source:b]。\r纯文本\t索引 [1]，后续[source:a]。\u000b\n相同\r\n相同[source:b]。',chapters=[{id:'c1',title:'第一章',text:raw}],before=structuredClone(chapters),presentation=thesisDocumentPresentation(value,chapters,{title:'合成\u0000题目\r\n附题'});
 assert.doesNotMatch(presentation.text,/\r|[\x00-\x08\x0b\x0c\x0e-\x1f]/);assert.ok(presentation.text.includes('纯文本\t索引 [1]'));assert.deepEqual(presentation.citationRanges.map(row=>row.number),[1,2,1]);
 const expected=[['引用[1]',1],['后续[2]',2],['相同[1]',1]].map(([needle,number])=>{const start=presentation.text.indexOf(needle)+needle.indexOf('[');return {start,end:start+3,number};});assert.deepEqual(presentation.citationRanges,expected);
 for(const range of presentation.citationRanges)assert.equal(presentation.text.slice(range.start,range.end),'['+range.number+']');assert.deepEqual(chapters,before);
 assert.deepEqual(thesisDocumentPresentation(value,[]),{text:'',citationRanges:[]});
});

test('known journal and book publication facts follow publication-year-locator order without invented fields',()=>{
 assert.equal(formatThesisReference({authors:'作者',title:'文献',documentType:'journal',journal:'期刊',year:'2026',volume:'12',issue:'3',pages:'45-49'}),'作者. 文献[J]. 期刊, 2026, 12(3): 45-49');
 assert.equal(formatThesisReference({authors:'作者',title:'图书',documentType:'book',publisher:'出版社',year:'2026',pages:'12-15'}),'作者. 图书[M]. 出版社, 2026: 12-15');
 assert.equal(formatThesisReference({authors:'作者',title:'旧题录',year:'2026'}),'作者. 旧题录. 2026');assert.equal(formatThesisReference({title:'缺少年份',documentType:'journal',journal:'原刊'}),'缺少年份[J]. 原刊');
});
