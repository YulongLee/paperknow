import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {writingQualityPanel} from '../dist/workspace/writing-quality-panel.mjs';
import {mountWritingJobPanel} from '../dist/workspace/writing-job-panel.mjs';

const snapshot={title:'期刊文章检查',profile:{level:'研究工作者',language:'中文'},materials:[],references:[{id:'r1',title:'任务确认的参考文献'}],outline:[]};
const quality=(overrides={})=>({status:'completed',checkedAt:'2026-10-22T10:00:00Z',citations:{items:[{id:'r1',metadataStatus:'matched',reason:'公开题录信息已对应。',claimSupport:'not_checked'}],summary:{matched:1}},consistency:{status:'no_deterministic_issues',findings:[],totalFindings:0,truncated:false},reviews:[{status:'completed',outcome:'no_ai_findings',checkedSections:1,checkedCharacters:500,findings:[],limitations:[]}],coverage:{totalSections:1,totalCharacters:500,reviewedCharacters:500,reviewedBatches:1,totalBatches:1,complete:true},limitations:[],...overrides});
const record=(overrides={})=>({id:'writing-1',kind:'article',operation:'draft',status:'running',stage:'verifying_citations',completedUnits:1,totalUnits:1,output:null,...overrides});

function fixture(t,{item=record()}={}){
 const dom=new JSDOM('<main class="dashboard"><div id="job"></div></main>',{url:'https://example.test/workspace.html#tool/article'}),container=dom.window.document.querySelector('#job');
 const style=dom.window.document.createElement('style');style.textContent=readFileSync(new URL('../dist/workspace/thesis-detail-commercial.css',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../dist/workspace/writing-flows.css',import.meta.url),'utf8');dom.window.document.head.append(style);
 const calls=[];let saved=structuredClone(item),applied=null;
 const api=async(path,data)=>{calls.push({path,data});if(path==='/auth/me')return {user:{id:'u1'}};if(path==='/writing/jobs/writing-1')return {item:structuredClone(saved)};if(path==='/writing/jobs/writing-1/cancel'){saved={...saved,status:'cancelled'};return {item:structuredClone(saved)};}throw Error('Unexpected request '+path);};
 const panel=mountWritingJobPanel({container,ctx:{api},kind:'article',operation:'draft',getSnapshot:()=>structuredClone(snapshot),initialState:{itemId:'writing-1',ownerId:'u1',snapshot:structuredClone(snapshot),contextKey:JSON.stringify(snapshot)},onApply:output=>{applied=output;}});
 t.after(()=>{panel.dispose();dom.window.close();});
 return {dom,container,calls,panel,setItem:item=>{saved=structuredClone(item);},$:selector=>container.querySelector(selector),get applied(){return applied;}};
}

test('shared panel understands completed review outcomes and never equates no findings with verified research',()=>{
 const dom=new JSDOM(writingQualityPanel(quality(),{references:snapshot.references,scrollKey:'quality-test'}));
 try{
  assert.equal(dom.window.document.querySelector('details').open,false);
  const value=dom.window.document.body.textContent;
  assert.match(value,/辅助审校未提出可定位问题；不代表全文没有问题/);
  assert.match(value,/500 \/ 500 个正文字符，完成 1 \/ 1 组/);
  assert.match(value,/题录核验不代表已查证全文/);
  assert.match(value,/任务确认的参考文献/);
  assert.doesNotMatch(value,/以下为辅助审校建议/);
 }finally{dom.window.close();}
});

test('a completed manuscript without a persisted quality report clearly requests manual checks',()=>{
 const saved=new JSDOM(writingQualityPanel(null,{completed:true})),pending=new JSDOM(writingQualityPanel(null));
 try{assert.match(saved.window.document.body.textContent,/检查记录未保存/);assert.match(saved.window.document.body.textContent,/请人工核对事实、引用和研究结果/);assert.doesNotMatch(saved.window.document.body.textContent,/生成后查看/);assert.match(pending.window.document.body.textContent,/生成后查看/);}finally{saved.window.close();pending.window.close();}
});

test('completed ordinary writing passes the missing-report state to the same collapsed panel',async t=>{
 const f=fixture(t,{item:record({status:'completed',stage:'completed',output:{text:'已保存的原始正文。',sourceIds:[]}})});await f.panel.open();assert.match(f.$('[data-writing-quality-panel]').textContent,/检查记录未保存/);assert.match(f.$('[data-writing-quality-panel]').textContent,/请人工核对/);assert.equal(f.$('[data-wj-apply]').disabled,false);
});

test('shared panel distinguishes unavailable rules, not-started review batches and partial manuscript coverage',()=>{
 const value=quality({status:'partial',consistency:{status:'unavailable',findings:[]},reviews:[{status:'completed',outcome:'no_ai_findings',checkedSections:1,findings:[]},{status:'not_started',checkedSections:0,reason:'provider qwen maxBudgetUsd 10',findings:[]}],coverage:{totalSections:3,totalCharacters:1200,reviewedCharacters:400,reviewedBatches:1,totalBatches:3,complete:false}}),dom=new JSDOM(writingQualityPanel(value));
 try{
  const text=dom.window.document.body.textContent;
  assert.match(text,/正文规则检查尚未完成/);
  assert.match(text,/部分正文尚未开始辅助审校/);
  assert.match(text,/400 \/ 1,200 个正文字符，完成 1 \/ 3 组/);
  assert.match(text,/辅助审校未覆盖全部正文/);
  assert.doesNotMatch(text,/provider|qwen|maxBudgetUsd/);
  assert.doesNotMatch(text,/本次规则检查未列出问题/);
 }finally{dom.window.close();}
});

test('quality prose preserves academic cost and statistical model discussions while ignoring backend attributes',()=>{
 const quote='比较经济成本与统计模型的拟合条件。',explanation='The statistical model compares the economic cost of each service provider.',suggestion='说明费用、成本和研究预算的估算依据，保留模型适用范围。';
 const value=quality({provider:'PRIVATE_BACKEND_PROVIDER',model:'PRIVATE_BACKEND_MODEL',costUsd:987654,reviews:[{status:'completed',outcome:'review_required',provider:'PRIVATE_REVIEW_PROVIDER',model:'PRIVATE_REVIEW_MODEL',findings:[{sectionTitle:'经济成本与统计模型',quote,category:'claim_scope',explanation,suggestion}],limitations:['研究预算（research budget）和经济成本需要结合实际调查条件解释。']}]}),dom=new JSDOM(writingQualityPanel(value));
 try{
  const result=dom.window.document.body.textContent;
  assert.match(result,/经济成本与统计模型/);
  assert.ok(result.includes(quote),'manuscript quotes are displayed verbatim');
  assert.ok(result.includes(explanation),'ordinary model/provider terms are not backend metadata');
  assert.ok(result.includes(suggestion),'academic cost and budget wording remains useful');
  assert.match(result,/research budget/);
  assert.doesNotMatch(result,/PRIVATE_BACKEND|PRIVATE_REVIEW|987654/);
 }finally{dom.window.close();}
});

test('explicit backend runtime fields are hidden and a limited review batch uses fixed public reason wording',()=>{
 const value=quality({status:'partial',reviews:[{status:'not_started',reasonCode:'budget_exhausted',reason:'Internal execution allowance 1234',findings:[],checkedSections:0}],limitations:['Runtime maxCostUsd=0.5; baseURL=https://dashscope.aliyuncs.com/apps/anthropic','Research budget and statistical model limitations remain to be reviewed.']}),dom=new JSDOM(writingQualityPanel(value));
 try{
  const result=dom.window.document.body.textContent;
  assert.match(result,/本批检查未完成/);
  assert.match(result,/Research budget and statistical model limitations/);
  assert.doesNotMatch(result,/1234|maxCostUsd|baseURL|dashscope\.aliyuncs/);
 }finally{dom.window.close();}
});

test('non-thesis draft has one reserved collapsed quality window across verification, consistency, review and completion',async t=>{
 const f=fixture(t);await f.panel.open();
 const key=f.$('[data-writing-quality-scroll]').getAttribute('data-scroll-key');
 assert.equal(f.$('[data-writing-quality-panel]').open,false);
 assert.match(f.$('[data-wj-stage]').textContent,/核验参考文献题录/);
 for(const [stage,label] of [['checking_consistency','检查正文一致性'],['reviewing_manuscript','正在审校全文']]){
  f.setItem(record({stage}));await f.panel.refresh();
  assert.match(f.$('[data-wj-stage]').textContent,new RegExp(label));
  assert.equal(f.$('[data-writing-quality-panel]').open,false);
  assert.equal(f.$('[data-writing-quality-scroll]').getAttribute('data-scroll-key'),key);
 }
 f.setItem(record({status:'completed',stage:'completed',output:{text:'这里是已保存的可编辑初稿。',sourceIds:[],quality:quality()}}));await f.panel.refresh();
 assert.equal(f.$('[data-writing-quality-panel]').open,false);
 assert.equal(f.$('[data-writing-quality-scroll]').getAttribute('data-scroll-key'),key);
 assert.equal(f.dom.window.getComputedStyle(f.$('[data-writing-quality-scroll]')).height,'320px');
 assert.equal(f.dom.window.getComputedStyle(f.$('[data-writing-quality-scroll]')).overflow,'auto');
 assert.match(f.$('[data-writing-quality-scroll]').textContent,/任务确认的参考文献/);
 assert.equal(f.$('[data-wj-apply]').disabled,false);
 assert.equal(f.calls.some(row=>row.data),false);
});

test('non-thesis quality updates preserve expansion, nested scroll and focus without modifying generated text',async t=>{
 const initial=record({status:'completed',stage:'completed',output:{text:'原始正文，不能由检查窗口改写。',sourceIds:[],quality:quality()}}),f=fixture(t,{item:initial});await f.panel.open();
 f.$('[data-writing-quality-panel]').open=true;f.$('[data-writing-quality-scroll]').scrollTop=117;f.$('[data-writing-quality-summary]').focus();
 const next=structuredClone(initial);next.output.quality.stale=true;next.output.quality.reviews[0].outcome='review_required';next.output.quality.reviews[0].findings=[{sectionId:'c1',sectionTitle:'结果与讨论 <img src=x onerror=1>',quote:'原始正文，不能由检查窗口改写。',category:'claim_scope',severity:'warning',explanation:'请核对结论范围。',suggestion:'用原始数据限定论证范围。'}];f.setItem(next);await f.panel.refresh();
 assert.equal(f.$('[data-writing-quality-panel]').open,true);
 assert.equal(f.$('[data-writing-quality-scroll]').scrollTop,117);
 assert.equal(f.dom.window.document.activeElement,f.$('[data-writing-quality-summary]'));
 assert.match(f.$('[data-writing-quality-scroll]').textContent,/正文已修改，以下为生成时检查记录/);
 assert.match(f.$('[data-writing-quality-scroll]').textContent,/用原始数据限定论证范围/);
 assert.equal(f.$('img,script'),null);
 assert.match(f.$('#writing-job-preview').value,/原始正文，不能由检查窗口改写/);
 assert.equal(f.calls.some(row=>row.data),false);
});
