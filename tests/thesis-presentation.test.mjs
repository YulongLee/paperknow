import test from 'node:test';
import assert from 'node:assert/strict';
import {thesisSnapshotFromDraft} from '../dist/workspace/writing-model.mjs';
import {normalizeThesisSnapshot,thesisPlan,thesisAgentTask,parseThesisSection,thesisWordCount} from '../backend/thesis-model.mjs';

const disabled={table:false,formula:false,code:false};
const enabled={table:true,formula:true,code:true};
const source={id:'evidence',name:'用户确认的研究记录',text:'用户确认的研究记录：本例资料记录了六份问卷，项目人数为 6。变量 a 为已有案例数量，b 为观察期数，x=a/b 仅为变量定义。代码 sum([1, 2, 3]) 是待核对的示例，未执行。资料只用于分析与论证，不代表效果经过实验验证。',confirmed:true};
const input=(extra={})=>({title:'小节呈现偏好的研究',profile:{level:'本科',language:'中文',targetWords:500},requirements:{contentMode:'rich'},materials:[source],references:[],outline:[{id:'chapter',title:'研究分析',targetWords:500}],...extra});
function fixture(presentation,contentMode='rich'){
 const snapshot=normalizeThesisSnapshot(input({requirements:contentMode===undefined?{}:{contentMode},outline:[{id:'chapter',title:'研究分析',targetWords:500,...(presentation===undefined?{}:{presentation})}]}));
 const unit=thesisPlan(snapshot)[0];
 return {snapshot,unit};
}
function response(unit,block='',extra={}){
 const count=thesisWordCount(block,'中文');
 assert.ok(count<unit.targetWords,'Fixture block must leave room for the target-length prose');
 const text='研'.repeat(unit.targetWords-count)+block+'[source:evidence]';
 return {text:JSON.stringify({text,source_ids:['evidence'],missing_evidence:[],complete:true}),trace:[{tool:'read_material',status:'completed',materialId:'evidence'}],...extra};
}
const blocks={
 table:'\n| 项目 | 数值 |\n| --- | --- |\n| 人数 | 6 |\n',
 tableWithoutOuterPipes:'\n项目 | 数值\n:--- | ---:\n人数 | 6\n',
 formula:'\n$$\nx=\\frac{a}{b}\n$$\n',
 formulaSingleLine:'\n$$x=a/b$$\n',
 formulaBrackets:'\n\\[\nx=a+b\n\\]\n',
 code:'\n```python\nvalue = sum([1, 2, 3])\n```\n',
 codeTildes:'\n~~~python\nvalue = sum([1, 2, 3])\n~~~\n',
 image:'\n![本人材料示意](https://example.test/research.png)\n'
};

test('backend missing-target defaults follow degree while explicit historical targets and the existing configured cap remain authoritative',()=>{
 for(const [level,expected] of [['专科',4000],['本科',8000],['硕士',20000],['博士',60000],['研究工作者',8000],['master',20000],['doctor',60000]]){
  for(const targetWords of ['',undefined,null])assert.equal(normalizeThesisSnapshot(input({profile:{level,language:'中文',targetWords}})).profile.targetWords,expected);
  assert.equal(normalizeThesisSnapshot(input({profile:{level,targetWords:8000}})).profile.targetWords,8000);
 }
 assert.equal(normalizeThesisSnapshot(input({profile:{level:'博士'}}),{thesisMaxTargetWords:10000}).profile.targetWords,10000);
 assert.equal(normalizeThesisSnapshot(input({profile:{level:'研究工作者',targetWords:80000}})).profile.targetWords,80000);
 assert.throws(()=>normalizeThesisSnapshot(input({profile:{level:'博士',targetWords:80001}})),error=>error.status===400);
});

test('local section preferences survive execution snapshot conversion and backend normalization without changing the draft',()=>{
 const draft={title:'小节选项持久化',degree:'本科',targetWords:500,formula:'rich',knowledgeFiles:[source],outlineRows:[{id:'chapter',title:'研究分析',level:1,words:0,presentation:{code:true}},{id:'selected',title:'1.1 变量分析',level:2,words:250,presentation:{formula:true,table:false,code:false}},{id:'plain',title:'1.2 研究讨论',level:2,words:250}]};
 const before=structuredClone(draft),local=thesisSnapshotFromDraft(draft),normalized=normalizeThesisSnapshot(local);
 assert.deepEqual(local.outline[0].presentation,{...disabled,code:true});
 assert.deepEqual(local.outline[0].sections[0].presentation,{formula:true,table:false,code:false});
 assert.equal(Object.hasOwn(local.outline[0].sections[1],'presentation'),false);
 assert.deepEqual(normalized.outline[0].presentation,{...disabled,code:true});
 assert.deepEqual(normalized.outline[0].sections[0].presentation,{...disabled,formula:true});
 assert.equal(Object.hasOwn(normalized.outline[0].sections[1],'presentation'),false);
 assert.deepEqual(normalizeThesisSnapshot(JSON.parse(JSON.stringify(normalized))),normalized);
 assert.deepEqual(draft,before);
});

