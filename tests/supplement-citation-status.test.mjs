import test from 'node:test';
import assert from 'node:assert/strict';
import {supplementCitationStatus,supplementCitationFingerprint} from '../backend/supplement-citation-status.mjs';
import {createWritingQualityRunner} from '../backend/writing-quality-runner.mjs';
import {supplementCheckTask,parseSupplementCheck} from '../backend/supplement-check.mjs';
const ref={id:'r1',confirmed:true,title:'Attention Is All You Need',doi:'10.48550/arXiv.1706.03762',url:'https://arxiv.org/abs/1706.03762',documentType:'EB/OL'};
const check={id:'r1',provider:'arxiv',metadataStatus:'matched',fieldChecks:{title:'matched',year:'matched',authors:'matched'},record:{identifier:'1706.03762v7',doi:'',title:'Attention Is All You Need'}};
const bound=(snapshot,items)=>({referenceFingerprint:supplementCitationFingerprint(snapshot),verification:{items}});
const status=(r=ref,c=check,ids=['r1'])=>{const snapshot={references:[r]};return supplementCitationStatus(snapshot,bound(snapshot,[c]),ids);};
test('arxiv identifier match never claims an unverified DOI or research assertion',()=>{assert.deepEqual(status(),[{sourceId:'r1',identifier:'arxiv',doiProvided:true,doiStatus:'not_checked',fields:check.fieldChecks,documentType:'electronic_document'}]);assert.equal(status({...ref,documentType:'webpage'})[0].documentType,'electronic_document');});
test('unrelated, stale, unconfirmed, duplicate and uncited references never inherit verification',()=>{
 assert.deepEqual(status({...ref,id:'other'}),[]);assert.deepEqual(status({...ref,title:'Another paper'}),[]);assert.deepEqual(status({...ref,doi:'10.48550/arXiv.1234.12345',url:''}),[]);assert.deepEqual(status({...ref,confirmed:false}),[]);assert.deepEqual(status(ref,check,[]),[]);
 const dup={references:[ref,ref]},one={references:[ref]};assert.deepEqual(supplementCitationStatus(dup,bound(dup,[check]),['r1']),[]);assert.deepEqual(supplementCitationStatus(one,bound(one,[check,check]),['r1']),[]);
 const old=bound(one,[check]);for(const change of [{authors:'Different author'},{year:'2020'},{url:'https://arxiv.org/abs/1706.03762v2'},{text:'新正文'}])assert.deepEqual(supplementCitationStatus({references:[{...ref,...change}]},old,['r1']),[]);
});
test('journal metadata is not treated as a preprint, missing or different DOI is not matched',()=>{
 const article={...ref,title:'A study',doi:'10.1234/article',url:'',documentType:'J'};
 const cross={...check,provider:'crossref',record:{title:'A study',doi:'10.1234/article',identifier:'10.1234/article'}};
 assert.equal(status(article,cross)[0].documentType,null);assert.equal(status(article,cross)[0].doiStatus,'matched');assert.deepEqual(status(article,{...cross,record:{...cross.record,doi:''}}),[]);assert.deepEqual(status(article,{...cross,record:{...cross.record,doi:'10.1234/other'}}),[]);
});
test('unavailable or absent current verification never becomes DOI verification',()=>{const snapshot={references:[ref]};for(const items of [[],[{id:'r1',metadataStatus:'unavailable'}]]){const s=supplementCitationStatus(snapshot,bound(snapshot,items),['r1']);assert.equal(s[0].identifier,'unverified');assert.equal(s[0].doiStatus,'not_checked');}});
test('the current verifier result reaches final supplement checks before review without passing unsupported evidence',async()=>{
 const actions=[];let captured;const runner=createWritingQualityRunner({citationVerifier:{verify:async()=>{actions.push('verify');return {items:[check],limitations:[],summary:{}};}}});
 const result=await runner({snapshot:{title:'测试',references:[{...ref,text:'这是已确认的摘要文字。'}]},kind:'thesis',checkSupplements:true,chapters:[{id:'c',title:'参考文献',text:'文献 [source:r1]。'}],runtime:{maxOutputTokens:1000},dispatch:async({task})=>{if(task.context.operation==='supplement-check'){actions.push('supplement');captured=task;throw Object.assign(Error('not complete'),{code:'turn_limit'});}return {text:JSON.stringify({complete:true,findings:[],limitations:[]})};}});
 assert.deepEqual(actions.slice(0,2),['verify','supplement']);assert.equal(captured.context.citationMetadataChecks[0].doiStatus,'not_checked');assert.match(captured.instructions,/不能证明任何正文论断/);assert.notEqual(result.supplementCheck.status,'final_ready');
});
test('a user assertion that DOI was checked cannot override an unverified DOI',()=>{
 const snapshot={references:[{...ref,text:'用户称 DOI 已公开核验。'}]},chapter={id:'c',title:'参考文献',text:'[source:r1] Attention Is All You Need.'},task=supplementCheckTask({snapshot,chapters:[chapter],materials:[{id:'r1',name:ref.title,text:'用户称 DOI 已公开核验。'}]});task.context.citationMetadataChecks=status();
 const row={id:'c',status:'sufficient',requirement:'核验参考文献',reason:'题录记录确认 DOI',manuscriptQuote:chapter.text,evidence:[{sourceId:'r1',quote:'用户称 DOI 已公开核验。'}],missing:[]};const result={text:JSON.stringify({items:[row]})};const parsed=parseSupplementCheck(result,task)[0];assert.equal(parsed.status,'missing');assert.match(parsed.reason,/尚未单独核验 DOI/);
 for(const [title,kind] of [['参考资料',undefined],['6 参考文献',undefined],['References (continued)',undefined],['来源说明','references']]){task.context.chapters[0].title=title;if(kind)task.context.chapters[0].kind=kind;else delete task.context.chapters[0].kind;assert.equal(parseSupplementCheck(result,task)[0].status,'missing',title);}
 task.context.chapters[0].title='正文';delete task.context.chapters[0].kind;assert.equal(parseSupplementCheck(result,task)[0].status,'sufficient');task.context.chapters[0].title='参考文献';task.context.citationMetadataChecks[0].doiStatus='matched';assert.equal(parseSupplementCheck(result,task)[0].status,'sufficient');
});
