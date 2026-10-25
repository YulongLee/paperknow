import {randomUUID} from 'node:crypto';
import {normalizeThesisSnapshot,thesisHash,thesisError,isThesisReferenceChapter} from './thesis-model.mjs';
import {thesisCompletionNeeds,safeCompletionIssues} from '../dist/workspace/thesis-completion-model.mjs';
import {thesisFrontMatterKind,thesisManualBackMatter,thesisCoverFields} from '../dist/workspace/thesis-delivery.mjs';
const fail=(status,message)=>{throw thesisError(status,message);};
export function savedThesisChapters(db,row){return JSON.parse(row.snapshot).outline.map(chapter=>({...chapter,record:db.prepare('SELECT * FROM thesis_chapter_versions WHERE thesis_id=? AND chapter_id=? ORDER BY version DESC LIMIT 1').get(row.id,chapter.id)}));}
export function completionAssessment(db,row){const chapters=savedThesisChapters(db,row).map(({record,...chapter})=>({...chapter,text:record?.text||''}));return thesisCompletionNeeds({snapshot:JSON.parse(row.snapshot),chapters});}
export function completionInput(row,input,config){
 const allowed=['version','clientKey','supplement','materials','references','metadata','acknowledgements'];if(!input||Object.keys(input).some(key=>!allowed.includes(key)))fail(400,'补充资料包含不支持的字段');
 const snapshot=JSON.parse(row.snapshot);snapshot.requirements={...snapshot.requirements,deliveryVersion:1};const metadata={...JSON.parse(row.export_metadata||'{}')};
 if(input.metadata!==undefined){if(!input.metadata||typeof input.metadata!=='object'||Array.isArray(input.metadata)||Object.keys(input.metadata).some(key=>!Object.hasOwn(thesisCoverFields,key)||typeof input.metadata[key]!=='string'||input.metadata[key].length>200))fail(400,'封面补充信息无效');Object.assign(metadata,input.metadata);}
 if(input.supplement!==undefined&&(typeof input.supplement!=='string'||input.supplement.length>50000))fail(400,'研究补充最多 50,000 字符');
 const materials=Array.isArray(input.materials)?[...input.materials]:input.materials??[];if(!Array.isArray(materials)||materials.length>10||materials.some(m=>!m||typeof m.name!=='string'||m.name.length>240||typeof m.text!=='string'||!m.text.trim()||m.text.length>50000))fail(400,'请选择最多 10 份有正文的研究资料，每份最多 50,000 字符');
 if(input.supplement?.trim())materials.push({name:'终稿补充研究说明',text:input.supplement.trim()});
 if(input.acknowledgements!==undefined&&(typeof input.acknowledgements!=='string'||input.acknowledgements.length>5000))fail(400,'致谢事实最多 5,000 字符');
 if(input.acknowledgements?.trim())materials.push({name:'作者确认的致谢事实',text:input.acknowledgements.trim(),purpose:'致谢事实'});
 for(const material of materials)snapshot.materials.push({id:'material:'+randomUUID(),name:material.name,text:material.text,purpose:material.purpose==='致谢事实'?'致谢事实':'研究证据补充',confirmed:true});
 const references=input.references??[];if(!Array.isArray(references)||references.length>30||references.some(r=>!r||typeof r.title!=='string'||!r.title.trim()||typeof r.text!=='string'||!r.text.trim()))fail(400,'文献需提供真实题名与可引用正文');
 for(const reference of references)snapshot.references.push({...reference,id:'reference:'+randomUUID(),sourceLabel:'作者终稿补充文献',confirmed:true});
 return {snapshot:normalizeThesisSnapshot(snapshot,config),metadata};
}
// The server selects the affected chapters and binds their exact baseline to
// the quote. Client issue codes can request work, never provide executable plans.
export function thesisCompletionPlan(db,row,basePlan,issueCodes=[]){
 const snapshot=JSON.parse(row.snapshot),saved=savedThesisChapters(db,row),needs=completionAssessment(db,row),issues=safeCompletionIssues(issueCodes),targets=new Set(needs.chapters.map(chapter=>chapter.id));
 const referencesChanged=snapshot.references.some(reference=>reference.confirmed&&reference.text?.trim()&&!saved.some(chapter=>chapter.record?.text.includes('[source:'+reference.id+']')));
 const broad=referencesChanged||issues.some(code=>/reference|citation|sources|duplicate|review_findings|raw_formula|table_numbers/.test(code));
 for(const chapter of saved){if(isThesisReferenceChapter(chapter))continue;if(broad&&!thesisManualBackMatter(chapter)||thesisFrontMatterKind(chapter)&&issues.some(code=>/abstract|keywords|english_title/.test(code)))targets.add(chapter.id);}
 const bodyChanged=saved.some(chapter=>targets.has(chapter.id)&&!thesisFrontMatterKind(chapter)&&!thesisManualBackMatter(chapter));if(bodyChanged)for(const chapter of saved.filter(thesisFrontMatterKind))targets.add(chapter.id);
 const priorQuality=row.current_run_id?db.prepare('SELECT quality FROM thesis_runs WHERE id=? AND thesis_id=?').get(row.current_run_id,row.id)?.quality:null,reviewFindings=priorQuality?(JSON.parse(priorQuality).reviews||[]).flatMap(review=>review.findings||[]):[];
 const priority=[...snapshot.materials.filter(row=>row.confirmed&&row.purpose==='研究证据补充').slice(-6),...snapshot.references.filter(row=>row.confirmed&&row.sourceLabel==='作者终稿补充文献').slice(-4)].map(row=>row.id);
 const plan=basePlan.filter(unit=>targets.has(unit.chapterId)).map(unit=>({...unit,sourceIds:[],completionSourceIds:priority,completion:{findings:reviewFindings.filter(finding=>typeof finding.quote==='string'&&finding.quote.length>=6&&saved.find(c=>c.id===unit.chapterId)?.record?.text.includes(finding.quote)).slice(0,6).map(({quote,explanation,suggestion,category})=>({quote:quote.slice(0,500),explanation:String(explanation||'').slice(0,500),suggestion:String(suggestion||'').slice(0,300),category})),originalText:String(saved.find(c=>c.id===unit.chapterId)?.record?.text||'').slice(0,16000),excerpted:String(saved.find(c=>c.id===unit.chapterId)?.record?.text||'').length>16000}}));
 const acknowledgementFacts=snapshot.materials.filter(row=>row.confirmed&&row.purpose==='致谢事实').map(row=>row.text).join('\n');
 for(const chapter of saved.filter(thesisManualBackMatter))if(targets.has(chapter.id)&&acknowledgementFacts.trim())plan.push({id:chapter.id+'::completion::1',chapterId:chapter.id,chapterTitle:chapter.title,sectionId:chapter.id,title:chapter.title,part:1,parts:1,targetWords:200,sourceIds:[],presentation:{},personalMatter:true,completion:{originalText:chapter.record?.text||'',acknowledgementFacts:acknowledgementFacts.slice(0,5000)}});
 if(!plan.length)fail(422,'当前没有需要 AI 完善的章节；请重新检查终稿，封面和排版由系统直接处理。');
 for(const [index,unit]of plan.entries())unit.position=index;
 const baseline=saved.flatMap(chapter=>chapter.record?[{chapterId:chapter.id,versionId:chapter.record.id}]:[]);
 return {plan,baseline,issueCodes:issues,chapterTitles:saved.filter(chapter=>plan.some(unit=>unit.chapterId===chapter.id)).map(chapter=>chapter.title),fingerprint:thesisHash({snapshot:row.snapshot_hash,baseline,plan})};
}
export function completionBaseline(db,run){const meta=JSON.parse(run.settings_meta||'{}');if(!meta.completion)return [];return (meta.completion.baseline||[]).map(reference=>{const row=db.prepare('SELECT * FROM thesis_chapter_versions WHERE id=? AND thesis_id=? AND chapter_id=?').get(reference.versionId,run.thesis_id,reference.chapterId);if(!row)fail(409,'原论文章节版本暂不可读取，未覆盖已保存内容');return row;});}
export function completionManuscriptHash(chapters){return thesisHash(chapters.map(row=>({id:row.chapter_id||row.id,text:row.text,figures:typeof row.figures==='string'?JSON.parse(row.figures):row.figures||[]})));}

export function assertCompletionResumeUnchanged(db,row,run){
 const completion=JSON.parse(run?.settings_meta||'{}').completion;if(!completion)return;for(const chapter of savedThesisChapters(db,row)){if(!chapter.record)continue;const original=completion.baseline.find(reference=>reference.chapterId===chapter.id);if(chapter.record.id!==original?.versionId&&chapter.record.run_id!==run.id)fail(409,'论文在中断后已有新的章节编辑，请重新获取自动完善费用；当前正文不会被旧任务覆盖。');}
}
