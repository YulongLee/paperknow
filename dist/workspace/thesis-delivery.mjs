// Shared by the account workflow and server. Historical snapshots stay intact;
// new writing submissions explicitly include the manuscript's closing work.
export const thesisCoverFields={author:'作者姓名',studentId:'学号',institution:'学校',college:'学院',className:'专业班级',supervisor:'指导教师',graduationYear:'毕业届次',completionDate:'完成年月'};
export function thesisFrontMatterKind(row={}) {
 const title=String(row.title||'').trim().replace(/^#{1,6}\s*/, '');
 return /^摘\s*要$/u.test(title)?'abstract_zh':/^abstract$/i.test(title)?'abstract_en':null;
}
export const thesisManualBackMatter=row=>/^(?:致\s*谢|acknowledg(?:e)?ments?)$/i.test(String(row?.title||'').trim());
export function prepareThesisDeliverySnapshot(value={}) {
 const outline=[...(value.outline||[])],ids=new Set(outline.flatMap(row=>[row.id,...(row.sections||[]).map(section=>section.id)]));
 for(const [kind,title,targetWords] of [['abstract_zh','摘要',400],['abstract_en','Abstract',250]]) {
  if(outline.some(row=>thesisFrontMatterKind(row)===kind))continue;
  let id='front-'+kind,index=1;while(ids.has(id))id='front-'+kind+'-'+index++;
  ids.add(id);outline.unshift({id,title,kind,targetWords,sourceIds:[],sections:[]});
 }
 outline.sort((a,b)=>(thesisFrontMatterKind(a)==='abstract_zh'?-2:thesisFrontMatterKind(a)==='abstract_en'?-1:0)-(thesisFrontMatterKind(b)==='abstract_zh'?-2:thesisFrontMatterKind(b)==='abstract_en'?-1:0));
 if(!outline.some(thesisManualBackMatter)){let id='back-acknowledgements',i=1;while(ids.has(id))id='back-acknowledgements-'+i++;outline.push({id,title:/english|英文/i.test(value.profile?.language||'')?'Acknowledgements':'致谢',targetWords:0,sourceIds:[],sections:[]});}
 return {...value,requirements:{...value.requirements,deliveryVersion:1},outline};
}
const headingLabel=value=>String(value||'').trim().replace(/^#{1,6}\s*/, '').replace(/\s+/g,' ');
// Models occasionally echo the title that the chapter assembler already owns.
// Remove only exact leading owned labels; never guess at or delete body prose.
export function stripThesisOwnedHeadings(text,titles=[]) {
 const labels=new Set(titles.filter(Boolean).map(headingLabel)),lines=String(text||'').split(/\r?\n/);
 while(lines.length&&(!lines[0].trim()||labels.has(headingLabel(lines[0]))))lines.shift();
 return lines.join('\n').trim();
}
export function thesisEnglishTitle(chapters=[]) {
 for(const chapter of chapters)if(thesisFrontMatterKind(chapter)==='abstract_en') {
  const match=String(chapter.text||'').match(/^(?:英文题目|English title)\s*[:：]\s*(\S[^\n]{4,300})/im);
  if(match)return match[1].trim();
 }
 return '';
}
