import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeThesisOutlineSnapshot,thesisOutlineTask,parseThesisOutline} from '../backend/thesis-outline-model.mjs';
import {normalizeThesisSnapshot,thesisPlan,thesisAgentTask,parseThesisSection,thesisWordCount} from '../backend/thesis-model.mjs';

const blank=()=>({table:false,image:false,formula:false,code:false});
const brief=(extra={})=>normalizeThesisOutlineSnapshot({title:'图书馆数字服务的改进路径研究',profile:{level:'本科',targetWords:8000},materials:[],references:[],...extra});
const response=chapters=>({text:JSON.stringify({complete:true,chapters})});
const structure=()=>[
 {title:'数字服务研究背景',sections:[],presentation:blank()},
 {title:'数字服务改进方案',sections:[
  {title:'服务方案对比与技术路线',presentation:{table:true,image:true,formula:false,code:false}},
  {title:'检索排序函数与算法实现',presentation:{table:false,image:false,formula:true,code:true}}
 ]},
 {title:'结论与待验证事项',sections:[],presentation:blank()},
 {title:'参考文献',sections:[],presentation:{table:true,image:true,formula:true,code:true}}
];

test('outline contract requests independent leaf presentation suggestions with evidence and subject boundaries',()=>{
 const task=thesisOutlineTask(brief());assert.match(task.instructions,/presentation/);for(const key of ['table','image','formula','code'])assert.match(task.instructions,new RegExp('"'+key+'"'));assert.match(task.instructions,/叶节点|叶小节|无子节/);assert.match(task.instructions,/参考文献/);assert.match(task.instructions,/不得编造|不能编造/);assert.match(task.instructions,/结构化流程图|流程图或概念/);assert.match(task.instructions,/学科|研究需要/);assert.match(task.instructions,/未选键省略/);assert.match(task.instructions,/"presentation":\{\}/);assert.doesNotMatch(task.instructions,/"presentation":\{"table":false/);
});

test('AI leaf choices and explicit all-false choices survive parsing and exact budgets while references cannot request extra content',()=>{
 const input=structure(),frozen=JSON.stringify(input),parsed=parseThesisOutline(response(input),brief());assert.equal(JSON.stringify(input),frozen);assert.deepEqual(parsed.chapters[0].presentation,blank());assert.deepEqual(parsed.chapters[1].sections.map(row=>row.presentation),input[1].sections.map(row=>row.presentation));assert.deepEqual(parsed.chapters[2].presentation,blank());assert.deepEqual(parsed.chapters[3].presentation,blank());assert.equal(parsed.chapters.reduce((sum,row)=>sum+row.targetWords,0),8000);assert.equal(parsed.chapters[3].targetWords,0);assert.equal(parsed.chapters[1].sections.reduce((sum,row)=>sum+row.targetWords,0),parsed.chapters[1].targetWords);
});

test('partial or empty explicit choices mean false for omitted keys and parent requests cannot cascade into sections',()=>{
 const input=structure();input[1].presentation={table:true,image:true,formula:true,code:true};input[1].sections[0].presentation={table:false};input[1].sections[1].presentation={};const parsed=parseThesisOutline(response(input),brief());assert.deepEqual(parsed.chapters[1].presentation,blank());for(const row of parsed.chapters[1].sections)assert.deepEqual(row.presentation,blank());
});

test('invalid AI presentation shapes cannot silently become generation permissions',()=>{
 for(const invalid of [null,[],true,'table',{table:'true'},{image:1},{formula:null},{code:[]},{table:true,unknown:true},{svg:'<svg></svg>'}])for(const location of ['chapter','section']){const input=structure();if(location==='chapter')input[0].presentation=invalid;else input[1].sections[0].presentation=invalid;assert.throws(()=>parseThesisOutline(response(input),brief()),error=>error.code==='invalid_outline'&&/呈现|内容选项/.test(error.message));}
});

test('leaf suggestions reach the real normalized thesis plan and existing section output permissions',()=>{
 const snapshot=brief(),parsed=parseThesisOutline(response(structure()),snapshot),normalized=normalizeThesisSnapshot({...snapshot,requirements:{...snapshot.requirements,contentMode:'rich'},outline:parsed.chapters}),plan=thesisPlan(normalized),tableUnit=plan.find(unit=>unit.sectionId==='chapter-2-section-1'&&unit.part===1),codeUnit=plan.find(unit=>unit.sectionId==='chapter-2-section-2'&&unit.part===1),intro=plan.find(unit=>unit.chapterId==='chapter-1');assert.deepEqual(tableUnit.presentation,{table:true,image:true,formula:false,code:false});assert.deepEqual(codeUnit.presentation,{table:false,image:false,formula:true,code:true});assert.deepEqual(intro.presentation,blank());assert.equal(plan.some(unit=>unit.chapterId==='chapter-4'),false);const tableTask=thesisAgentTask(normalized,tableUnit,[]),codeTask=thesisAgentTask(normalized,codeUnit,[]);assert.deepEqual(tableTask.context.unit.presentation,tableUnit.presentation);assert.deepEqual(codeTask.context.unit.presentation,codeUnit.presentation);assert.match(tableTask.instructions,/数据表=true.*图片=true.*公式=false.*代码=false/);assert.match(tableTask.instructions,/实测数值必须来自已读取的用户资料/);assert.match(tableTask.instructions,/不生成统计图、实验影像或伪造实测结果/);assert.match(codeTask.instructions,/数据表=false.*图片=false.*公式=true.*代码=true/);assert.match(codeTask.instructions,/不执行，也不声称已测试/);
});

test('the section parser accepts only the AI-adopted element types and renders permitted structured images through the existing contract',()=>{
 const snapshot=brief(),parsed=parseThesisOutline(response(structure()),snapshot),normalized=normalizeThesisSnapshot({...snapshot,requirements:{...snapshot.requirements,contentMode:'rich'},outline:parsed.chapters}),plan=thesisPlan(normalized),tableUnit=plan.find(unit=>unit.sectionId==='chapter-2-section-1'&&unit.part===1),codeUnit=plan.find(unit=>unit.sectionId==='chapter-2-section-2'&&unit.part===1),blocks={table:'\n| 方案 | 待比较维度 |\n| --- | --- |\n| 拟开展方案 | 服务流程 |\n',formula:'\n$$x=a+b$$\n',code:'\n```javascript\nconst x = a + b;\n```\n'};
 const candidate=(unit,block,figures=[])=>{const content='【待核对：当前论述和拟开展方案仍需文献与研究记录支持】'+block,text='研'.repeat(unit.targetWords-thesisWordCount(content,'中文'))+content;return {text:JSON.stringify({text,source_ids:[],missing_evidence:[],complete:true,draft:true,figures})};};
 assert.ok(parseThesisSection(candidate(tableUnit,blocks.table),normalized,tableUnit).text.includes('| 方案 |'));for(const block of [blocks.formula,blocks.code])assert.throws(()=>parseThesisSection(candidate(tableUnit,block),normalized,tableUnit),error=>error.code==='presentation_not_selected');for(const block of [blocks.formula,blocks.code])assert.ok(parseThesisSection(candidate(codeUnit,block),normalized,codeUnit).text);assert.throws(()=>parseThesisSection(candidate(codeUnit,blocks.table),normalized,codeUnit),error=>error.code==='presentation_not_selected');
 const figure={id:'plannedFlow',title:'拟开展的服务改进流程',kind:'flowchart',nodes:[{id:'input',label:'梳理服务需求'},{id:'plan',label:'拟定改进方案'}],edges:[{from:'input',to:'plan'}],caption:'拟开展方案，尚无实施结果。'},imageResult=parseThesisSection(candidate(tableUnit,'\n[figure:plannedFlow]\n',[figure]),normalized,tableUnit);assert.equal(imageResult.figures.length,1);assert.match(imageResult.text,/\[figure:fig-/);
});

test('explicit text mode remains a hard body-generation boundary after adopting AI suggestions',()=>{
 const snapshot=brief(),parsed=parseThesisOutline(response(structure()),snapshot),normalized=normalizeThesisSnapshot({...snapshot,requirements:{...snapshot.requirements,contentMode:'text'},outline:parsed.chapters});assert.ok(thesisPlan(normalized).every(unit=>Object.values(unit.presentation).every(flag=>flag===false)));
});

test('missing AI choices receive subject-appropriate fallback without forcing formulas or code into humanities',()=>{
 const snapshot=brief({title:'鲁迅小说叙事视角与人物关系研究',profile:{level:'本科',major:'中国语言文学',targetWords:8000},requirements:{contentMode:'text'}}),input=[{title:'小说叙事研究背景',sections:[]},{title:'人物关系与叙事结构分析',sections:[{title:'主要人物关系'},{title:'不同叙事视角的比较'}]},{title:'讨论与结论',sections:[]},{title:'参考文献',sections:[]}],parsed=parseThesisOutline(response(input),snapshot),leaves=parsed.chapters.flatMap(chapter=>chapter.sections.length?chapter.sections:[chapter]);assert.ok(leaves.every(row=>row.presentation&&row.presentation.formula===false&&row.presentation.code===false));assert.ok(leaves.some(row=>row.presentation.table||row.presentation.image));assert.deepEqual(parsed.chapters.at(-1).presentation,blank());
});