test('presentation accepts only independent boolean switches at both chapter and subsection locations',()=>{
 const invalid=[null,false,'formula',[],{table:1},{formula:'true'},{code:null},{table:true,image:true}];
 for(const presentation of invalid)for(const subsection of [false,true]){
  const chapter={id:'chapter',title:'研究分析',targetWords:500,...(subsection?{sections:[{id:'section',title:'具体分析',targetWords:500,presentation}]}:{presentation})};
  assert.throws(()=>normalizeThesisSnapshot(input({outline:[chapter]})),error=>error.status===400);
 }
 const value=normalizeThesisSnapshot(input({outline:[{id:'chapter',title:'研究分析',targetWords:500,presentation:{formula:true}}]}));
 assert.deepEqual(value.outline[0].presentation,{...disabled,formula:true});
});

test('legacy missing preferences remain compatible and global rich mode does not authorize extra formats',()=>{
 for(const requirements of [{},{contentMode:'rich'},{contentMode:'text'}]){
  const snapshot=normalizeThesisSnapshot(input({requirements})),unit=thesisPlan(snapshot)[0],task=thesisAgentTask(snapshot,unit,[]);
  assert.equal(Object.hasOwn(snapshot.outline[0],'presentation'),false);
  assert.deepEqual(unit.presentation,disabled);
  assert.deepEqual(task.context.unit.presentation,disabled);
  assert.equal(parseThesisSection(response(unit),snapshot,unit).wordCount,500);
 }
});

test('plain-text mode and references disable stored format switches without authorizing a generation unit',()=>{
 for(const requirements of [{},{contentMode:'text'}]){
  const snapshot=normalizeThesisSnapshot(input({requirements,outline:[{id:'chapter',title:'研究分析',targetWords:500,presentation:enabled,sections:[{id:'section',title:'具体分析',targetWords:500,presentation:enabled}]}]}));
  assert.deepEqual(snapshot.outline[0].presentation,disabled);
  assert.deepEqual(snapshot.outline[0].sections[0].presentation,disabled);
  assert.deepEqual(thesisPlan(snapshot)[0].presentation,disabled);
 }
 const snapshot=normalizeThesisSnapshot(input({outline:[{id:'chapter',title:'研究分析',targetWords:500},{id:'refs',title:'参考文献',presentation:enabled,sections:[{id:'refs-child',title:'真实来源清单',presentation:enabled}]}]}));
 assert.deepEqual(snapshot.outline[1].presentation,disabled);
 assert.deepEqual(snapshot.outline[1].sections[0].presentation,disabled);
 assert.ok(thesisPlan(snapshot).every(unit=>unit.chapterId!=='refs'));
});

test('a parent chapter cannot enable child sections or leak selected formats to siblings and later chapters',()=>{
 const snapshot=normalizeThesisSnapshot(input({outline:[{id:'parent',title:'研究分析',targetWords:300,presentation:enabled,sections:[{id:'selected',title:'已有记录表',targetWords:150,presentation:{table:true}},{id:'plain',title:'研究讨论',targetWords:150}]},{id:'leaf',title:'代码说明',targetWords:200,presentation:{code:true}}]}));
 const plan=thesisPlan(snapshot),expected=[{...disabled,table:true},disabled,{...disabled,code:true}];
 assert.equal(plan.length,3);
 for(const [index,unit] of plan.entries()){
  assert.deepEqual(unit.presentation,expected[index]);
  assert.deepEqual(thesisAgentTask(snapshot,unit,[]).context.unit.presentation,expected[index]);
  const {presentation,...restoredLegacyUnit}=unit;
  assert.deepEqual(thesisAgentTask(snapshot,restoredLegacyUnit,[]).context.unit.presentation,expected[index]);
  assert.equal(parseThesisSection(response(unit),snapshot,unit).wordCount,unit.targetWords);
  for(const flag of ['table','formula','code']){
   if(expected[index][flag])assert.equal(parseThesisSection(response(unit,blocks[flag]),snapshot,unit).wordCount,unit.targetWords);
   else assert.throws(()=>parseThesisSection(response(unit,blocks[flag]),snapshot,unit),error=>error.status===502);
  }
 }
});

