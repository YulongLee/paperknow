import {thesisDocxObjects} from './thesis-docx-objects.mjs';
import {researchWordCount} from './text-length.mjs';
import {docxObjectIds} from '../dist/workspace/docx-object-markers.mjs';
import {generateSimulationData} from '../dist/workspace/simulation-data.mjs';
import {manuscriptFigures} from '../dist/workspace/manuscript-figures.mjs';
import {randomUUID} from 'node:crypto';
import {normalizeThesisSnapshot,thesisHash,thesisError,isThesisReferenceChapter,thesisAgentTask} from './thesis-model.mjs';
import {thesisCompletionNeeds,safeCompletionIssues} from '../dist/workspace/thesis-completion-model.mjs';
import {thesisFrontMatterKind,thesisManualBackMatter,thesisCoverFields} from '../dist/workspace/thesis-delivery.mjs';
import {completionDiagnosis} from './thesis-completion-guidance.mjs';
const fail=(status,message)=>{throw thesisError(status,message);};
const referenceDoi=value=>{const doi=String(value||'').trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//iu,'').replace(/^doi\s*:\s*/iu,'').toLowerCase();return /^10\.\d{4,9}\/[^\s<>\u0000-\u001f]+$/u.test(doi)?doi:'';};
const referenceTitle=value=>String(value||'').normalize('NFKC').trim().replace(/\s+/gu,' ').toLowerCase();
const referenceAuthorsCompatible=(left,right)=>{
 if(!String(left||'').trim()||!String(right||'').trim())return true;
 const tokens=value=>String(value).split(/[;,；，]/u)[0].normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu)||[],a=tokens(left),b=tokens(right);
 if(a.length&&a.length===b.length&&a.every((token,index)=>token===b[index]))return true;
 if(a.length===1&&b.length===1)return a[0]===b[0];
 // Support surname-first initials and given-name-first names only when the
 // surname is identical and the remaining given name is not contradictory.
 const shared=a.filter(token=>token.length>=2&&b.includes(token));if(shared.length!==1)return false;
 const restA=a.filter(token=>token!==shared[0]),restB=b.filter(token=>token!==shared[0]);if(restA.length!==1||restB.length!==1)return false;
 return restA[0]===restB[0]||(restA[0].length===1&&restB[0].startsWith(restA[0]))||(restB[0].length===1&&restA[0].startsWith(restB[0]));
};
const referenceFieldsCompatible=(left,right)=>['year','journal','volume','issue','pages','publisher','documentType','url'].every(key=>!String(left[key]||'').trim()||!String(right[key]||'').trim()||referenceTitle(left[key])===referenceTitle(right[key]))&&referenceAuthorsCompatible(left.authors,right.authors);
function linkExistingReferenceExcerpts(references){
 for(const original of references){if(original.confirmed!==true||String(original.text||'').trim())continue;const doi=referenceDoi(original.doi);if(!doi)continue;
  const matches=references.filter(row=>row.confirmed===true&&referenceDoi(row.doi)===doi);
  if(matches.length!==2)continue;const other=matches.find(row=>row!==original);
  if(!other||!String(other.text||'').trim()||referenceTitle(original.title)!==referenceTitle(other.title)||!referenceFieldsCompatible(original,other))continue;
  // Keep both IDs and original metadata: older snapshots may cite either one.
  original.text=other.text;original.sourceLabel='对应的用户提供文献内容，不代表全文或题录已核验';
 }
}
export function recoverableThesisSimulation(db,row){
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='thesis_method_runs'").get())return null;
 const saved=new Set(JSON.parse(row.snapshot).materials.filter(material=>material.dataKind==='simulation').map(material=>material.simulation?.jobId));
 const candidates=db.prepare("SELECT m.id,m.snapshot,m.output,m.created_at FROM jobs j JOIN thesis_method_runs m ON m.id=j.id WHERE j.user_id=? AND m.user_id=? AND j.type='thesis_method' AND j.status='completed' AND m.status='completed' AND json_extract(j.input,'$.operation')='simulation' AND json_extract(j.input,'$.thesisId')=? ORDER BY j.created_at DESC LIMIT 8").all(row.user_id,row.user_id,row.id);
 for(const candidate of candidates){
  if(saved.has(candidate.id))continue;
  try{const source=JSON.parse(candidate.snapshot),output=JSON.parse(candidate.output),recipe=output.recipe;
   if(source.requestKind!=='simulation'||source.simulation?.thesisId!==row.id||source.simulation.sourceHash!==row.snapshot_hash||output.origin!=='ai_simulation'||!recipe||!Number.isSafeInteger(recipe.sampleSize)||!Array.isArray(recipe.variables))continue;
   return {id:candidate.id,title:String(recipe.title).slice(0,120),sampleSize:recipe.sampleSize,variableCount:recipe.variables.length,createdAt:candidate.created_at};
  }catch{}
 }
 return null;
}
export function savedThesisChapters(db,row){return JSON.parse(row.snapshot).outline.map(chapter=>({...chapter,record:db.prepare('SELECT * FROM thesis_chapter_versions WHERE thesis_id=? AND chapter_id=? ORDER BY version DESC LIMIT 1').get(row.id,chapter.id)}));}
export function completionAssessment(db,row){const chapters=savedThesisChapters(db,row).map(({record,...chapter})=>({...chapter,text:record?.text||'',figures:JSON.parse(record?.figures||'[]')}));return thesisCompletionNeeds({snapshot:JSON.parse(row.snapshot),chapters});}
export function completionInput(row,input,config,db){
 const allowed=['version','clientKey','supplement','materials','references','referenceFragments','metadata','acknowledgements','simulationRunIds'];if(!input||Object.keys(input).some(key=>!allowed.includes(key)))fail(400,'补充资料包含不支持的字段');
 const snapshot=JSON.parse(row.snapshot);snapshot.requirements={...snapshot.requirements,deliveryVersion:1};const metadata={...JSON.parse(row.export_metadata||'{}')};
 if(input.metadata!==undefined){if(!input.metadata||typeof input.metadata!=='object'||Array.isArray(input.metadata)||Object.keys(input.metadata).some(key=>!Object.hasOwn(thesisCoverFields,key)||typeof input.metadata[key]!=='string'||input.metadata[key].length>200))fail(400,'封面补充信息无效');Object.assign(metadata,input.metadata);}
 if(input.supplement!==undefined&&(typeof input.supplement!=='string'||input.supplement.length>50000))fail(400,'研究补充最多 50,000 字符');
 const materials=Array.isArray(input.materials)?[...input.materials]:input.materials??[];if(!Array.isArray(materials)||materials.length>10||materials.some(m=>!m||typeof m.name!=='string'||m.name.length>240||typeof m.text!=='string'||!m.text.trim()||m.text.length>50000))fail(400,'请选择最多 10 份有正文的研究资料，每份最多 50,000 字符');
 if(input.supplement?.trim())materials.push({name:'终稿补充研究说明',text:input.supplement.trim()});
 if(input.acknowledgements!==undefined&&(typeof input.acknowledgements!=='string'||input.acknowledgements.length>5000))fail(400,'致谢事实最多 5,000 字符');
 if(input.acknowledgements?.trim())materials.push({name:'作者确认的致谢事实',text:input.acknowledgements.trim(),purpose:'致谢事实'});
 for(const material of materials)snapshot.materials.push({id:'material:'+randomUUID(),name:material.name,text:material.text,purpose:material.purpose==='致谢事实'?'致谢事实':'研究证据补充',confirmed:true});
 const fragments=input.referenceFragments??[];if(!Array.isArray(fragments)||fragments.length>10||fragments.some(row=>!row||Object.keys(row).some(key=>!['referenceId','text'].includes(key))||typeof row.referenceId!=='string'||!row.referenceId||row.referenceId.length>150||typeof row.text!=='string'||!row.text.trim()||row.text.length>50000))fail(400,'请选择已有文献并填写需补充的正文片段');
 for(const fragment of fragments){const matches=snapshot.references.filter(row=>row.id===fragment.referenceId&&row.confirmed===true);if(matches.length!==1)fail(404,'所选文献不存在或尚未确认');const reference=matches[0];snapshot.materials.push({id:'material:'+randomUUID(),name:'文献补充片段：'+String(reference.title).slice(0,200),text:fragment.text.trim(),purpose:'文献补充片段（作者提供，未核验为全文）',relatedReferenceId:reference.id,confirmed:true});}
 const simulationIds=input.simulationRunIds??[];if(!Array.isArray(simulationIds)||simulationIds.length>3||simulationIds.some(id=>typeof id!=='string'||id.length>100)||new Set(simulationIds).size!==simulationIds.length)fail(400,'本次最多采用 3 份模拟数据');
 for(const simulationId of simulationIds){
  if(!db)fail(503,'模拟数据来源暂不可核对');const run=db.prepare('SELECT * FROM thesis_method_runs WHERE id=? AND user_id=?').get(simulationId,row.user_id);if(!run||run.status!=='completed')fail(404,'已完成的模拟任务不存在');const source=JSON.parse(run.snapshot),output=JSON.parse(run.output||'null');
  if(source.requestKind!=='simulation'||source.simulation?.thesisId!==row.id||output?.origin!=='ai_simulation')fail(409,'这份模拟数据不属于当前论文');
  const materialId='simulation:'+run.id;if(snapshot.materials.some(material=>material.id===materialId))continue;
  if(source.simulation.sourceHash!==row.snapshot_hash)fail(409,'论文研究信息已变化，请根据最新信息重新生成模拟数据');
  const generated=generateSimulationData(output.recipe,output.seed);if(generated.csv!==output.csv)fail(409,'模拟数据复现检查未通过，请重新生成');
  snapshot.materials.push({id:materialId,name:'AI模拟数据：'+generated.recipe.title,text:generated.text,purpose:'仿真研究数据（非实测）',dataKind:'simulation',confirmed:true,simulation:{jobId:run.id,seed:generated.seed,generatorVersion:1,recipe:generated.recipe}});
 }
 const references=input.references??[];if(!Array.isArray(references)||references.length>30||references.some(r=>!r||typeof r.title!=='string'||!r.title.trim()||typeof r.text!=='string'||!r.text.trim()))fail(400,'文献需提供真实题名与可引用正文');
 const batchDoiCounts=new Map();for(const reference of references){const doi=referenceDoi(reference.doi);if(doi)batchDoiCounts.set(doi,(batchDoiCounts.get(doi)||0)+1);}
 for(const reference of references){
  // A user may supply text for a bibliography entry already cited in the
  // draft. Bind it only on an unambiguous DOI AND title, retaining that ID
  // and all original metadata. A title-only match is never enough.
  const doi=referenceDoi(reference.doi),matches=doi?snapshot.references.filter(row=>row.confirmed===true&&referenceDoi(row.doi)===doi):[],original=matches.length===1&&batchDoiCounts.get(doi)===1?matches[0]:null;
  const sameTitle=original&&referenceTitle(original.title)===referenceTitle(reference.title),sameFields=original&&referenceFieldsCompatible(original,reference);
  if(original&&sameTitle&&sameFields&&!String(original.text||'').trim()){
   original.text=reference.text;original.sourceLabel='作者补充文献内容，原题录未系统核验';
  }else snapshot.references.push({...reference,id:'reference:'+randomUUID(),sourceLabel:'作者终稿补充文献',confirmed:true});
 }
 linkExistingReferenceExcerpts(snapshot.references);
 return {snapshot:normalizeThesisSnapshot(snapshot,config),metadata};
}
// A review quote that maps uniquely to one original section need not be sent
// to every sibling. Ambiguous or boundary-spanning quotes stay on all units,
// so a cross-section issue is never silently dismissed by this optimisation.
export function scopeCompletionFindings(units){
 for(const unit of units){const candidates=unit.completion?.findings||[];unit.completion.findings=candidates.filter(finding=>{
  const quote=String(finding.quote||'');if(!quote)return true;
  const matches=units.filter(other=>String(other.completion?.originalText||'').includes(quote));
  return matches.length!==1||matches[0]===unit;
 }).slice(0,6);}
}
// The server selects the affected chapters and binds their exact baseline to
// the quote. Client issue codes can request work, never provide executable plans.
export function thesisCompletionPlan(db,row,basePlan,issueCodes=[],{scope='affected'}={}){
 const snapshot=JSON.parse(row.snapshot),saved=savedThesisChapters(db,row),needs=completionAssessment(db,row),issues=safeCompletionIssues(issueCodes),targets=new Set(needs.chapters.map(chapter=>chapter.id));
 const referencesChanged=snapshot.references.some(reference=>reference.confirmed&&reference.text?.trim()&&!saved.some(chapter=>chapter.record?.text.includes('[source:'+reference.id+']')));
 const latestSimulation=snapshot.materials.filter(material=>material.dataKind==='simulation').at(-1),simulationChanged=latestSimulation&&!saved.some(chapter=>chapter.record?.text.includes('[source:'+latestSimulation.id+']'));
 const broad=scope==='full'||simulationChanged||issues.includes('supplement_check')&&!targets.size||referencesChanged||issues.some(code=>/reference|citation|sources|duplicate|review_findings|raw_formula|table_numbers/.test(code));
 for(const chapter of saved){if(isThesisReferenceChapter(chapter))continue;if(issues.includes('figure_review')&&JSON.parse(chapter.record?.figures||'[]').length)targets.add(chapter.id);if(broad&&!thesisManualBackMatter(chapter)||thesisFrontMatterKind(chapter)&&issues.some(code=>/abstract|keywords|english_title/.test(code)))targets.add(chapter.id);}
 const bodyChanged=saved.some(chapter=>targets.has(chapter.id)&&!thesisFrontMatterKind(chapter)&&!thesisManualBackMatter(chapter));if(bodyChanged)for(const chapter of saved.filter(thesisFrontMatterKind))targets.add(chapter.id);
 // Findings are bound to both the reviewed sources and the exact full
 // manuscript. A still-matching short quote is insufficient: its explanation
 // may refer to an older version of another chapter or older evidence.
 const priorRun=row.current_run_id?db.prepare('SELECT quality,snapshot_hash FROM thesis_runs WHERE id=? AND thesis_id=? AND user_id=?').get(row.current_run_id,row.id,row.user_id):null;
 let priorQuality=null;try{const quality=priorRun?.quality&&JSON.parse(priorRun.quality),currentManuscript=saved.map(chapter=>({id:chapter.id,text:chapter.record?.text||'',figures:JSON.parse(chapter.record?.figures||'[]')}));if(priorRun?.snapshot_hash===row.snapshot_hash&&quality?.manuscriptHash===completionManuscriptHash(currentManuscript))priorQuality=quality;}catch{/* An invalid or legacy check cannot be used as current evidence. */}
 const reviewFindings=(priorQuality?.reviews||[]).flatMap(review=>review.findings||[]);
 const priorChapters=saved.map(chapter=>({id:chapter.id,title:chapter.title,text:chapter.record?.text||'',figures:JSON.parse(chapter.record?.figures||'[]')})),priorDiagnosis=priorQuality?completionDiagnosis(priorQuality.supplementCheck,priorChapters):null,priorItems=priorDiagnosis?.status==='checked'?priorDiagnosis.items.filter(item=>{const text=priorChapters.find(chapter=>chapter.id===item.chapterId)?.text||'',quote=item.manuscriptQuote||'',at=quote.length>=8?text.indexOf(quote):-1;return at>=0&&text.indexOf(quote,at+1)<0;}):[];
 const priority=[...(latestSimulation?[latestSimulation]:[]),...snapshot.materials.filter(row=>row.confirmed&&(row.purpose==='研究证据补充'||row.relatedReferenceId)).slice(-6),...snapshot.references.filter(row=>row.confirmed&&row.sourceLabel==='作者终稿补充文献').slice(-4)].map(row=>row.id);
 const plan=basePlan.filter(unit=>targets.has(unit.chapterId)).map(unit=>{const originalText=String(saved.find(c=>c.id===unit.chapterId)?.record?.text||'');return {...unit,sourceIds:[],completionSourceIds:priority,completion:{missingInformation:[...new Set([...needs.chapters.filter(chapter=>chapter.id===unit.chapterId).flatMap(chapter=>chapter.requests),...priorItems.filter(item=>item.status==='missing'&&item.chapterId===unit.chapterId).flatMap(item=>item.missing||[])])].slice(0,10).map(text=>String(text).slice(0,400)),findings:reviewFindings.filter(finding=>{if(finding.sectionId!==unit.chapterId||typeof finding.quote!=='string'||finding.quote.length<6)return false;const at=originalText.indexOf(finding.quote);return at>=0&&originalText.indexOf(finding.quote,at+1)<0;}).map(({quote,explanation,suggestion,category})=>({quote:quote.slice(0,500),explanation:String(explanation||'').slice(0,500),suggestion:String(suggestion||'').slice(0,300),category})),originalText,originalFigures:manuscriptFigures({text:originalText,figures:JSON.parse(saved.find(c=>c.id===unit.chapterId)?.record?.figures||'[]')}),excerpted:false}};});
 const acknowledgementFacts=snapshot.materials.filter(row=>row.confirmed&&row.purpose==='致谢事实').map(row=>row.text).join('\n');
 for(const chapter of saved.filter(thesisManualBackMatter))if((targets.has(chapter.id)||scope==='full'&&!chapter.record?.text?.trim())&&(acknowledgementFacts.trim()||scope==='full'))plan.push({id:chapter.id+'::completion::1',chapterId:chapter.id,chapterTitle:chapter.title,sectionId:chapter.id,title:chapter.title,part:1,parts:1,targetWords:200,sourceIds:[],presentation:{},personalMatter:true,completion:{originalText:chapter.record?.text||'',acknowledgementFacts:acknowledgementFacts.slice(0,5000),generalAcknowledgement:!acknowledgementFacts.trim()}});
 const chapterUnits=new Map();for(const unit of plan){const rows=chapterUnits.get(unit.chapterId)||[];rows.push(unit);chapterUnits.set(unit.chapterId,rows);}
 // Different named sections must be mapped to their actual headings, not
 // roughly equal slices of the chapter. Ambiguous imports remain untouched.
 const sectionGroups=new Map();
 const headingKey=value=>String(value||'').trim().replace(/^#{1,6}\s*/, '').replace(/^\d+(?:\.\d+){0,5}[.、\s]+/u,'').replace(/\s+/gu,'').toLowerCase();
 for(const units of chapterUnits.values()){
  const groups=[];for(const unit of units){let group=groups.at(-1);if(!group||group.id!==unit.sectionId){if(groups.some(row=>row.id===unit.sectionId))fail(422,'无法安全对应原稿小节顺序，请核对提纲与原稿标题；原稿未更改，本次未扣费。');groups.push(group={id:unit.sectionId,title:unit.title,units:[]});}group.units.push(unit);}
  const chapter=units[0].completion.originalText;
  if(groups.length>1&&chapter){const lines=[...chapter.matchAll(/^([^\r\n]{1,160})$/gm)].map(match=>({offset:match.index,key:headingKey(match[1])})),positions=[];
   for(const group of groups){const key=headingKey(group.title),hits=lines.filter(line=>key&&line.key===key);if(hits.length!==1||positions.length&&hits[0].offset<=positions.at(-1))fail(422,'无法准确对应原稿小节标题，请核对提纲与原稿；原稿未更改，本次未扣费。');positions.push(hits[0].offset);}
   for(let index=0;index<groups.length;index++)groups[index].text=chapter.slice(index===0?0:positions[index],positions[index+1]??chapter.length);
  }else if(groups.length>1){for(const group of groups)group.text='';}else groups[0].text=chapter;
  for(const group of groups)for(const unit of group.units)sectionGroups.set(unit,group);
 }
 const stableTargets=new Map(plan.map(unit=>[unit,unit.targetWords]));
 for(const unit of plan){
  const grouped=sectionGroups.get(unit),group=grouped.units,partIndex=group.indexOf(unit),text=grouped.text,parts=group.length;let points=[0];
  if(parts>1){
   for(let index=1;index<parts;index++){
    const target=Math.round(text.length*index/parts),after=text.indexOf('\n\n',target),before=text.lastIndexOf('\n\n',target);
    let end=after>=0&&after-target<1000?after+2:before>points.at(-1)?before+2:target;
    // Never split a source/object marker or a UTF-16 surrogate pair.
    for(const match of text.matchAll(/\[(?:docx|figure|source):[^\]]+\]/g))if(match.index<end&&match.index+match[0].length>end)end=match.index;
    if(end>0&&/[\uD800-\uDBFF]/.test(text[end-1])&&/[\uDC00-\uDFFF]/.test(text[end]||''))end--;
    // Do not split inside a fenced code block; select its start or end.
    let opened=-1;for(const marker of text.matchAll(/^\s*(?:`{3,}|~{3,})[^\n]*$/gm)){if(marker.index>=end)break;opened=opened<0?marker.index:-1;}
    if(opened>=0){const close=/^\s*(?:`{3,}|~{3,})[^\n]*$/gm;close.lastIndex=end;const found=close.exec(text);end=opened>points.at(-1)?opened:found?found.index+found[0].length:text.length;}
    points.push(Math.max(points.at(-1),end));
   }
  }
  points.push(text.length);
  unit.completion.originalText=parts>1?text.slice(points[partIndex],points[partIndex+1]):text;
  unit.completion.originalFigures=manuscriptFigures({text:unit.completion.originalText,figures:unit.completion.originalFigures||[]});
  if(docxObjectIds(unit.completion.originalText).length)unit.completion.originalObjects=thesisDocxObjects(db,row.id,row.user_id,[{text:unit.completion.originalText}]).map(({id,kind,label,plaintext})=>({id,kind,label:label.slice(0,80),...(plaintext?{plaintext:plaintext.slice(0,160)}:{})}));
  // A revision must be able to preserve the author's existing text. The
  // original per-unit target can be much smaller than an imported manuscript.
  // Align its target with that segment instead of repeatedly forcing cuts.
  if(scope==='full'&&!unit.personalMatter){const lang=unit.frontMatter==='abstract_en'?'English':unit.frontMatter==='abstract_zh'?'中文':snapshot.profile.language,existing=researchWordCount(unit.completion.originalText,lang),chapterText=String(saved.find(c=>c.id===unit.chapterId)?.record?.text||'');
   // A later automatic completion must not reset its own growth allowance.
   // The latest author edit/import, or the first generated chapter, forms a
   // stable per-chapter anchor until the author intentionally edits it again.
   const anchor=db.prepare("SELECT text FROM thesis_chapter_versions WHERE thesis_id=? AND chapter_id=? AND source IN ('manual','imported') AND length(trim(text))>0 ORDER BY version DESC LIMIT 1").get(row.id,unit.chapterId)||db.prepare("SELECT text FROM thesis_chapter_versions WHERE thesis_id=? AND chapter_id=? AND source='generated' AND length(trim(text))>0 ORDER BY version ASC LIMIT 1").get(row.id,unit.chapterId);
   const anchorCount=anchor?researchWordCount(anchor.text,lang):0,chapterTargets=(chapterUnits.get(unit.chapterId)||[]).reduce((sum,row)=>sum+(stableTargets.get(row)||0),0);
   unit.completion.baselineTargetWords=unit.targetWords;if(chapterTargets>0&&anchor&&chapterText)unit.completion.anchorWords=Math.ceil(anchorCount*(stableTargets.get(unit)||0)/chapterTargets);if(existing>unit.targetWords)unit.targetWords=existing;}
 }
 for(const units of chapterUnits.values())scopeCompletionFindings(units);
 if(scope==='full')for(const unit of plan)unit.completion={...unit.completion,scope:'full'};
 // Never send a model an excerpt and then overwrite the complete chapter.
 // Admission happens before quote creation and billing; all saved text and
 // original Word objects remain available when the input is too long.
 for(const unit of plan){if(unit.personalMatter)continue;let task;try{task=thesisAgentTask(snapshot,unit,[]);}catch(error){if(/原稿对象位置超出当前可核对范围/.test(String(error?.message||'')))fail(422,'章节内容较长，当前无法完整处理。请将原稿拆分为较短且标题清晰的小节后重试；原稿已保留，本次未扣费。');throw error;}if(task.context?.revision?.excerpted)fail(422,'章节内容较长，当前无法完整处理。请将原稿拆分为较短且标题清晰的小节后重试；原稿已保留，本次未扣费。');}
 if(!plan.length)fail(422,'当前没有需要 AI 完善的章节；请重新检查终稿，封面和排版由系统直接处理。');
 for(const [index,unit]of plan.entries())unit.position=index;
 const baseline=saved.flatMap(chapter=>chapter.record?[{chapterId:chapter.id,versionId:chapter.record.id}]:[]);
 return {plan,baseline,scope,issueCodes:issues,chapterTitles:saved.filter(chapter=>plan.some(unit=>unit.chapterId===chapter.id)).map(chapter=>chapter.title),fingerprint:thesisHash({snapshot:row.snapshot_hash,baseline,plan})};
}
export function completionBaseline(db,run){const meta=JSON.parse(run.settings_meta||'{}');if(!meta.completion)return [];return (meta.completion.baseline||[]).map(reference=>{const row=db.prepare('SELECT * FROM thesis_chapter_versions WHERE id=? AND thesis_id=? AND chapter_id=?').get(reference.versionId,run.thesis_id,reference.chapterId);if(!row)fail(409,'原论文章节版本暂不可读取，未覆盖已保存内容');return row;});}
export function completionManuscriptHash(chapters){return thesisHash(chapters.map(row=>({id:row.chapter_id||row.id,text:row.text,figures:typeof row.figures==='string'?JSON.parse(row.figures):row.figures||[]})));}

export function assertCompletionResumeUnchanged(db,row,run){
 const completion=JSON.parse(run?.settings_meta||'{}').completion;if(!completion)return;for(const chapter of savedThesisChapters(db,row)){if(!chapter.record)continue;const original=completion.baseline.find(reference=>reference.chapterId===chapter.id);if(chapter.record.id!==original?.versionId&&chapter.record.run_id!==run.id)fail(409,'论文在中断后已有新的章节编辑，请重新获取自动完善费用；当前正文不会被旧任务覆盖。');}
}