test('long selected leaf sections keep their own switches in every split unit without sharing mutable preferences',()=>{
 const snapshot=normalizeThesisSnapshot(input({profile:{level:'硕士',language:'中文',targetWords:5000},outline:[{id:'parent',title:'研究分析',targetWords:5000,presentation:enabled,sections:[{id:'formula',title:'变量分析',targetWords:3000,presentation:{formula:true}},{id:'table',title:'已有记录比较',targetWords:2000,presentation:{table:true}}]}]}));
 const plan=thesisPlan(snapshot),formula=plan.filter(unit=>unit.sectionId==='formula'),table=plan.filter(unit=>unit.sectionId==='table');
 assert.equal(formula.length,2);assert.equal(table.length,2);
 assert.equal(plan.reduce((sum,unit)=>sum+unit.targetWords,0),5000);
 for(const unit of formula)assert.deepEqual(unit.presentation,{...disabled,formula:true});
 for(const unit of table)assert.deepEqual(unit.presentation,{...disabled,table:true});
 formula[0].presentation.formula=false;
 assert.equal(formula[1].presentation.formula,true);
 assert.equal(snapshot.outline[0].sections[0].presentation.formula,true);
});

test('task context communicates only the current unit switches and keeps evidence and unexecuted-example constraints',()=>{
 for(const selection of [{table:true},{formula:true},{code:true}]){
  const {snapshot,unit}=fixture(selection),task=thesisAgentTask(snapshot,unit,[]);
  assert.deepEqual(task.context.unit.presentation,{...disabled,...selection});
  assert.match(task.instructions,/read_material/);
  assert.match(task.instructions,/不得编造/);
  if(selection.table)assert.match(task.instructions,/已读取|实际读取/);
  if(selection.formula)assert.match(task.instructions,/变量/);
  if(selection.code)assert.match(task.instructions,/不执行|未执行/);
 }
});

for(const [name,block] of Object.entries(blocks))test(`legacy rich output rejects unselected ${name} while retaining readable and cited evidence checks`,()=>{
 const {snapshot,unit}=fixture();
 assert.equal(parseThesisSection(response(unit),snapshot,unit).wordCount,500);
 assert.throws(()=>parseThesisSection(response(unit,block),snapshot,unit),error=>error.status===502);
});

for(const [flag,names] of [['table',['table','tableWithoutOuterPipes']],['formula',['formula','formulaSingleLine','formulaBrackets']],['code',['code','codeTildes']]])test(`explicit ${flag} authorization permits that format and does not authorize the others`,()=>{
 const {snapshot,unit}=fixture({[flag]:true});
 for(const name of names)assert.equal(parseThesisSection(response(unit,blocks[name]),snapshot,unit).wordCount,500);
 for(const [other,block] of Object.entries(blocks))if(!names.includes(other))assert.throws(()=>parseThesisSection(response(unit,block),snapshot,unit),error=>error.status===502);
 assert.equal(parseThesisSection(response(unit),snapshot,unit).wordCount,500);
});

test('plain-text mode rejects selected block formats and image Markdown remains unsupported even with every switch selected',()=>{
 const text=fixture(enabled,'text');
 for(const block of Object.values(blocks))assert.throws(()=>parseThesisSection(response(text.unit,block),text.snapshot,text.unit),error=>error.status===502);
 const rich=fixture(enabled);
 assert.throws(()=>parseThesisSection(response(rich.unit,blocks.image),rich.snapshot,rich.unit),error=>error.status===502);
});

test('normal inline expressions, prose pipes and inline source code remain ordinary paragraph text',()=>{
 const {snapshot,unit}=fixture();
 const inline='文中 x=y 是原样变量说明，符号 A | B 用于讨论；`x=y` 只表示原文片段。';
 assert.equal(parseThesisSection(response(unit,inline),snapshot,unit).wordCount,500);
});

test('selecting every format cannot bypass source identity, actual reads, inline markers or incomplete-evidence rejection',()=>{
 const {snapshot,unit}=fixture(enabled),good=response(unit,blocks.table+blocks.formula+blocks.code);
 assert.equal(parseThesisSection(good,snapshot,unit).wordCount,500);
 assert.throws(()=>parseThesisSection({...good,trace:[]},snapshot,unit),error=>error.code==='unread_source');
 for(const body of [{...JSON.parse(good.text),source_ids:['invented']},{...JSON.parse(good.text),text:JSON.parse(good.text).text.replace('[source:evidence]','[source:invented]')},{...JSON.parse(good.text),source_ids:[]}])assert.throws(()=>parseThesisSection({...good,text:JSON.stringify(body)},snapshot,unit),error=>error.code==='unknown_source');
 const missing={...JSON.parse(good.text),missing_evidence:['尚缺支撑已取得效果的实验记录'],complete:false};
 assert.throws(()=>parseThesisSection({...good,text:JSON.stringify(missing)},snapshot,unit),error=>error.code==='needs_materials');
 assert.throws(()=>parseThesisSection({...good,finishReason:'max_tokens'},snapshot,unit),error=>error.code==='truncated');
});
